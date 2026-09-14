#!/usr/bin/env node
// Co-founder hunt collector. Runs anywhere Node 18+ runs, around the clock, so
// the queue is already full when you open your laptop.
//
// It reads Reddit through the official API with an "installed app" client id
// (read-only, userless, 100 requests a minute), classifies every post with the
// same lib.js the extension uses, and serves the keepers over HTTP to the
// extension. It never posts, never DMs, and never sees your Reddit password.
//
//   REDDIT_CLIENT_ID=xxxx HUNT_TOKEN=some-long-secret node hunt-server.js
//
// Env:
//   HUNT_TOKEN         required. The shared secret the extension sends back.
//   REDDIT_CLIENT_ID   an "installed app" client id from reddit.com/prefs/apps.
//                      Without it the server falls back to public JSON, which
//                      Reddit rate-limits hard and sometimes refuses outright.
//   PORT               default 8787
//   DATA_FILE          default ./hunt-data.json
//   POLL_SECONDS       default 60
//   SUBS               comma-separated override for the subreddit list
//   KEEP_HOURS         drop posts older than this, default 72
//   USER_AGENT         default "cofounder-hunt/1.0"
const http = require("http");
const fs = require("fs");
const path = require("path");
require(fs.existsSync(path.join(__dirname, "..", "lib.js")) ? path.join(__dirname, "..", "lib.js") : "/lib.js");           // defines the HEAT.* helpers on globalThis

const TOKEN = process.env.HUNT_TOKEN || "";
const CLIENT_ID = (process.env.REDDIT_CLIENT_ID || "").trim();
const PORT = Number(process.env.PORT || 8787);
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "hunt-data.json");
const POLL_MS = Math.max(20, Number(process.env.POLL_SECONDS || 60)) * 1000;
const KEEP_MS = Number(process.env.KEEP_HOURS || 72) * 3600000;
const UA = process.env.USER_AGENT || "cofounder-hunt/1.0";
const SUBS = (process.env.SUBS ? process.env.SUBS.split(",") : HUNT_SUBS).map((s) => s.trim()).filter(Boolean);
const PER_TICK = Math.max(1, Number(process.env.SUBS_PER_TICK || 4));

if (!TOKEN) { console.error("HUNT_TOKEN is required: the extension sends it back as a bearer token."); process.exit(1); }

let state = { posts: {}, cursor: 0, lastPoll: 0, lastError: "", found: 0, polls: 0 };
try { state = { ...state, ...JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) }; console.log(`loaded ${Object.keys(state.posts).length} posts from ${DATA_FILE}`); }
catch (_) { /* first run */ }
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(DATA_FILE, JSON.stringify(state), (e) => e && console.error("save failed:", e.message)), 500);
}

// ---- Reddit --------------------------------------------------------------
let token = { value: "", expires: 0 };
const deviceId = "hunt" + Math.random().toString(36).slice(2, 18).padEnd(16, "0");
async function getToken() {
  if (!CLIENT_ID) return "";
  if (token.value && token.expires > Date.now() + 60000) return token.value;
  const body = `grant_type=${encodeURIComponent("https://oauth.reddit.com/grants/installed_client")}&device_id=${deviceId}&scope=read`;
  const r = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(CLIENT_ID + ":").toString("base64"), "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
    body,
  });
  if (!r.ok) throw new Error(`OAuth ${r.status} — the client id must be an "installed app"`);
  const j = await r.json();
  if (!j.access_token) throw new Error("OAuth: no token in response");
  token = { value: j.access_token, expires: Date.now() + (j.expires_in || 3600) * 1000 };
  return token.value;
}

