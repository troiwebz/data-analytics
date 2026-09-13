importScripts("lib.js");

const ALARM = "heat-refresh";
const MAX_SNAPS = 60;
const PACE_MS = 6500;              // gap between search requests; Reddit allows ~10/min unauthenticated
const COMMENT_PACE_MS = 4000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getConfig() {
  const c = await chrome.storage.local.get(["config"]);
  const cfg = c.config || {};
  return {
    subs: cfg.subs && cfg.subs.length ? cfg.subs : DEFAULT_SUBS,
    keywords: cfg.keywords && cfg.keywords.length ? cfg.keywords : DEFAULT_KEYWORDS,
    intervalMin: cfg.intervalMin || 360,
    time: cfg.time || "month",
    commentDives: cfg.commentDives || 60,
    autoCsv: cfg.autoCsv !== false,
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
  if (msg && msg.type === "refresh") { refresh().then(() => reply({ ok: true })).catch((e) => reply({ ok: false, error: String(e) })); return true; }
  if (msg && msg.type === "rearm") { arm().then(() => reply({ ok: true })); return true; }
});

async function getJson(url, attempt = 0) {
  const r = await fetch(url, { credentials: "omit", headers: { Accept: "application/json" } });
  if ((r.status === 429 || r.status === 503) && attempt < 3) { await sleep(20000 * (attempt + 1)); return getJson(url, attempt + 1); }
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

let running = false;

async function refresh() {
  if (running) return;
  running = true;
  const started = Date.now();
  try {
    const cfg = await getConfig();
    const store = await chrome.storage.local.get(["posts", "snaps"]);
    const posts = store.posts || {};
    const snaps = store.snaps || {};
    const errors = [];
    const batches = batchKeywords(cfg.keywords);
    const totalReq = cfg.subs.length * batches.length;
    let done = 0;

    const progress = (stage) => chrome.storage.local.set({ meta: { ...(store.meta || {}), running: true, stage, done, totalReq, startedAt: started } });

    for (const sub of cfg.subs) {
      for (const b of batches) {
        try {
          const data = await getJson(searchUrl(sub, b.q, "new", cfg.time, 100));
          for (const c of (data.data && data.data.children) || []) {
            const p = postFromChild(c, sub, b);
            const prev = posts[p.id] || {};
            const kw = Array.from(new Set([...(prev.keywords || []), ...p.keywords]));
            posts[p.id] = { ...prev, ...p, keywords: kw, signals: prev.signals, lastSeen: Date.now() };
            const arr = snaps[p.id] || [];
            const last = arr[arr.length - 1];
            if (!last || last.score !== p.score || last.comments !== p.comments || Date.now() - last.t > 6 * 3600 * 1000) arr.push({ t: Date.now(), score: p.score, comments: p.comments });
            snaps[p.id] = arr.slice(-MAX_SNAPS);
          }
        } catch (e) { errors.push(`r/${sub} [${b.keywords[0]}…]: ${e.message}`); }
        done += 1;
        if (done % 5 === 0) await progress(`searching r/${sub}`);
        await sleep(PACE_MS);
      }
    }

    // Comment deep-dive on the posts most likely to carry lead evidence:
    // most comment movement, then most comments, never analysed in last 12h.
    const now = Date.now();
    const candidates = Object.values(posts)
      .filter((p) => p.comments > 0 && (!p.signals || now - (p.signals.t || 0) > 12 * 3600 * 1000))
      .map((p) => ({ p, h: heatScore(p, snaps[p.id], now) }))
      .sort((a, b) => (b.h.dComments - a.h.dComments) || (b.p.comments - a.p.comments))
      .slice(0, cfg.commentDives);
    let k = 0;
    for (const { p } of candidates) {
      try {
        const listing = await getJson(commentsUrl(p.permalink));
        p.signals = { ...summariseComments(listing, p.author), t: Date.now() };
      } catch (e) { errors.push(`comments ${p.id}: ${e.message}`); }
      k += 1;
      if (k % 5 === 0) await progress(`reading comments ${k}/${candidates.length}`);
      await sleep(COMMENT_PACE_MS);
    }

    for (const id of Object.keys(posts)) if (now - (posts[id].lastSeen || 0) > 90 * 86400000) { delete posts[id]; delete snaps[id]; }

    const meta = { lastRun: Date.now(), durationMin: Math.round((Date.now() - started) / 60000), errors, count: Object.keys(posts).length, analysed: Object.values(posts).filter((p) => p.signals).length, running: false };
    await chrome.storage.local.set({ posts, snaps, meta });

    if (cfg.autoCsv) await exportCsv(posts, snaps);
  } finally { running = false; }
}

async function exportCsv(posts, snaps) {
  const now = Date.now();
  const rows = Object.values(posts).map((p) => toRow(p, snaps[p.id], now)).sort((a, b) => b.leadScore - a.leadScore || b.heat - a.heat);
  const csv = toCsv(rows);
  const url = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  try { await chrome.downloads.download({ url, filename: `reddit-lead-threads/leads-${stamp}.csv`, conflictAction: "uniquify", saveAs: false }); }
  catch (e) { const m = (await chrome.storage.local.get(["meta"])).meta || {}; m.errors = [...(m.errors || []), "csv: " + e.message]; await chrome.storage.local.set({ meta: m }); }
}
