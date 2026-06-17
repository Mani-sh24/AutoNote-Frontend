# ScribeWave Chrome Extension

A lightweight browser extension that captures audio from an active tab, forwards it to a local backend for transcription and summarization, and keeps the finished summary available when the popup is reopened.

## What it does

- Captures live audio from a browser tab using Chrome extension APIs.
- Encodes captured audio as MP3 and posts it to a Python backend.
- Backend uses NLP to generate an extractive meeting summary.
- Persists capture status and returned summaries in the popup between opens.
- Supports copying or downloading a finished summary.

## Installation

1. Clone repository:
   ```bash
   git clone <repo-url>
   cd Transcriber
   npm install
   ```
2. Open Chrome and go to `chrome://extensions/`
3. Enable Developer mode (top right)
4. Click "Load unpacked" and choose this repository folder

Chrome 116 or newer is required for background tab capture through an offscreen document.

## Usage

- Open the extension popup from a tab that is playing audio and click **Start capture**.
- Click **Stop** when the segment is complete. The popup may be closed during recording or processing.
- Review the returned summary, then use **Copy text** or **Download**.
- Ensure the backend accepts `audio/mpeg` MP3 uploads at `http://localhost:8000/upload-audio`.

## Architecture

- Frontend: Chrome extension (`manifest.json`, `popup.html`, `popup.css`, `popup.js`).
- Capture lifecycle: background service worker (`background.js`) and offscreen recorder (`offscreen.js`).
- Backend: Python service (not included here) exposes HTTP API for audio upload + summary output.
