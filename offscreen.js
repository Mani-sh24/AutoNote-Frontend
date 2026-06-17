let stream = null;
let audioContext = null;
let sourceNode = null;
let processorNode = null;
let mp3Encoder = null;
let mp3Chunks = [];
let isRecording = false;
let isFinishing = false;

const BACKEND_URL = "http://localhost:8000/upload-audio";
const MP3_BITRATE = 128;
const BUFFER_SIZE = 4096;

function report(event, details = {}) {
  return chrome.runtime.sendMessage({
    type: "OFFSCREEN_EVENT",
    event,
    ...details
  }).catch(() => undefined);
}

async function cleanup() {
  isRecording = false;
  isFinishing = false;

  if (processorNode) {
    processorNode.onaudioprocess = null;
    processorNode.disconnect();
  }
  if (sourceNode) {
    sourceNode.disconnect();
  }
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
  if (audioContext && audioContext.state !== "closed") {
    await audioContext.close().catch(() => undefined);
  }

  stream = null;
  audioContext = null;
  sourceNode = null;
  processorNode = null;
  mp3Encoder = null;
  mp3Chunks = [];
}

function toMonoInt16(inputBuffer) {
  const left = inputBuffer.getChannelData(0);
  const right = inputBuffer.numberOfChannels > 1 ? inputBuffer.getChannelData(1) : left;
  const pcm = new Int16Array(left.length);

  for (let index = 0; index < left.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, (left[index] + right[index]) * 0.5));
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  return pcm;
}

function monitorTabAudio(event) {
  const channels = Math.min(event.inputBuffer.numberOfChannels, event.outputBuffer.numberOfChannels);
  for (let channel = 0; channel < channels; channel += 1) {
    event.outputBuffer.getChannelData(channel).set(event.inputBuffer.getChannelData(channel));
  }

  if (!isRecording || !mp3Encoder) {
    return;
  }

  const encoded = mp3Encoder.encodeBuffer(toMonoInt16(event.inputBuffer));
  if (encoded.length > 0) {
    mp3Chunks.push(encoded);
  }
}

async function uploadRecording(blob) {
  const formData = new FormData();
  formData.append("file", blob, "tab_recording.mp3");

  const response = await fetch(BACKEND_URL, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Server returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const json = await response.json();
    return json.summary || json.Summary || json.transcript || JSON.stringify(json);
  }

  return response.text();
}

async function finishRecording() {
  if (!isRecording || isFinishing) {
    return;
  }

  isFinishing = true;
  isRecording = false;
  await report("CAPTURE_ENDED");

  try {
    const finalChunk = mp3Encoder.flush();
    if (finalChunk.length > 0) {
      mp3Chunks.push(finalChunk);
    }

    const recording = new Blob(mp3Chunks, { type: "audio/mpeg" });
    if (!recording.size) {
      throw new Error("No audio was captured from this tab.");
    }

    const summary = await uploadRecording(recording);
    await report("UPLOAD_SUCCESS", { summary });
  } catch (error) {
    await report("UPLOAD_ERROR", { error: error.message });
  } finally {
    await cleanup();
    await report("CLEANED_UP");
  }
}

async function startAudio(streamId) {
  if (!streamId) {
    throw new Error("No tab audio stream was provided.");
  }
  if (!globalThis.lamejs?.Mp3Encoder) {
    throw new Error("MP3 encoder failed to load.");
  }

  await cleanup();
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId
      }
    }
  });

  audioContext = new AudioContext();
  sourceNode = audioContext.createMediaStreamSource(stream);
  processorNode = audioContext.createScriptProcessor(BUFFER_SIZE, 2, 2);
  mp3Encoder = new lamejs.Mp3Encoder(1, audioContext.sampleRate, MP3_BITRATE);
  mp3Chunks = [];
  isRecording = true;
  isFinishing = false;

  processorNode.onaudioprocess = monitorTabAudio;
  sourceNode.connect(processorNode);
  processorNode.connect(audioContext.destination);
  await audioContext.resume();

  stream.getAudioTracks()[0]?.addEventListener("ended", () => {
    finishRecording();
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "OFFSCREEN_START_CAPTURE") {
    startAudio(message.streamId)
      .then(() => sendResponse({ ok: true }))
      .catch(async (error) => {
        await cleanup();
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (message.type === "OFFSCREEN_STOP_CAPTURE") {
    if (!isRecording) {
      sendResponse({ ok: false, error: "There is no active recording." });
      return false;
    }

    finishRecording();
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
