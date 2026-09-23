// Host Catalog - background service worker
//
// Listens at the network layer (chrome.webRequest) rather than injecting a
// content script, so it sees every request a page issues - including ones a
// CSP or ad-blocker later cancels - and buckets them by hostname + resource
// type while capture is active. State is persisted to chrome.storage.local
// so it survives MV3 service-worker restarts.

const STORAGE_KEY = "hostCatalogState";
const MAX_SAMPLES_PER_TYPE = 15;

const TYPE_LABELS = {
  main_frame: "Page navigation",
  sub_frame: "Iframe",
  stylesheet: "CSS",
  script: "JavaScript",
  image: "Image",
  font: "Font",
  object: "Object/Plugin",
  xmlhttprequest: "API call (XHR/Fetch)",
  ping: "Ping/Beacon",
  csp_report: "CSP report",
  media: "Media",
  websocket: "WebSocket",
  manifest: "Web app manifest",
  other: "Other",
};

function emptyState() {
  return {
    active: false,
    startedAt: null,
    stoppedAt: null,
    hosts: {}, // hostname -> host record
  };
}

let state = emptyState();
let saveTimer = null;

function emptyHostRecord(host) {
  const now = Date.now();
  return {
    host,
    firstSeen: now,
    lastSeen: now,
    requestCount: 0,
    types: {}, // resourceType -> count
    methods: {}, // HTTP method -> count
    statusCodes: {}, // status code -> count
    errors: {}, // net error -> count (blocked/failed requests)
    initiators: {}, // origin of the page that triggered the request -> count
    samples: {}, // resourceType -> [url, ...] (capped)
  };
}

async function loadState() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  if (data && data[STORAGE_KEY]) {
    state = data[STORAGE_KEY];
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  }, 400);
}

async function saveStateNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function getInitiatorOrigin(details) {
  try {
    if (details.initiator && details.initiator !== "null") return details.initiator;
    if (details.documentUrl) return new URL(details.documentUrl).origin;
  } catch (e) {
    /* ignore malformed initiator/documentUrl */
  }
  return null;
}

function bump(obj, key) {
  if (key === undefined || key === null) return;
  obj[key] = (obj[key] || 0) + 1;
}

function recordRequest(details, { error } = {}) {
  if (!state.active) return;

  let host;
  try {
    host = new URL(details.url).hostname;
  } catch (e) {
    return;
  }
  if (!host) return;

  if (!state.hosts[host]) {
    state.hosts[host] = emptyHostRecord(host);
  }
  const rec = state.hosts[host];
  rec.lastSeen = Date.now();
  rec.requestCount += 1;

  bump(rec.types, details.type);
  bump(rec.methods, details.method);
  if (typeof details.statusCode === "number" && details.statusCode > 0) {
    bump(rec.statusCodes, details.statusCode);
  }
  if (error) {
    bump(rec.errors, error);
  }

  const initiatorOrigin = getInitiatorOrigin(details);
  if (initiatorOrigin) {
    bump(rec.initiators, initiatorOrigin);
  }

  const type = details.type || "other";
  if (!rec.samples[type]) rec.samples[type] = [];
  if (rec.samples[type].length < MAX_SAMPLES_PER_TYPE && !rec.samples[type].includes(details.url)) {
    rec.samples[type].push(details.url);
  }

  scheduleSave();
}

chrome.webRequest.onCompleted.addListener(
  (details) => recordRequest(details),
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => recordRequest(details, { error: details.error }),
  { urls: ["<all_urls>"] }
);

chrome.runtime.onInstalled.addListener(loadState);
chrome.runtime.onStartup.addListener(loadState);
loadState();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case "START":
        state = { active: true, startedAt: Date.now(), stoppedAt: null, hosts: {} };
        await saveStateNow();
        sendResponse({ ok: true, state });
        break;
      case "STOP":
        await loadState();
        state.active = false;
        state.stoppedAt = Date.now();
        await saveStateNow();
        sendResponse({ ok: true, state });
        break;
      case "GET_STATE":
        await loadState();
        sendResponse({ ok: true, state, typeLabels: TYPE_LABELS });
        break;
      case "CLEAR":
        state = emptyState();
        await saveStateNow();
        sendResponse({ ok: true, state });
        break;
      default:
        sendResponse({ ok: false, error: "unknown message type" });
    }
  })();
  return true; // keep the message channel open for the async response
});
