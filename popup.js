const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const statusEl = document.getElementById("status");
const errorEl = document.getElementById("error");
const statusPill = document.getElementById("status-pill");
const stateLabel = document.getElementById("state-label");
const waves = document.getElementById("waves");
const summaryEl = document.getElementById("summary");
const hintEl = document.getElementById("summary-hint");
const copyBtn = document.getElementById("copy-summary");
const downloadBtn = document.getElementById("download-summary");

const DEFAULT_SESSION = {
  state: "idle",
  status: "Ready to capture a tab",
  summary: "",
  error: ""
};

const LABELS = {
  idle: "Ready",
  starting: "Starting",
  recording: "Recording",
  uploading: "Processing",
  error: "Needs attention"
};

let session = DEFAULT_SESSION;

function render(nextSession) {
  session = { ...DEFAULT_SESSION, ...nextSession };
  const active = session.state === "starting" || session.state === "recording";
  const hasSummary = Boolean(session.summary);

  statusPill.className = `status-pill ${session.state}`;
  stateLabel.textContent = LABELS[session.state] || LABELS.idle;
  waves.classList.toggle("active", session.state === "recording");
  statusEl.textContent = session.status;
  errorEl.textContent = session.error;
  errorEl.hidden = !session.error;

  startBtn.disabled = active || session.state === "uploading";
  stopBtn.disabled = session.state !== "recording";
  summaryEl.value = session.summary;
  copyBtn.disabled = !hasSummary;
  downloadBtn.disabled = !hasSummary;
  hintEl.textContent = hasSummary ? "Saved for this session" : "Appears here after capture";
}

async function readSession() {
  const response = await chrome.runtime.sendMessage({ type: "GET_SESSION_REQUEST" });
  if (!response?.ok) {
    throw new Error(response?.error || "State could not be restored.");
  }
  render(response.session);
}

startBtn.addEventListener("click", async () => {
  render({
    ...session,
    state: "starting",
    status: "Requesting access to active tab audio...",
    error: ""
  });

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("Open a normal browser tab and try again.");
    }

    const response = await chrome.runtime.sendMessage({
      type: "START_CAPTURE_REQUEST",
      tabId: tab.id
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Capture could not start.");
    }
  } catch (error) {
    render({
      ...session,
      state: "error",
      status: "Could not start capture",
      error: error.message
    });
  }
});

stopBtn.addEventListener("click", async () => {
  stopBtn.disabled = true;
  statusEl.textContent = "Stopping capture...";
  const response = await chrome.runtime.sendMessage({ type: "STOP_CAPTURE_REQUEST" });
  if (!response?.ok) {
    render({
      ...session,
      state: "error",
      status: "Could not stop capture",
      error: response?.error || "Please try again."
    });
  }
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(summaryEl.value);
    statusEl.textContent = "Summary copied to clipboard";
  } catch (error) {
    statusEl.textContent = "Copy failed";
    errorEl.textContent = error.message;
    errorEl.hidden = false;
  }
});

downloadBtn.addEventListener("click", () => {
  const blob = new Blob([summaryEl.value], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  link.href = url;
  link.download = `scribewave_summary_${timestamp}.txt`;
  link.click();
  URL.revokeObjectURL(url);
  statusEl.textContent = "Summary downloaded";
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.session) {
    render(changes.session.newValue);
  }
});

readSession().catch((error) => {
  render({
    state: "error",
    status: "Could not read extension state",
    error: error.message
  });
});
