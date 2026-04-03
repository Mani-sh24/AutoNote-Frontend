let stream = null;
let recorder = null;
let recordedChunks = [];
let playbackAudio = null;

const backend_url = "http://localhost:8000/upload-audio"; // IMPORTANT: NOT 0.0.0.0

chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.type === "START_CAPTURE") {
    await startAudio(msg.streamId);
  }

  if (msg.type === "STOP_CAPTURE") {
    stopAudio();
  }
});

async function startAudio(streamId) {
  try {
    // If already recording, stop previous session cleanly
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }

    recordedChunks = [];

    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId
        }
      }
    });

    // 🔊 Restore tab audio playback
    playbackAudio = new Audio();
    playbackAudio.srcObject = stream;
    await playbackAudio.play();

    recorder = new MediaRecorder(stream, {
      mimeType: "audio/webm;codecs=opus"
    });

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    recorder.onstop = async () => {
      try {
        const finalBlob = new Blob(recordedChunks, {
          type: "audio/webm"
        });

        await uploadFullRecording(finalBlob);
      } catch (err) {
        console.error("Upload failed:", err);
      }

      cleanup();
    };

    recorder.start();
    console.log("Recording started");

  } catch (err) {
    console.error("Start capture error:", err);
  }
}

async function uploadFullRecording(blob) {
  const formData = new FormData();
  formData.append("file", blob, "full_recording.webm");

  const response = await fetch(backend_url, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    chrome.runtime.sendMessage({ type: 'SERVER_ERROR', error: `HTTP ${response.status}: ${errorText}` });
    throw new Error("Upload failed with status " + response.status);
  }

  let summaryText = "";

  try {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = await response.json();
      summaryText = json.Summary || json.summary || json.transcript || JSON.stringify(json);
    } else {
      summaryText = await response.text();
    }
  } catch (err) {
    console.warn('Could not parse backend response as JSON/text', err);
    summaryText = "(response parse failed)";
  }

  chrome.runtime.sendMessage({ type: 'SERVER_RESPONSE', summary: summaryText });
  console.log("Full recording uploaded successfully", summaryText);
}

function stopAudio() {
  try {
    if (recorder && recorder.state === "recording") {
      recorder.stop(); // triggers onstop
    } else {
      cleanup();
    }

    console.log("Stop requested");
  } catch (err) {
    console.error("Stop error:", err);
  }
}

function cleanup() {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }

  if (playbackAudio) {
    playbackAudio.pause();
    playbackAudio.srcObject = null;
    playbackAudio = null;
  }

  recorder = null;
  recordedChunks = [];

  // Notify popup that recording has stopped
  chrome.runtime.sendMessage({ type: 'RECORDING_STOPPED' });

  console.log("Capture fully stopped and cleaned up");
}
