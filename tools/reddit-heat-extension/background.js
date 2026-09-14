importScripts("lib.js");

// Crawler: walks each subreddit's /new listing page by page (100 posts a
// page, up to Reddit's 1000-post cap), keeps every post that matches a
// keyword or looks like an offer / demand / freebie / value post, then reads
// the comments of the most active ones for lead evidence.
//
// Transport: with a Reddit "installed app" client id (Options) we use OAuth
// at 100 requests/min. Without one, old.reddit.com/.json at ~10/min.

const ALARM = "heat-refresh";
const MAX_SNAPS = 60;
const PUBLIC_PACE_MS = 6500;
const OAUTH_PACE_MS = 700;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getConfig() {
  const { config = {} } = await chrome.storage.local.get(["config"]);
  const entries = parseKeywordText(config.keywordText || DEFAULT_KEYWORD_TEXT);
  return {
    subs: Array.from(new Set([...(config.subs && config.subs.length ? config.subs : DEFAULT_SUBS), ...(config.confirmedSubs || [])])),
    entries,
    clientId: (config.clientId || "").trim(),
    windowDays: config.windowDays || 30,
    maxPages: config.maxPages || 10,
    intervalMin: config.intervalMin || 180,
    commentDives: config.commentDives || 150,
    autoCsv: config.autoCsv === true,   // no file lands in Downloads unless you turn this on
    alsoSearch: !!config.alsoSearch,
  };
}

