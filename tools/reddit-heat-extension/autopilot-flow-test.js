// node autopilot-flow-test.js
// Runs autopilot.js against a fake Chrome, a fake Telegram and a fake Claude
// writer, and walks the whole path: command in, gates, DM handed to the chat
// bridge, receipt out. No network, no browser.
const fs = require("fs"), vm = require("vm"), assert = require("assert");

function world(opts = {}) {
  const store = {};
  const tabs = { created: [], removed: [] };
  const tg = { sent: [], updates: [], calls: 0 };
  let clock = 1_800_000_000_000;
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(clock); } static now() { return clock; } }
  const chrome = {
    storage: { local: {
      get: async (keys) => { const o = {}; for (const k of [].concat(keys)) if (k in store) o[k] = JSON.parse(JSON.stringify(store[k])); return o; },
      set: async (o) => { for (const [k, v] of Object.entries(o)) store[k] = JSON.parse(JSON.stringify(v)); },
      remove: async (k) => { for (const x of [].concat(k)) delete store[x]; },
    } },
    alarms: { get: async () => null, create: () => {}, clear: () => {}, onAlarm: { addListener: () => {} } },
    tabs: { create: async (o) => { if (opts.noTabs) throw new Error("no window"); const t = { id: 100 + tabs.created.length, ...o }; tabs.created.push(t); return t; }, remove: async (id) => { tabs.removed.push(id); } },
    runtime: { onInstalled: { addListener: () => {} }, onStartup: { addListener: () => {} }, onMessage: { addListener: () => {} } },
  };
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body || "{}");
    const method = url.split("/").pop();
    tg.calls += 1;
    if (opts.tgDown) throw new Error("offline");
    if (method === "getUpdates") { const r = tg.updates.filter((u) => u.update_id >= (body.offset || 0)); return { ok: true, json: async () => ({ ok: true, result: r }) }; }
    if (method === "sendMessage") { tg.sent.push(body); return { ok: true, json: async () => ({ ok: true, result: {} }) }; }
    return { ok: true, json: async () => ({ ok: true, result: { username: "testbot" } }) };
  };
  const hunt = { on: false, posts: {}, contacted: {}, me: "me_user", maxAgeH: 48 };
  const calls = { claude: 0, mods: 0, armed: [] };
  const ctx = {
    chrome, fetch, console, setTimeout, clearTimeout, AbortController, Date: FakeDate, JSON, Math, Object, Array, String, Number, Promise, Error, RegExp,
    huntGet: async () => JSON.parse(JSON.stringify(hunt)),
    huntSet: async (p) => { Object.assign(hunt, JSON.parse(JSON.stringify(p))); },
    huntArm: (on) => calls.armed.push(on),
    huntAiKey: async () => (opts.noKey ? "" : "sk-test"),
    spendGet: async () => ({ cents: opts.overBudget ? 100 : 0, budget: 100 }),
    HEAT_FIT: () => (opts.fitOff ? "off" : "strict"),
    huntScore: (p) => (p.fit != null ? p.fit : 50),
    huntFetch: async () => { calls.mods += 1; if (opts.modsDown) throw new Error("HTTP 403"); return { data: { children: (opts.mods || []).map((name) => ({ name })) } }; },
    dmGate: async () => opts.gate || { ok: true, waitMs: 0, sentToday: 0, cap: 25 },
    huntSlotWrite: async (id) => {
      calls.claude += 1;
      if (opts.claude === "error") return { ok: false, error: "rate limited by the API, try again in a minute" };
      if (opts.claude === "throw") throw new Error("boom");
      if (opts.claude === "no") { hunt.posts[id].act = "not_relevant"; return { ok: false, cancelled: true, reason: "offering themselves" }; }
      if (opts.claude === "empty") { hunt.posts[id].ai = { model: "template+slots", fit: "yes", readBody: true, dm_long: "" }; return { ok: true }; }
      hunt.posts[id].ai = { model: "template+slots", fit: "yes", readBody: true, dm_long: "Hi, I read your post about the bakery app and had one thought on the launch that may help you." };
      return { ok: true, ai: hunt.posts[id].ai };
    },
    huntAiWrite: async () => ({ ok: false, error: "wrong writer" }),
    // background.js sends from its own visible window; here it is a tab we can count
    openSenderTab: async (url) => chrome.tabs.create({ url, active: true }),
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(__dirname + "/autopilot-lib.js", "utf8"), ctx);
  vm.runInContext(fs.readFileSync(__dirname + "/autopilot.js", "utf8"), ctx);
  let uid = 1;
  return {
    ctx, store, tabs, tg, hunt, calls,
    tick: () => ctx.apTick(),
    advance: (ms) => { clock += ms; },
    now: () => clock,
    say: (text, chat = "777") => tg.updates.push({ update_id: uid++, message: { chat: { id: Number(chat), first_name: "Hema" }, text, date: Math.floor(clock / 1000) } }),
    post: (id, o = {}) => { hunt.posts[id] = { id, author: "user_" + id, sub: "startups", title: "Looking for a technical co-founder " + id, body: "I am building a scheduling tool for small clinics, 40 users on the waitlist, and I need a technical partner to take the MVP to launch. ".repeat(2), hunt: "cofounder", comments: 2, permalink: "https://www.reddit.com/r/startups/comments/" + id + "/", firstSeen: clock, created: clock - 60000, ...o }; },
    // the original scenarios: no look-back, a one-minute gap, nothing opened in front
    link: async (rules = { backMin: 0, gapMinS: 60, gapMaxS: 60, watchFirst: 0 }) => { await chrome.storage.local.set({ autopilot: { token: "123:abc", chatId: "777", rules } }); },
    opts,
  };
}
const texts = (w) => w.tg.sent.map((m) => m.text).join("\n---\n");

