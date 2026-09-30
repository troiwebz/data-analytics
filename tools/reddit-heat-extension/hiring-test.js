// node hiring-test.js
// The Hiring category: who is kept, and the two-minute lane run for real
// against a fake Chrome and a fake Reddit (background.js loaded as it is).
const fs = require("fs"), vm = require("vm"), assert = require("assert");

// ---------------------------------------------------------------- classifier
require("./lib.js");
const H = globalThis;
const keep = (t, b = "") => H.classifyAny(t, b, "hiring");
const K = (t, b, kind) => { const r = keep(t, b); assert.ok(r.keep, `should keep: ${t} (${r.why})`); assert.strictEqual(r.kind, kind, t); assert.strictEqual(r.badge, "hiring"); return r; };
const D = (t, b, why) => { const r = keep(t, b); assert.ok(!r.keep, `should drop: ${t}`); if (why) assert.ok(why.test(r.why), `${t}: ${r.why}`); };
K("[Hiring] Python developer to build a scraper, $400 fixed", "", "Programming");
K("[Task] Fix a bug in my WordPress site - $50", "", "Programming");
K("[HIRING] Need someone to optimize my Google Business Profile", "Local plumber. Budget $300/month", "Google Maps");
K("Looking to hire someone for local SEO and GMB for my salon", "", "Google Maps");
K("[Hiring] SEO specialist for ecommerce store", "", "SEO");
K("[Hiring] Facebook ads expert for a dental clinic", "$1500/mo", "Digital marketing");
K("Hiring a Google Ads manager, paid monthly", "", "Digital marketing");
assert.strictEqual(K("[Hiring] React developer", "Pay is $40/hr", "Programming").budget, "$40/hr");
D("[For Hire] Full stack developer, 8 years experience", "", /offering/);
D("I am a freelance SEO expert, hire me", "", /offering/);
D("Looking for a job as a React developer", "", /job/);
D("[Hiring] Video editor for YouTube shorts", "", /not programming/);
D("[Hiring] Logo designer", "", /not programming/);
D("Need a technical co-founder for my app", "", /co-founder/);
D("Looking to hire a web developer for a landing page", "unpaid, for exposure", /unpaid/);
D("Best laptop for programming?", "", /nobody is being hired/);
D("Hiring for a VMware Engineer | Company: Infra Assure | Location: Riyadh", "5+ years of experience, full time, send your CV", /employee job ad/);
D("Nui Cobalt is hiring!", "Join our team as a social media marketer. Full-time, benefits.", /employee job ad/);
D("we are hiring", "Medical coding specialists, on-site, salary 40k", /employee job ad|not programming/);
D("Hiring for an AI Engineer, Bangalore, India", "3+ years experience in Python, CTC 20 LPA, hybrid", /employee job ad/);
K("[Hiring] Contract React developer for a 2-week project", "Budget $1500, remote", "Programming");
assert.deepStrictEqual(H.HIRING_KINDS.map((k) => k.label), ["Google Maps", "SEO", "Digital marketing", "Programming"]);
assert.strictEqual(H.badgeDef("hiring").label, "Hiring");
// the project hunt only calls something "Hiring" when it passes the same test
const zc = H.classifyAny("Can someone start a software development company with zero capital?", "I want to build apps for clients but have no money", "project");
assert.ok(zc.badge !== "hiring", "a question with nobody hiring is not Hiring: " + zc.badge);
const ph = H.classifyAny("Looking to hire a developer to build our booking website", "Small clinic, budget $2000, paid on milestones", "project");
assert.strictEqual(ph.badge, "hiring"); assert.strictEqual(ph.kind, "Programming");
// the other hunts are unchanged
assert.strictEqual(H.classifyAny("Need a technical co-founder for my SaaS", "I am non-technical, building an MVP", "cofounder").badge, "cofounder");

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
  // hunt off: nothing is read
  let r = await ctx.huntHiringPoll();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(fetched.length, 0, "no reads while the hunt is off");

  // switching the hunt on arms the lane at two minutes
  ctx.huntArm(true);
  assert.strictEqual(alarms["hunt-hiring"].periodInMinutes, 2, "every two minutes");
  await chrome.storage.local.set({ hunt: { on: true, posts: {}, contacted: {} } });

  listing = [
    child("a1", "[Hiring] Python developer for a scraper, $400"),
    child("a2", "[For Hire] SEO expert, cheap rates"),
    child("a3", "[Hiring] Google Maps ranking for my HVAC company", { sub: "hiring" }),
    child("a4", "[Hiring] Logo designer"),
    child("a5", "[Hiring] SEO for a law firm", { at: clock - 30 * 3600000 }),        // over a day old
    child("a6", "[Hiring] WordPress dev", { stickied: true }),                        // a pinned rules post
    child("a7", "Rules and posting guide", { author: "AutoModerator" }),
  ];
  search = [child("b1", "Hiring a Facebook ads manager for my gym, $1000/mo", { sub: "smallbusiness" }), child("a1", "[Hiring] Python developer for a scraper, $400")];
  r = await ctx.huntHiringPoll();
  assert.strictEqual(fetched.length, 2, "exactly two requests per check");
  assert.ok(/\/r\/forhire\+hiring\+jobbit\+slavelabour\+DoneDirtCheap\+freelance_forhire\/new\.json/.test(fetched[0]), fetched[0]);
  assert.ok(/search\.json\?q=title%3Ahiring.*sort=new&t=day/.test(fetched[1]), fetched[1]);
  let posts = store.hunt.posts;
  assert.deepStrictEqual(Object.keys(posts).sort(), ["t3_a1", "t3_a3", "t3_b1"], JSON.stringify(Object.keys(posts)));
  assert.strictEqual(r.added, 3);
  assert.strictEqual(posts.t3_a1.badge, "hiring");
  assert.strictEqual(posts.t3_a1.kind, "Programming");
  assert.strictEqual(posts.t3_a3.kind, "Google Maps");
  assert.strictEqual(posts.t3_b1.kind, "Digital marketing");
  assert.strictEqual(posts.t3_b1.budget, "$1000/mo");
  assert.strictEqual(posts.t3_a1.hunt, "project", "Hiring posts sit with the project hunt");
  assert.strictEqual(posts.t3_a1.source, "hiring");
  assert.strictEqual(store.hunt.hiringLane.added, 3);

  // they show on the board under the Hiring badge
  const q = await ctx.huntQueue(50);
  assert.strictEqual(q.badges.hiring, 3, JSON.stringify(q.badges));
  assert.strictEqual(q.hiringLane.added, 3);

  // the next check adds only what is new, and keeps your clicks
  store.hunt.posts.t3_a1.act = "skip";
  listing.push(child("c1", "[Hiring] Local SEO and GBP for a dentist"));
  fetched.length = 0;
  r = await ctx.huntHiringPoll();
  assert.strictEqual(r.added, 1);
  assert.strictEqual(store.hunt.posts.t3_a1.act, "skip", "a post you skipped stays skipped");
  assert.strictEqual(Object.keys(store.hunt.posts).length, 4);

  // a full sweep that started before the lane wrote does not undo the lane
  store.hunt.posts.t3_old = { id: "t3_old", author: "x", created: clock - 60000, firstSeen: clock - 60000, hunt: "cofounder" };
  const beforeSweep = JSON.parse(JSON.stringify(store.hunt));
  // simulate: the sweep read the database, then the lane added d1, then the sweep wrote
  listing.push(child("d1", "[Hiring] Shopify developer, $500"));
  await ctx.huntHiringPoll();
  assert.ok(store.hunt.posts.t3_d1, "lane added d1");
  store.hunt.posts.t3_a3.dmAt = clock;         // and you DM'd somebody meanwhile
  const origGet = ctx.huntGet;
  let first = true;
  ctx.huntGet = async () => { if (first) { first = false; return { ...(await origGet()), posts: beforeSweep.posts, on: true }; } return origGet(); };
  listing = []; search = [];
  await ctx.huntPoll(false);
  ctx.huntGet = origGet;
  assert.ok(store.hunt.posts.t3_d1, "the sweep kept the post the lane added while it ran");
  assert.ok(store.hunt.posts.t3_a3.dmAt, "and kept the DM you sent while it ran");

  // an extension update re-sorts the board: Hiring posts must survive it
  const before = Object.keys(store.hunt.posts).filter((k) => store.hunt.posts[k].source === "hiring").length;
  await ctx.huntReclassify();
  const after = Object.keys(store.hunt.posts).filter((k) => store.hunt.posts[k].source === "hiring").length;
  assert.ok(before >= 4, "hiring posts before: " + before);
  assert.strictEqual(after, before, "an update no longer deletes the Hiring posts");

  // hunt off: the lane stops
  ctx.huntArm(false);
  assert.ok(!alarms["hunt-hiring"], "the lane stops with the hunt");

  // Auto mode leaves Hiring posts on the board for you
  assert.strictEqual(ctx.AP.blockReason({ id: "t3_z", author: "u", hunt: "project", firstSeen: clock, created: clock }, { since: 0, now: clock }), "a Hiring or project post, left for you");
  assert.strictEqual(ctx.AP.blockReason({ id: "t3_y", author: "u", hunt: "cofounder", firstSeen: clock, created: clock }, { since: 0, now: clock }), "");

  console.log("hiring-test: all passed");
})().catch((e) => { console.error(e); process.exit(1); });