async function arm() {
  const cfg = await getConfig();
  chrome.alarms.create(ALARM, { periodInMinutes: cfg.intervalMin, delayInMinutes: 1 });
}
// Auto-reload: once a minute, read manifest.json from disk. If update.bat /
// update.sh (or a fresh unzip) put a newer version in the folder, reload so
// Chrome picks it up without anyone clicking anything. Never reloads mid-sweep.
const VERSION_ALARM = "version-check";
const RAW_MANIFEST = "https://raw.githubusercontent.com/troiwebz/data-analytics/claude/brave-fermat-6ysqd0/tools/reddit-heat-extension/manifest.json";
function semverGt(a, b) {
  const pa = String(a || "0").split(".").map(Number), pb = String(b || "0").split(".").map(Number);
  for (let i = 0; i < 3; i += 1) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
}
// Every couple of minutes: what is the newest version on GitHub? Lets the page
// say "2.4.4 is on its way" instead of leaving you guessing.
async function checkRemoteVersion() {
  try {
    const r = await fetch(RAW_MANIFEST + "?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return;
    const j = await r.json();
    if (j.version) await chrome.storage.local.set({ remoteVersion: j.version, remoteCheckedAt: Date.now() });
  } catch (_) { /* offline */ }
}
async function versionState() {
  const running = chrome.runtime.getManifest().version;
  let onDisk = running;
  try { onDisk = (await (await fetch(chrome.runtime.getURL("manifest.json"), { cache: "no-store" })).json()).version || running; } catch (_) { /* mid-copy */ }
  const { remoteVersion = "", remoteCheckedAt = 0, sweepState = null, auto = null } = await chrome.storage.local.get(["remoteVersion", "remoteCheckedAt", "sweepState", "auto"]);
  return { running, onDisk, remote: remoteVersion, remoteCheckedAt, diskAhead: semverGt(onDisk, running), remoteAhead: semverGt(remoteVersion, onDisk), busy: !!(sweepState || auto) };
}
async function checkVersion() {
  try {
    const onDisk = await (await fetch(chrome.runtime.getURL("manifest.json"), { cache: "no-store" })).json();
    if (onDisk.version && onDisk.version !== chrome.runtime.getManifest().version) {
      const { auto, pendingVersion, sweepState } = await chrome.storage.local.get(["auto", "pendingVersion", "sweepState"]);
      // Require the same new version on two consecutive checks so we never
      // reload while the updater is still copying files.
      if (pendingVersion !== onDisk.version) { await chrome.storage.local.set({ pendingVersion: onDisk.version }); return; }
      if (auto || sweepState) return; // a sweep or walk is running; try again next minute
      await chrome.storage.local.set({ lastAutoReload: { from: chrome.runtime.getManifest().version, to: onDisk.version, t: Date.now() }, pendingVersion: null });
      chrome.runtime.reload();
    }
  } catch (e) { /* file missing mid-copy; retry next minute */ }
}
async function reclassifyAll() {
  const { posts = {} } = await chrome.storage.local.get(["posts"]);
  let changed = 0;
  for (const p of Object.values(posts)) {
    if (p.manual) continue;
    const t = classifyPost(p.title, p.body);
    if (t !== p.type) { p.type = t; changed += 1; }
  }
  if (changed) await chrome.storage.local.set({ posts });
  return changed;
}
chrome.runtime.onInstalled.addListener(() => { huntReclassify(); arm(); chrome.alarms.create(VERSION_ALARM, { periodInMinutes: 1 }); chrome.alarms.create(REMOTE_ALARM, { periodInMinutes: 2, delayInMinutes: 0.2 }); reclassifyAll();  huntGet().then((h) => huntArm(h.on)); });
chrome.runtime.onStartup.addListener(() => { arm(); chrome.alarms.create(VERSION_ALARM, { periodInMinutes: 1 }); chrome.alarms.create(REMOTE_ALARM, { periodInMinutes: 2, delayInMinutes: 0.2 });  huntGet().then((h) => huntArm(h.on)); });
const REMOTE_ALARM = "remote-version";
chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) refresh(); if (a.name === VERSION_ALARM) checkVersion(); if (a.name === REMOTE_ALARM) checkRemoteVersion(); if (a.name === HUNT_ALARM) huntPoll(false); });
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (!msg) return;
  if (msg.type === "refresh") { refresh().then(() => reply({ ok: true })).catch((e) => reply({ ok: false, error: String(e) })); return true; }
  if (msg.type === "rearm") { arm().then(() => reply({ ok: true })); return true; }
  if (msg.type === "testauth") { getToken(msg.clientId, true).then((t) => reply({ ok: !!t })).catch((e) => reply({ ok: false, error: String(e) })); return true; }
  if (msg.type === "config") { getConfig().then((c) => reply({ entries: c.entries, subs: c.subs })); return true; }
  if (msg.type === "ingest") { ingest(msg.posts || [], msg.source, "manual").then(reply); return true; }
  if (msg.type === "signals") { saveSignals(msg.post, msg.signals, msg.source).then(reply); return true; }
  if (msg.type === "open-page") { chrome.tabs.create({ url: chrome.runtime.getURL(msg.page) }); reply({ ok: true }); return; }
  if (msg.type === "open-dashboard") { chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") }); reply({ ok: true }); return; }
  if (msg.type === "queue") { buildQueue(msg.limit || 30, msg.newest).then((queue) => reply({ queue })); return true; }
  if (msg.type === "sweep-start") { startSweep(msg.queue || [], msg.read || 0, msg.delay || 3, msg.workers || 2, msg.maxPerMin || 24, msg.run).then(() => reply({ ok: true })).catch((e) => reply({ ok: false, error: String(e) })); return true; }
  if (msg.type === "sweep-stop") { stopSweep(true).then(() => reply({ ok: true })); return true; }
  if (msg.type === "sweep-page") { handlePage(_s.tab && _s.tab.id, msg).then(reply); return true; }
  if (msg.type === "sweep-thread") { handleThread(_s.tab && _s.tab.id, msg).then(reply); return true; }
  if (msg.type === "sweep-429") { handle429(_s.tab && _s.tab.id).then(reply); return true; }
  if (msg.type === "diag") { (async () => { const bytes = await chrome.storage.local.getBytesInUse(null); const { posts = {}, log = [], runs = {}, errors = [], sweepState = null, auto = null } = await chrome.storage.local.get(["posts", "log", "runs", "errors", "sweepState", "auto"]); reply({ bytes, posts: Object.keys(posts).length, log: log.length, runs: Object.keys(runs).length, errors: errors.slice(-5), sweepRunning: !!sweepState, autoMode: auto && auto.mode, version: chrome.runtime.getManifest().version }); })(); return true; }
  if (msg.type === "prune") { (async () => { const { posts = {}, snaps = {} } = await chrome.storage.local.get(["posts", "snaps"]); const cutoff = Date.now() - (msg.days || 90) * 86400000; let n = 0; for (const [id, p] of Object.entries(posts)) { if ((p.created || 0) < cutoff && statusOf(p) === "new" && !p.manual) { delete posts[id]; delete snaps[id]; n += 1; } } await chrome.storage.local.set({ posts, snaps }); reply({ removed: n }); })(); return true; }
  if (msg.type === "reclassify") { reclassifyAll().then((n) => reply({ changed: n })); return true; }
  if (msg.type === "override") { chrome.storage.local.get(["posts"]).then(async ({ posts = {} }) => { const p = posts[msg.id]; if (p) { Object.assign(p, msg.patch, { manual: true }); if (msg.patch.status) { p.statusAt = Date.now(); p.ignored = msg.patch.status === "not_lead"; if (msg.patch.status === "replied" && !p.replied) p.replied = Date.now(); if (msg.patch.status === "new") { p.replied = 0; } } if (msg.patch.ignored === true) { p.status = "not_lead"; p.statusAt = Date.now(); } if (msg.patch.ignored === false && p.status === "not_lead") { p.status = "new"; } if (msg.patch.replied && !p.status) { p.status = "replied"; p.statusAt = Date.now(); } await chrome.storage.local.set({ posts }); } reply({ ok: !!p }); }); return true; }
  if (msg.type === "hunt-queue") { huntQueue(msg.limit || 40).then(reply); return true; }
  if (msg.type === "hunt-act") { huntAct(msg.id, msg.action, msg.variant).then(reply); return true; }
  if (msg.type === "hunt-done") { huntGet().then((st) => { const rows = Object.values(st.posts).filter((p) => p.repliedAt || p.dmAt).map((p) => ({ id: p.id, author: p.author, sub: p.sub, title: p.title, permalink: p.permalink, repliedAt: p.repliedAt || 0, dmAt: p.dmAt || 0, at: Math.max(p.repliedAt || 0, p.dmAt || 0) })).sort((a, b) => b.at - a.at); reply({ rows }); }); return true; }
  if (msg.type === "hunt-check-mine") { huntCheckMine(msg.id).then(reply).catch((e) => reply({ ok: false, error: String(e) })); return true; }
  if (msg.type === "hunt-server") { huntSet({ server: msg.url ? { url: msg.url, token: msg.token || "" } : null }).then(() => reply({ ok: true })); return true; }
  if (msg.type === "version-state") { versionState().then(reply); return true; }
  if (msg.type === "version-check-now") { Promise.all([checkRemoteVersion(), checkVersion()]).then(() => reply({ ok: true })); return true; }
  if (msg.type === "reload-now") { chrome.runtime.reload(); reply({ ok: true }); return; }
  if (msg.type === "hunt-ai") { huntAiWrite(msg.id, !!msg.force).then(reply).catch((e) => reply({ ok: false, error: String(e && e.message || e) })); return true; }
  if (msg.type === "hunt-slots") { huntSlotWrite(msg.id, !!msg.force).then(reply).catch((e) => reply({ ok: false, error: String(e && e.message || e) })); return true; }
  if (msg.type === "inbox-list") { inboxList().then(reply); return true; }
  if (msg.type === "inbox-poll") { inboxPoll().then(reply).catch((e) => reply({ ok: false, error: String(e) })); return true; }
  if (msg.type === "chat-observe") { chatObserve(msg.with, msg.messages, msg.v).then(reply); return true; }
  if (msg.type === "chat-draft") { chatDraft(msg.id, !!msg.force).then(reply).catch((e) => reply({ ok: false, error: String(e && e.message || e) })); return true; }
  if (msg.type === "chat-fill") { chatFill(msg.with, msg.text).then(reply).catch((e) => reply({ ok: false, error: String(e && e.message || e) })); return true; }
  if (msg.type === "chat-open") { chatTab(true).then((t) => { chrome.tabs.update(t.id, { active: true }); reply({ ok: true }); }); return true; }
  if (msg.type === "chat-status") { (async () => { const t = await chatTab(false); const { inbox = {} } = await chrome.storage.local.get(["inbox"]); reply({ open: !!t, url: t && t.url, seen: inbox.chatSeen || 0 }); })(); return true; }
  if (msg.type === "chat-dump") { (async () => { const t = await chatTab(false); if (!t) return reply({ error: "no Chat tab open" }); try { reply(await chrome.tabs.sendMessage(t.id, { type: "chat-dump" })); } catch (e) { reply({ error: "the Chat tab did not answer — reload it" }); } })(); return true; }
  if (msg.type === "inbox-add") { inboxAdd(msg.with, msg.body).then(reply); return true; }
  if (msg.type === "inbox-mine") { inboxNoteMine(msg.id, msg.body).then(reply); return true; }
  if (msg.type === "inbox-act") { inboxAct(msg.id, msg.action, msg.patch).then(reply); return true; }
  if (msg.type === "inbox-ai") { inboxAiWrite(msg.id, !!msg.force).then(reply).catch((e) => reply({ ok: false, error: String(e && e.message || e) })); return true; }
  if (msg.type === "inbox-deal") { inboxDeal(msg.id, msg.patch || {}).then(reply); return true; }
  if (msg.type === "inbox-terms") { (async () => { const { inbox = {} } = await chrome.storage.local.get(["inbox"]); await inboxSet({ deal: { ...DEAL_DEFAULT, ...(inbox.deal || {}), ...(msg.deal || {}) }, dealV: Date.now() }); reply({ ok: true }); })(); return true; }
  if (msg.type === "inbox-plan") { inboxSet({ plan: msg.plan || "" }).then(() => reply({ ok: true })); return true; }
  if (msg.type === "inbox-prompt") { (async () => { const st = await inboxGet(); const t = st.threads[msg.id]; if (!t) return reply(null); const hunt = await huntGet(); const { config = {} } = await chrome.storage.local.get(["config"]); reply(inboxAiPrompt(t, t.postId ? hunt.posts[t.postId] : null, { ...(config.profile || {}), deal: st.deal }, st.plan || INBOX_PLAN_DEFAULT)); })(); return true; }
  if (msg.type === "hunt-ai-save") { (async () => { const st = await huntGet(); const p = st.posts[msg.id]; if (!p) return reply({ ok: false }); const { inbox: ib = {} } = await chrome.storage.local.get(["inbox"]); const clean = huntAiClean(msg.ai); if (!clean || !clean.public_reply) return reply({ ok: false, error: clean && clean.tooLong ? "the reply line is over 40 words" : "failed the checks (needs a reply line and both DMs)" }); if (clean.fit === "no") { p.act = "not_relevant"; p.actAt = Date.now(); p.cancelledBy = "ai"; p.cancelReason = clean.fit_reason || "not a fit"; await huntSet({ posts: st.posts }); return reply({ ok: false, cancelled: true, reason: p.cancelReason }); } p.ai = { ...clean, at: Date.now(), model: msg.model || "on-device", cents: 0, dealV: ib.dealV || 0 }; await huntSet({ posts: st.posts }); reply({ ok: true, ai: p.ai }); })(); return true; }
  if (msg.type === "hunt-ai-test") { (async () => {
      const key = await huntAiKey();
      if (!key) return reply({ ok: false, error: "no key saved yet" });
      try {
        const r = await fetch(AI_URL, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
          body: JSON.stringify({ model: AI_MODEL, max_tokens: 16, messages: [{ role: "user", content: "Say OK." }] }) });
        const j = await r.json().catch(() => ({}));
        reply(r.ok ? { ok: true } : { ok: false, error: (j.error && j.error.message) || ("HTTP " + r.status) });
      } catch (e) { reply({ ok: false, error: String(e.message || e) }); }
    })(); return true; }
  if (msg.type === "hunt-whoami") { huntMe().then((me) => reply({ me })).catch(() => reply({ me: "" })); return true; }
  if (msg.type === "hunt-server-test") { (async () => {
      try {
        const r = await fetch(String(msg.url || "").replace(/\/+$/, "") + "/health", { cache: "no-store" });
        const j = await r.json();
        reply({ ok: r.ok, health: j });
      } catch (e) { reply({ ok: false, error: String(e.message || e) }); }
    })(); return true; }
  if (msg.type === "hunt-window") { huntSet({ maxAgeH: msg.hours || 48 }).then(() => reply({ ok: true })); return true; }
  if (msg.type === "hunt-me") { huntSet({ me: (msg.me || "").replace(/^\/?u\//, "").trim() }).then(() => reply({ ok: true })); return true; }
  if (msg.type === "hunt-contacted") { huntGet().then((st) => reply({ rows: Object.entries(st.contacted).map(([user, c]) => ({ user, ...c })).sort((a, b) => b.at - a.at) })); return true; }
  if (msg.type === "hunt-poll") { huntPoll(true).then(reply).catch((e) => reply({ ok: false, error: String(e) })); return true; }
  if (msg.type === "hunt-on") { huntSet({ on: !!msg.on }).then(() => { huntArm(!!msg.on); if (msg.on) huntPoll(true); reply({ ok: true }); }); return true; }
  if (msg.type === "hunt-subs") { huntSet({ subs: msg.subs && msg.subs.length ? msg.subs : HUNT_SUBS, perTick: msg.perTick || 4 }).then(() => reply({ ok: true })); return true; }
  if (msg.type === "status-by-url") { chrome.storage.local.get(["posts"]).then(({ posts = {} }) => { const path = (msg.permalink || "").replace(/^https?:\/\/[^/]+/, ""); const p = Object.values(posts).find((x) => x.permalink && path.startsWith(x.permalink.replace(/\/$/, ""))); reply(p ? { id: p.id, status: statusOf(p), type: p.type, title: p.title } : { id: null }); }); return true; }
});

// --- Page-scrape ingestion (from content.js). Same store as the crawler.
async function noteError(where, e) {
  try { const { errors = [] } = await chrome.storage.local.get(["errors"]); errors.push({ t: Date.now(), where, msg: String(e && e.message || e).slice(0, 300) }); await chrome.storage.local.set({ errors: errors.slice(-50) }); } catch (_) { /* storage itself is broken */ }
  console.error("[RLT]", where, e);
}

async function withStore(fn) {
  const store = await chrome.storage.local.get(["posts", "snaps", "meta"]);
  const posts = store.posts || {}, snaps = store.snaps || {};
  const result = await fn(posts, snaps);
  const meta = { ...(store.meta || {}), count: Object.keys(posts).length, analysed: Object.values(posts).filter((p) => p.signals).length, lastPage: Date.now() };
  try { await chrome.storage.local.set({ posts, snaps, meta }); }
  catch (e) { await noteError("save posts", e); throw e; }
  return result;
}

function recordPost(posts, snaps, p, now) {
  const prev = posts[p.id] || {};
  const keepType = prev.manual ? { type: prev.type, ignored: prev.ignored } : {};
  posts[p.id] = { ...prev, ...p, ...keepType, body: p.body || prev.body || "", signals: prev.signals, runs: prev.runs, replied: prev.replied, manual: prev.manual, status: prev.status, statusAt: prev.statusAt, note: prev.note, ignored: prev.ignored, firstSeen: prev.firstSeen || now, lastSeen: now };
  const arr = snaps[p.id] || [];
  const last = arr[arr.length - 1];
  if (!last || last.score !== p.score || last.comments !== p.comments || now - last.t > 6 * 3600 * 1000) arr.push({ t: now, score: p.score, comments: p.comments });
  snaps[p.id] = arr.slice(-MAX_SNAPS);
}

// Runs registry: one entry per run name with counts, so the dashboard can
// list recent batches with "new vs seen before".
async function touchRun(name, inc = {}) {
  const { runs = {} } = await chrome.storage.local.get(["runs"]);
  const r = runs[name] || { name, started: Date.now(), pages: 0, kept: 0, fresh: 0, threads: 0 };
  for (const k of ["pages", "kept", "fresh", "threads"]) r[k] = (r[k] || 0) + (inc[k] || 0);
  r.last = Date.now();
  if (inc.finished) r.finished = Date.now();
  runs[name] = r;
  await chrome.storage.local.set({ runs });
}

async function addLog(entry) {
  try {
    const { log = [] } = await chrome.storage.local.get(["log"]);
    log.push({ t: Date.now(), ...entry });
    await chrome.storage.local.set({ log: log.slice(-300) });
  } catch (e) { await noteError("save log", e); }
}

async function ingest(list, source, run) {
  const r = await withStore(async (posts, snaps) => {
    const now = Date.now();
    let kept = 0, fresh = 0;
    for (const p of list) {
      if (!p || !p.id || !keepPost(p)) continue;
      const isNew = !posts[p.id];
      recordPost(posts, snaps, p, now);
      if (run) {
        const rs = posts[p.id].runs || [];
        if (!rs.includes(run)) rs.push(run);
        posts[p.id].runs = rs.slice(-20);
        if (isNew) { posts[p.id].firstRun = run; fresh += 1; }
        else if (!posts[p.id].firstRun) posts[p.id].firstRun = rs[0];
      }
      kept += 1;
    }
    return { kept, fresh, total: Object.keys(posts).length };
  });
  if (run) await touchRun(run, { kept: r.kept, fresh: r.fresh, pages: 1 });
  if (source) await addLog({ kind: "page", url: source.url, label: source.label, scanned: list.length, kept: r.kept });
  return r;
}

async function saveSignals(post, signals, source) {
  const r = await withStore(async (posts, snaps) => {
    const now = Date.now();
    if (post && post.id) { if (!posts[post.id]) recordPost(posts, snaps, post, now); else recordPost(posts, snaps, { ...posts[post.id], score: post.score, comments: post.comments, body: post.body || posts[post.id].body }, now); posts[post.id].signals = signals; }
    return { ok: true };
  });
  if (source) await addLog({ kind: "thread", url: source.url, label: source.label, total: signals.total, lead: signals.lead, buyer: signals.buyer, closed: signals.closed });
  return r;
}

// Threads worth reading next: unread or stale; most comments first, or
// newest first when `newest` is set (used after a sweep).
async function buildQueue(limit, newest = false) {
  const { posts = {} } = await chrome.storage.local.get(["posts"]);
  const now = Date.now();
  return Object.values(posts)
    .filter((p) => p.comments > 0 && p.permalink && (!p.signals || now - (p.signals.t || 0) > 24 * 3600 * 1000))
    .sort((a, b) => newest ? (b.created - a.created || b.comments - a.comments) : (b.comments - a.comments || b.created - a.created))
    .slice(0, limit)
    .map((p) => p.permalink);
}

// --- Batch sweep engine: N worker tabs pull from one shared queue, under one
// global rate limit. Content scripts report each page and ask what to do next.
let S = null;                       // in-memory copy of sweepState
let lock = Promise.resolve();
function withLock(fn) { const p = lock.then(fn); lock = p.catch(() => {}); return p; }
async function loadS() { if (!S) { const { sweepState } = await chrome.storage.local.get(["sweepState"]); S = sweepState || null; } return S; }
async function saveS() { await chrome.storage.local.set({ sweepState: S }); }
async function pushProgress(stage) {
  if (!S) return;
  await chrome.storage.local.set({ sweep: { running: true, run: S.run, stage, items: S.items, totalPages: S.totalPages, pagesDone: S.stats.pagesDone, kept: S.stats.kept, fresh: S.stats.fresh || 0, read: S.read, threadsDone: S.stats.threadsDone, throttled: S.stats.throttled, workers: Object.keys(S.active).length, maxPerMin: S.maxPerMin, started: S.started } });
}

async function startSweep(queue, read, delay, workers = 2, maxPerMin = 24, run = "") {
  return withLock(async () => {
    await loadS();
    if (S && Object.keys(S.active).length) throw new Error("a sweep is already running; stop it first (Batch sweep → Stop)");
    if (!queue.length) throw new Error("empty queue");
    workers = Math.min(4, Math.max(1, workers | 0));
    run = (run || "").trim() || new Date().toISOString().slice(0, 16).replace("T", " ");
    await touchRun(run, {});
    S = { run, queue: queue.slice(), active: {}, read, delay: Math.max(2, delay), workers, maxPerMin: Math.max(6, maxPerMin | 0), nav: [], cooldownUntil: 0, commentQueue: null,
      items: queue.length, totalPages: queue.reduce((n, q) => n + q.pages, 0), started: Date.now(), stats: { pagesDone: 0, kept: 0, threadsDone: 0, throttled: 0 } };
    for (let i = 0; i < workers; i++) {
      const item = S.queue.shift(); if (!item) break;
      const tab = await chrome.tabs.create({ url: item.url, active: i === 0 });
      S.active[tab.id] = { item, pagesLeft: item.pages };
    }
    await saveS(); await pushProgress("starting");
  });
}

// _stop runs without taking the lock (callers inside withLock use it directly).
async function _stop(stopped) {
  const { sweep, sweepLog = [] } = await chrome.storage.local.get(["sweep", "sweepLog"]);
  if (S && S.run) await touchRun(S.run, { finished: true });
  S = null;
  await chrome.storage.local.remove(["sweepState", "auto"]);
  if (sweep && sweep.running) {
    const done = { ...sweep, running: false, stopped, finishedAt: Date.now() };
    sweepLog.push({ run: done.run, items: done.items, pagesDone: done.pagesDone, kept: done.kept, fresh: done.fresh || 0, threadsDone: done.threadsDone, throttled: done.throttled, workers: done.workers, stopped, finishedAt: done.finishedAt });
    await chrome.storage.local.set({ sweep: done, sweepLog: sweepLog.slice(-100) });
  }
}
async function stopSweep(stopped) { return withLock(() => _stop(stopped)); }

// Global pacing: reserve a navigation slot. Returns ms this tab should wait.
function throttle() {
  const now = Date.now();
  S.nav = S.nav.filter((t) => t > now - 60000);
  let wait = S.delay * 1000 + Math.floor(Math.random() * 1500);
  if (S.cooldownUntil > now) wait = Math.max(wait, S.cooldownUntil - now);
  if (S.nav.length >= S.maxPerMin) wait = Math.max(wait, S.nav[0] + 60000 - now + 500);
  S.nav.push(now + wait);
  return wait;
}

async function nextForTab(tabId) {
  const a = S.active[tabId];
  // 1. more pages of the current item?  (caller sets a.nextUrl)
  if (a.pagesLeft > 0 && a.nextUrl && !a.thread) { const go = a.nextUrl; a.nextUrl = ""; return { go, stage: `${a.item.label} · page ${a.item.pages - a.pagesLeft + 1}/${a.item.pages}` }; }
  // 2. next queue item
  const item = S.queue.shift();
  if (item) { S.active[tabId] = { item, pagesLeft: item.pages }; return { go: item.url, stage: `${item.label} (${S.queue.length} items left)` }; }
  // 3. comment phase
  if (S.read > 0) {
    if (!S.commentQueue) S.commentQueue = await buildQueue(S.read, true);
    const perm = S.commentQueue.shift();
    if (perm) { S.active[tabId] = { item: a.item, pagesLeft: 0, thread: true }; return { go: "https://old.reddit.com" + perm, stage: `reading comments (${S.commentQueue.length} left)` }; }
  }
  // 4. nothing left for this tab
  delete S.active[tabId];
  return { done: true, last: Object.keys(S.active).length === 0 };
}

async function handlePage(tabId, payload) {
  return withLock(async () => {
    await loadS();
    if (!S || !S.active[tabId]) return { ignore: true };
    const a = S.active[tabId];
    if (a.thread) return { ignore: true }; // a listing page while assigned a thread: not ours
    const r = await ingest(payload.posts || [], payload.source, S.run);
    a.pagesLeft -= 1; a.nextUrl = payload.nextUrl || "";
    S.stats.pagesDone += 1; S.stats.kept += r.kept; S.stats.fresh = (S.stats.fresh || 0) + r.fresh;
    const nx = await nextForTab(tabId);
    if (nx.done) { await saveS(); if (nx.last) { await pushProgress("finished"); await _stop(false); return { done: true, finished: true }; } await pushProgress("winding down"); return { done: true }; }
    const wait = throttle();
    await saveS(); await pushProgress(nx.stage);
    return { go: nx.go, wait, stage: nx.stage, kept: r.kept };
  });
}

async function handleThread(tabId, payload) {
  return withLock(async () => {
    await loadS();
    if (!S || !S.active[tabId] || !S.active[tabId].thread) return { ignore: true };
    await saveSignals(payload.post, payload.signals, payload.source);
    S.stats.threadsDone += 1; await touchRun(S.run, { threads: 1 });
    const nx = await nextForTab(tabId);
    if (nx.done) { await saveS(); if (nx.last) { await pushProgress("finished"); await _stop(false); return { done: true, finished: true }; } return { done: true }; }
    const wait = throttle();
    await saveS(); await pushProgress(nx.stage);
    return { go: nx.go, wait, stage: nx.stage };
  });
}

// Reddit answered "too many requests": every tab pauses 90s and the cap drops 30%.
async function handle429(tabId) {
  return withLock(async () => {
    await loadS();
    if (!S) return { wait: 60000 };
    S.cooldownUntil = Date.now() + 90000;
    S.maxPerMin = Math.max(6, Math.floor(S.maxPerMin * 0.7));
    S.stats.throttled += 1;
    await saveS(); await pushProgress(`rate limited, cooling down 90s (cap now ${S.maxPerMin}/min)`);
    return { wait: 90000 + Math.floor(Math.random() * 5000) };
  });
}

// A worker tab closed by hand: put its item back and carry on with the rest.
chrome.tabs.onRemoved.addListener((tabId) => withLock(async () => {
  await loadS();
  if (!S || !S.active[tabId]) return;
  const a = S.active[tabId];
  if (!a.thread && a.pagesLeft > 0) S.queue.unshift({ ...a.item, pages: a.pagesLeft });
  delete S.active[tabId];
  await saveS();
  if (!Object.keys(S.active).length) { await pushProgress("all tabs closed"); await _stop(true); }
}));

// --- OAuth (installed app, userless). Token lasts ~1h; cached in storage.
async function getToken(clientId, force = false) {
  if (!clientId) return "";
  const { oauth = {} } = await chrome.storage.local.get(["oauth"]);
  if (!force && oauth.token && oauth.clientId === clientId && oauth.expires > Date.now() + 60000) return oauth.token;
  const { deviceId } = await chrome.storage.local.get(["deviceId"]);
  const dev = deviceId || crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  if (!deviceId) await chrome.storage.local.set({ deviceId: dev });
  const r = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(clientId + ":"), "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("https://oauth.reddit.com/grants/installed_client")}&device_id=${dev}&scope=read`,
  });
  if (!r.ok) throw new Error(`OAuth ${r.status}: check the client id (must be an "installed app")`);
  const j = await r.json();
  if (!j.access_token) throw new Error("OAuth: no token in response");
  await chrome.storage.local.set({ oauth: { token: j.access_token, clientId, expires: Date.now() + (j.expires_in || 3600) * 1000 } });
  return j.access_token;
}