(async () => {
  let w2;
  // 1. "auto mode on" from the linked chat turns it on and starts the hunt
  let w = world(); await w.link();
  w.say("Auto mode on"); await w.tick();
  assert.strictEqual(w.store.autopilot.on, true);
  assert.strictEqual(w.hunt.on, true, "the hunt must be watching");
  assert.ok(/Autopilot is ON/.test(texts(w)));

  // 2. a new find is screened by Claude, then handed to the chat as a DM
  w.advance(1000); w.post("a1"); await w.tick();
  assert.strictEqual(w.calls.claude, 1);
  assert.strictEqual(w.store.pendingDm.kind, "hunt");
  assert.strictEqual(w.store.pendingDm.auto, true);
  assert.strictEqual(w.store.pendingDm.author, "user_a1");
  assert.strictEqual(w.tabs.created.length, 1);
  assert.ok(/\/chat\/room\/create$/.test(w.tabs.created[0].url), "only Reddit Chat is ever opened");
  assert.strictEqual(w.tabs.created[0].active, true, "the chat opens where Reddit will run it");
  assert.strictEqual(w.store.pendingReply, undefined, "no public reply is ever queued");
  assert.strictEqual(w.store.autopilot.job.id, "a1");

  // 3. while one is in flight, a second find waits its turn
  w.post("a2"); await w.tick();
  assert.strictEqual(w.tabs.created.length, 1, "one DM at a time");

  // 4. the chat bridge reports the DM sent: receipt, tab closed
  w.advance(20000); w.hunt.posts.a1.dmAt = w.now(); w.hunt.contacted.user_a1 = { at: w.now() }; delete w.store.pendingDm;
  await w.tick();
  assert.strictEqual(w.store.autopilot.job, null);
  assert.deepStrictEqual(w.tabs.removed, [100]);
  assert.ok(/DM sent to u\/user_a1/.test(texts(w)));
  assert.strictEqual(w.store.autopilot.done.a1.why, "sent");

  // 5. "off" stops it, and a find that arrives afterwards is left alone
  w.say("off"); await w.tick();
  assert.strictEqual(w.store.autopilot.on, false);
  assert.strictEqual(w.hunt.on, false, "the hunt goes back to how it was");
  const before = w.tabs.created.length;
  w.post("a3"); await w.tick(); await w.tick();
  assert.strictEqual(w.tabs.created.length, before, "off means nothing is sent");
  assert.ok(/Autopilot is OFF/.test(texts(w)));

  // 6. turned on again: a2 and a3 were found before the switch, so they are not messaged
  w.advance(5000); w.say("auto on"); await w.tick(); await w.tick();
  assert.strictEqual(w.tabs.created.length, before, "only threads found after switching on");

  // 7. "off" while a DM is in flight drops it before it sends
  w = world(); await w.link(); w.say("auto on"); await w.tick(); w.advance(1000); w.post("b1"); await w.tick();
  assert.ok(w.store.pendingDm);
  w.say("OFF"); await w.tick();
  assert.strictEqual(w.store.pendingDm, undefined, "the waiting DM is removed");
  assert.deepStrictEqual(w.tabs.removed, [100]);
  assert.strictEqual(w.store.autopilot.on, false);

  // 8. the Claude screen fails: that thread is not messaged, and is not retried
  for (const mode of ["error", "throw", "empty"]) {
    w = world({ claude: mode }); await w.link(); w.say("auto on"); await w.tick(); w.advance(1000); w.post("c1"); await w.tick();
    assert.strictEqual(w.tabs.created.length, 0, mode + ": nothing opened");
    assert.strictEqual(w.store.pendingDm, undefined, mode + ": nothing queued");
    assert.ok(/Claude screen did not work/.test(texts(w)), mode + ": " + texts(w));
    await w.tick(); await w.tick();
    assert.strictEqual(w.calls.claude, 1, mode + ": not tried twice");
  }
  // 9. Claude says not a fit
  w = world({ claude: "no" }); await w.link(); w.say("auto on"); await w.tick(); w.advance(1000); w.post("c2"); await w.tick();
  assert.strictEqual(w.tabs.created.length, 0);
  assert.ok(/Claude screened it out: offering themselves/.test(texts(w)));
  // 10. no Claude key: PAUSED, and the post is kept, not skipped
  w = world({ noKey: true }); await w.link(); w.say("auto on"); await w.tick(); w.advance(1000); w.post("c3"); await w.tick(); await w.tick();
  assert.strictEqual(w.tabs.created.length, 0);
  assert.strictEqual(w.calls.claude, 0);
  assert.ok(/PAUSED: no Claude key saved/.test(texts(w)), texts(w));
  assert.strictEqual(w.tg.sent.filter((m) => /^Autopilot is PAUSED/.test(m.text)).length, 1, "said once, not every tick");
  assert.strictEqual((w.store.autopilot.done || {}).c3, undefined, "the post is waiting, not skipped");
  assert.ok(/no Claude key/.test(w.store.autopilot.blocked));
  // the key is added: it carries on with the same post
  w.opts.noKey = false; await w.tick();
  assert.strictEqual(w.tabs.created.length, 1, "sent once the key is there");
  assert.strictEqual(w.store.pendingDm.author, "user_c3");
  assert.strictEqual(w.store.autopilot.blocked, "");

  // 11. moderators: on the mod list, or marked by Reddit
  w = world({ mods: ["user_d1"] }); await w.link(); w.say("auto on"); await w.tick(); w.advance(1000); w.post("d1"); w.post("d2", { distinguished: "moderator" }); await w.tick(); await w.tick();
  assert.strictEqual(w.tabs.created.length, 0, "no mod post is messaged");
  assert.strictEqual(w.calls.claude, 0, "and no money is spent screening it");
  // the mod list is read once and kept
  w.post("d3"); await w.tick();
  assert.strictEqual(w.calls.mods, 1);
  assert.strictEqual(w.tabs.created.length, 1, "an ordinary member in the same room is messaged");

  // 12. a stranger's chat cannot switch it on
  w = world(); await w.link(); w.say("auto on", "999"); await w.tick();
  assert.ok(!w.store.autopilot.on, "only the linked chat gives orders");
  assert.strictEqual(w.tg.sent.length, 0);

  // 13. ordinary chatter changes nothing
  w = world(); await w.link(); w.say("is it on?"); w.say("hello"); await w.tick();
  assert.ok(!w.store.autopilot.on);

  // 14. the pacing gate holds a DM back without dropping the thread
  const gate = { ok: false, waitMs: 90000, sentToday: 2, cap: 25 };
  w = world({ gate }); await w.link(); w.say("auto on"); await w.tick(); w.advance(1000); w.post("e1"); await w.tick();
  assert.strictEqual(w.tabs.created.length, 0);
  assert.strictEqual((w.store.autopilot.done || {}).e1, undefined, "held, not dropped");
  gate.ok = true; gate.waitMs = 0; await w.tick();
  assert.strictEqual(w.tabs.created.length, 1);

  // 15. the day's ceiling is said once
  w = world({ gate: { ok: false, waitMs: 0, sentToday: 25, cap: 25 } }); await w.link(); w.say("auto on"); await w.tick(); w.advance(1000); w.post("f1"); await w.tick(); await w.tick(); await w.tick();
  assert.strictEqual(w.tg.sent.filter((m) => /ceiling of 25/.test(m.text)).length, 1);

  // 16. Reddit Chat never confirms: dropped after three minutes, never retried
  w = world(); await w.link(); w.say("auto on"); await w.tick(); w.advance(1000); w.post("g1"); await w.tick();
  w.advance(60000); await w.tick();
  assert.ok(w.store.autopilot.job, "still waiting at one minute");
  w.advance(125000); await w.tick();
  assert.strictEqual(w.store.autopilot.job, null);
  assert.strictEqual(w.store.pendingDm, undefined);
  assert.ok(/Not sent: u\/user_g1/.test(texts(w)));
  await w.tick();
  assert.strictEqual(w.tabs.created.length, 1, "not tried again");

  // 17. someone already contacted is never messaged a second time
  w = world(); await w.link(); w.hunt.contacted.user_h1 = { at: 1 }; w.say("auto on"); await w.tick(); w.advance(1000); w.post("h1"); await w.tick();
  assert.strictEqual(w.tabs.created.length, 0);

  // 18. an unlinked bot records who wrote, and obeys nobody
  w = world(); await w.ctx.chrome.storage.local.set({ autopilot: { token: "123:abc" } }); w.say("auto on", "555"); await w.tick();
  assert.ok(!w.store.autopilot.on);
  assert.strictEqual(w.store.autopilot.seenChat.id, "555");

  // 19. Telegram down: nothing breaks, and the switch stays where it was
  w = world({ tgDown: true }); await w.link(); await w.ctx.apSet({ on: true, since: w.now() }); w.advance(1000); w.post("i1"); await w.tick();
  assert.strictEqual(w.store.autopilot.on, true);
  assert.strictEqual(w.tabs.created.length, 1, "DMs do not depend on Telegram being reachable");

  // 20. no Telegram at all: the switch on the page is the whole control
  w = world();
  let r = await w.ctx.apTurn(true, "the Autopilot page");
  assert.strictEqual(r.on, true);
  assert.strictEqual(w.store.autopilot.on, true, "Auto mode is on with no bot and no chat");
  assert.strictEqual(w.hunt.on, true);
  w.advance(1000); w.post("j1"); await w.tick();
  assert.strictEqual(w.tabs.created.length, 1, "the DM goes out without Telegram");
  assert.strictEqual(w.store.pendingDm.author, "user_j1");
  assert.strictEqual(w.store.pendingReply, undefined);
  w.advance(20000); w.hunt.posts.j1.dmAt = w.now(); w.hunt.contacted.user_j1 = { at: w.now() }; delete w.store.pendingDm;
  await w.tick();
  assert.strictEqual(w.store.autopilot.job, null);
  assert.ok(w.store.autopilot.log.some((x) => x.what === "DM sent" && x.who === "user_j1"), "the page's own log is the record");
  // a skip is recorded there too
  w2 = world({ claude: "error" });
  await w2.ctx.apTurn(true, "the Autopilot page"); w2.advance(1000); w2.post("j2"); await w2.tick();
  assert.ok(w2.store.autopilot.log.some((x) => /Claude screen did not work/.test(x.what)), "and so is every skip, with the reason");
  assert.strictEqual(w2.tabs.created.length, 0);
  // Manual mode: back to nothing sent by itself
  r = await w.ctx.apTurn(false, "the Autopilot page");
  assert.strictEqual(r.on, false);
  w.advance(1000); w.post("j3"); await w.tick(); await w.tick();
  assert.strictEqual(w.tabs.created.length, 1, "Manual mode sends nothing");
  assert.strictEqual(w.tg.calls + w2.tg.calls, 0, "and Telegram was never contacted");

  // 21. the conversion rules: nothing is paid for a post that would not convert
  w = world(); await w.link({ backMin: 0, gapMinS: 60, gapMaxS: 60, watchFirst: 0 }); w.say("auto on"); await w.tick(); w.advance(1000);
  w.post("k1", { created: w.now() - 7 * 3600000 });                  // 7h old
  w.post("k2", { comments: 40 });                                     // crowded
  w.post("k3", { body: "need cofounder dm me" });                     // one line
  w.post("k4", { fit: 20 });                                          // low fit
  await w.tick();
  assert.strictEqual(w.calls.claude, 0, "no Claude call for any of them");
  assert.strictEqual(w.tabs.created.length, 0);
  const why = w.store.autopilot.done;
  assert.ok(/over 6h/.test(why.k1.why) && /40 comments/.test(why.k2.why) && /too short/.test(why.k3.why) && /fit 20, under 35/.test(why.k4.why), JSON.stringify(why));
  w.post("k5"); await w.tick();
  assert.strictEqual(w.calls.claude, 1, "a post that passes is screened");
  assert.strictEqual(w.tabs.created.length, 1);

  // 22. the interval: after a DM, the next one waits 4-8 minutes by default
  w = world(); await w.link({ backMin: 0, watchFirst: 0 }); w.say("auto on"); await w.tick(); w.advance(1000);
  w.post("g1"); await w.tick();
  w.hunt.posts.g1.dmAt = w.now(); w.hunt.contacted.user_g1 = { at: w.now() }; delete w.store.pendingDm; await w.tick();
  const gap = w.store.autopilot.nextAt - w.now();
  assert.ok(gap >= 240000 && gap <= 480000, "gap " + gap);
  w.post("g2"); await w.tick();
  assert.strictEqual(w.tabs.created.length, 1, "g2 waits for the gap");
  w.advance(gap - 1000); await w.tick();
  assert.strictEqual(w.tabs.created.length, 1, "still inside the gap");
  w.advance(2000); await w.tick();
  assert.strictEqual(w.tabs.created.length, 2, "and goes once the gap is over");
  assert.strictEqual(w.ctx.AP.rules({ gapMinS: 5, gapMaxS: 2 }).gapMinS, 60, "never under a minute");

  // 23. the first few open in front of you, then quietly
  w = world(); await w.link({ backMin: 0, gapMinS: 60, gapMaxS: 60, watchFirst: 2 }); w.say("auto on"); await w.tick();
  for (const id of ["w1", "w2", "w3"]) {
    w.advance(61000); w.post(id); await w.tick();
    w.hunt.posts[id].dmAt = w.now(); w.hunt.contacted["user_" + id] = { at: w.now() }; delete w.store.pendingDm; await w.tick();
  }
  // every DM now goes out in front (Reddit Chat stalls in a hidden tab); the window closes itself after
  assert.deepStrictEqual(w.tabs.created.map((t) => t.active), [true, true, true], JSON.stringify(w.tabs.created.map((t) => t.active)));

  // 24. look back: switching on takes posts found in the last hour, not older
  w = world(); await w.link({ backMin: 60, gapMinS: 60, gapMaxS: 60, watchFirst: 0 });
  w.post("l1", { firstSeen: w.now() - 90 * 60000, created: w.now() - 91 * 60000 });
  w.post("l2", { firstSeen: w.now() - 30 * 60000, created: w.now() - 31 * 60000 });
  w.say("auto on"); await w.tick(); await w.tick();
  assert.strictEqual(w.tabs.created.length, 1);
  assert.strictEqual(w.store.pendingDm.author, "user_l2", "the 30-minute-old find is taken, the 90-minute one is not");

  // 25. skips caused only by a missing key get another chance at the next switch-on
  w = world(); await w.link({ backMin: 60, gapMinS: 60, gapMaxS: 60, watchFirst: 0 });
  await w.ctx.apSet({ done: { m1: { at: w.now(), why: "Claude screen could not run (no Claude key saved)" }, m2: { at: w.now(), why: "Claude screened it out: offering themselves" } } });
  w.post("m1"); w.post("m2", { author: "user_m2b" });
  w.say("auto on"); await w.tick();
  assert.strictEqual(w.store.pendingDm && w.store.pendingDm.author, "user_m1", "the no-key skip is retried");
  assert.ok(w.store.autopilot.done.m2, "a real no from Claude stays a no");

  // 26. fit check switched off, or the day's AI budget used: PAUSED, nothing lost
  for (const o of [{ fitOff: true }, { overBudget: true }]) {
    w = world(o); await w.link(); w.say("auto on"); await w.tick(); w.advance(1000); w.post("n1"); await w.tick();
    assert.strictEqual(w.tabs.created.length, 0);
    assert.strictEqual(w.calls.claude, 0);
    assert.ok(w.store.autopilot.blocked, JSON.stringify(o));
    assert.strictEqual((w.store.autopilot.done || {}).n1, undefined);
  }

  // 27. Hiring and project posts are left on the board
  w = world(); await w.link(); w.say("auto on"); await w.tick(); w.advance(1000);
  w.post("h9", { hunt: "project", badge: "hiring" }); await w.tick();
  assert.strictEqual(w.tabs.created.length, 0);
  assert.strictEqual(w.calls.claude, 0);

  console.log("autopilot-flow-test: all 27 scenarios passed");
})().catch((e) => { console.error(e); process.exit(1); });
