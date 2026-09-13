const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let config = {}, counts = {}, sel = new Set(), qsel = new Set(), ksel = new Set(), batches = [];
let kwEntries = [];

async function load() {
  const { config: c = {}, posts = {}, batches: b = [], sweepLog = [], sweep = null } = await chrome.storage.local.get(["config", "posts", "batches", "sweepLog", "sweep"]);
  config = c; batches = b;
  kwEntries = parseKeywordText(config.keywordText || DEFAULT_KEYWORD_TEXT);
  counts = {};
  for (const p of Object.values(posts)) { const k = (p.sub || "").toLowerCase(); const e = counts[k] || (counts[k] = { total: 0, demand: 0 }); e.total += 1; if (p.type === "demand") e.demand += 1; }
  if (!sel.size && !ksel.size && config.lastSweep) { sel = new Set(config.lastSweep.subs || []); qsel = new Set(config.lastSweep.queries || []); ksel = new Set(config.lastSweep.kgroups || []); $("kt").value = config.lastSweep.kt || "week"; $("ksort").value = config.lastSweep.ksort || "relevance"; $("kbatch").value = config.lastSweep.kbatch || 4; $("pages").value = config.lastSweep.pages || 5; $("workers").value = config.lastSweep.workers || 2; $("maxpm").value = config.lastSweep.maxPerMin || 24; $("sort").value = config.lastSweep.sort || "new"; $("read").value = config.lastSweep.read ?? 30; $("delay").value = config.lastSweep.delay || 3; $("custom").value = (config.lastSweep.custom || []).join("\n"); }
  renderGroups(); renderQueries(); renderKeywordGroups(); renderBatches(); renderLog(sweepLog); renderProgress(sweep); estimate();
}

function allSubs() {
  const confirmed = (config.confirmedSubs || []).filter((s) => !CANDIDATE_SUBS.some((g) => g.subs.map((x) => x.toLowerCase()).includes(s.toLowerCase())));
  return [{ group: "Confirmed from your dashboard", subs: confirmed, confirmed: true }, ...CANDIDATE_SUBS];
}

