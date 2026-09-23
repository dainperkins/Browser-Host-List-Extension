# Host Catalog

A Chrome extension that catalogs every distinct host a site talks to while you browse it, then exports a Markdown report of what was fetched from each host (JS, CSS, images, fonts, API calls, WebSockets, etc.).

## How it works

- The background service worker (`background.js`) listens to `chrome.webRequest.onCompleted` / `onErrorOccurred` across all tabs (so it also sees requests a CSP or ad-blocker later cancels).
- Each request is bucketed by hostname and resource type, with counts, HTTP methods, status codes, the page(s) that triggered the request, and a capped set of example URLs per type.
- State lives in `chrome.storage.local` so it survives the service worker being suspended/restarted mid-capture.
- The popup (`popup.html`/`popup.js`) starts/stops capture and renders the collected data as a Markdown report you can copy or download.

## Install (load unpacked)

1. Open `chrome://extensions`.
2. Enable "Developer mode" (top right).
3. Click "Load unpacked" and select this `host-catalog-extension` folder.
4. Pin the extension for easy access.

## Usage

1. Click the extension icon, then **Start capture**.
2. Browse the site (navigate pages, trigger the flows you care about — login, search, checkout, etc.).
3. Click **Stop capture**.
4. The popup renders a Markdown report: a summary table of hosts plus a per-host breakdown of what was accessed there. Use **Copy Markdown** or **Download .md**.
5. **Clear** resets the catalog for a fresh run.

## Notes

- Requires the `<all_urls>` host permission to observe network traffic across every host a page contacts, plus `webRequest`/`storage`.
- Data is local to your browser (`chrome.storage.local`) — nothing is sent anywhere.
- Only use this against sites/systems you're authorized to test or inspect.
