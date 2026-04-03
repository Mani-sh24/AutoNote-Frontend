# Chrome Audio Capture Extension

A lightweight browser extension that captures audio from active browser tabs (e.g., meetings) and forwards it to a backend service for transcription and summarization.

## What it does

- Captures live audio from a browser tab using Chrome extension APIs.
- Posts captured audio data to a Python backend.
- Backend uses NLP to generate an extractive meeting summary.
- Returns the summary to the extension UI for user review.

## Installation

1. Clone repository:
   ```bash
   git clone <repo-url>
   cd Transcriber
   ```
2. Open Chrome and go to `chrome://extensions/`
3. Enable Developer mode (top right)
4. Click "Load unpacked" and choose this repository folder

## Usage

- Open the extension popup to start/stop capturing tab audio.
- The extension sends audio chunks to a Python backend endpoint.
- The backend analyzes speech, runs NLP summarization, and sends back summary text.
- Display returned summary in the extension UI.

## Architecture

- Frontend: Chrome extension (`manifest.json`, `popup.html`, `popup.js`, `offscreen.js`).
- Backend: Python service (not included here) exposes HTTP API for audio upload + summary output.