function makeClient(token) {
  const oauth = !!token;
  const pace = oauth ? OAUTH_PACE_MS : PUBLIC_PACE_MS;
  let requests = 0;
  async function get(url, attempt = 0) {
    const headers = { Accept: "application/json" };
    if (oauth) headers.Authorization = "bearer " + token;
    const r = await fetch(url, { credentials: "omit", headers });
    requests += 1;
    if ((r.status === 429 || r.status >= 500) && attempt < 3) { await sleep(20000 * (attempt + 1)); return get(url, attempt + 1); }
    if (!r.ok) throw new Error(`${r.status} ${url.replace(/^https:\/\/[^/]+/, "")}`);
    await sleep(pace);
    return r.json();
  }
  return { get, oauth, count: () => requests };
}

let running = false;

async function refresh() {
  if (running) return;
  running = true;
  const started = Date.now();
  try {
    const cfg = await getConfig();
    const compiled = compileKeywords(cfg.entries);
    const store = await chrome.storage.local.get(["posts", "snaps"]);
    const posts = store.posts || {};
    const snaps = store.snaps || {};
    const errors = [];
    const now = Date.now();
    const cutoff = now - cfg.windowDays * 86400000;

    let token = "";
    try { token = await getToken(cfg.clientId); } catch (e) { errors.push(e.message + " — falling back to public rate"); }
    const client = makeClient(token);

    const setMeta = (stage, extra = {}) => chrome.storage.local.set({ meta: { running: true, stage, startedAt: started, requests: client.count(), oauth: client.oauth, ...extra } });
    await setMeta("starting");

    const record = (p) => {
      if (!keepPost(p)) return false;
      const prev = posts[p.id] || {};
      posts[p.id] = { ...prev, ...p, signals: prev.signals, firstSeen: prev.firstSeen || now, lastSeen: now };
      const arr = snaps[p.id] || [];
      const last = arr[arr.length - 1];
      if (!last || last.score !== p.score || last.comments !== p.comments || now - last.t > 6 * 3600 * 1000) arr.push({ t: now, score: p.score, comments: p.comments });
      snaps[p.id] = arr.slice(-MAX_SNAPS);
      return true;
    };

    // 1. Page-by-page crawl of each subreddit's newest posts.
    let scanned = 0, kept = 0;
    for (const sub of cfg.subs) {
      let after = "", pages = 0, reachedCutoff = false;
      while (pages < cfg.maxPages && !reachedCutoff) {
        try {
          const data = await client.get(listingUrl(sub, after, 100, client.oauth));
          const children = (data.data && data.data.children) || [];
          for (const c of children) {
            const p = postFromChild(c, sub, compiled);
            scanned += 1;
            if (p.created < cutoff) { reachedCutoff = true; continue; }
            if (record(p)) kept += 1;
          }
          after = data.data && data.data.after;
          pages += 1;
          if (!after || !children.length) break;
        } catch (e) { errors.push(`r/${sub} page ${pages + 1}: ${e.message}`); break; }
        await setMeta(`crawling r/${sub} page ${pages}`, { scanned, kept });
      }
      // Busy subreddits exceed the 1000-post listing cap before the window
      // ends. Optional keyword searches reach further back.
      if (!reachedCutoff && cfg.alsoSearch) {
        const t = cfg.windowDays <= 7 ? "week" : cfg.windowDays <= 31 ? "month" : "year";
        const groupsSeen = new Set();
        for (const e of cfg.entries) {
          if (groupsSeen.has(e.group)) continue;
          groupsSeen.add(e.group);
          const batch = cfg.entries.filter((x) => x.group === e.group).slice(0, 12).map((x) => `(${x.kw})`).join(" OR ");
          try {
            const data = await client.get(searchUrl(sub, batch, "new", t, 100, client.oauth));
            for (const c of (data.data && data.data.children) || []) { const p = postFromChild(c, sub, compiled); scanned += 1; if (p.created >= cutoff && record(p)) kept += 1; }
          } catch (err) { errors.push(`search r/${sub} ${e.group}: ${err.message}`); }
        }
      }
    }

    // 2. Comment deep-dive on the most active tracked posts not analysed recently.
    const candidates = Object.values(posts)
      .filter((p) => p.comments > 0 && p.created >= cutoff && (!p.signals || now - (p.signals.t || 0) > 12 * 3600 * 1000))
      .map((p) => ({ p, h: heatScore(p, snaps[p.id], now) }))
      .sort((a, b) => (b.h.dComments - a.h.dComments) || (b.p.comments - a.p.comments))
      .slice(0, cfg.commentDives);
    let k = 0;
    for (const { p } of candidates) {
      try {
        const listing = await client.get(commentsUrl(p.permalink, client.oauth));
        p.signals = { ...summariseComments(listing, p.author), t: Date.now() };
      } catch (e) { errors.push(`comments ${p.id}: ${e.message}`); }
      k += 1;
      if (k % 10 === 0) await setMeta(`reading comments ${k}/${candidates.length}`, { scanned, kept });
    }

    // 3. Prune posts unseen for 90 days.
    for (const id of Object.keys(posts)) if (now - (posts[id].lastSeen || 0) > 90 * 86400000) { delete posts[id]; delete snaps[id]; }

    const meta = {
      running: false, lastRun: Date.now(), durationMin: Math.round((Date.now() - started) / 6000) / 10, requests: client.count(), oauth: client.oauth,
      scanned, kept, errors: errors.slice(0, 50), count: Object.keys(posts).length, analysed: Object.values(posts).filter((p) => p.signals).length,
    };
    await chrome.storage.local.set({ posts, snaps, meta });
    if (cfg.autoCsv) await exportCsv(posts, snaps);
  } finally { running = false; }
}

