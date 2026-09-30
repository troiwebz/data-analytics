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
  const post = (id) => ({ id, author: "user_" + id, sub: "cofounder", title: "Need a technical cofounder " + id, body: "x".repeat(200), permalink: "/r/cofounder/comments/" + id + "/", created: clock - 60000, firstSeen: clock - 60000, hunt: "cofounder", ai: { fit: "yes", readBody: true, model: "template+slots", dm_long: "Hello " + id + ", I read your post about the clinic scheduler and the waitlist. I would start by moving the prototype onto a proper backend and keeping your booking flow as is. What is the launch date you have in mind?", public_reply: "a public line" } });
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

  assert.strictEqual(store.pendingDm, undefined);

  // ---- nothing goes out unless Claude read the description ----
  const claudeCalls = [];
  let verdict = { fit: "yes", reason: "a paid freelance build", dm: "Hi, you need a booking site for the clinic with online payments. I would start with the booking flow and the reminder emails, then the payment page. We have built booking products for small practices. Is the launch tied to a date?" };
  const baseFetch = ctx.fetch;
  ctx.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("api.anthropic.com")) { claudeCalls.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(verdict) }], usage: { input_tokens: 900, output_tokens: 120 } }) }; }
    if (u.includes("/comments/") && u.includes(".json")) return { ok: true, status: 200, json: async () => ([{ data: { children: [{ data: { selftext: "We are a small clinic and need a booking website with payments, budget $2000, paid by milestone." } }] } }]) };
    return baseFetch(url, init);
  };
  const hire = (id, o = {}) => ({ id, author: "buyer_" + id, sub: "forhire", title: "[Hiring] Booking website for a clinic " + id, body: "", permalink: "/r/forhire/comments/" + id + "/x/", created: clock - 60000, firstSeen: clock - 60000, hunt: "project", badge: "hiring", ...o });
  store.hunt.posts.h1 = hire("h1");
  await chrome.storage.local.set({ config: { profile: {} } });
  store.hunt.schedule = [{ id: "h1", at: clock - 1000, kind: "dm" }];
  const openedBefore = opened.length;
  await ctx.scheduleTick();
  let line = store.hunt.schedule[0];
  assert.ok(!line.state, "no key: the line waits, it is not opened");
  assert.ok(/Claude key/.test(line.reason), line.reason);
  assert.strictEqual(opened.length, openedBefore, "nothing opened without Claude");
  assert.strictEqual(store.pendingDm, undefined);

  // with a key: the description is fetched, Claude reads it and writes the DM
  await chrome.storage.local.set({ config: { profile: { apiKey: "sk-test-not-real", role: "web developer" } } });
  line.at = clock - 1000;
  await ctx.scheduleTick();
  assert.strictEqual(claudeCalls.length, 1, "one Claude call");
  assert.ok(/booking website with payments/.test(claudeCalls[0].messages[0].content), "Claude was given the description, not just the title");
  assert.strictEqual(store.hunt.posts.h1.ai.model, "claude-hire");
  assert.strictEqual(store.hunt.posts.h1.ai.readBody, true);
  assert.strictEqual(store.pendingDm.text, verdict.dm, "the DM is the one Claude wrote");
  assert.strictEqual(store.pendingDm.screened, true);
  assert.strictEqual(store.hunt.schedule[0].state, "opened");

  // Claude says it is not relevant: the line is dropped with its reason, nothing opens
  delete store.pendingDm;
  verdict = { fit: "no", reason: "a full-time job ad, not a project", dm: "" };
  store.hunt.posts.h2 = hire("h2", { body: "Full-time VMware engineer in Riyadh, 5 years of experience, salary and benefits." });
  store.hunt.schedule = [{ id: "h2", at: clock - 1000, kind: "dm" }];
  const o2 = opened.length;
  await ctx.scheduleTick();
  assert.strictEqual(store.hunt.schedule[0].state, "cancelled");
  assert.ok(/Claude read it: a full-time job ad/.test(store.hunt.schedule[0].reason), store.hunt.schedule[0].reason);
  assert.strictEqual(opened.length, o2);
  assert.strictEqual(store.pendingDm, undefined);

  // a post with no description at all is never messaged
  ctx.fetch = async (url, init) => String(url).includes(".json") && String(url).includes("/comments/") ? { ok: true, status: 200, json: async () => ([{ data: { children: [{ data: { selftext: "" } }] } }]) } : baseFetch(url, init);
  store.hunt.posts.h3 = hire("h3");
  store.hunt.schedule = [{ id: "h3", at: clock - 1000, kind: "dm" }];
  await ctx.scheduleTick();
  assert.strictEqual(store.hunt.schedule[0].state, "cancelled");
  assert.ok(/no description/.test(store.hunt.schedule[0].reason));

  // the chat box only sends a DM by itself when it is marked as read and written by Claude
  const bridge = fs.readFileSync(__dirname + "/chat-bridge.js", "utf8");
  assert.ok(/pendingDm\.screened === true/.test(bridge));

  // ---- a new schedule starts at once, and a dropped line can be read again ----
  ctx.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("api.anthropic.com")) { claudeCalls.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(verdict) }], usage: { input_tokens: 900, output_tokens: 120 } }) }; }
    if (u.includes("/comments/") && u.includes(".json")) return { ok: true, status: 200, json: async () => ([{ data: { children: [{ data: { selftext: "Remote LinkedIn outreach partner, part time, paid US$50 a month, about ten minutes to set up." } }] } }]) };
    return baseFetch(url, init);
  };
  delete store.pendingDm;
  store.hunt.schedule = [];
  verdict = { fit: "yes", reason: "a real paid remote role", dm: "Hi, your LinkedIn outreach partner role is remote and part time, which suits me well. I can set it up in the ten minutes you mention and keep it running every week without supervision. I already run outreach for my own work. When would you like to start?" };
  store.hunt.posts.k1 = hire("k1"); store.hunt.posts.k2 = hire("k2");
  const add = await ctx.scheduleAdd(["k1", "k2"], 5, 60);
  assert.strictEqual(add.added, 2);
  const first = store.hunt.schedule.find((x) => x.id === "k1");
  assert.ok(first.at <= clock, "the first line is due at once");
  const o3 = opened.length;
  await ctx.scheduleKick();
  assert.strictEqual(store.hunt.schedule.find((x) => x.id === "k1").state, "opened", "the first DM opens straight away");
  assert.strictEqual(opened.length, o3 + 1);
  assert.strictEqual(store.pendingDm.author, "buyer_k1");
  assert.ok(ctx.dmReadyFromClaude(store.hunt.posts.k2), "the second post is read ahead, ready for its time");
  assert.ok(!store.hunt.schedule.find((x) => x.id === "k2").state, "but it waits for its turn");

  // a line Claude dropped: try again brings the post back and reads it once more
  delete store.pendingDm;
  store.hunt.posts.k3 = hire("k3", { act: "not_relevant", cancelledBy: "ai", cancelReason: "old rule", ai: { fit: "no" } });
  store.hunt.schedule.push({ id: "k3", at: clock - 1000, kind: "dm", state: "cancelled", reason: "Claude read it: old rule" });
  await ctx.scheduleRetry("k3");
  assert.ok(!store.hunt.posts.k3.act, "the post is back");
  await ctx.scheduleKick();
  assert.strictEqual(store.hunt.schedule.find((x) => x.id === "k3").state, "opened");

  // after the update, a "no" given under the old strict rules is taken back
  store.hunt.posts.k4 = hire("k4", { body: "x".repeat(60), act: "not_relevant", cancelledBy: "ai", cancelReason: "not programming", ai: { fit: "no" } });
  store.hunt.schedule.push({ id: "k4", at: clock - 1000, kind: "dm", state: "cancelled", reason: "Claude read it: not programming" });
  await ctx.huntReclassify();
  assert.ok(store.hunt.posts.k4 && !store.hunt.posts.k4.act, "the old drop is taken back");
  assert.ok(!store.hunt.schedule.some((x) => x.id === "k4"), "and its dropped line is cleared so it can be scheduled again");

  console.log("schedule-test: all passed");
})().catch((e) => { console.error(e); process.exit(1); });
