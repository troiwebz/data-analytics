const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const TYPES = ["offer", "freebie", "value", "demand", "other"];
const PRICE_BANDS = ["free", "under $200", "$200–599", "$600–1499", "$1500+", "hourly", "no price"];

let all = [], rows = [], log = [];
const f = { type: new Set(), group: new Set(), sub: new Set(), price: new Set(), kw: "", days: 365, read: false, evidence: false, confirmed: false, q: "" };
let config = {};
let sortKey = "leadScore", sortDir = -1;
const open = new Set();

function priceBand(p) {
  if (!p) return "no price";
  if (p === "free") return "free";
  if (/\/hr$/.test(p)) return "hourly";
  const n = Number((p.match(/\d+/) || [0])[0]);
  if (n < 200) return "under $200"; if (n < 600) return "$200–599"; if (n < 1500) return "$600–1499"; return "$1500+";
}

async function load() {
  const { posts = {}, snaps = {}, meta = {}, log: lg = [], config: cfg = {} } = await chrome.storage.local.get(["posts", "snaps", "meta", "log", "config"]);
  config = cfg;
  const now = Date.now();
  all = Object.values(posts).map((p) => ({ ...toRow(p, snaps[p.id], now), band: priceBand(p.price) }));
  log = lg;
  $("ver").textContent = "v" + chrome.runtime.getManifest().version;
  const read = all.filter((r) => r.analysed);
  $("s-tracked").textContent = all.length;
  $("s-read").textContent = read.length;
  $("s-hands").textContent = read.reduce((a, r) => a + r.leadReplies, 0);
  $("s-buyer").textContent = read.reduce((a, r) => a + r.buyerReplies, 0);
  $("s-booked").textContent = read.filter((r) => r.closed).length;
  const last = Math.max(meta.lastPage || 0, meta.lastRun || 0);
  $("s-last").textContent = last ? new Date(last).toLocaleString() : "nothing yet";
  renderFilters();
  apply();
}

function chips(el, items, set, cls) {
  el.innerHTML = items.map(([v, n]) => `<span class="chip ${set.has(v) ? "on" : ""}" data-v="${esc(v)}">${cls ? `<span class="tag t-${esc(v)}">${esc(v)}</span>` : esc(v)}<span class="n">${n}</span></span>`).join("") || '<span class="chip" style="cursor:default;color:var(--muted)">none yet</span>';
  el.querySelectorAll(".chip[data-v]").forEach((c) => c.addEventListener("click", () => { const v = c.dataset.v; set.has(v) ? set.delete(v) : set.add(v); renderFilters(); apply(); }));
}

