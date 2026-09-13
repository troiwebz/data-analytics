const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function showError(where, e) { const b = $("errbar"); b.hidden = false; b.textContent = `Dashboard error in ${where}: ${e && e.message ? e.message : e}. Please copy this line and send it.`; console.error("[RLT dashboard]", where, e); }
window.addEventListener("error", (ev) => showError("page", ev.error || ev.message));
window.addEventListener("unhandledrejection", (ev) => showError("async", ev.reason));
const safe = (name, fn) => { try { fn(); } catch (e) { showError(name, e); } };
const PRICE_BANDS = ["free", "under $200", "$200–599", "$600–1499", "$1500+", "hourly", "no price"];

let all = [], rows = [], log = [], config = {}, runsReg = {}, rawPosts = {};
const f = { days: 7, who: "buyers", status: "new", q: "", kw: "", sub: "", run: "" };
let sortKey = "posted", sortDir = -1;
const open = new Set(), selected = new Set();

function priceBand(p) {
  if (!p) return "no price";
  if (p === "free") return "free";
  if (/\/hr$/.test(p)) return "hourly";
  const n = Number((p.match(/\d+/) || [0])[0]);
  if (n < 200) return "under $200"; if (n < 600) return "$200–599"; if (n < 1500) return "$600–1499"; return "$1500+";
}

// ----------------------------------------------------------------- load
async function load() {
  const { posts = {}, snaps = {}, meta = {}, log: lg = [], config: cfg = {}, runs = {} } = await chrome.storage.local.get(["posts", "snaps", "meta", "log", "config", "runs"]);
  config = cfg; runsReg = runs; rawPosts = posts; log = lg;
  const now = Date.now();
  all = Object.values(posts).map((p) => ({ ...toRow(p, snaps[p.id], now), band: priceBand(p.price), manual: !!p.manual, ignored: !!p.ignored, runs: p.runs || [], firstRun: p.firstRun || (p.runs || [])[0] || "", statusAtMs: p.statusAt || 0 }));
  $("ver").textContent = "v" + chrome.runtime.getManifest().version;
  safe("filters", renderFilterOptions);
  apply();
  safe("trends", renderTrends);
  safe("diagnostics", renderDiag);
  scheduleFileSync();
}

// --------------------------------------------------------------- filters
function inTime(r) { return !f.days || Date.now() - Date.parse(r.posted) <= f.days * 86400000; }
function inWho(r) { return f.who === "all" ? r.type !== "job" : f.who === "buyers" ? r.type === "demand" : ["offer", "freebie", "value"].includes(r.type); }
function base() { return all.filter((r) => inTime(r) && inWho(r) && (!f.run || r.runs.includes(f.run))); }

