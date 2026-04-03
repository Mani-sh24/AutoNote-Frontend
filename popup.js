// Function to download text content as a file
function downloadSummary(text, filename = 'transcription_summary.txt') {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}

const startBtn = document.getElementById('start');
const stopBtn = document.getElementById('stop');
const statusEl = document.getElementById('status');
const summaryEl = document.getElementById('summary');
const copyBtn = document.getElementById('copy-summary');

// 1. When the popup opens, check recording state from storage
async function checkState() {
  try {
    const result = await chrome.storage.local.get(['isRecording']);
    const isRecording = result.isRecording || false;

    if (isRecording) {
      // Check if offscreen document still exists
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
      });

      if (contexts.length > 0) {
        // Recording is active
        startBtn.disabled = true;
        stopBtn.disabled = false;
        statusEl.textContent = "Capturing...";
        return;
      } else {
        // Offscreen document gone, reset state
        await chrome.storage.local.set({ isRecording: false });
      }
    }

    // No active recording
    startBtn.disabled = false;
    stopBtn.disabled = true;
    statusEl.textContent = "Ready";
    summaryEl.value = "";
    copyBtn.disabled = true;
  } catch (err) {
    // Fallback to ready state on error
    startBtn.disabled = false;
    stopBtn.disabled = true;
    statusEl.textContent = "Ready";
    summaryEl.value = "";
    copyBtn.disabled = true;
  }
}

checkState();

startBtn.onclick = async () => {
  try {
    // Clean up any existing offscreen documents first
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });

    for (const context of existingContexts) {
      try {
        await chrome.offscreen.closeDocument();
      } catch (e) {
        // Ignore errors when closing existing documents
      }
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });

    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Process PCM audio from tab'
    });

    chrome.runtime.sendMessage({ type: 'START_CAPTURE', streamId });

    // Mark as recording in storage
    await chrome.storage.local.set({ isRecording: true });

    startBtn.disabled = true;
    stopBtn.disabled = false;
    statusEl.textContent = "Capturing...";
    summaryEl.value = "";
    copyBtn.disabled = true;
  } catch (err) {
    console.error("Capture failed:", err);
    statusEl.textContent = "Error: Use a user-facing tab";
    startBtn.disabled = false;
    stopBtn.disabled = true;
    await chrome.storage.local.set({ isRecording: false });
  }
};

stopBtn.onclick = async () => {
  chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' });

  // Clear recording state in storage
  await chrome.storage.local.set({ isRecording: false });

  startBtn.disabled = false;
  stopBtn.disabled = true;
  statusEl.textContent = "Stopped; waiting for server response...";
};

copyBtn.onclick = async () => {
  try {
    await navigator.clipboard.writeText(summaryEl.value);
    statusEl.textContent = "Copied to clipboard";
    setTimeout(() => {
      if (statusEl.textContent === "Copied to clipboard") statusEl.textContent = "Ready";
    }, 1200);
  } catch (err) {
    console.error("Copy failed:", err);
    statusEl.textContent = "Copy failed";
  }
};

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SERVER_RESPONSE') {
    const text = message.summary || message.data || "(no summary received)";
    summaryEl.value = text;
    statusEl.textContent = "Server response received";
    copyBtn.disabled = !text;

    // Automatically download the summary
    if (text && text !== "(no summary received)" && text !== "(response parse failed)") {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const filename = `transcription_summary_${timestamp}.txt`;
      downloadSummary(text, filename);
      statusEl.textContent = "Summary downloaded automatically";
    }

    // Clear recording state and reset status after showing response
    chrome.storage.local.set({ isRecording: false });
    setTimeout(() => {
      if (statusEl.textContent === "Server response received" || statusEl.textContent === "Summary downloaded automatically") {
        statusEl.textContent = "Ready";
      }
    }, 3000);
  }

  if (message.type === 'SERVER_ERROR') {
    statusEl.textContent = `Server error: ${message.error || 'unknown'}`;
    summaryEl.value = "";
    copyBtn.disabled = true;
    // Clear recording state and reset status after showing error
    chrome.storage.local.set({ isRecording: false });
    setTimeout(() => {
      if (statusEl.textContent.startsWith("Server error:")) {
        statusEl.textContent = "Ready";
      }
    }, 5000);
  }

  if (message.type === 'RECORDING_STOPPED') {
    // Recording has actually stopped, clear the state
    chrome.storage.local.set({ isRecording: false });
  }
});
