let rows = [];
let sortKey = "leadScore", sortDir = -1;
const $ = (id) => document.getElementById(id);

async function load() {
  const { posts = {}, snaps = {}, meta = {} } = await chrome.storage.local.get(["posts", "snaps", "meta"]);
  const now = Date.now();
  const days = Number($("days").value), type = $("type").value, q = $("q").value.trim().toLowerCase();
  rows = Object.values(posts)
    .filter((p) => now - p.created <= days * 86400000)
    .filter((p) => type === "all" || p.type === type)
    .map((p) => toRow(p, snaps[p.id], now))
    .filter((r) => !q || r.title.toLowerCase().includes(q) || r.sub.toLowerCase().includes(q) || r.keywords.join(" ").toLowerCase().includes(q));
  const st = $("status");
  if (meta.running) st.textContent = `Running: ${meta.stage || "…"} (${meta.done || 0}/${meta.totalReq || "?"} searches)`;
  else if (meta.lastRun) st.textContent = `${rows.length} shown · ${meta.count || 0} tracked · ${meta.analysed || 0} comment-analysed · last run ${new Date(meta.lastRun).toLocaleString()} (${meta.durationMin || "?"} min)${meta.errors && meta.errors.length ? ` · ${meta.errors.length} errors` : ""}`;
  else st.textContent = "No data yet. Click Refresh now (first run takes ~30 to 40 minutes with default keywords).";
  render();
}

function render() {
  const tb = document.querySelector("#t tbody");
  const sorted = rows.slice().sort((a, b) => (a[sortKey] > b[sortKey] ? 1 : a[sortKey] < b[sortKey] ? -1 : 0) * sortDir);
  const top = sorted.length ? Math.max(...sorted.map((r) => r.leadScore)) : 0;
  tb.innerHTML = "";
  for (const r of sorted.slice(0, 400)) {
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
       (r.keywords.length ? `<div class="kw">${esc(r.keywords.slice(0, 4).join(" · "))}</div>` : "") +
       (r.sampleReply ? `<div class="sample">“${esc(r.sampleReply)}”</div>` : ""), "title");
    tb.appendChild(tr);
  }
}
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

document.querySelectorAll("th").forEach((th) => th.addEventListener("click", () => { const k = th.dataset.k; if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = -1; } render(); }));
["type", "days"].forEach((id) => $(id).addEventListener("change", load));
$("q").addEventListener("input", load);
$("opts").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("refresh").addEventListener("click", async () => {
  $("status").textContent = "Starting run… you can close this popup; progress shows here when you reopen it.";
  chrome.runtime.sendMessage({ type: "refresh" }, () => load());
  setTimeout(load, 1500);
});
$("csv").addEventListener("click", () => {
  const blob = new Blob([toCsv(rows.slice().sort((a, b) => b.leadScore - a.leadScore || b.heat - a.heat))], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `reddit-lead-threads-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
});
chrome.storage.onChanged.addListener((ch) => { if (ch.meta || ch.posts) load(); });
load();