async function exportCsv(posts, snaps) {
  const now = Date.now();
  const rows = Object.values(posts).map((p) => toRow(p, snaps[p.id], now)).sort((a, b) => b.leadScore - a.leadScore || b.heat - a.heat);
  const url = "data:text/csv;charset=utf-8," + encodeURIComponent("﻿" + toCsv(rows));
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  try { await chrome.downloads.download({ url, filename: `reddit-lead-threads/leads-${stamp}.csv`, conflictAction: "uniquify", saveAs: false }); }
  catch (e) { const { meta = {} } = await chrome.storage.local.get(["meta"]); meta.errors = [...(meta.errors || []), "csv: " + e.message]; await chrome.storage.local.set({ meta }); }
}

// ===========================================================================
// CO-FOUNDER HUNT
// Polls a handful of subreddits every minute for people asking for a
// co-founder, keeps one queue sorted by fit, and refuses to surface anyone
// you have already contacted. Read-only: it never posts and never DMs.
// ===========================================================================
const HUNT_ALARM = "hunt-poll";
const HUNT_KEEP_DAYS = 14;

async function huntGet() {
  const { hunt = {} } = await chrome.storage.local.get(["hunt"]);
  return {
    on: !!hunt.on,
    posts: hunt.posts || {},
    contacted: hunt.contacted || {},
    cursor: hunt.cursor || 0,
    lastPoll: hunt.lastPoll || 0,
    lastError: hunt.lastError || "",
    subs: hunt.subs && hunt.subs.length ? hunt.subs : HUNT_SUBS,
    perTick: hunt.perTick || 4,
    maxAgeH: hunt.maxAgeH || 48,
    server: hunt.server || null,
    me: hunt.me || "",
    found: hunt.found || 0,
    sent: Array.isArray(hunt.sent) ? hunt.sent : [],   // fingerprints of the last DMs built, so none repeats
    lastReport: hunt.lastReport || "",
  };
}
async function huntSet(patch) {
  const { hunt = {} } = await chrome.storage.local.get(["hunt"]);
  await chrome.storage.local.set({ hunt: { ...hunt, ...patch } });
}
function huntArm(on) {
  if (on) chrome.alarms.create(HUNT_ALARM, { periodInMinutes: 1, delayInMinutes: 0.1 });
  else chrome.alarms.clear(HUNT_ALARM);
}

// Reddit answers 403 to JSON asked for by an extension worker: no cookies, no
// referrer, not a browsing session. So we read through a pinned old.reddit.com
// tab instead — the content script's fetch is same-origin and carries your
// normal logged-in session, exactly like scrolling the page yourself.
async function huntTabId() {
  const { hunt = {} } = await chrome.storage.local.get(["hunt"]);
  if (hunt.tabId) {
    try {
      const t = await chrome.tabs.get(hunt.tabId);
      if (t && /^https:\/\/old\.reddit\.com/.test(t.url || "")) return t.id;
    } catch (_) { /* it was closed */ }
  }
  const tab = await chrome.tabs.create({ url: "https://old.reddit.com/r/cofounder/new/", active: false, pinned: true });
  await new Promise((done) => {
    const on = (id, info) => { if (id === tab.id && info.status === "complete") { chrome.tabs.onUpdated.removeListener(on); done(); } };
    chrome.tabs.onUpdated.addListener(on);
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(on); done(); }, 15000);
  });
  await huntSet({ tabId: tab.id });
  return tab.id;
}

function withTimeout(p, ms, what) {
  return Promise.race([p, new Promise((_, bad) => setTimeout(() => bad(new Error(what + " timed out")), ms))]);
}

async function huntFetchViaTab(url) {
  const tabId = await huntTabId();
  const r = await withTimeout(chrome.tabs.sendMessage(tabId, { type: "hunt-fetch", url }), 20000, "the Reddit tab");
  if (!r) throw new Error("the Reddit tab did not answer — reload it");
  if (!r.ok) throw new Error(r.error);
  return r.json;
}

async function huntFetch(url) {
  // 1. straight from the worker, with your cookies. Cheapest when it works.
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 12000);
    const r = await fetch(url, { credentials: "include", cache: "no-store", signal: ctl.signal, headers: { Accept: "application/json" } });
    clearTimeout(t);
    if (r.ok) return await r.json();
  } catch (_) { /* blocked, offline or aborted: fall through to the tab */ }
  // 2. through the pinned Reddit tab, as you.
  return huntFetchViaTab(url);
}

// Turn a Reddit JSON child into a hunt candidate, or null if it isn't one.
function huntCandidate(child) {
  const d = child && child.data;
  if (!d || d.stickied || d.over_18) return null;
  const author = (d.author || "").trim();
  if (!author || author === "[deleted]" || /^automoderator$/i.test(author)) return null;
  const title = d.title || "", body = d.selftext || "";
  const c = classifyCofounder(title, body);
  if (!c.keep) return null;
  return {
    id: d.name || ("t3_" + d.id),
    author,
    sub: d.subreddit || "",
    title,
    body: body.slice(0, 4000),
    permalink: "https://www.reddit.com" + (d.permalink || ""),
    created: (d.created_utc || 0) * 1000,
    comments: d.num_comments || 0,
    ups: d.score || 0,
    flair: d.link_flair_text || "",
    role: c.role, stage: c.stage, equityOnly: c.equityOnly, hasBudget: c.hasBudget,
    firstSeen: Date.now(),
  };
}

