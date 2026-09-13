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
chrome.runtime.onInstalled.addListener(arm);
chrome.runtime.onStartup.addListener(arm);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) refresh(); });
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (!msg) return;
  if (msg.type === "refresh") { refresh().then(() => reply({ ok: true })).catch((e) => reply({ ok: false, error: String(e) })); return true; }
  if (msg.type === "rearm") { arm().then(() => reply({ ok: true })); return true; }
  if (msg.type === "testauth") { getToken(msg.clientId, true).then((t) => reply({ ok: !!t })).catch((e) => reply({ ok: false, error: String(e) })); return true; }
  if (msg.type === "config") { getConfig().then((c) => reply({ entries: c.entries, subs: c.subs })); return true; }
  if (msg.type === "ingest") { ingest(msg.posts || [], msg.source).then(reply); return true; }
  if (msg.type === "signals") { saveSignals(msg.post, msg.signals, msg.source).then(reply); return true; }
  if (msg.type === "open-dashboard") { chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") }); reply({ ok: true }); return; }
  if (msg.type === "queue") { buildQueue(msg.limit || 30).then((queue) => reply({ queue })); return true; }
});

// --- Page-scrape ingestion (from content.js). Same store as the crawler.
async function withStore(fn) {
  const store = await chrome.storage.local.get(["posts", "snaps", "meta"]);
  const posts = store.posts || {}, snaps = store.snaps || {};
  const result = await fn(posts, snaps);
  const meta = { ...(store.meta || {}), count: Object.keys(posts).length, analysed: Object.values(posts).filter((p) => p.signals).length, lastPage: Date.now() };
  await chrome.storage.local.set({ posts, snaps, meta });
  return result;
}

function recordPost(posts, snaps, p, now) {
  const prev = posts[p.id] || {};
  posts[p.id] = { ...prev, ...p, body: p.body || prev.body || "", signals: prev.signals, firstSeen: prev.firstSeen || now, lastSeen: now };
  const arr = snaps[p.id] || [];
  const last = arr[arr.length - 1];
  if (!last || last.score !== p.score || last.comments !== p.comments || now - last.t > 6 * 3600 * 1000) arr.push({ t: now, score: p.score, comments: p.comments });
  snaps[p.id] = arr.slice(-MAX_SNAPS);
}

async function addLog(entry) {
  const { log = [] } = await chrome.storage.local.get(["log"]);
  log.push({ t: Date.now(), ...entry });
  await chrome.storage.local.set({ log: log.slice(-300) });
}

async function ingest(list, source) {
  const r = await withStore(async (posts, snaps) => {
    const now = Date.now();
    let kept = 0;
    for (const p of list) { if (!p || !p.id || !keepPost(p)) continue; recordPost(posts, snaps, p, now); kept += 1; }
    return { kept, total: Object.keys(posts).length };
  });
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

// Threads worth reading next: most comments first, unread or stale.
async function buildQueue(limit) {
  const { posts = {} } = await chrome.storage.local.get(["posts"]);
  const now = Date.now();
  return Object.values(posts)
    .filter((p) => p.comments > 0 && p.permalink && (!p.signals || now - (p.signals.t || 0) > 24 * 3600 * 1000))
    .sort((a, b) => b.comments - a.comments || b.created - a.created)
    .slice(0, limit)
    .map((p) => p.permalink);
}

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
