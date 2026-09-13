let rows = [], all = [];
let sortKey = "leadScore", sortDir = -1;
const $ = (id) => document.getElementById(id);

function fillSelect(sel, values, label) {
  const cur = sel.value;
  sel.innerHTML = `<option value="all">${label}</option>` + values.map(([v, n]) => `<option value="${esc(v)}">${esc(v)} (${n})</option>`).join("");
  sel.value = values.some(([v]) => v === cur) ? cur : "all";
}

async function load() {
  const { posts = {}, snaps = {}, meta = {} } = await chrome.storage.local.get(["posts", "snaps", "meta"]);
  const now = Date.now();
  const days = Number($("days").value);
  all = Object.values(posts).filter((p) => now - p.created <= days * 86400000).map((p) => toRow(p, snaps[p.id], now));

  // Populate category and keyword filters from what actually matched, with counts.
  const gc = {}, kc = {};
  for (const r of all) { for (const g of r.groups) gc[g] = (gc[g] || 0) + 1; for (const k of r.keywords) kc[k] = (kc[k] || 0) + 1; }
  fillSelect($("group"), Object.entries(gc).sort((a, b) => b[1] - a[1]), "All categories");
  const group = $("group").value;
  const kwEntries = Object.entries(kc).sort((a, b) => b[1] - a[1]);
  fillSelect($("kw"), group === "all" ? kwEntries : kwEntries.filter(([k]) => all.some((r) => r.keywords.includes(k) && r.groups.includes(group))), "All keywords");

  const type = $("type").value, kw = $("kw").value, q = $("q").value.trim().toLowerCase();
  rows = all
    .filter((r) => type === "all" || r.type === type)
    .filter((r) => group === "all" || r.groups.includes(group))
    .filter((r) => kw === "all" || r.keywords.includes(kw))
    .filter((r) => !q || r.title.toLowerCase().includes(q) || r.sub.toLowerCase().includes(q) || r.body.toLowerCase().includes(q) || r.keywords.join(" ").toLowerCase().includes(q));

  const st = $("status");
  if (meta.running) st.textContent = `Running: ${meta.stage || "…"} · ${meta.requests || 0} requests · ${meta.kept || 0} kept of ${meta.scanned || 0} scanned${meta.oauth ? "" : " · no API key (slow)"}`;
  else if (meta.lastRun) st.textContent = `${rows.length} shown · ${meta.count || 0} tracked · ${meta.analysed || 0} comment-read · last run ${new Date(meta.lastRun).toLocaleString()} (${meta.durationMin} min, ${meta.requests || "?"} req${meta.oauth ? ", API key" : ""})${meta.errors && meta.errors.length ? ` · ${meta.errors.length} errors: ${meta.errors[0]}` : ""}`;
  else st.textContent = "No data yet. Add a Reddit API client id in Options for fast runs, then click Refresh now.";
  render();
}

function render() {
  const tb = document.querySelector("#t tbody");
  const sorted = rows.slice().sort((a, b) => (a[sortKey] > b[sortKey] ? 1 : a[sortKey] < b[sortKey] ? -1 : 0) * sortDir);
  const top = sorted.length ? Math.max(...sorted.map((r) => r.leadScore)) : 0;
  tb.innerHTML = "";
  for (const r of sorted.slice(0, 500)) {
    const tr = document.createElement("tr");
    const td = (html, cls) => { const d = document.createElement("td"); d.innerHTML = html; if (cls) d.className = cls; tr.appendChild(d); };
    td(`<span class="${r.leadScore >= Math.max(8, top * 0.5) ? "hot" : ""}">${r.analysed ? r.leadScore : '<span class="muted" title="comments not read yet">·</span>'}</span>`, "num");
    td(String(r.heat), "num");
    td(`<span class="tag ${r.type}">${r.type}</span>`);
    td(`r/${r.sub}`);
    td(r.price || '<span class="muted">—</span>');
    td(r.score, "num"); td(r.comments, "num"); td(r.dComments48h, "num");
    td(r.leadReplies ? `<span class="tag lead">${r.leadReplies}</span>` : "0", "num");
    td(r.buyerReplies ? `<span class="tag lead">${r.buyerReplies}</span>` : "0", "num");
    td(String(r.opReplies), "num");
    td(r.heckles ? `<span class="tag heckle">${r.heckles}</span>` : "0", "num");
    td(r.posted);
    td(`${r.closed ? '<span class="tag closed">booked/closed</span>' : ""}<a href="${r.url}" target="_blank" rel="noopener">${esc(r.title)}</a>` +
       (r.keywords.length ? `<div class="kw"><b>${esc(r.groups.join(", "))}</b> · ${esc(r.keywords.slice(0, 5).join(" · "))}${r.keywords.length > 5 ? ` · +${r.keywords.length - 5}` : ""}</div>` : "") +
       (r.sampleReply ? `<div class="sample">“${esc(r.sampleReply)}”</div>` : ""), "title");
    tb.appendChild(tr);
  }
}
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

document.querySelectorAll("th").forEach((th) => th.addEventListener("click", () => { const k = th.dataset.k; if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = -1; } render(); }));
["type", "group", "kw", "days"].forEach((id) => $(id).addEventListener("change", load));
$("q").addEventListener("input", load);
$("opts").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("refresh").addEventListener("click", () => {
  $("status").textContent = "Starting run… you can close this popup; progress shows when you reopen it.";
  chrome.runtime.sendMessage({ type: "refresh" }, () => load());
  setTimeout(load, 1500);
});
$("csv").addEventListener("click", () => {
  const blob = new Blob(["﻿" + toCsv(rows.slice().sort((a, b) => b.leadScore - a.leadScore || b.heat - a.heat))], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `reddit-lead-threads-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
});
chrome.storage.onChanged.addListener((ch) => { if (ch.meta || ch.posts) load(); });
load();