// A collector running on a server does the reading around the clock, so the
// queue is full even when this laptop was shut. When one is configured and
// answering, the browser does no Reddit reads of its own.
async function huntPullServer(st) {
  const s = st.server;
  if (!s || !s.url || !s.token) return null;
  const url = s.url.replace(/\/+$/, "") + `/queue?maxAgeH=${st.maxAgeH}&limit=200`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { headers: { Authorization: "Bearer " + s.token }, cache: "no-store", signal: ctl.signal });
    if (!r.ok) throw new Error("server HTTP " + r.status + (r.status === 401 ? " — wrong token" : ""));
    const j = await r.json();
    const posts = st.posts;
    let added = 0;
    for (const cand of j.posts || []) {
      const prev = posts[cand.id];
      if (prev) { prev.comments = cand.comments; prev.ups = cand.ups; continue; }
      posts[cand.id] = { ...cand, firstSeen: cand.firstSeen || Date.now() };
      added += 1;
    }
    return { added, seen: (j.posts || []).length, serverLastPoll: j.lastPoll || 0, error: j.lastError ? "server's own Reddit read failed: " + j.lastError : "" };
  } catch (e) { return { error: String(e.message || e), failed: true }; }
  finally { clearTimeout(timer); }
}

async function huntPoll(force) {
  const st = await huntGet();
  if (!st.on && !force) return { ok: false, error: "hunt is off" };

  inboxPoll().catch(() => {});      // in parallel; one request through the tab
  const fromServer = await huntPullServer(st);
  if (fromServer && !fromServer.failed) {
    const cutoff = Date.now() - HUNT_KEEP_DAYS * 86400000;
    for (const [id, p] of Object.entries(st.posts)) {
      if (!p.act && !p.repliedAt && !p.dmAt && (p.created || p.firstSeen || 0) < cutoff) delete st.posts[id];
    }
    await huntSet({ posts: st.posts, lastPoll: Date.now(), lastError: fromServer.error || "", serverLastPoll: fromServer.serverLastPoll, found: st.found + fromServer.added, via: "server" });
    return { ok: true, added: fromServer.added, seen: fromServer.seen, via: "server", error: fromServer.error || "" };
  }
  if (fromServer && fromServer.failed) await huntSet({ lastError: "server: " + fromServer.error });
  const subs = st.subs;
  const n = force ? subs.length : Math.max(1, Math.min(8, st.perTick));   // Check now sweeps every subreddit
  const picks = [];
  for (let i = 0; i < n; i += 1) picks.push(subs[(st.cursor + i) % subs.length]);
  const query = HUNT_QUERIES[st.cursor % HUNT_QUERIES.length];
  const urls = picks.map((s) => `https://old.reddit.com/r/${encodeURIComponent(s)}/new.json?limit=25&raw_json=1`);
  urls.push(`https://old.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=new&t=week&limit=25&raw_json=1`);

  const posts = st.posts;
  let added = 0, seen = 0, error = "", ok = 0, known = 0, dropped = 0;
  for (const url of urls) {
    try {
      const j = await huntFetch(url);
      ok += 1;
      for (const child of (j.data && j.data.children) || []) {
        seen += 1;
        const cand = huntCandidate(child);
        if (!cand) { dropped += 1; continue; }
        if (cand.created && Date.now() - cand.created > (st.maxAgeH + 12) * 3600000) continue;
        const prev = posts[cand.id];
        if (prev) { known += 1; prev.comments = cand.comments; prev.ups = cand.ups; continue; }
        posts[cand.id] = cand;
        added += 1;
      }
    } catch (e) { error = String(e.message || e); }
    await sleep(force ? 700 : 1200);           // stay well under Reddit's public pace
  }
  // Forget stale, untouched candidates so the store cannot grow forever.
  const cutoff = Date.now() - HUNT_KEEP_DAYS * 86400000;
  for (const [id, p] of Object.entries(posts)) {
    if (!p.act && !p.repliedAt && !p.dmAt && (p.created || p.firstSeen || 0) < cutoff) delete posts[id];
  }
  const report = `scanned ${seen} posts in ${picks.map((x) => "r/" + x).join(", ")} + search · ${added} new co-founder ask${added === 1 ? "" : "s"} · ${known} already in the database · ${dropped} not a co-founder ask${ok < urls.length ? ` · ${urls.length - ok} request(s) failed: ${error}` : ""}`;
  await huntSet({ posts, cursor: (st.cursor + n) % subs.length, lastPoll: Date.now(), lastError: ok ? "" : error, found: st.found + added, lastReport: report });
  return { ok: true, added, seen, known, dropped, checked: ok, error: ok ? "" : error, report };
}