function renderFilters() {
  const count = (fn) => { const m = {}; for (const r of all) for (const v of fn(r)) m[v] = (m[v] || 0) + 1; return m; };
  const tc = count((r) => [r.type]), gc = count((r) => r.groups), sc = count((r) => [r.sub]), pc = count((r) => [r.band]);
  chips($("f-type"), TYPES.filter((t) => tc[t]).map((t) => [t, tc[t]]), f.type, true);
  chips($("f-group"), Object.entries(gc).sort((a, b) => b[1] - a[1]), f.group);
  chips($("f-sub"), Object.entries(sc).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([s, n]) => ["r/" + s, n]), f.sub);
  chips($("f-price"), PRICE_BANDS.filter((b) => pc[b]).map((b) => [b, pc[b]]), f.price);
  const kc = {};
  for (const r of all) if (!f.group.size || r.groups.some((g) => f.group.has(g))) for (const k of r.keywords) kc[k] = (kc[k] || 0) + 1;
  const sel = $("f-kw");
  sel.innerHTML = '<option value="">All keywords</option>' + Object.entries(kc).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<option value="${esc(k)}">${esc(k)} (${n})</option>`).join("");
  sel.value = kc[f.kw] ? f.kw : ""; if (!kc[f.kw]) f.kw = "";
}

function apply() {
  const now = Date.now();
  rows = all.filter((r) =>
    (now - Date.parse(r.posted) <= f.days * 86400000) &&
    (!f.type.size || f.type.has(r.type)) &&
    (!f.group.size || r.groups.some((g) => f.group.has(g))) &&
    (!f.sub.size || f.sub.has("r/" + r.sub)) &&
    (!f.price.size || f.price.has(r.band)) &&
    (!f.kw || r.keywords.includes(f.kw)) &&
    (!f.read || r.analysed) &&
    (!f.evidence || r.leadReplies + r.buyerReplies > 0 || r.closed) &&
    (!f.confirmed || (config.confirmedSubs || []).includes(r.sub.toLowerCase())) &&
    (!f.q || [r.title, r.body, r.sub, r.keywords.join(" "), r.author].join(" ").toLowerCase().includes(f.q)));
  renderInsights();
  renderDiscovery();
  renderTable();
  renderLog();
}

async function saveConfig(patch) {
  const { config: cur = {} } = await chrome.storage.local.get(["config"]);
  config = { ...cur, ...patch };
  await chrome.storage.local.set({ config });
}

function renderDemandByKeyword() {
  const days = Number($("dk-days").value) || 7;
  const groupsOf = {};
  for (const e of parseKeywordText(config.keywordText || DEFAULT_KEYWORD_TEXT)) groupsOf[e.kw] = e.group;
  const postsObj = {};
  for (const r of all) postsObj[r.id] = { type: r.type, created: Date.parse(r.posted), keywords: r.keywords, comments: r.comments, signals: r.analysed ? { lead: r.leadReplies, buyer: r.buyerReplies } : null };
  const list = demandByKeyword(postsObj, days, Date.now(), groupsOf);
  bars($("i-demand-kw"), list.slice(0, 14).map((e) => [e.kw, e.posts, e]), (v, e) => `${v} posts · ${e.comments} cmts`);
  const g = {};
  for (const e of list) { const x = g[e.group] || (g[e.group] = { posts: 0, comments: 0 }); x.posts += e.posts; x.comments += e.comments; }
  bars($("i-demand-group"), Object.entries(g).sort((a, b) => b[1].posts - a[1].posts).map(([k, v]) => [k, v.posts, v]), (v, e) => `${v} posts · ${e.comments} cmts`);
}

function renderDiscovery() {
  renderDemandByKeyword();
  // Subreddits by demand volume, with confirm checkboxes.
  const bySub = {};
  for (const r of all) { const b = bySub[r.sub] || (bySub[r.sub] = { demand: 0, total: 0, ev: 0, recent: 0 }); b.total += 1; if (r.type === "demand") { b.demand += 1; if (Date.now() - Date.parse(r.posted) < 30 * 86400000) b.recent += 1; } b.ev += r.leadReplies + r.buyerReplies; }
  const confirmed = new Set((config.confirmedSubs || []).map((s) => s.toLowerCase()));
  const subs = Object.entries(bySub).sort((a, b) => b[1].demand - a[1].demand || b[1].total - a[1].total).slice(0, 15);
  $("i-subs").innerHTML = subs.length ? subs.map(([s, b]) => `<label class="subrow"><input type="checkbox" data-sub="${esc(s)}" ${confirmed.has(s.toLowerCase()) ? "checked" : ""}><span>r/${esc(s)}</span><span class="c">${b.demand} demand (${b.recent} this month) · ${b.total} total · ${b.ev} buyer replies</span></label>`).join("") : '<div style="color:var(--muted)">No data yet.</div>';
  $("i-subs").querySelectorAll("input[data-sub]").forEach((cb) => cb.addEventListener("change", async () => {
    const set = new Set(config.confirmedSubs || []);
    cb.checked ? set.add(cb.dataset.sub) : set.delete(cb.dataset.sub);
    await saveConfig({ confirmedSubs: Array.from(set) });
    apply();
  }));

  // Phrases from demand titles, add-as-keyword.
  const demandTitles = all.filter((r) => r.type === "demand").map((r) => r.title);
  const phrases = titlePhrases(demandTitles, 24);
  const existing = new Set(parseKeywordText(config.keywordText || DEFAULT_KEYWORD_TEXT).map((e) => e.kw.toLowerCase().replace(/"/g, "")));
  $("i-phrases").innerHTML = phrases.length ? `<div class="phr">${phrases.map(([p, n]) => `<span class="chip">${esc(p)}<span class="n">${n}</span>${existing.has(p) ? "" : `<button data-p="${esc(p)}" title="add as keyword">+</button>`}</span>`).join("")}</div>` : '<div style="color:var(--muted)">Scrape some demand threads first (site-wide searches in the popup).</div>';
  $("i-phrases").querySelectorAll("button[data-p]").forEach((b) => b.addEventListener("click", async () => {
    const text = (config.keywordText || DEFAULT_KEYWORD_TEXT).trimEnd();
    const block = text.includes("# Discovered") ? text + `\n"${b.dataset.p}"` : text + `\n\n# Discovered — added from the dashboard\n"${b.dataset.p}"`;
    await saveConfig({ keywordText: block });
    b.textContent = "✓"; b.disabled = true;
  }));

  // Opportunities: demand rows, best first.
  const opps = rows.filter((r) => r.type === "demand" && r.opportunity > 0).sort((a, b) => b.opportunity - a.opportunity).slice(0, 10);
  $("i-opp").innerHTML = opps.length ? `<div class="opp">${opps.map((r) => `<div class="o"><b>${r.opportunity}</b><div><a href="${esc(r.url)}" target="_blank">${esc(r.title)}</a><div class="m">r/${esc(r.sub)} · ${r.posted} · ${r.comments} replies${r.price ? " · " + esc(r.price) : ""}</div></div></div>`).join("")}</div>` : '<div style="color:var(--muted)">No open demand threads in the current filter.</div>';
}