function renderFilterOptions() {
  const b = base();
  const sc = {}, kc = {};
  for (const r of b) { sc[r.sub] = (sc[r.sub] || 0) + 1; for (const k of r.keywords) kc[k] = (kc[k] || 0) + 1; }
  const subSel = $("f-sub"); subSel.innerHTML = '<option value="">any subreddit</option>' + Object.entries(sc).sort((a, b) => b[1] - a[1]).map(([s, n]) => `<option value="${esc(s)}">r/${esc(s)} (${n})</option>`).join(""); subSel.value = sc[f.sub] ? f.sub : ""; if (!sc[f.sub]) f.sub = "";
  const kwSel = $("kw"); kwSel.innerHTML = '<option value="">any keyword</option>' + Object.entries(kc).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<option value="${esc(k)}">${esc(k)} (${n})</option>`).join(""); kwSel.value = kc[f.kw] ? f.kw : ""; if (!kc[f.kw]) f.kw = "";
  const names = Array.from(new Set([...Object.keys(runsReg), ...all.flatMap((r) => r.runs)])).sort((a, b) => ((runsReg[b] && (runsReg[b].last || 0)) || 0) - ((runsReg[a] && (runsReg[a].last || 0)) || 0));
  const rs = $("run-select"); rs.innerHTML = '<option value="">any run</option>' + names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join(""); rs.value = names.includes(f.run) ? f.run : ""; if (!names.includes(f.run)) f.run = "";
  const cnt = {}; for (const r of b) cnt[r.status] = (cnt[r.status] || 0) + 1;
  $("f-status").innerHTML = `<button data-v="" class="${f.status === "" ? "on" : ""}">All<span class="n">${b.length}</span></button>` + STATUSES.map((s) => `<button data-v="${s.key}" class="s-${s.key} ${f.status === s.key ? "on" : ""}" title="${esc(s.hint)}">${s.label}<span class="n">${cnt[s.key] || 0}</span></button>`).join("");
  $("f-status").querySelectorAll("button").forEach((btn) => btn.addEventListener("click", () => { f.status = btn.dataset.v; renderFilterOptions(); apply(); }));
  $("f-time").querySelectorAll("button").forEach((btn) => btn.classList.toggle("on", Number(btn.dataset.v) === f.days));
  $("f-who").querySelectorAll("button").forEach((btn) => btn.classList.toggle("on", btn.dataset.v === f.who));
}

function apply() {
  const q = f.q.toLowerCase();
  rows = base().filter((r) =>
    (!f.status || r.status === f.status) &&
    (!f.sub || r.sub === f.sub) &&
    (!f.kw || r.keywords.includes(f.kw)) &&
    (!q || [r.title, r.body, r.sub, r.keywords.join(" "), r.author, r.note].join(" ").toLowerCase().includes(q)));
  safe("table", renderTable);
}

// ----------------------------------------------------------------- table
function renderTable() {
  const tb = document.querySelector("#t tbody");
  const val = (r) => sortKey === "posted" ? Date.parse(r.posted) : sortKey === "statusAt" ? r.statusAtMs : r[sortKey];
  const sorted = rows.slice().sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sortDir);
  document.querySelectorAll("th[data-k]").forEach((th) => { th.classList.toggle("sorted", th.dataset.k === sortKey); th.classList.toggle("asc", th.dataset.k === sortKey && sortDir === 1); });
  $("count").textContent = `${rows.length} thread${rows.length === 1 ? "" : "s"} shown · ${all.length} in database`;
  const empty = $("empty"); empty.hidden = rows.length > 0;
  if (!rows.length) empty.innerHTML = all.length ? "Nothing matches. Widen Time, switch Who, or pick a different Status." : "<b>Database is empty.</b> Run a Batch sweep with buyer categories.";
  tb.innerHTML = "";
  for (const r of sorted.slice(0, 600)) {
    const tr = document.createElement("tr"); tr.className = "row"; tr.dataset.id = r.id;
    const td = (html, cls) => { const d = document.createElement("td"); d.innerHTML = html; if (cls) d.className = cls; tr.appendChild(d); };
    td(`<input type="checkbox" data-sel="${esc(r.id)}" ${selected.has(r.id) ? "checked" : ""}>`);
    td(`<select class="stsel s-${r.status}" data-st="${esc(r.id)}">${STATUSES.map((s) => `<option value="${s.key}" ${s.key === r.status ? "selected" : ""}>${s.label}</option>`).join("")}</select>${r.statusAt ? `<div style="color:var(--muted);font-size:11px">${esc(r.statusAt.slice(5))}</div>` : ""}`);
    td(r.type === "demand" ? `<span class="opp ${r.opportunity >= 15 ? "hot" : ""}">${r.opportunity}</span>` : '<span style="color:#c4c8ce">·</span>', "num");
    td(`<span class="tag t-${r.type}">${r.type}</span>`);
    td(`r/${esc(r.sub)}`);
    td(r.price ? esc(r.price) : '<span style="color:#c4c8ce">—</span>');
    td(String(r.comments), "num");
    td(r.analysed ? String(r.leadScore) : '<span style="color:#c4c8ce" title="comments not read">·</span>', "num");
    td(r.posted.slice(5));
    td(`<div class="ttl"><div class="t">${r.runs.length > 1 ? `<span class="tag t-seen" title="${esc(r.runs.join(", "))}">×${r.runs.length}</span> ` : ""}<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a></div><div class="m">${esc(r.groups.join(", "))}${r.keywords.length ? " · " + esc(r.keywords.slice(0, 3).join(" · ")) : ""}${r.note ? ` · <i>${esc(r.note.slice(0, 80))}</i>` : ""}${r.sampleReply ? `<br><i>“${esc(r.sampleReply)}”</i>` : ""}</div></div>`);
    td(`<div class="acts"><button class="btn sm" data-reply="${esc(r.id)}" title="write a value-bomb reply">Reply</button><button class="btn sm" data-more="${esc(r.id)}" title="details, note, change type">${open.has(r.id) ? "▴" : "▾"}</button></div>`);
    tr.querySelector("[data-sel]").addEventListener("change", (e) => { e.target.checked ? selected.add(r.id) : selected.delete(r.id); updateSelCount(); });
    tr.querySelector("[data-st]").addEventListener("change", async (e) => { await setStatus(r.id, e.target.value); });
    tr.querySelector("[data-reply]").addEventListener("click", async () => { await chrome.storage.local.set({ replySelection: [r.id] }); location.href = "replies.html"; });
    tr.querySelector("[data-more]").addEventListener("click", () => { open.has(r.id) ? open.delete(r.id) : open.add(r.id); renderTable(); });
    tb.appendChild(tr);
    if (open.has(r.id)) {
      const d = document.createElement("tr"); d.className = "detail";
      d.innerHTML = `<td colspan="11"><div class="detail"><div class="grid">
        <div><h4>Post by u/${esc(r.author)}${r.flair ? " · " + esc(r.flair) : ""} · first seen ${r.firstRun ? esc(r.firstRun) : "manually"}</h4><div class="body-text">${esc(r.body) || "<i>no body captured</i>"}</div>${r.linkUrl ? `<div style="margin-top:6px"><a href="${esc(r.linkUrl)}" target="_blank">${esc(r.linkUrl)}</a></div>` : ""}
          <h4 style="margin-top:12px">Your note</h4><textarea data-note="${esc(r.id)}" placeholder="what you did, what they said, price quoted…">${esc(r.note)}</textarea></div>
        <div><h4>Type</h4><div>${["demand", "offer", "freebie", "value", "job", "other"].map((t) => `<button class="btn sm ${t === r.type ? "primary" : ""}" data-type="${t}" data-id="${esc(r.id)}">${t}</button>`).join(" ")}${r.manual ? ' <span class="tag t-good">manually set</span>' : ""}</div>
          <h4 style="margin-top:12px">Matched keywords</h4><div>${r.keywords.map((k) => `<span class="chip">${esc(k)}</span>`).join(" ") || "<i>none, kept by type</i>"}</div>
          <h4 style="margin-top:12px">Classified replies ${r.analysed ? `(${r.uniqueCommenters} people)` : ""}</h4>${r.analysed ? (r.replies.length ? `<ul>${r.replies.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "<i>no buyer / hand-raise / booked replies found</i>") : `<i>Comments not read yet. <a href="${esc(r.url)}" target="_blank">Open the thread</a> and use the orange panel.</i>`}</div>
      </div></div></td>`;
      d.querySelector("[data-note]").addEventListener("change", async (e) => { await chrome.runtime.sendMessage({ type: "override", id: r.id, patch: { note: e.target.value } }); r.note = e.target.value; scheduleFileSync(); });
      d.querySelectorAll("[data-type]").forEach((b) => b.addEventListener("click", async () => { await chrome.runtime.sendMessage({ type: "override", id: b.dataset.id, patch: { type: b.dataset.type, ignored: false } }); load(); }));
      tb.appendChild(d);
    }
  }
}

