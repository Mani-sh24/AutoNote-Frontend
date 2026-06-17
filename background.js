const OFFSCREEN_URL = "offscreen.html";
const DEFAULT_SESSION = {
  state: "idle",
  status: "Ready to capture a tab",
  summary: "",
  error: "",
  updatedAt: 0
};

async function getSession() {
  const { session } = await chrome.storage.local.get("session");
  return { ...DEFAULT_SESSION, ...session };
}

async function updateSession(changes) {
  const session = {
    ...(await getSession()),
    ...changes,
    updatedAt: Date.now()
  };
  await chrome.storage.local.set({ session });
  return session;
}

async function hasOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
  });
  return contexts.length > 0;
}

async function closeOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    await chrome.offscreen.closeDocument().catch(() => undefined);
  }
}

async function syncSession() {
  const session = await getSession();
  const inProgress = ["starting", "recording", "uploading"].includes(session.state);
  if (inProgress && !(await hasOffscreenDocument())) {
    return updateSession({
      state: "error",
      status: "Capture was interrupted",
      error: "Start a new capture to continue."
    });
  }
  return session;
}

async function startCapture(tabId) {
  const session = await getSession();
  if (session.state === "recording" || session.state === "uploading") {
    throw new Error("A capture is already active.");
  }

  await closeOffscreenDocument();
  await updateSession({
    state: "starting",
    status: "Connecting to tab audio...",
    summary: "",
    error: ""
  });

  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["USER_MEDIA"],
      justification: "Record tab audio for transcription"
    });

    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tabId
    });
    const result = await chrome.runtime.sendMessage({
      type: "OFFSCREEN_START_CAPTURE",
      streamId
    });

    if (!result?.ok) {
      throw new Error(result?.error || "Audio recording could not start.");
    }

    await updateSession({
      state: "recording",
      status: "Listening to this tab..."
    });
  } catch (error) {
    await closeOffscreenDocument();
    await updateSession({
      state: "error",
      status: "Could not start capture",
      error: error.message
    });
    throw error;
  }
}

async function stopCapture() {
  const session = await getSession();
  if (session.state !== "recording") {
    return;
  }

  await updateSession({
    state: "uploading",
    status: "Preparing your summary..."
  });

  const result = await chrome.runtime.sendMessage({ type: "OFFSCREEN_STOP_CAPTURE" });
  if (!result?.ok) {
    await updateSession({
      state: "error",
      status: "Could not stop capture",
      error: result?.error || "Recorder was not available."
    });
    await closeOffscreenDocument();
  }
}

async function handleOffscreenEvent(message) {
  if (message.event === "UPLOAD_SUCCESS") {
    const summary = message.summary || "No summary was returned.";
    await updateSession({
      state: "idle",
      status: "Summary ready",
      summary,
      error: ""
    });
  }

  if (message.event === "UPLOAD_ERROR") {
    await updateSession({
      state: "error",
      status: "Transcription failed",
      error: message.error || "The server did not return a summary."
    });
  }

  if (message.event === "CAPTURE_ENDED") {
    const session = await getSession();
    if (session.state === "recording") {
      await updateSession({
        state: "uploading",
        status: "Tab audio ended. Preparing summary..."
      });
    }
  }

  if (message.event === "CLEANED_UP") {
    await closeOffscreenDocument();
  }
}

chrome.runtime.onInstalled.addListener(() => {
  getSession().then((session) => chrome.storage.local.set({ session }));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_CAPTURE_REQUEST") {
    startCapture(message.tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "STOP_CAPTURE_REQUEST") {
    stopCapture()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "GET_SESSION_REQUEST") {
    syncSession()
      .then((session) => sendResponse({ ok: true, session }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "OFFSCREEN_EVENT" && sender.url?.endsWith(OFFSCREEN_URL)) {
    handleOffscreenEvent(message)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});