function renderGroups() {
  const confirmed = new Set((config.confirmedSubs || []).map((s) => s.toLowerCase()));
  $("groups").innerHTML = allSubs().filter((g) => g.subs.length).map((g) => `<div class="group"><div class="gh"><input type="checkbox" data-g="${esc(g.group)}" ${g.subs.every((s) => sel.has(s)) ? "checked" : ""}><b>${esc(g.group)}</b><span class="c">${g.subs.filter((s) => sel.has(s)).length}/${g.subs.length}</span></div><div class="subs">${g.subs.map((s) => { const k = s.toLowerCase(); const c = counts[k]; return `<span class="sub ${sel.has(s) ? "on" : ""}" data-s="${esc(s)}">r/${esc(s)}${confirmed.has(k) ? " ✓" : ""}${c ? `<span class="n">${c.demand}d/${c.total}</span>` : ""}</span>`; }).join("")}</div></div>`).join("");
  $("groups").querySelectorAll(".sub").forEach((el) => el.addEventListener("click", () => { const s = el.dataset.s; sel.has(s) ? sel.delete(s) : sel.add(s); renderGroups(); estimate(); }));
  $("groups").querySelectorAll("input[data-g]").forEach((cb) => cb.addEventListener("change", () => { const g = allSubs().find((x) => x.group === cb.dataset.g); g.subs.forEach((s) => cb.checked ? sel.add(s) : sel.delete(s)); renderGroups(); estimate(); }));
}
function renderQueries() {
  $("queries").innerHTML = DISCOVERY_QUERIES.map((q) => `<span class="sub ${qsel.has(q.key) ? "on" : ""}" data-q="${q.key}" title="${esc(q.q)}">${esc(q.label)}</span>`).join("");
  $("queries").querySelectorAll(".sub").forEach((el) => el.addEventListener("click", () => { const k = el.dataset.q; qsel.has(k) ? qsel.delete(k) : qsel.add(k); renderQueries(); estimate(); }));
}
function renderKeywordGroups() {
  const counts = {};
  for (const e of kwEntries) counts[e.group] = (counts[e.group] || 0) + 1;
  const batch = Math.max(1, Number($("kbatch").value) || 4);
  $("kgroups").innerHTML = Object.entries(counts).map(([g, n]) => `<span class="sub ${ksel.has(g) ? "on" : ""}" data-k="${esc(g)}">${esc(g)}<span class="n">${n} kw · ${Math.ceil(n / batch)} searches</span></span>`).join("");
  $("kgroups").querySelectorAll(".sub").forEach((el) => el.addEventListener("click", () => { const g = el.dataset.k; ksel.has(g) ? ksel.delete(g) : ksel.add(g); renderKeywordGroups(); estimate(); }));
}
function customSubs() { return $("custom").value.split("\n").map((s) => s.trim().replace(/^r\//, "")).filter(Boolean); }
function selection() {
  return { subs: Array.from(new Set([...sel, ...customSubs()])), queries: Array.from(qsel), kgroups: Array.from(ksel), kt: $("kt").value, ksort: $("ksort").value, kbatch: Math.max(1, Number($("kbatch").value) || 4), pages: Math.max(1, Number($("pages").value) || 5), sort: $("sort").value, read: Math.max(0, Number($("read").value) || 0), delay: Math.max(2, Number($("delay").value) || 3), run: $("runname").value.trim(), workers: Math.min(4, Math.max(1, Number($("workers").value) || 2)), maxPerMin: Math.min(60, Math.max(6, Number($("maxpm").value) || 24)), custom: customSubs() };
}
function keywordQueue(s) { return buildKeywordSweepQueue(kwEntries, s.kgroups, s.pages, s.ksort, s.kt, s.kbatch); }
function estimate() {
  const s = selection();
  const kq = keywordQueue(s);
  $("kest").textContent = kq.length ? `${kq.length} keyword searches over the past ${s.kt}, ${s.pages} pages each.` : "No categories selected.";
  const items = s.subs.length + s.queries.length + kq.length;
  const loads = items * s.pages + s.read;
  const perMin = Math.min(s.maxPerMin, s.workers * (60 / (s.delay + 2.2)));
  $("est").textContent = items ? `${items} items × up to ${s.pages} pages + ${s.read} threads = ${loads} page loads ≈ ${Math.ceil(loads / perMin)} min with ${s.workers} tab${s.workers > 1 ? "s" : ""} at ~${Math.round(perMin)} pages/min. Keep the tabs open.` : "Nothing selected.";
  if (!document.querySelector("#prog.live")) $("run").disabled = !items;
}
["pages", "sort", "read", "delay", "custom", "kt", "ksort", "workers", "maxpm"].forEach((id) => $(id).addEventListener("input", estimate));
$("workers").addEventListener("change", estimate);
$("kbatch").addEventListener("input", () => { renderKeywordGroups(); estimate(); });
$("kall").addEventListener("click", () => { kwEntries.forEach((e) => ksel.add(e.group)); renderKeywordGroups(); estimate(); });
$("kbuy").addEventListener("click", () => { ksel.clear(); kwEntries.forEach((e) => { if (!/^(Offers|Value bombs|Freebies)$/i.test(e.group)) ksel.add(e.group); }); renderKeywordGroups(); estimate(); });
$("knone").addEventListener("click", () => { ksel.clear(); renderKeywordGroups(); estimate(); });

async function run(s) {
  const queue = [...keywordQueue(s), ...buildSweepQueue(s.subs, s.queries, s.pages, s.sort)];
  if (!queue.length) return;
  await chrome.storage.local.set({ config: { ...config, lastSweep: s } });
  const r = await chrome.runtime.sendMessage({ type: "sweep-start", queue, read: s.read, delay: s.delay, workers: s.workers, maxPerMin: s.maxPerMin, run: s.run });
  if (!r || !r.ok) alert("Could not start: " + ((r && r.error) || "unknown"));
}
$("run").addEventListener("click", () => run(selection()));
$("stop").addEventListener("click", () => chrome.runtime.sendMessage({ type: "sweep-stop" }));
$("all").addEventListener("click", () => { allSubs().forEach((g) => g.subs.forEach((s) => sel.add(s))); renderGroups(); estimate(); });
$("none").addEventListener("click", () => { sel.clear(); renderGroups(); estimate(); });
$("conf").addEventListener("click", () => { sel = new Set(config.confirmedSubs || []); renderGroups(); estimate(); });
$("qall").addEventListener("click", () => { DISCOVERY_QUERIES.forEach((q) => qsel.add(q.key)); renderQueries(); estimate(); });
$("qnone").addEventListener("click", () => { qsel.clear(); renderQueries(); estimate(); });

function renderBatches() {
  $("batches").innerHTML = batches.length ? batches.map((b, i) => `<div class="batch"><div><b>${esc(b.name)}</b><div class="m">${(b.kgroups || []).length} keyword categories (${b.kt || "week"}) · ${b.subs.length} subreddits · ${b.queries.length} searches · ${b.pages} pages · ${b.read} threads${b.lastRun ? ` · last ${new Date(b.lastRun).toLocaleDateString()}` : ""}</div></div><button class="btn sm primary" data-run="${i}">Run</button><button class="btn sm" data-del="${i}" title="delete">✕</button></div>`).join("") : '<div style="color:var(--muted);font-size:12px">No saved batches yet. Select subreddits and searches, name it, Save batch. Then it is one click.</div>';
  $("batches").querySelectorAll("[data-run]").forEach((b) => b.addEventListener("click", async () => { const bt = batches[Number(b.dataset.run)]; bt.lastRun = Date.now(); await chrome.storage.local.set({ batches }); sel = new Set(bt.subs); qsel = new Set(bt.queries); ksel = new Set(bt.kgroups || []); $("kt").value = bt.kt || "week"; $("ksort").value = bt.ksort || "relevance"; $("kbatch").value = bt.kbatch || 4; renderKeywordGroups(); $("pages").value = bt.pages; $("sort").value = bt.sort; $("workers").value = bt.workers || 2; $("maxpm").value = bt.maxPerMin || 24; $("read").value = bt.read; $("delay").value = bt.delay; $("custom").value = ""; $("runname").value = bt.name + " " + new Date().toLocaleDateString(); renderGroups(); renderQueries(); estimate(); run({ ...bt, run: $("runname").value }); }));
  $("batches").querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => { batches.splice(Number(b.dataset.del), 1); await chrome.storage.local.set({ batches }); renderBatches(); }));
}
$("saveb").addEventListener("click", async () => {
  const name = $("bname").value.trim(); if (!name) return $("bname").focus();
  const s = selection(); if (!s.subs.length && !s.queries.length && !s.kgroups.length) return alert("Select something first.");
  const i = batches.findIndex((b) => b.name === name);
  const entry = { name, ...s };
  if (i >= 0) batches[i] = { ...batches[i], ...entry }; else batches.push(entry);
  await chrome.storage.local.set({ batches }); $("bname").value = ""; renderBatches();
});

function renderProgress(sw) {
  const live = sw && sw.running;
  $("prog").classList.toggle("live", !!live);
  $("stop").hidden = !live;
  $("run").disabled = !!live; $("run").textContent = live ? `Running "${sw.run || ""}"… stop it before starting another` : "Run this selection now";
  document.querySelectorAll("[data-run]").forEach((b) => (b.disabled = !!live));
  if (!sw) { $("st").textContent = "Idle."; $("fill").style.width = "0"; return; }
  const total = (sw.totalPages || 0) + (sw.read || 0), done = (sw.pagesDone || 0) + (sw.threadsDone || 0);
  $("fill").style.width = total ? Math.min(100, Math.round((done / total) * 100)) + "%" : "0";
  $("st").textContent = live ? `${sw.stage || "running"} · ${sw.pagesDone || 0}/${sw.totalPages || 0} pages · ${sw.kept || 0} saved (${sw.fresh || 0} new) · ${sw.threadsDone || 0}/${sw.read || 0} comment reads · ${sw.workers || 1} tab${(sw.workers || 1) > 1 ? "s" : ""} · cap ${sw.maxPerMin || "?"}/min${sw.throttled ? ` · slowed by Reddit ${sw.throttled}×` : ""}` : `Finished ${sw.finishedAt ? new Date(sw.finishedAt).toLocaleString() : ""}: ${sw.pagesDone || 0} pages, ${sw.kept || 0} threads saved, ${sw.threadsDone || 0} comment reads${sw.stopped ? " (stopped early)" : ""}.`;
}
function renderLog(lg) { $("log").innerHTML = lg.length ? lg.slice().reverse().slice(0, 30).map((e) => `<div class="e"><span class="u">${esc(e.run || "")} · ${esc(e.items)} items · ${e.pagesDone} pages · ${e.kept} saved (${e.fresh || 0} new) · ${e.threadsDone} threads read${e.stopped ? " · stopped" : ""}</span><span>${new Date(e.finishedAt).toLocaleString()}</span></div>`).join("") : '<div style="color:var(--muted)">No sweeps yet.</div>'; }

$("dash").addEventListener("click", () => { location.href = "dashboard.html"; });
$("plan").addEventListener("click", () => { location.href = "campaign.html"; });
chrome.storage.onChanged.addListener((ch) => { if (ch.sweep) renderProgress(ch.sweep.newValue); if (ch.sweepLog) renderLog(ch.sweepLog.newValue || []); if (ch.posts) load(); });
load();