async function setStatus(id, status) {
  await chrome.runtime.sendMessage({ type: "override", id, patch: { status } });
  const r = all.find((x) => x.id === id); if (r) { r.status = status; r.statusAtMs = Date.now(); r.statusAt = new Date().toISOString().slice(0, 16).replace("T", " "); }
  renderFilterOptions(); apply(); scheduleFileSync();
}
function updateSelCount() { $("replies").textContent = `Replies for selected (${selected.size})`; }

// ------------------------------------------------------------- trends tab
function bars(el, entries, fmt) {
  const max = Math.max(1, ...entries.map((e) => e[1]));
  el.innerHTML = entries.length ? entries.map(([k, v, extra]) => `<div class="bar-r"><span class="k" title="${esc(k)}">${esc(k)}</span><div class="track"><div class="fill" style="width:${Math.round((v / max) * 100)}%"></div></div><span class="num">${fmt ? fmt(v, extra) : v}</span></div>`).join("") : '<div style="color:var(--muted)">No data yet.</div>';
}
async function saveConfig(patch) { const { config: cur = {} } = await chrome.storage.local.get(["config"]); config = { ...cur, ...patch }; await chrome.storage.local.set({ config }); }

function renderTrends() {
  const buyers = all.filter((r) => r.type === "demand");
  $("s-tracked").textContent = all.length; $("s-buyers").textContent = buyers.length;
  $("s-done").textContent = all.filter((r) => r.status !== "new").length;
  $("s-replied").textContent = all.filter((r) => ["replied", "dm", "quoted"].includes(r.status)).length;
  $("s-won").textContent = all.filter((r) => r.status === "won").length;
  const last = Math.max(0, ...all.map((r) => r.lastSeen)); $("s-last").textContent = last ? new Date(last).toLocaleString() : "nothing yet";
  renderDemandByKeyword();
  const bySub = {};
  for (const r of all) { const b = bySub[r.sub] || (bySub[r.sub] = { demand: 0, total: 0, recent: 0 }); b.total += 1; if (r.type === "demand") { b.demand += 1; if (Date.now() - Date.parse(r.posted) < 30 * 86400000) b.recent += 1; } }
  const confirmed = new Set((config.confirmedSubs || []).map((s) => s.toLowerCase()));
  const subs = Object.entries(bySub).sort((a, b) => b[1].demand - a[1].demand || b[1].total - a[1].total).slice(0, 15);
  $("i-subs").innerHTML = subs.length ? subs.map(([s, b]) => `<label class="subrow"><input type="checkbox" data-sub="${esc(s)}" ${confirmed.has(s.toLowerCase()) ? "checked" : ""}><span>r/${esc(s)}</span><span class="c">${b.demand} buyers (${b.recent} this month) · ${b.total} total</span></label>`).join("") : '<div style="color:var(--muted)">No data yet.</div>';
  $("i-subs").querySelectorAll("input[data-sub]").forEach((cb) => cb.addEventListener("change", async () => { const set = new Set(config.confirmedSubs || []); cb.checked ? set.add(cb.dataset.sub) : set.delete(cb.dataset.sub); await saveConfig({ confirmedSubs: Array.from(set) }); }));
  const byBand = {};
  for (const r of all.filter((x) => x.type === "offer")) { const b = byBand[r.band] || (byBand[r.band] = { ev: 0, n: 0, read: 0 }); b.n += 1; if (r.analysed) { b.read += 1; b.ev += r.leadReplies + r.buyerReplies + (r.closed ? 3 : 0); } }
  bars($("i-price"), PRICE_BANDS.filter((b) => byBand[b]).map((b) => [b, byBand[b].ev, byBand[b]]), (v, b) => `${v} · ${b.read}/${b.n} read`);
  const phrases = titlePhrases(buyers.map((r) => r.title), 24);
  const existing = new Set(parseKeywordText(config.keywordText || DEFAULT_KEYWORD_TEXT).map((e) => e.kw.toLowerCase().replace(/"/g, "")));
  $("i-phrases").innerHTML = phrases.length ? phrases.map(([p, n]) => `<span class="chip">${esc(p)} <span style="color:var(--muted)">${n}</span>${existing.has(p) ? "" : `<button data-p="${esc(p)}" title="add as keyword">+</button>`}</span>`).join(" ") : '<div style="color:var(--muted)">Scrape some buyer threads first.</div>';
  $("i-phrases").querySelectorAll("button[data-p]").forEach((b) => b.addEventListener("click", async () => { const text = (config.keywordText || DEFAULT_KEYWORD_TEXT).trimEnd(); const block = text.includes("# Discovered") ? text + `\n"${b.dataset.p}"` : text + `\n\n# Discovered — added from the dashboard\n"${b.dataset.p}"`; await saveConfig({ keywordText: block }); b.textContent = "✓"; b.disabled = true; }));
  renderLog();
}
function renderDemandByKeyword() {
  const days = Number($("dk-days").value) || 7;
  const groupsOf = {}; for (const e of parseKeywordText(config.keywordText || DEFAULT_KEYWORD_TEXT)) groupsOf[e.kw] = e.group;
  const postsObj = {}; for (const r of all) postsObj[r.id] = { type: r.type, created: Date.parse(r.posted), keywords: r.keywords, comments: r.comments, signals: r.analysed ? { lead: r.leadReplies, buyer: r.buyerReplies } : null };
  const list = demandByKeyword(postsObj, days, Date.now(), groupsOf);
  bars($("i-demand-kw"), list.slice(0, 14).map((e) => [e.kw, e.posts, e]), (v, e) => `${v} posts · ${e.comments} cmts`);
  const g = {}; for (const e of list) { const x = g[e.group] || (g[e.group] = { posts: 0, comments: 0 }); x.posts += e.posts; x.comments += e.comments; }
  bars($("i-demand-group"), Object.entries(g).sort((a, b) => b[1].posts - a[1].posts).map(([k, v]) => [k, v.posts, v]), (v, e) => `${v} posts · ${e.comments} cmts`);
}
function renderLog() {
  $("log").innerHTML = log.length ? log.slice().reverse().slice(0, 60).map((e) => `<div class="e"><a class="u" href="${esc(e.url)}" target="_blank" title="${esc(e.url)}">${esc(e.label || e.url)}</a><span>${e.kind === "thread" ? `${e.total} cmts · ${e.lead} hands · ${e.buyer} buyer` : `${e.kept} of ${e.scanned} saved`} · ${new Date(e.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>`).join("") : '<div style="color:var(--muted)">Nothing scraped yet.</div>';
}
async function renderDiag() {
  const r = await chrome.runtime.sendMessage({ type: "diag" }); if (!r) return;
  $("diag").textContent = `${r.log} entries · ${r.posts} threads · ${(r.bytes / 1048576).toFixed(1)} MB${r.sweepRunning ? " · sweep running" : ""}`;
  if (r.errors && r.errors.length) { const e = r.errors[r.errors.length - 1]; showError(e.where + " (background, " + new Date(e.t).toLocaleTimeString() + ")", e.msg); }
}

// ----------------------------------------------------- central file sync
const idb = { open: () => new Promise((res, rej) => { const q = indexedDB.open("rlt", 1); q.onupgradeneeded = () => q.result.createObjectStore("kv"); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }),
  get: async (k) => { const db = await idb.open(); return new Promise((res, rej) => { const t = db.transaction("kv").objectStore("kv").get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); }); },
  set: async (k, v) => { const db = await idb.open(); return new Promise((res, rej) => { const t = db.transaction("kv", "readwrite").objectStore("kv").put(v, k); t.onsuccess = () => res(); t.onerror = () => rej(t.error); }); },
  del: async (k) => { const db = await idb.open(); return new Promise((res, rej) => { const t = db.transaction("kv", "readwrite").objectStore("kv").delete(k); t.onsuccess = () => res(); t.onerror = () => rej(t.error); }); } };
let fileHandle = null, syncTimer = null, lastSync = 0;

async function initFile() { try { fileHandle = (await idb.get("central")) || null; } catch { fileHandle = null; } await renderFileState(); }
async function renderFileState() {
  const el = $("file");
  if (!window.showSaveFilePicker) { el.innerHTML = '<span class="warn">central file needs Chrome 86+</span>'; return; }
  if (!fileHandle) { el.innerHTML = '<button class="btn sm" id="pick-file" title="pick one CSV on your disk; it is rewritten in place after every change">Choose central file…</button>'; $("pick-file").addEventListener("click", pickFile); return; }
  let perm = "prompt"; try { perm = await fileHandle.queryPermission({ mode: "readwrite" }); } catch {}
  if (perm !== "granted") { el.innerHTML = `<span class="warn">${esc(fileHandle.name)}</span><button class="btn sm" id="reconnect">Reconnect file</button><button class="link" id="unlink" title="stop syncing to this file">✕</button>`; $("reconnect").addEventListener("click", async () => { try { await fileHandle.requestPermission({ mode: "readwrite" }); } catch {} await renderFileState(); syncFile(true); }); $("unlink").addEventListener("click", unlinkFile); return; }
  el.innerHTML = `<span class="ok">● ${esc(fileHandle.name)}</span><span>${lastSync ? "synced " + new Date(lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "not synced yet"}</span><button class="btn sm" id="sync-now">Sync now</button><button class="link" id="unlink" title="stop syncing to this file">✕</button>`;
  $("sync-now").addEventListener("click", () => syncFile(true)); $("unlink").addEventListener("click", unlinkFile);
}
async function pickFile() {
  try {
    fileHandle = await window.showSaveFilePicker({ suggestedName: "reddit-leads.csv", types: [{ description: "CSV", accept: { "text/csv": [".csv"] } }] });
    await idb.set("central", fileHandle);
    await renderFileState(); await syncFile(true);
  } catch (e) { if (e && e.name !== "AbortError") showError("choose file", e); }
}
async function unlinkFile() { fileHandle = null; await idb.del("central"); renderFileState(); }
function scheduleFileSync() { clearTimeout(syncTimer); syncTimer = setTimeout(() => syncFile(false), 2500); }
async function syncFile(force) {
  if (!fileHandle) return;
  try {
    const perm = await fileHandle.queryPermission({ mode: "readwrite" });
    if (perm !== "granted") { if (force) renderFileState(); return; }
    const { posts = {}, snaps = {} } = await chrome.storage.local.get(["posts", "snaps"]);
    const now = Date.now();
    const order = Object.fromEntries(STATUSES.map((s, i) => [s.key, i]));
    const list = Object.values(posts).map((p) => toRow(p, snaps[p.id], now)).sort((a, b) => (order[a.status] - order[b.status]) || (Date.parse(b.posted) - Date.parse(a.posted)));
    const w = await fileHandle.createWritable();
    await w.write("﻿" + toCsv(list));
    await w.close();
    lastSync = now; renderFileState();
  } catch (e) { showError("central file sync", e); }
}

// ------------------------------------------------------------ wiring
$("f-time").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { f.days = Number(b.dataset.v); renderFilterOptions(); apply(); }));
$("f-who").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { f.who = b.dataset.v; renderFilterOptions(); apply(); }));
$("sort").addEventListener("change", (e) => { sortKey = e.target.value; sortDir = -1; renderTable(); });
$("q").addEventListener("input", (e) => { f.q = e.target.value.trim(); apply(); });
$("kw").addEventListener("change", (e) => { f.kw = e.target.value; apply(); });
$("f-sub").addEventListener("change", (e) => { f.sub = e.target.value; apply(); });
$("run-select").addEventListener("change", (e) => { f.run = e.target.value; renderFilterOptions(); apply(); });
$("clear").addEventListener("click", () => { Object.assign(f, { days: 7, who: "buyers", status: "new", q: "", kw: "", sub: "", run: "" }); $("q").value = ""; renderFilterOptions(); apply(); });
document.querySelectorAll("th[data-k]").forEach((th) => th.addEventListener("click", () => { const k = th.dataset.k; if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = ["title", "sub", "type", "status"].includes(k) ? 1 : -1; } if (["posted", "opportunity", "comments", "leadScore", "statusAt"].includes(k)) $("sort").value = k; renderTable(); }));
$("sel-all").addEventListener("change", (e) => { rows.forEach((r) => e.target.checked ? selected.add(r.id) : selected.delete(r.id)); renderTable(); updateSelCount(); });
$("replies").addEventListener("click", async () => { if (!selected.size) return alert("Tick one or more threads first."); await chrome.storage.local.set({ replySelection: Array.from(selected) }); location.href = "replies.html"; });
$("tab-threads").addEventListener("click", () => { $("pane-threads").hidden = false; $("pane-trends").hidden = true; $("bar").hidden = false; $("tab-threads").classList.add("on"); $("tab-trends").classList.remove("on"); });
$("tab-trends").addEventListener("click", () => { $("pane-threads").hidden = true; $("pane-trends").hidden = false; $("bar").hidden = true; $("tab-trends").classList.add("on"); $("tab-threads").classList.remove("on"); safe("trends", renderTrends); });
$("dk-days").addEventListener("change", () => safe("trends", renderDemandByKeyword));
$("sweep").addEventListener("click", () => { location.href = "sweep.html"; });
$("plan").addEventListener("click", () => { location.href = "campaign.html"; });
$("opts").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("reload").addEventListener("click", () => chrome.runtime.reload());
$("reclass").addEventListener("click", async () => { const r = await chrome.runtime.sendMessage({ type: "reclassify" }); $("reclass").textContent = `re-checked (${r.changed} changed)`; setTimeout(() => ($("reclass").textContent = "re-check types"), 2500); load(); });
$("prune").addEventListener("click", async () => { if (!confirm("Delete saved threads older than 90 days that are still New?")) return; const r = await chrome.runtime.sendMessage({ type: "prune", days: 90 }); alert(`Removed ${r.removed} threads.`); load(); });
$("clear-data").addEventListener("click", async () => { if (confirm("Delete ALL saved threads, statuses, notes and the log? Keywords and settings are kept. Your central file keeps its last copy.")) { await chrome.storage.local.remove(["posts", "snaps", "meta", "log", "auto", "runs"]); load(); } });
chrome.storage.onChanged.addListener((ch) => { if (ch.posts || ch.meta || ch.log || ch.runs) load(); });
initFile().then(load);