async function readJson(pathAndQuery) {
  const t = await getToken();
  const url = (t ? "https://oauth.reddit.com" : "https://www.reddit.com") + pathAndQuery;
  const headers = { "User-Agent": UA, Accept: "application/json" };
  if (t) headers.Authorization = "Bearer " + t;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { headers, signal: ctl.signal });
    if (!r.ok) throw new Error(`${pathAndQuery.split("?")[0]} -> HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

function candidate(child) {
  const d = child && child.data;
  if (!d || d.stickied || d.over_18) return null;
  const author = (d.author || "").trim();
  if (!author || author === "[deleted]" || /^automoderator$/i.test(author)) return null;
  const c = classifyCofounder(d.title || "", d.selftext || "");
  if (!c.keep) return null;
  return {
    id: d.name || ("t3_" + d.id), author, sub: d.subreddit || "",
    title: d.title || "", body: (d.selftext || "").slice(0, 4000),
    permalink: "https://www.reddit.com" + (d.permalink || ""),
    created: (d.created_utc || 0) * 1000, comments: d.num_comments || 0, ups: d.score || 0,
    flair: d.link_flair_text || "",
    role: c.role, stage: c.stage, equityOnly: c.equityOnly, hasBudget: c.hasBudget,
    firstSeen: Date.now(), source: "server",
  };
}

async function poll() {
  const picks = [];
  for (let i = 0; i < PER_TICK; i += 1) picks.push(SUBS[(state.cursor + i) % SUBS.length]);
  const query = HUNT_QUERIES[state.cursor % HUNT_QUERIES.length];
  const paths = picks.map((s) => `/r/${encodeURIComponent(s)}/new?limit=25&raw_json=1`);
  paths.push(`/search?q=${encodeURIComponent(query)}&sort=new&t=week&limit=25&raw_json=1`);

  let added = 0, ok = 0, error = "";
  for (const p of paths) {
    try {
      const j = await readJson(p);
      ok += 1;
      for (const child of (j.data && j.data.children) || []) {
        const cand = candidate(child);
        if (!cand) continue;
        if (cand.created && Date.now() - cand.created > KEEP_MS) continue;
        const prev = state.posts[cand.id];
        if (prev) { prev.comments = cand.comments; prev.ups = cand.ups; continue; }
        state.posts[cand.id] = cand;
        added += 1;
      }
    } catch (e) { error = String(e.message || e); }
    await new Promise((r) => setTimeout(r, CLIENT_ID ? 700 : 6500));   // Reddit's pace, with or without a key
  }
  for (const [id, p] of Object.entries(state.posts)) {
    if (Date.now() - (p.created || p.firstSeen || 0) > KEEP_MS) delete state.posts[id];
  }
  state.cursor = (state.cursor + PER_TICK) % SUBS.length;
  state.lastPoll = Date.now();
  state.lastError = ok ? "" : error;
  state.found += added;
  state.polls += 1;
  save();
  const when = new Date().toISOString().slice(11, 19);
  console.log(`${when} polled ${ok}/${paths.length} · +${added} new · ${Object.keys(state.posts).length} held${error ? " · " + error : ""}`);
}

// ---- HTTP ----------------------------------------------------------------
function authed(req, url) {
  const h = req.headers.authorization || "";
  const bearer = h.startsWith("Bearer ") ? h.slice(7) : "";
  return (bearer || url.searchParams.get("token")) === TOKEN;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const json = (code, obj) => {
    res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization" });
    res.end(JSON.stringify(obj));
  };
  if (req.method === "OPTIONS") return json(204, {});
  if (url.pathname === "/health") {
    return json(200, { ok: true, posts: Object.keys(state.posts).length, lastPoll: state.lastPoll, lastError: state.lastError, found: state.found, polls: state.polls, oauth: !!CLIENT_ID });
  }
  if (!authed(req, url)) return json(401, { error: "bad or missing token" });
  if (url.pathname === "/queue") {
    const maxAgeH = Number(url.searchParams.get("maxAgeH") || 48);
    const since = Number(url.searchParams.get("since") || 0);
    const cutoff = Date.now() - maxAgeH * 3600000;
    const posts = Object.values(state.posts)
      .filter((p) => (p.created || p.firstSeen || 0) >= cutoff && (p.firstSeen || 0) >= since)
      .map((p) => ({ ...p, score: huntScore(p) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Number(url.searchParams.get("limit") || 200));
    return json(200, { posts, lastPoll: state.lastPoll, lastError: state.lastError, found: state.found, now: Date.now() });
  }
  return json(404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`co-founder hunt server on :${PORT} · ${SUBS.length} subreddits · every ${POLL_MS / 1000}s · ${CLIENT_ID ? "reddit api key" : "NO api key (slow, may be refused)"}`);
  poll().catch((e) => console.error("poll:", e.message));
  setInterval(() => poll().catch((e) => console.error("poll:", e.message)), POLL_MS);
});
