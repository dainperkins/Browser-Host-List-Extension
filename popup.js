const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
const hostCountEl = document.getElementById("hostCount");
const requestCountEl = document.getElementById("requestCount");
const durationEl = document.getElementById("duration");
const reportSection = document.getElementById("reportSection");
const reportText = document.getElementById("reportText");
const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");
const hint = document.getElementById("hint");

let pollTimer = null;
let typeLabels = {};

function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function totalRequests(state) {
  return Object.values(state.hosts).reduce((sum, h) => sum + h.requestCount, 0);
}

function render(state) {
  const hostCount = Object.keys(state.hosts).length;
  const reqCount = totalRequests(state);

  if (state.active) {
    statusEl.textContent = "Capturing";
    statusEl.className = "status active";
    startBtn.disabled = true;
    stopBtn.disabled = false;
    summaryEl.hidden = false;
    reportSection.hidden = true;
    hint.textContent = "Browse the site now. Click \"Stop capture\" when done.";
    durationEl.textContent = fmtDuration(Date.now() - state.startedAt);
  } else if (state.startedAt) {
    statusEl.textContent = "Stopped";
    statusEl.className = "status stopped";
    startBtn.disabled = false;
    stopBtn.disabled = true;
    summaryEl.hidden = false;
    durationEl.textContent = fmtDuration((state.stoppedAt || Date.now()) - state.startedAt);
    if (hostCount > 0) {
      reportSection.hidden = false;
      reportText.value = buildMarkdown(state);
      hint.textContent = "Report generated below. Start a new capture to reset.";
    } else {
      hint.textContent = "No requests were captured.";
    }
  } else {
    statusEl.textContent = "Idle";
    statusEl.className = "status idle";
    startBtn.disabled = false;
    stopBtn.disabled = true;
    summaryEl.hidden = true;
    reportSection.hidden = true;
    hint.textContent = 'Click "Start capture", then browse the site you want to fingerprint. Click "Stop capture" when done to generate the report.';
  }

  hostCountEl.textContent = hostCount;
  requestCountEl.textContent = reqCount;
}

function typeLabel(type) {
  return typeLabels[type] || type;
}

function buildMarkdown(state) {
  const hosts = Object.values(state.hosts).sort((a, b) => b.requestCount - a.requestCount);
  const totalReq = totalRequests(state);
  const started = state.startedAt ? new Date(state.startedAt).toISOString() : "unknown";
  const stopped = state.stoppedAt ? new Date(state.stoppedAt).toISOString() : "unknown";
  const duration = state.startedAt && state.stoppedAt ? fmtDuration(state.stoppedAt - state.startedAt) : "n/a";

  const lines = [];
  lines.push("# Host Catalog Report");
  lines.push("");
  lines.push(`- **Captured:** ${started} → ${stopped} (${duration})`);
  lines.push(`- **Distinct hosts:** ${hosts.length}`);
  lines.push(`- **Total requests observed:** ${totalReq}`);
  lines.push("");
  lines.push("## Hosts");
  lines.push("");
  lines.push("| Host | Requests | Resources |");
  lines.push("| --- | --- | --- |");
  for (const h of hosts) {
    const resourceTypes = Object.entries(h.types)
      .sort((a, b) => b[1] - a[1])
      .map(([type]) => typeLabel(type))
      .join(", ");
    lines.push(`| \`${h.host}\` | ${h.requestCount} | ${resourceTypes || "—"} |`);
  }
  lines.push("");

  return lines.join("\n");
}

async function refresh() {
  const res = await send({ type: "GET_STATE" });
  if (!res?.ok) return;
  typeLabels = res.typeLabels || {};
  render(res.state);
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(refresh, 1000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

startBtn.addEventListener("click", async () => {
  const res = await send({ type: "START" });
  if (res?.ok) {
    render(res.state);
    startPolling();
  }
});

stopBtn.addEventListener("click", async () => {
  const res = await send({ type: "STOP" });
  if (res?.ok) {
    stopPolling();
    typeLabels = (await send({ type: "GET_STATE" }))?.typeLabels || typeLabels;
    render(res.state);
  }
});

clearBtn.addEventListener("click", async () => {
  const res = await send({ type: "CLEAR" });
  if (res?.ok) {
    stopPolling();
    render(res.state);
  }
});

copyBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(reportText.value);
  copyBtn.textContent = "Copied!";
  setTimeout(() => (copyBtn.textContent = "Copy Markdown"), 1200);
});

downloadBtn.addEventListener("click", () => {
  const blob = new Blob([reportText.value], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  a.href = url;
  a.download = `host-catalog-${stamp}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

refresh().then(() => {
  send({ type: "GET_STATE" }).then((res) => {
    if (res?.ok && res.state.active) startPolling();
  });
});