// Your Reddit username: from Options, else asked of the logged-in tab once.
async function huntMe() {
  const st = await huntGet();
  if (st.me) return st.me;
  const { config = {} } = await chrome.storage.local.get(["config"]);
  const typed = ((config.profile || {}).reddit || "").replace(/^\/?u\//, "").trim();
  if (typed) { await huntSet({ me: typed }); return typed; }
  try {
    const j = await huntFetch("https://old.reddit.com/api/me.json");
    const name = (j && (j.name || (j.data && j.data.name))) || "";
    if (name) { await huntSet({ me: name }); return name; }
  } catch (_) { /* not logged in in that tab */ }
  return "";
}

// One cheap read of the thread: if your username is already in it, this post is
// done — it leaves the queue and the person goes on the contacted list.
async function huntCheckMine(id) {
  const st = await huntGet();
  const p = st.posts[id];
  if (!p) return { ok: false };
  const me = await huntMe();
  if (!me) return { ok: true, me: "", mine: false };
  if (p.checkedMine && Date.now() - p.checkedMine < 6 * 3600000) return { ok: true, me, mine: !!p.mine };
  let mine = false;
  try {
    const path = p.permalink.replace(/^https?:\/\/[^/]+/, "").replace(/\/$/, "");
    const j = await huntFetch(`https://old.reddit.com${path}.json?limit=200&raw_json=1`);
    const walk = (node) => {
      if (!node || mine) return;
      if (Array.isArray(node)) return node.forEach(walk);
      const d = node.data || {};
      if (d.author && d.author.toLowerCase() === me.toLowerCase() && node.kind === "t1") mine = true;
      if (d.children) walk(d.children);
      if (d.replies) walk(d.replies);
    };
    walk(j);
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
  p.checkedMine = Date.now();
  if (mine) {
    p.mine = true;
    const k = (p.author || "").toLowerCase();
    if (k && !st.contacted[k]) st.contacted[k] = { at: Date.now(), id, how: "already replied", sub: p.sub };
  }
  await huntSet({ posts: st.posts, contacted: st.contacted });
  return { ok: true, me, mine };
}

// The queue: fit-ranked, never anyone already contacted, never anything you
// skipped or marked irrelevant.
async function huntQueue(limit = 40) {
  const st = await huntGet();
  const { inbox: ibx = {} } = await chrome.storage.local.get(["inbox"]);
  const dealV = ibx.dealV || 0;
  const now = Date.now();
  const list = [];
  let blocked = 0;
  const maxAge = st.maxAgeH * 3600000;
  let stale = 0, later = 0;
  for (const p of Object.values(st.posts)) {
    if (p.act === "skip" || p.act === "not_relevant" || p.dmAt) continue;
    if (p.laterUntil && p.laterUntil > now) { later += 1; continue; }   // snoozed till tomorrow
    if (p.mine) { blocked += 1; continue; }              // you already commented there
    if (now - (p.created || p.firstSeen || 0) > maxAge) { stale += 1; continue; }
    const prior = st.contacted[(p.author || "").toLowerCase()];
    if (prior && prior.id !== p.id) { blocked += 1; continue; }
    // a reply written under an older deal is not shown; it gets written again
    list.push({ ...p, ai: p.ai && (p.ai.dealV || 0) === dealV ? p.ai : undefined, score: huntScore(p, now) });
  }
  list.sort((a, b) => (b.repliedAt ? 1 : 0) - (a.repliedAt ? 1 : 0) || b.score - a.score);
  // One card per person: the same founder cross-posts to several subreddits.
  // Keep the best-fit post, remember the others as "also posted in".
  const seenAuthor = {};
  const collapsed = [];
  let dupes = 0;
  for (const p of list) {
    const k = (p.author || "").toLowerCase();
    if (k && seenAuthor[k]) { seenAuthor[k].also = (seenAuthor[k].also || []).concat([{ sub: p.sub, permalink: p.permalink, id: p.id }]); dupes += 1; continue; }
    if (k) seenAuthor[k] = p;
    collapsed.push(p);
  }
  list.length = 0; list.push(...collapsed);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yday = today.getTime() - 86400000;
  const contacted = Object.values(st.contacted);
  const doneAt = (p) => Math.max(p.repliedAt || 0, p.dmAt || 0);
  const all = Object.values(st.posts);
  const doneToday = all.filter((p) => doneAt(p) >= today.getTime()).length;
  const doneYesterday = all.filter((p) => doneAt(p) >= yday && doneAt(p) < today.getTime()).length;
  const lastDone = Math.max(0, ...all.map(doneAt));
  const newSince = all.filter((p) => (p.firstSeen || 0) > lastDone && !p.act && !p.dmAt && !p.mine).length;
  const aiCancelled = all.filter((p) => p.cancelledBy === "ai" && (p.actAt || 0) >= today.getTime()).length;
  return {
    queue: list.slice(0, limit),
    total: list.length,
    blocked, later, dupes, aiCancelled, doneToday, doneYesterday, newSince, lastDone,
    lastReport: st.lastReport || "",
    spend: await spendGet(),
    contactedTotal: contacted.length,
    contactedToday: contacted.filter((c) => c.at >= today.getTime()).length,
    on: st.on,
    server: st.server ? { url: st.server.url, on: true } : null,
    stale,
    maxAgeH: st.maxAgeH,
    me: st.me,
    lastPoll: st.lastPoll,
    lastError: st.lastError,
    found: st.found,
  };
}

// After an update the classifier may have learnt to drop something that is
// already sitting in the queue (beta-tester asks, builders). Re-run it.
async function huntReclassify() {
  const st = await huntGet();
  let dropped = 0;
  for (const [id, p] of Object.entries(st.posts)) {
    if (p.act || p.repliedAt || p.dmAt) continue;
    const c = classifyCofounder(p.title, p.body);
    if (!c.keep) { delete st.posts[id]; dropped += 1; continue; }
    Object.assign(p, { role: c.role, stage: c.stage, equityOnly: c.equityOnly, hasBudget: c.hasBudget });
  }
  if (dropped || true) await huntSet({ posts: st.posts });
  return dropped;
}

async function huntAct(id, action, variant) {
  const st = await huntGet();
  const p = st.posts[id];
  if (!p) return { ok: false };
  const now = Date.now();
  if (action === "skip" || action === "not_relevant") p.act = action;
  if (action === "later") { const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(7, 0, 0, 0); p.laterUntil = t.getTime(); }
  const sameAuthor = Object.values(st.posts).filter((q) => q.id !== id && (q.author || "").toLowerCase() === (p.author || "").toLowerCase());
  if (action === "skip" || action === "not_relevant" || action === "later") for (const q of sameAuthor) { if (action === "later") q.laterUntil = p.laterUntil; else q.act = action; }
  if (action === "replied") { p.repliedAt = now; p.usedVariant = variant; st.contacted[p.author.toLowerCase()] = { at: now, id, how: "reply", sub: p.sub }; }
  if (action === "dm") {
    p.dmAt = now;
    const prev = st.contacted[p.author.toLowerCase()];
    st.contacted[p.author.toLowerCase()] = { at: now, id, how: prev && prev.how === "reply" ? "reply+dm" : "dm", sub: p.sub };
  }
  if (action === "undo") { delete p.act; delete p.repliedAt; delete p.dmAt; if ((st.contacted[p.author.toLowerCase()] || {}).id === id) delete st.contacted[p.author.toLowerCase()]; }
  p.actAt = now;
  await huntSet({ posts: st.posts, contacted: st.contacted });
  return { ok: true };
}

// ===========================================================================
// AI-WRITTEN REPLIES (Claude API, the user's own key)
// One request per post, cached on the post. Raw HTTP: an unpacked extension
// has no bundler for the SDK. The browser-access header is required because
// the request carries a chrome-extension:// origin.
// ===========================================================================
const AI_URL = "https://api.anthropic.com/v1/messages";
const AI_MODEL = "claude-opus-5";
// $ per million tokens: input, output, cache write (1.25x), cache read (0.1x)
const AI_PRICES = { "claude-opus-5": [5, 25], "claude-sonnet-5": [2, 10] };
const AI_POLISH_MODEL = "claude-sonnet-5";
const AI_SLOT_MODEL = "claude-sonnet-5";   // the slots are a small extraction; the shape is written here
// ---- the daily cap: cents spent today across every call, against the budget in Your details
const dayKey = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
async function spendGet() {
  const { spend = {}, config = {} } = await chrome.storage.local.get(["spend", "config"]);
  const cents = spend.day === dayKey() ? Number(spend.cents || 0) : 0;
  const budget = Number((config.profile || {}).aiBudgetCents);
  return { day: dayKey(), cents, budget: Number.isFinite(budget) && budget > 0 ? budget : 100 };
}
async function spendAdd(c) {
  const s = await spendGet();
  await chrome.storage.local.set({ spend: { day: s.day, cents: Math.round((s.cents + (Number(c) || 0)) * 10) / 10 } });
}
// Comments on the thread and the author's other posts, through the pinned
// tab, cached on the post for a day. Never blocks a write: failures are skipped.
async function huntContext(p) {
  if (p.ctx && Date.now() - (p.ctx.at || 0) < 86400000) return p.ctx;
  const ctx = { comments: [], author: [], at: Date.now() };
  const me = ((await huntMe()) || "").toLowerCase();
  try {
    const path = String(p.permalink || "").replace(/^https?:\/\/[^/]+/, "");
    if (path) {
      const j = await huntFetch("https://old.reddit.com" + path.replace(/\/?$/, "/") + ".json?limit=12&depth=1&raw_json=1");
      const kids = ((j && j[1] && j[1].data && j[1].data.children) || []).map((c) => c.data).filter((d) => d && d.body && d.author && d.author !== "AutoModerator" && d.author.toLowerCase() !== me);
      ctx.comments = kids.slice(0, 8).map((d) => ({ author: d.author, op: !!d.is_submitter, body: String(d.body).replace(/\s+/g, " ").slice(0, 300) }));
    }
  } catch (_) { /* no comments this time */ }
  try {
    if (p.author) {
      const j = await huntFetch(`https://old.reddit.com/user/${encodeURIComponent(p.author)}/overview.json?limit=10&raw_json=1`);
      const items = ((j && j.data && j.data.children) || []).map((c) => c.data).filter((d) => d && d.name !== ("t3_" + p.id) && d.id !== p.id);
      ctx.author = items.slice(0, 6).map((d) => ({ sub: d.subreddit || "", text: String(d.title ? d.title + (d.selftext ? " — " + d.selftext : "") : d.body || "").replace(/\s+/g, " ").slice(0, 260) })).filter((a) => a.text);
    }
  } catch (_) { /* no profile this time */ }
  p.ctx = ctx;
  return ctx;
}
async function aiModel() { const { config = {} } = await chrome.storage.local.get(["config"]); const m = (config.profile || {}).aiModel; return AI_PRICES[m] ? m : AI_MODEL; }
function aiCents(model, u) {
  const [pin, pout] = AI_PRICES[model] || AI_PRICES[AI_MODEL];
  const usd = ((u.input_tokens || 0) * pin + (u.cache_creation_input_tokens || 0) * pin * 1.25 + (u.cache_read_input_tokens || 0) * pin * 0.1 + (u.output_tokens || 0) * pout) / 1e6;
  return Math.round(usd * 1000) / 10;
}
// The request body shared by both writers: the static system prompt is cached
// (a prefix hit costs a tenth), fallbacks only where the model supports them.
function aiBody(model, system, user, schema, maxTokens) {
  const body = { model, max_tokens: maxTokens, output_config: { effort: "low", format: { type: "json_schema", schema } }, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content: user }] };
  if (model === "claude-opus-5") body.fallbacks = "default";
  return body;
}
function aiHeaders(key, model) {
  const h = { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" };
  if (model === "claude-opus-5") h["anthropic-beta"] = "server-side-fallback-2026-07-01";
  return h;
}

async function huntAiKey() {
  const { config = {} } = await chrome.storage.local.get(["config"]);
  return ((config.profile || {}).apiKey || "").trim();
}

async function huntAiWrite(id, force) {
  const st = await huntGet();
  const p = st.posts[id];
  if (!p) return { ok: false, error: "post not found" };
  const { config = {}, inbox = {} } = await chrome.storage.local.get(["config", "inbox"]);
  if (p.ai && !force && (p.ai.dealV || 0) === (inbox.dealV || 0)) return { ok: true, ai: p.ai, cached: true };
  const key = await huntAiKey();
  if (!key) return { ok: false, error: "no api key", noKey: true };
  const spent = await spendGet();
  if (spent.cents >= spent.budget) return { ok: false, overBudget: true, error: `today's AI budget is used up (${spent.cents}¢ of ${spent.budget}¢) — templates or Claude in Chrome until tomorrow, or raise it under AI writing` };
  const model = await aiModel();
  await huntContext(p);
  const { system, user: user0, schema } = huntAiPrompt(p, { ...(config.profile || {}), deal: { ...DEAL_DEFAULT, ...(inbox.deal || {}) } });
  const user = user0 + (force === "shorter" ? "\n\nYour previous public_reply was too long. This time keep it under 35 words in total, two short lines." : "");

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 90000);
  let r, j;
  try {
    r = await fetch(AI_URL, {
      method: "POST",
      signal: ctl.signal,
      headers: aiHeaders(key, model),
      body: JSON.stringify(aiBody(model, system, user, schema, 3000)),
    });
    j = await r.json().catch(() => ({}));
  } catch (e) {
    return { ok: false, error: /abort/i.test(String(e)) ? "the API took more than 90s" : "could not reach api.anthropic.com: " + String(e.message || e) };
  } finally { clearTimeout(timer); }

  if (!r.ok) {
    const msg = (j.error && j.error.message) || ("HTTP " + r.status);
    return { ok: false, error: r.status === 401 ? "the API key was rejected — check it in Your details" : r.status === 429 ? "rate limited by the API, try again in a minute" : msg };
  }
  if (j.stop_reason === "refusal") return { ok: false, error: "the model declined this post" + (j.stop_details && j.stop_details.category ? " (" + j.stop_details.category + ")" : "") };
  const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (_) { return { ok: false, error: "the model returned something that was not JSON" }; }
  const ai = huntAiClean(parsed);
  if (ai && ai.tooLong) {
    if (force !== "shorter") return huntAiWrite(id, "shorter");   // one more try, told to be brief
    return { ok: false, error: "the model kept the public reply too long — press rewrite" };
  }
  if (!ai) return { ok: false, error: "the model's reply failed the checks (two lines, no links, no prices, lengths)" };
  // The AI's cancel: not a founder who would hire a team -> gone, with the reason.
  if (ai.fit === "no") {
    p.act = "not_relevant"; p.actAt = Date.now(); p.cancelledBy = "ai"; p.cancelReason = ai.fit_reason || "not a fit";
    await huntSet({ posts: st.posts });
    return { ok: false, cancelled: true, reason: p.cancelReason };
  }
  const u = j.usage || {};
  ai.at = Date.now();
  ai.dealV = inbox.dealV || 0;
  ai.model = j.model || model;
  ai.cents = aiCents(model, u);
  ai.cached = u.cache_read_input_tokens || 0;
  await spendAdd(ai.cents);
  // The polish pass: a cheaper model rewrites only the sentences that could
  // have been sent to anyone. Skipped when off, or when it would pass the cap.
  if ((config.profile || {}).aiPolish !== false && spent.cents + ai.cents + 1.5 < spent.budget) {
    try {
      const pol = await huntPolish(key, p, ai);
      if (pol) { Object.assign(ai, pol); await spendAdd(pol.polishCents); }
    } catch (_) { /* keep the first draft */ }
  }
  p.ai = ai;
  await huntSet({ posts: st.posts });
  return { ok: true, ai };
}
// The template engine: one cheap call fills the slots, the message is built
// here from your skeleton, and every one is checked against the last forty you
// sent so no two read alike.
async function huntSlotWrite(id, force) {
  const st = await huntGet();
  const p = st.posts[id];
  if (!p) return { ok: false, error: "post not found" };
  const { config = {}, inbox = {} } = await chrome.storage.local.get(["config", "inbox"]);
  if (p.ai && !force && (p.ai.dealV || 0) === (inbox.dealV || 0)) return { ok: true, ai: p.ai, cached: true };
  const key = await huntAiKey();
  if (!key) return { ok: false, error: "no api key", noKey: true };
  const spent = await spendGet();
  if (spent.cents >= spent.budget) return { ok: false, overBudget: true, error: `today's AI budget is used up (${spent.cents}¢ of ${spent.budget}¢) — templates until tomorrow, or raise it under AI writing` };
  await huntContext(p);
  const profile = { ...(config.profile || {}), deal: { ...DEAL_DEFAULT, ...(inbox.deal || {}) } };
  const { system, user, schema } = huntSlotPrompt(p, profile);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60000);
  let r, j;
  try {
    r = await fetch(AI_URL, { method: "POST", signal: ctl.signal, headers: aiHeaders(key, AI_SLOT_MODEL), body: JSON.stringify(aiBody(AI_SLOT_MODEL, system, user, schema, 900)) });
    j = await r.json().catch(() => ({}));
  } catch (e) {
    return { ok: false, error: /abort/i.test(String(e)) ? "the API took more than 60s" : "could not reach api.anthropic.com: " + String(e.message || e) };
  } finally { clearTimeout(timer); }
  if (!r.ok) {
    const msg = (j.error && j.error.message) || ("HTTP " + r.status);
    return { ok: false, error: r.status === 401 ? "the API key was rejected — check it in Your details" : r.status === 429 ? "rate limited by the API, try again in a minute" : msg };
  }
  if (j.stop_reason === "refusal") return { ok: false, error: "the model declined this post" };
  const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  let slots; try { slots = JSON.parse(text); } catch (_) { return { ok: false, error: "the model returned something that was not JSON" }; }
  if (slots.fit === "no") {
    p.act = "not_relevant"; p.actAt = Date.now(); p.cancelledBy = "ai"; p.cancelReason = String(slots.fit_reason || "not a fit").slice(0, 200);
    await huntSet({ posts: st.posts });
    return { ok: false, cancelled: true, reason: p.cancelReason };
  }
  const sent = Array.isArray(st.sent) ? st.sent : [];
  const ai = huntSlotAssemble(p, profile, slots, { avoid: sent.map((x) => x.sh), recentStyles: sent.map((x) => x.style) });
  if (!ai.public_reply || ai.dm_short.length < 180) return { ok: false, error: "the slots came back too thin — press rewrite" };
  ai.at = Date.now();
  ai.dealV = inbox.dealV || 0;
  ai.model = "template+slots";
  ai.cents = aiCents(AI_SLOT_MODEL, j.usage || {});
  await spendAdd(ai.cents);
  const shingles = ai.shingles || [];
  delete ai.shingles;
  p.ai = ai;
  await huntSet({ posts: st.posts, sent: [{ at: Date.now(), style: ai.style, sh: shingles }, ...sent].slice(0, 40) });
  return { ok: true, ai };
}
async function huntPolish(key, p, ai) {
  const { system, user, schema } = huntPolishPrompt(p, ai);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60000);
  let r, j;
  try {
    r = await fetch(AI_URL, { method: "POST", signal: ctl.signal, headers: aiHeaders(key, AI_POLISH_MODEL), body: JSON.stringify(aiBody(AI_POLISH_MODEL, system, user, schema, 2500)) });
    j = await r.json().catch(() => ({}));
  } finally { clearTimeout(timer); }
  if (!r.ok || j.stop_reason === "refusal") return null;
  const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  let out; try { out = JSON.parse(text); } catch (_) { return null; }
  // the polished texts must still pass every check; otherwise the first draft stands
  const again = huntAiClean({ ...ai, concept: ai.concept, public_reply: out.public_reply, dm_short: out.dm_short, dm_long: out.dm_long, fit: "yes" });
  if (!again || again.tooLong) return null;
  const cents = aiCents(AI_POLISH_MODEL, j.usage || {});
  return { public_reply: again.public_reply, dm_short: again.dm_short, dm_long: again.dm_long, quoted: again.quoted, generic: again.generic, polished: true, genericFound: (Array.isArray(out.generic) ? out.generic : []).map((x) => String(x).slice(0, 160)).slice(0, 6), polishCents: cents, cents: Math.round((ai.cents + cents) * 10) / 10 };
}

