// node schedule-test.js
// The Schedule sends private DMs only: it never schedules, opens or submits a
// public reply, old public-reply lines are cancelled, and any line can be deleted.
const fs = require("fs"), vm = require("vm"), assert = require("assert");
// ------------------------------------------------------------ the 2-min lane
const store = {};
const alarms = {};
const fetched = [];
let clock = Date.now();
let listing = [];      // what Reddit returns for the job boards
let search = [];       // what the site-wide search returns
const child = (id, title, o = {}) => ({ kind: "t3", data: { name: "t3_" + id, id, title, selftext: o.body || "", author: o.author || "user_" + id, subreddit: o.sub || "forhire", permalink: `/r/${o.sub || "forhire"}/comments/${id}/x/`, created_utc: (o.at || clock - 60000) / 1000, num_comments: 0, score: 1, stickied: !!o.stickied, over_18: false, distinguished: o.distinguished || null } });
const noop = () => {};
const ev = () => ({ addListener: noop, removeListener: noop });
const chrome = {
  storage: { local: {
    get: async (keys) => { if (keys == null) return JSON.parse(JSON.stringify(store)); const o = {}; for (const k of [].concat(keys)) if (k in store) o[k] = JSON.parse(JSON.stringify(store[k])); return o; },
    set: async (o) => { for (const [k, v] of Object.entries(o)) store[k] = JSON.parse(JSON.stringify(v)); },
    remove: async (k) => { for (const x of [].concat(k)) delete store[x]; },
    getBytesInUse: async () => 0,
  } },
  alarms: { create: (n, o) => { alarms[n] = o; }, clear: async (n) => { delete alarms[n]; }, get: async (n) => alarms[n] || null, getAll: async () => [], onAlarm: ev() },
  runtime: { onInstalled: ev(), onStartup: ev(), onMessage: ev(), getManifest: () => ({ version: "4.13.0" }), getURL: (p) => "chrome-extension://x/" + p, reload: noop, sendMessage: async () => ({}) },
  tabs: { create: async () => ({ id: 9 }), get: async () => ({ id: 9, url: "https://old.reddit.com/" }), query: async () => [], remove: async () => {}, update: async () => ({}), sendMessage: async () => ({}), onUpdated: ev(), onRemoved: ev() },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  downloads: { download: async () => 1 },
  notifications: { create: noop, clear: noop, onClicked: ev() },
};
const fetchFake = async (url) => {
  const u = String(url);
  fetched.push(u);
  const body = u.includes("/search.json") ? search : u.includes("/new.json") && u.includes("forhire+hiring") ? listing : [];
  return { ok: true, status: 200, json: async () => ({ data: { children: body } }), text: async () => "" };
};
class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(clock); } static now() { return clock; } }
const ctx = { chrome, fetch: fetchFake, console: { log: noop, warn: noop, error: noop }, setTimeout: (f) => { f(); return 0; }, clearTimeout: noop, setInterval: () => 0, clearInterval: noop,
  AbortController, URL, URLSearchParams, TextEncoder, TextDecoder, Blob: class {}, JSON, Math, Object, Array, String, Number, Promise, Error, RegExp, Date: FakeDate, Map, Set, encodeURIComponent, decodeURIComponent, structuredClone, navigator: {}, self: null };
ctx.globalThis = ctx; ctx.self = ctx;
ctx.importScripts = (...files) => { for (const f of files) vm.runInContext(fs.readFileSync(__dirname + "/" + f, "utf8"), ctx, { filename: f }); };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + "/background.js", "utf8"), ctx, { filename: "background.js" });


(async () => {
  const opened = [];
  chrome.tabs.create = async (o) => { opened.push(o.url); return { id: 50 + opened.length }; };
  const post = (id) => ({ id, author: "user_" + id, sub: "cofounder", title: "Need a technical cofounder " + id, body: "x".repeat(200), permalink: "/r/cofounder/comments/" + id + "/", created: clock - 60000, firstSeen: clock - 60000, hunt: "cofounder", ai: { dm_long: "Hello " + id + ", a real DM long enough.", public_reply: "a public line" } });
  await chrome.storage.local.set({ hunt: { on: true, contacted: {}, posts: { p1: post("p1"), p2: post("p2"), p3: post("p3") } } });

  // scheduling three posts makes three DM lines and nothing else
  const r = await ctx.scheduleAdd(["p1", "p2", "p3"], 5, 60);
  assert.strictEqual(r.added, 3);
  let sched = store.hunt.schedule;
  assert.strictEqual(sched.length, 3);
  assert.ok(sched.every((x) => x.kind === "dm"), JSON.stringify(sched));

  // a public-reply line left by an older version is cancelled, never opened
  store.hunt.schedule.unshift({ id: "p1", at: clock - 1000, kind: "reply" });
  await ctx.scheduleTick();
  const rep = store.hunt.schedule.find((x) => x.kind === "reply");
  assert.strictEqual(rep.state, "cancelled");
  assert.ok(/never sent automatically/.test(rep.reason));
  assert.strictEqual(store.pendingReply, undefined, "no public reply is queued");
  assert.ok(!opened.some((u) => /\/comments\//.test(u)), "no thread was opened to comment in: " + opened);
  // and "Open now" refuses it too
  store.hunt.schedule.push({ id: "p2", at: clock + 999999, kind: "reply" });
  const rn = await ctx.scheduleRunNow("p2", "reply");
  assert.strictEqual(rn.ok, false);
  assert.ok(/DMs only/.test(rn.error));

  // the DM line runs: it opens Reddit Chat only
  clock += 6 * 60000;
  await ctx.scheduleTick();
  assert.ok(opened.length >= 1 && opened.every((u) => /reddit\.com\/chat\//.test(u)), JSON.stringify(opened));
  assert.strictEqual(store.pendingDm.kind, "hunt");

  // delete one post: every line of it goes, in any state, and its waiting DM is taken out of the chat box
  const id = store.pendingDm.id;
  let d = await ctx.scheduleDelete(id);
  assert.ok(d.deleted >= 1);
  assert.ok(!store.hunt.schedule.some((x) => x.id === id));
  assert.strictEqual(store.pendingDm, undefined, "its DM is no longer waiting in the chat box");

  // delete all waiting: only the lines that have not gone yet
  store.hunt.schedule.push({ id: "p9", at: clock - 5000, kind: "dm", state: "sent", sentAt: clock });
  d = await ctx.scheduleDelete("waiting");
  assert.ok(store.hunt.schedule.every((x) => x.state), JSON.stringify(store.hunt.schedule));
  assert.ok(store.hunt.schedule.some((x) => x.id === "p9"), "sent records are kept");

  // delete everything
  d = await ctx.scheduleDelete("all");
  assert.strictEqual(store.hunt.schedule.length, 0);

  // the reply-prefill page never submits a public reply by itself
  const pf = fs.readFileSync(__dirname + "/prefill-new.js", "utf8");
  assert.ok(!/(?<!function )\bsendCountdown\(pendingReply,/.test(pf), "the public reply countdown is not called");

  console.log("schedule-test: all passed");
})().catch((e) => { console.error(e); process.exit(1); });