function bars(el, entries, fmt) {
  const max = Math.max(1, ...entries.map((e) => e[1]));
  el.innerHTML = entries.length ? entries.map(([k, v, extra]) => `<div class="bar"><span class="k" title="${esc(k)}">${esc(k)}</span><div class="track"><div class="fill" style="width:${Math.round((v / max) * 100)}%"></div></div><span class="num">${fmt ? fmt(v, extra) : v}</span></div>`).join("") : '<div style="color:var(--muted)">No data yet.</div>';
}

function renderInsights() {
  const offers = rows.filter((r) => r.type === "offer");
  const byBand = {};
  for (const r of offers) { const b = byBand[r.band] || (byBand[r.band] = { ev: 0, n: 0, read: 0 }); b.n += 1; if (r.analysed) { b.read += 1; b.ev += r.leadReplies + r.buyerReplies + (r.closed ? 3 : 0); } }
  bars($("i-price"), PRICE_BANDS.filter((b) => byBand[b]).map((b) => [b, byBand[b].ev, byBand[b]]), (v, b) => `${v} · ${b.read}/${b.n} read`);
  const byKw = {};
  for (const r of rows) if (r.analysed) for (const k of r.keywords) byKw[k] = (byKw[k] || 0) + r.leadReplies + r.buyerReplies + (r.closed ? 3 : 0);
  bars($("i-kw"), Object.entries(byKw).filter((e) => e[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 8));
}

function renderLog() {
  $("log").innerHTML = log.length ? log.slice().reverse().slice(0, 60).map((e) => `<div class="e"><a class="u" href="${esc(e.url)}" target="_blank" title="${esc(e.url)}">${esc(e.label || e.url)}</a><span class="n">${e.kind === "thread" ? `${e.total} cmts · ${e.lead} hands · ${e.buyer} buyer` : `${e.kept} of ${e.scanned} saved`} · ${new Date(e.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>`).join("") : '<div style="color:var(--muted)">Nothing scraped yet. Open <a href="https://old.reddit.com/r/forhire/new" target="_blank">old.reddit.com/r/forhire/new</a> and use the orange panel.</div>';
}

function renderTable() {
  const tb = document.querySelector("#t tbody");
  const sorted = rows.slice().sort((a, b) => (a[sortKey] > b[sortKey] ? 1 : a[sortKey] < b[sortKey] ? -1 : 0) * sortDir);
  const top = sorted.reduce((m, r) => Math.max(m, r.leadScore), 0);
  $("count").textContent = `${rows.length} thread${rows.length === 1 ? "" : "s"}`;
  document.querySelectorAll("th").forEach((th) => { th.classList.toggle("sorted", th.dataset.k === sortKey); th.classList.toggle("asc", th.dataset.k === sortKey && sortDir === 1); });
  const empty = $("empty");
  empty.hidden = rows.length > 0;
  if (!rows.length) empty.innerHTML = all.length ? "No threads match these filters." : "<b>Nothing collected yet.</b><br>Open <a href='https://old.reddit.com/r/forhire/search?q=%22for+hire%22+website&restrict_sr=on&sort=top&t=year' target='_blank'>this r/forhire search</a> and click <b>Save + walk next pages</b> in the orange panel.";
  tb.innerHTML = "";
  for (const r of sorted.slice(0, 600)) {
    const tr = document.createElement("tr"); tr.className = "row"; tr.dataset.id = r.id;
    const td = (html, cls) => { const d = document.createElement("td"); d.innerHTML = html; if (cls) d.className = cls; tr.appendChild(d); };
    td(`<span class="lead ${!r.analysed ? "na" : r.leadScore >= Math.max(8, top * 0.5) ? "hot" : ""}">${r.analysed ? r.leadScore : "·"}</span>`, "num");
    td(r.type === "demand" ? `<span class="lead ${r.opportunity >= 15 ? "hot" : ""}">${r.opportunity}</span>` : '<span class="lead na">·</span>', "num");
    td(`<span class="tag t-${r.type}">${r.type}</span>`);
    td(`r/${esc(r.sub)}`);
    td(r.price ? esc(r.price) : '<span style="color:#c4c8ce">—</span>');
    td(r.score, "num"); td(r.comments, "num");
    td(r.leadReplies ? `<span class="tag t-good">${r.leadReplies}</span>` : "0", "num");
    td(r.buyerReplies ? `<span class="tag t-good">${r.buyerReplies}</span>` : "0", "num");
    td(String(r.opReplies), "num");
    td(r.heckles ? `<span class="tag t-bad">${r.heckles}</span>` : "0", "num");
    td(r.posted);
    td(`<div class="ttl"><div class="t">${r.closed ? '<span class="tag t-good">booked</span> ' : ""}<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a></div><div class="m">${esc(r.groups.join(", "))}${r.keywords.length ? " · " + esc(r.keywords.slice(0, 3).join(" · ")) + (r.keywords.length > 3 ? ` +${r.keywords.length - 3}` : "") : ""}${r.sampleReply ? `<br><i>“${esc(r.sampleReply)}”</i>` : ""}</div></div>`);
    tr.addEventListener("click", (e) => { if (e.target.closest("a")) return; open.has(r.id) ? open.delete(r.id) : open.add(r.id); renderTable(); });
    tb.appendChild(tr);
    if (open.has(r.id)) {
      const d = document.createElement("tr"); d.className = "detail";
      d.innerHTML = `<td colspan="12"><div class="detail"><div class="grid"><div><h4>Post by u/${esc(r.author)}${r.flair ? " · " + esc(r.flair) : ""}</h4><div class="body-text">${esc(r.body) || "<i>no body captured</i>"}</div>${r.linkUrl ? `<div style="margin-top:6px"><a href="${esc(r.linkUrl)}" target="_blank">${esc(r.linkUrl)}</a></div>` : ""}</div><div><h4>Matched keywords</h4><div>${r.keywords.map((k) => `<span class="chip" style="cursor:default">${esc(k)}</span>`).join(" ") || "<i>none, kept by type</i>"}</div><h4 style="margin-top:12px">Classified replies ${r.analysed ? `(${r.uniqueCommenters} people)` : ""}</h4>${r.analysed ? (r.replies.length ? `<ul>${r.replies.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "<i>no buyer / hand-raise / booked replies found</i>") : `<i>Comments not read yet. <a href="${esc(r.url)}" target="_blank">Open the thread</a> and click “Save this thread's comments”.</i>`}</div></div></div></td>`;
      tb.appendChild(d);
    }
  }
}

document.querySelectorAll("th").forEach((th) => th.addEventListener("click", () => { const k = th.dataset.k; if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = k === "title" || k === "sub" || k === "type" ? 1 : -1; } renderTable(); }));
$("f-kw").addEventListener("change", (e) => { f.kw = e.target.value; apply(); });
$("dk-days").addEventListener("change", renderDemandByKeyword);
$("f-days").addEventListener("change", (e) => { f.days = Number(e.target.value); apply(); });
$("f-read").addEventListener("change", (e) => { f.read = e.target.checked; apply(); });
$("f-evidence").addEventListener("change", (e) => { f.evidence = e.target.checked; apply(); });
$("f-confirmed").addEventListener("change", (e) => { f.confirmed = e.target.checked; apply(); });
$("q").addEventListener("input", (e) => { f.q = e.target.value.trim().toLowerCase(); apply(); });
$("clear-group").addEventListener("click", () => { f.group.clear(); renderFilters(); apply(); });
$("clear-sub").addEventListener("click", () => { f.sub.clear(); renderFilters(); apply(); });
$("expand-all").addEventListener("click", () => { if (open.size) open.clear(); else rows.forEach((r) => open.add(r.id)); renderTable(); });
$("csv").addEventListener("click", () => {
  const blob = new Blob(["﻿" + toCsv(rows.slice().sort((a, b) => b.leadScore - a.leadScore || b.heat - a.heat))], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `reddit-lead-threads-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
});
$("crawl").addEventListener("click", () => { chrome.runtime.sendMessage({ type: "refresh" }, () => load()); $("s-last").textContent = "crawling…"; });
$("opts").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("plan").addEventListener("click", () => { location.href = "campaign.html"; });
$("sweep").addEventListener("click", () => { location.href = "sweep.html"; });
$("reload").addEventListener("click", () => chrome.runtime.reload());
$("clear-data").addEventListener("click", async () => { if (confirm("Delete all saved threads, comments and the collection log? Keywords and settings are kept.")) { await chrome.storage.local.remove(["posts", "snaps", "meta", "log", "auto"]); load(); } });
chrome.storage.onChanged.addListener((ch) => { if (ch.posts || ch.meta || ch.log) load(); });
load();