// ===========================================================================
// INBOX: private replies to your DMs, read through the logged-in tab
// ===========================================================================
async function inboxGet() {
  const { inbox = {} } = await chrome.storage.local.get(["inbox"]);
  return { threads: inbox.threads || {}, lastPoll: inbox.lastPoll || 0, lastError: inbox.lastError || "", plan: inbox.plan || "", me: inbox.me || "", deal: { ...DEAL_DEFAULT, ...(inbox.deal || {}) } };
}
async function inboxSet(patch) {
  const { inbox = {} } = await chrome.storage.local.get(["inbox"]);
  await chrome.storage.local.set({ inbox: { ...inbox, ...patch } });
}

// Reddit's message listing: t4 threads, replies nested under `replies`.
function flattenMessages(child, me, out) {
  const d = child && child.data;
  if (!d) return;
  const author = d.author || "";
  out.push({ id: d.name || ("t4_" + d.id), author, mine: author.toLowerCase() === (me || "").toLowerCase(), body: d.body || "", at: (d.created_utc || 0) * 1000, unread: !!d.new, parent: d.parent_id || "", root: d.first_message_name || d.name });
  const rep = d.replies && d.replies.data && d.replies.data.children;
  if (rep) for (const c of rep) flattenMessages(c, me, out);
}

async function inboxPoll() {
  const st = await inboxGet();
  const me = await huntMe();
  if (!me) { await inboxSet({ lastError: "your Reddit username is unknown — set it in Your details" }); return { ok: false }; }
  let j;
  try { j = await huntFetch("https://old.reddit.com/message/messages.json?limit=50&raw_json=1"); }
  catch (e) { await inboxSet({ lastError: String(e.message || e), lastPoll: Date.now() }); return { ok: false, error: String(e.message || e) }; }
  const flat = [];
  for (const c of (j.data && j.data.children) || []) flattenMessages(c, me, flat);
  const hunt = await huntGet();
  const byAuthor = {};
  for (const p of Object.values(hunt.posts)) if (p.author) byAuthor[p.author.toLowerCase()] = p.id;
  const threads = st.threads;
  let fresh = 0;
  for (const m of flat) {
    if (!m.author || /^automoderator$|^reddit$/i.test(m.author)) continue;
    const root = m.root;
    let t = threads[root];
    if (!t) {
      const other = m.mine ? "" : m.author;
      t = threads[root] = { id: root, with: other, subject: "", messages: [], lastAt: 0, handled: false, postId: "", unread: 0 };
    }
    if (!t.with && !m.mine) t.with = m.author;
    if (!t.messages.some((x) => x.id === m.id)) {
      t.messages.push({ id: m.id, author: m.author, mine: m.mine, body: m.body, at: m.at });
      t.messages.sort((a, b) => a.at - b.at);
      if (!m.mine) { fresh += 1; t.handled = false; t.draft = null; }  // a new message from them reopens the thread
    }
    t.lastAt = Math.max(t.lastAt, m.at);
  }
  for (const t of Object.values(threads)) {
    if (!t.with) continue;
    if (!t.postId) t.postId = byAuthor[t.with.toLowerCase()] || "";
    const last = t.messages[t.messages.length - 1];
    t.needsReply = !!(last && !last.mine && !t.handled);
    t.subject = t.subject || (flat.find((m) => m.root === t.id && m.body) || {}).body || "";
  }
  // only conversations with people we contacted from the hunt, or who wrote to us about a post we hold
  await inboxSet({ threads, lastPoll: Date.now(), lastError: "", me, rawCount: flat.length });
  return { ok: true, fresh, raw: flat.length };
}

// One conversation per person. A legacy message thread, a chat room and a
// pasted reply for the same username become one thread; chat wins the id.
async function inboxDedupe() {
  const st = await inboxGet();
  const byUser = {};
  let merged = 0;
  for (const t of Object.values(st.threads)) {
    const k = (t.with || "").toLowerCase();
    if (!k) continue;
    (byUser[k] = byUser[k] || []).push(t);
  }
  for (const group of Object.values(byUser)) {
    if (group.length < 2) continue;
    group.sort((a, b) => (b.chat ? 2 : b.manual ? 0 : 1) - (a.chat ? 2 : a.manual ? 0 : 1) || (b.messages || []).length - (a.messages || []).length);
    const keep = group[0];
    for (const t of group.slice(1)) {
      for (const m of t.messages || []) if (!keep.messages.some((x) => x.mine === m.mine && x.body === m.body)) keep.messages.push(m);
      keep.messages.sort((a, b) => a.at - b.at);
      keep.postId = keep.postId || t.postId;
      keep.deal = keep.deal || t.deal;
      keep.repliedAt = Math.max(keep.repliedAt || 0, t.repliedAt || 0) || keep.repliedAt;
      keep.lastAt = Math.max(keep.lastAt || 0, t.lastAt || 0);
      delete st.threads[t.id];
      merged += 1;
    }
    const last = keep.messages[keep.messages.length - 1];
    keep.needsReply = !!(last && !last.mine && !keep.handled);
  }
  if (merged) await inboxSet({ threads: st.threads });
  return merged;
}

async function inboxList() {
  await inboxDedupe();
  const st = await inboxGet();
  const hunt = await huntGet();
  const list = Object.values(st.threads).filter((t) => t.with).map((t) => ({ ...t, post: t.postId && hunt.posts[t.postId] ? { title: hunt.posts[t.postId].title, sub: hunt.posts[t.postId].sub, body: (hunt.posts[t.postId].body || "").slice(0, 2500) } : null }));
  list.sort((a, b) => (b.needsReply ? 1 : 0) - (a.needsReply ? 1 : 0) || b.lastAt - a.lastAt);
  const { inbox = {} } = await chrome.storage.local.get(["inbox"]);
  const deals = list.map((t) => ({ id: t.id, with: t.with, post: t.post ? t.post.title : "", status: (t.deal || {}).status || "qualifying", share: (t.deal || {}).share ?? st.deal.share, upfront: (t.deal || {}).upfront ?? st.deal.upfront, note: (t.deal || {}).note || "", verdict: t.verdict || "", budget: t.budget || "", shareOk: t.shareOk || "", lastAt: t.lastAt, messages: t.messages.length }));
  const counts = {}; for (const d of deals) counts[d.status] = (counts[d.status] || 0) + 1;
  const inDeals = deals.filter((d) => d.status === "interested" || d.status === "agreed");
  const summary = { counts, agreed: deals.filter((d) => d.status === "agreed").length, interested: deals.filter((d) => d.status === "interested").length, cut: deals.filter((d) => d.status === "cut").length, avgShare: inDeals.length ? Math.round(inDeals.reduce((a, d) => a + Number(d.share || 0), 0) / inDeals.length * 10) / 10 : 0, upfrontTotal: deals.filter((d) => d.status === "agreed").reduce((a, d) => a + Number(d.upfront || 0), 0) };
  return { threads: list, needs: list.filter((t) => t.needsReply).length, lastPoll: st.lastPoll, lastError: st.lastError, rawCount: inbox.rawCount || 0, plan: st.plan || INBOX_PLAN_DEFAULT, deal: st.deal, deals, summary };
}

