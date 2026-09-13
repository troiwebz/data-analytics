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
    autoCsv: config.autoCsv !== false,
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
chrome.runtime.onInstalled.addListener(() => { arm(); chrome.alarms.create(VERSION_ALARM, { periodInMinutes: 1 }); reclassifyAll(); });
chrome.runtime.onStartup.addListener(() => { arm(); chrome.alarms.create(VERSION_ALARM, { periodInMinutes: 1 }); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) refresh(); if (a.name === VERSION_ALARM) checkVersion(); });
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
