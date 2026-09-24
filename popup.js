const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
const hostCountEl = document.getElementById("hostCount");
const requestCountEl = document.getElementById("requestCount");
const durationEl = document.getElementById("duration");
const reportSection = document.getElementById("reportSection");
const reportRender = document.getElementById("reportRender");
const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");
const downloadCsvBtn = document.getElementById("downloadCsvBtn");
const downloadHostsBtn = document.getElementById("downloadHostsBtn");
const hint = document.getElementById("hint");

let pollTimer = null;
let typeLabels = {};
let currentState = null;
let currentMarkdown = "";

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
  currentState = state;
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
      currentMarkdown = buildMarkdown(state);
      reportRender.innerHTML = renderMarkdown(currentMarkdown);
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

function getHostsSorted(state) {
  return Object.values(state.hosts).sort((a, b) => b.requestCount - a.requestCount);
}

function resourceTypesFor(h) {
  return Object.entries(h.types)
    .sort((a, b) => b[1] - a[1])
    .map(([type]) => typeLabel(type))
    .join(", ");
}

function buildMarkdown(state) {
  const hosts = getHostsSorted(state);
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
    lines.push(`| \`${h.host}\` | ${h.requestCount} | ${resourceTypesFor(h) || "—"} |`);
  }
  lines.push("");

  return lines.join("\n");
}

function csvEscape(value) {
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCSV(state) {
  const hosts = getHostsSorted(state);
  const lines = ["Host,Requests,Resources"];
  for (const h of hosts) {
    lines.push([csvEscape(h.host), csvEscape(h.requestCount), csvEscape(resourceTypesFor(h))].join(","));
  }
  return lines.join("\n");
}

function buildHostnamesText(state) {
  return getHostsSorted(state).map((h) => h.host).join("\n");
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function renderTableBlock(tableLines) {
  const rows = tableLines.map((l) =>
    l.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim())
  );
  const [headerCells, ...rest] = rows;
  const bodyRows = rest.filter((r) => !r.every((c) => /^:?-+:?$/.test(c)));
  const thead = `<thead><tr>${headerCells.map((c) => `<th>${renderInline(c)}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${bodyRows
    .map((r) => `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody>`;
  return `<table>${thead}${tbody}</table>`;
}

function renderMarkdown(md) {
  const lines = md.split("\n");
  const html = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      html.push(`<h${level}>${renderInline(headingMatch[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^\|.*\|\s*$/.test(line)) {
      const tableLines = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }
      html.push(renderTableBlock(tableLines));
      continue;
    }

    if (/^-\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^-\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^-\s+/, ""));
        i++;
      }
      html.push(`<ul>${items.map((it) => `<li>${renderInline(it)}</li>`).join("")}</ul>`);
      continue;
    }

    html.push(`<p>${renderInline(line)}</p>`);
    i++;
  }
  return html.join("\n");
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

function downloadFile(content, mime, filename) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

copyBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(currentMarkdown);
  copyBtn.textContent = "Copied!";
  setTimeout(() => (copyBtn.textContent = "Copy Markdown"), 1200);
});

downloadBtn.addEventListener("click", () => {
  downloadFile(currentMarkdown, "text/markdown", `host-catalog-${timestamp()}.md`);
});

downloadCsvBtn.addEventListener("click", () => {
  if (!currentState) return;
  downloadFile(buildCSV(currentState), "text/csv", `host-catalog-${timestamp()}.csv`);
});

downloadHostsBtn.addEventListener("click", () => {
  if (!currentState) return;
  downloadFile(buildHostnamesText(currentState), "text/plain", `host-catalog-hosts-${timestamp()}.txt`);
});

refresh().then(() => {
  send({ type: "GET_STATE" }).then((res) => {
    if (res?.ok && res.state.active) startPolling();
  });
});