// A reply that came through Reddit Chat (which cannot be read): pasted by hand.
async function inboxAdd(withUser, body) {
  const st = await inboxGet();
  const user = String(withUser || "").replace(/^\/?u\//, "").trim();
  if (!user || !body) return { ok: false, error: "need a username and their message" };
  const hunt = await huntGet();
  const post = Object.values(hunt.posts).find((p) => (p.author || "").toLowerCase() === user.toLowerCase());
  const existing = Object.values(st.threads).find((t) => t.manual && (t.with || "").toLowerCase() === user.toLowerCase());
  const t = existing || (st.threads["manual_" + user.toLowerCase()] = { id: "manual_" + user.toLowerCase(), with: user, subject: "", messages: [], lastAt: 0, handled: false, postId: post ? post.id : "", unread: 0, manual: true });
  t.messages.push({ id: "m_" + Date.now(), author: user, mine: false, body: String(body).trim(), at: Date.now() });
  t.lastAt = Date.now(); t.handled = false; t.needsReply = true; t.draft = null;
  await inboxSet({ threads: st.threads });
  return { ok: true, id: t.id };
}
// What you sent back by hand (chat), so the next draft knows the history.
async function inboxNoteMine(id, body) {
  const st = await inboxGet();
  const t = st.threads[id];
  if (!t) return { ok: false };
  t.messages.push({ id: "m_" + Date.now(), author: st.me || "me", mine: true, body: String(body).trim(), at: Date.now() });
  t.lastAt = Date.now(); t.handled = true; t.needsReply = false; t.repliedAt = Date.now();
  await inboxSet({ threads: st.threads });
  return { ok: true };
}

async function inboxAct(id, action, patch) {
  const st = await inboxGet();
  const t = st.threads[id];
  if (!t) return { ok: false };
  if (action === "handled") { t.handled = true; t.needsReply = false; t.repliedAt = Date.now(); }
  if (action === "skip") { t.handled = true; t.needsReply = false; }
  if (action === "reopen") { t.handled = false; t.needsReply = true; }
  if (action === "draft" && patch) { t.draft = patch; applyVerdict(t, patch, st.deal); }
  await inboxSet({ threads: st.threads });
  return { ok: true };
}

async function inboxAiWrite(id, force) {
  const st = await inboxGet();
  const t = st.threads[id];
  if (!t) return { ok: false, error: "thread not found" };
  if (t.draft && t.draft.engine === "claude" && !force) return { ok: true, draft: t.draft, cached: true };
  const key = await huntAiKey();
  if (!key) return { ok: false, error: "no api key", noKey: true };
  const spentI = await spendGet();
  if (spentI.cents >= spentI.budget) return { ok: false, overBudget: true, error: `today's AI budget is used up (${spentI.cents}¢ of ${spentI.budget}¢) — template used; raise it under AI writing on the hunt page` };
  const model = await aiModel();
  const { config = {} } = await chrome.storage.local.get(["config"]);
  const hunt = await huntGet();
  const post = t.postId ? hunt.posts[t.postId] : null;
  const { system, user, schema } = inboxAiPrompt(t, post, { ...(config.profile || {}), deal: st.deal }, st.plan || INBOX_PLAN_DEFAULT);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 90000);
  let r, j;
  try {
    r = await fetch(AI_URL, {
      method: "POST", signal: ctl.signal,
      headers: aiHeaders(key, model),
      body: JSON.stringify(aiBody(model, system, user, schema, 2000)),
    });
    j = await r.json().catch(() => ({}));
  } catch (e) { return { ok: false, error: /abort/i.test(String(e)) ? "the API took more than 90s" : "could not reach api.anthropic.com" }; }
  finally { clearTimeout(timer); }
  if (!r.ok) return { ok: false, error: r.status === 401 ? "the API key was rejected" : r.status === 429 ? "rate limited, try again in a minute" : ((j.error && j.error.message) || "HTTP " + r.status) };
  if (j.stop_reason === "refusal") return { ok: false, error: "the model declined this conversation" };
  let parsed = null;
  try { parsed = JSON.parse((j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("")); } catch (_) { return { ok: false, error: "not JSON" }; }
  const draft = inboxAiClean(parsed);
  if (!draft) return { ok: false, error: "the reply failed the checks" };
  const u = j.usage || {};
  draft.engine = "claude"; draft.at = Date.now();
  draft.cents = aiCents(model, u);
  await spendAdd(draft.cents);
  t.draft = draft;
  applyVerdict(t, draft, st.deal);
  await inboxSet({ threads: st.threads });
  return { ok: true, draft };
}

// The deals database lives on the thread: status, our share, upfront, notes.
function applyVerdict(t, draft, deal) {
  t.deal = t.deal || { status: "qualifying", share: (deal || DEAL_DEFAULT).share, upfront: (deal || DEAL_DEFAULT).upfront, note: "" };
  if (t.deal.locked) return;                       // the operator set it by hand; drafts do not overrule
  t.verdict = draft.verdict || "unclear"; t.budget = draft.budget || "unknown"; t.shareOk = draft.share_ok || "unknown";
  if (draft.verdict === "not_interested" || draft.stage === "cut") { t.deal.status = "cut"; t.cutAt = t.cutAt || Date.now(); }
  else if (draft.verdict === "interested" || draft.stage === "close") t.deal.status = "interested";
  else if (draft.stage === "offer" || draft.stage === "objection") t.deal.status = "offered";
}
async function inboxDeal(id, patch) {
  const st = await inboxGet();
  const t = st.threads[id];
  if (!t) return { ok: false };
  t.deal = { ...(t.deal || { status: "qualifying", share: st.deal.share, upfront: st.deal.upfront, note: "" }), ...patch, locked: true };
  if (patch.status === "cut") { t.handled = true; t.needsReply = false; }
  await inboxSet({ threads: st.threads });
  return { ok: true };
}


// ===========================================================================
// REDDIT CHAT: what the bridge in the chat.reddit.com tab sees
// ===========================================================================
async function chatObserve(withUser, messages, readerV) {
  const user = String(withUser || "").replace(/^\/?u\//, "").trim();
  if (!user || !messages || !messages.length) return { ok: false };
  const st = await inboxGet();
  const hunt = await huntGet();
  const id = "chat_" + user.toLowerCase();
  const post = Object.values(hunt.posts).find((p) => (p.author || "").toLowerCase() === user.toLowerCase());
  const t = st.threads[id] || (st.threads[id] = { id, with: user, subject: "", messages: [], lastAt: 0, handled: false, postId: post ? post.id : "", unread: 0, chat: true });
  if (!t.postId && post) t.postId = post.id;
  // an older reader mixed the room list into conversations: throw that away once
  if ((readerV || 0) >= 2 && (t.readerV || 0) < 2) { t.messages = t.messages.filter((m) => m.v >= 2); t.draft = null; t.readerV = 2; }
  let added = 0;
  for (const m of messages) {
    const body = String(m.body || "").trim();
    if (!body) continue;
    if (t.messages.some((x) => x.mine === !!m.mine && x.body === body)) continue;
    t.messages.push({ id: "c_" + Date.now() + "_" + added, author: m.mine ? (st.me || "me") : (m.author || user), mine: !!m.mine, body, at: Date.now() - (messages.length - messages.indexOf(m)) * 1000, v: readerV || 1 });
    added += 1;
    if (!m.mine) { t.handled = false; t.draft = null; }
  }
  if (added) {
    const last = t.messages[t.messages.length - 1];
    t.needsReply = !!(last && !last.mine && !t.handled);
    t.lastAt = Date.now();
  }
  await inboxSet({ threads: st.threads, lastPoll: Date.now(), lastError: "", chatSeen: Date.now() });
  return { ok: true, added, id, needsReply: !!t.needsReply, draft: t.draft || null };
}

// A draft for a chat thread, made the same way the Inbox makes them.
async function chatDraft(id, force) {
  const st = await inboxGet();
  const t = st.threads[id];
  if (!t) return { ok: false, error: "no such conversation" };
  const { config = {} } = await chrome.storage.local.get(["config"]);
  const profile = config.profile || {};
  let draft = t.draft && !force ? t.draft : null;
  if (!draft && profile.aiEngine !== "templates" && profile.apiKey) {
    const r = await inboxAiWrite(id, true);
    if (r.ok) draft = r.draft;
  }
  if (!draft) { draft = inboxTemplateReply(t, profile, st.plan || INBOX_PLAN_DEFAULT, st.deal); draft.engine = "template"; t.draft = draft; applyVerdict(t, draft, st.deal); await inboxSet({ threads: st.threads }); }
  draft.stageLabel = (INBOX_STAGES.find((s) => s.key === draft.stage) || {}).label || draft.stage;
  return { ok: true, draft, needsReply: !!t.needsReply, dealStatus: (t.deal || {}).status };
}

async function chatTab(create) {
  const tabs = [...await chrome.tabs.query({ url: "https://www.reddit.com/chat/*" }), ...await chrome.tabs.query({ url: "https://chat.reddit.com/*" })];
  if (tabs.length) return tabs[0];
  if (!create) return null;
  const tab = await chrome.tabs.create({ url: "https://www.reddit.com/chat/", active: true, pinned: true });
  await new Promise((done) => { const on = (id, info) => { if (id === tab.id && info.status === "complete") { chrome.tabs.onUpdated.removeListener(on); done(); } }; chrome.tabs.onUpdated.addListener(on); setTimeout(() => { chrome.tabs.onUpdated.removeListener(on); done(); }, 15000); });
  return tab;
}

// Put the drafted reply into Chat's box for this person, and show that tab.
async function chatFill(withUser, textToFill) {
  const tab = await chatTab(true);
  // If that person's chat is already open, fill it straight away.
  if ((tab.url || "").toLowerCase().includes("/user/" + withUser.toLowerCase())) {
    await chrome.tabs.update(tab.id, { active: true });
    try { return await chrome.tabs.sendMessage(tab.id, { type: "chat-fill", text: textToFill }); }
    catch (e) { return { ok: false, error: "the Chat tab did not answer — reload it and try again" }; }
  }
  // Otherwise hand it to the bridge. With "do this for me" on (the default) it
  // opens the new-chat page, types the name, picks the person and fills the
  // box; with it off it waits until you open that chat yourself.
  const { autoDm = true } = await chrome.storage.local.get(["autoDm"]);
  await chrome.storage.local.set({ pendingDm: { kind: "inbox", author: withUser, text: textToFill, at: Date.now() } });
  if (autoDm) {
    await chrome.tabs.update(tab.id, { url: "https://www.reddit.com/chat/room/create", active: true });
    for (let i = 0; i < 40; i += 1) {
      await sleep(750);
      const { pendingDm } = await chrome.storage.local.get(["pendingDm"]);
      if (!pendingDm) return { ok: true };
      if (pendingDm.done) { await chrome.storage.local.remove("pendingDm"); return { ok: !!pendingDm.filled, error: pendingDm.filled ? "" : "the box would not take the text — it is on your clipboard" }; }
    }
    return { ok: false, pending: true, error: `still opening ${withUser}'s chat — the panel on that tab shows where it got to` };
  }
  await chrome.tabs.update(tab.id, { active: true });
  return { ok: false, pending: true, error: `open the chat with ${withUser} in the Chat tab — the reply fills itself when it opens (it is also on your clipboard)` };
}
