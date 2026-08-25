# Crispr browser extension (FR-49)

Detects a PDF open in the current tab and ingests it into your Crispr workspace
without leaving the page, then opens chat scoped to it.

## Install (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this `extension/` folder.
4. Click the Crispr toolbar icon, enter your app URL (default `http://localhost:3000`), and hit **Ingest & ask**.

## How it works

The popup POSTs the tab's PDF URL to `POST /api/documents/fetch-url`. The app
downloads the file server-side, dedupes by hash, runs normal ingestion
(chunk → embed → vector index), and returns the document id. The chat page is
then opened with that document selected.

Notes:
- The extension talks directly to your app origin — no third-party relay.
- Ingestion respects workspace RBAC: you act as the user configured in the app.
- Only PDF URLs are supported today; other types are rejected client-side.
