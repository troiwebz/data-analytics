// node autopilot-test.js
const assert = require("assert");
const AP = require("./autopilot-lib.js");

// --- Telegram commands ------------------------------------------------------
for (const s of ["auto on", "Auto mode on", "AUTO ON", "autopilot on", "auto pilot on", "/auto_on", "on", "/on", "auto mode on.", "/auto on@MyBot", "resume"]) assert.strictEqual(AP.parseCommand(s), "on", s);
for (const s of ["off", "auto off", "Auto mode off", "autopilot off", "/off", "stop", "/auto_off", "pause"]) assert.strictEqual(AP.parseCommand(s), "off", s);
for (const s of ["status", "/status", "auto status"]) assert.strictEqual(AP.parseCommand(s), "status", s);
assert.strictEqual(AP.parseCommand("/start"), "help");
// ordinary sentences must never flip the switch
for (const s of ["", "hello", "turn it on tomorrow maybe", "is it on", "on and off", "what is the offer", "come on", "log off the laptop"]) assert.strictEqual(AP.parseCommand(s), "", s);

// --- moderator posts --------------------------------------------------------
assert.strictEqual(AP.isModPost({ author: "AutoModerator" }, []), true);
assert.strictEqual(AP.isModPost({ author: "startups-ModTeam" }, []), true);
assert.strictEqual(AP.isModPost({ author: "jane", distinguished: "moderator" }, []), true);
assert.strictEqual(AP.isModPost({ author: "jane", distinguished: "admin" }, []), true);
assert.strictEqual(AP.isModPost({ author: "jane", stickied: true }, []), true);
assert.strictEqual(AP.isModPost({ author: "Jane" }, ["bob", "jane"]), true);
assert.strictEqual(AP.isModPost({ author: "jane" }, ["bob"]), false);
assert.strictEqual(AP.isModPost({ author: "[deleted]" }, []), true);
assert.strictEqual(AP.isModPost(null, []), true);

// --- choosing who to message ------------------------------------------------
const now = 1_800_000_000_000;
const since = now - 600000;
const base = { since, contacted: {}, done: {}, me: "me_user", now, maxAgeH: 48 };
const mk = (id, o = {}) => ({ id, author: "user_" + id, firstSeen: now - 60000, created: now - 120000, ...o });
assert.strictEqual(AP.blockReason(mk("a"), base), "");
assert.strictEqual(AP.blockReason(mk("a", { firstSeen: since - 1 }), base), "found before autopilot was switched on");
assert.strictEqual(AP.blockReason(mk("a", { dmAt: now }), base), "already messaged");
assert.strictEqual(AP.blockReason(mk("a", { act: "skip" }), base), "skipped");
assert.strictEqual(AP.blockReason(mk("a", { mine: true }), base), "you already commented there");
assert.strictEqual(AP.blockReason(mk("a", { author: "Me_User" }), base), "your own post");
assert.strictEqual(AP.blockReason(mk("a", { distinguished: "moderator" }), base), "moderator post");
assert.strictEqual(AP.blockReason(mk("a", { created: now - 49 * 3600000 }), base), "too old");
assert.strictEqual(AP.blockReason(mk("a"), { ...base, done: { a: "x" } }), "already handled");
assert.strictEqual(AP.blockReason(mk("a"), { ...base, contacted: { user_a: { at: 1 } } }), "this person was already contacted");

const posts = { n: mk("n", { firstSeen: now - 1000 }), o: mk("o", { firstSeen: now - 50000 }), old: mk("old", { firstSeen: since - 5 }), mod: mk("mod", { firstSeen: now - 90000, distinguished: "moderator" }) };
assert.strictEqual(AP.pickNext(posts, base).id, "o", "oldest new find goes first");
assert.strictEqual(AP.pickNext({ old: posts.old, mod: posts.mod }, base), null, "nothing eligible means nothing sent");
assert.strictEqual(AP.pickNext({}, base), null);

// --- the Claude screen ------------------------------------------------------
assert.strictEqual(AP.screenedByClaude({ ai: { model: "template+slots", fit: "yes", dm_long: "x" } }), true);
assert.strictEqual(AP.screenedByClaude({ ai: { model: "claude-sonnet-5", fit: "yes" } }), true);
assert.strictEqual(AP.screenedByClaude({ ai: { model: "claude-sonnet-5", fit: "no" } }), false, "a no from Claude is a no");
assert.strictEqual(AP.screenedByClaude({ ai: { model: "on-device" } }), false);
assert.strictEqual(AP.screenedByClaude({ ai: { model: "claude-chrome" } }), false);
assert.strictEqual(AP.screenedByClaude({}), false);
assert.strictEqual(AP.dmText({}), "", "no Claude draft, no DM");
assert.strictEqual(AP.dmText({ ai: { dm_short: " short " } }), "short");
assert.strictEqual(AP.dmText({ ai: { dm_long: "long", dm_short: "short" } }), "long");

// --- status -----------------------------------------------------------------
const s = AP.statusText({ on: true, log: [{ what: "DM sent", who: "bob" }] }, { sentToday: 3, cap: 25 }, 2);
assert.ok(/ON/.test(s) && /3 of 25/.test(s) && /waiting: 2/.test(s) && /u\/bob/.test(s));
assert.ok(/OFF/.test(AP.statusText({ on: false }, null)));
assert.strictEqual(AP.clip("a  b   c", 10), "a b c");
assert.strictEqual(AP.clip("abcdefghij", 5).length, 5);

console.log("autopilot-test: all passed");
