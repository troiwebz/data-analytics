// Node unit test for v2-lib.js:  node v2-test.js
require("./v2-lib.js");
const assert = require("assert");
const V = globalThis.V2;

// ---- the rooms are real, distinct and sorted into the right kinds --------
assert.ok(V.TARGETS.length >= 180, "not enough rooms: " + V.TARGETS.length);
assert.strictEqual(new Set(V.TARGETS.map((t) => t.sub.toLowerCase())).size, V.TARGETS.length, "a subreddit is listed twice");
for (const t of V.TARGETS) {
  assert.ok(["ads", "owner", "biz"].includes(t.kind), t.sub + " has no kind");
  assert.ok(V.PROMO[t.promo], t.sub + " has no posting rule");
  assert.ok(t.note && t.note.length > 10, t.sub + " has no note");
}
assert.ok(V.TARGETS.filter((t) => t.kind === "ads").length >= 40, "too few ad-spender rooms");
assert.ok(V.TARGETS.filter((t) => t.kind === "owner").length >= 90, "too few owner rooms");
assert.ok(V.TARGETS.filter(V.postable).length >= 100, "too few rooms that take a post");

// ---- ten offers, each of which gives before it asks ---------------------
assert.strictEqual(V.OFFERS.length, 10);
assert.strictEqual(new Set(V.OFFERS.map((o) => o.key)).size, 10);
for (const o of V.OFFERS) {
  for (const f of ["name", "who", "gift", "ask", "risk"]) assert.ok(o[f] && o[f].length > 8, o.key + " is missing " + f);
  assert.ok(o.spots >= 1 && o.spots <= 20, o.key + " has a silly number of spots");
  assert.ok(!/\$\s?\d/.test(o.gift + o.ask), o.key + " quotes a price in the offer");
  assert.ok(!/book a call|hop on a call|schedule a call/i.test(o.ask), o.key + " asks for a call on the first touch");
}

// ---- post types: magnets ask, value posts do not ------------------------
assert.strictEqual(V.POST_TYPES.length, 10);
assert.ok(V.POST_TYPES.filter((t) => t.magnet).length >= 3, "not enough magnet shapes");
assert.ok(V.POST_TYPES.filter((t) => !t.magnet).length >= 6, "not enough value shapes");

// ---- the calendar: three posts a day, three rooms, three groups ---------
const p30 = V.plan({ days: 30, start: Date.UTC(2026, 0, 1) });
assert.strictEqual(p30.rows.length, 90, "30 days at three a day should be 90 posts");
assert.strictEqual(p30.perDay, 3);
assert.strictEqual(p30.skipped, 0, "the 30-day plan could not fill every slot");
assert.strictEqual(p30.rooms, 88, "almost every post should land in its own room: " + p30.rooms);
// every day hits all three groups, so the three can be compared
assert.deepStrictEqual(Object.keys(p30.groups).sort(), ["ads", "biz", "owner"]);
assert.ok(Math.max(...Object.values(p30.groups)) - Math.min(...Object.values(p30.groups)) <= 1, "the groups are not balanced: " + JSON.stringify(p30.groups));
// only the offer lane ever sells, and only on its cadence
assert.ok(p30.magnets >= 12 && p30.magnets <= 18, "wrong number of offer posts: " + p30.magnets);
assert.ok(p30.values > p30.magnets * 3, "not enough posts that sell nothing");
for (const r of p30.rows.filter((x) => x.magnet)) assert.strictEqual(r.lane, "offer", "a magnet escaped the offer lane");
// a day never repeats a room or a shape
const byDay = {};
for (const r of p30.rows) { if (!r.sub) continue; (byDay[r.day] = byDay[r.day] || []).push(r); }
for (const [d, rows] of Object.entries(byDay)) {
  assert.strictEqual(rows.length, 3, "day " + d + " does not have three slots");
  assert.strictEqual(new Set(rows.map((r) => r.sub)).size, 3, "day " + d + " posts twice in one room");
  assert.strictEqual(new Set(rows.map((r) => r.typeKey)).size, 3, "day " + d + " repeats a shape");
  assert.strictEqual(new Set(rows.map((r) => r.group)).size, 3, "day " + d + " misses a group");
  assert.deepStrictEqual(rows.map((r) => new Date(r.at).getHours()), [9, 14, 19], "the three slots are not spread across the day");
}
// no room twice inside the cooling window
const seen = {};
for (const r of p30.rows) {
  if (!r.sub) continue;
  assert.ok(!seen[r.sub] || r.at - seen[r.sub] >= 14 * 86400000, "r/" + r.sub + " comes round too fast");
  seen[r.sub] = r.at;
}
// an offer never lands in a room that does not take offers
for (const r of p30.rows.filter((x) => x.magnet)) assert.ok((V.PROMO[r.promo] || {}).rank >= 1, "an offer was planned into r/" + r.sub + ", which is comments-only");
// fewer lanes on request
assert.strictEqual(V.plan({ days: 5, perDay: 1 }).rows.length, 5);
assert.strictEqual(V.plan({ days: 5, perDay: 2 }).rows.filter((r) => r.lane === "talk").length, 0);
// all ten offers get an airing before any repeats
const offerOrder = V.plan({ days: 40, start: Date.UTC(2026, 0, 1) }).rows.filter((r) => r.magnet).map((r) => r.offerKey);
assert.strictEqual(new Set(offerOrder.slice(0, 10)).size, 10, "the offers repeat before all ten have run");
// same inputs, same calendar
assert.deepStrictEqual(V.plan({ days: 10, start: 111 }).rows, V.plan({ days: 10, start: 111 }).rows);
// asking for only comments-only rooms is refused, not silently ignored
assert.ok(V.plan({ days: 5, subs: ["SEO", "bigseo"] }).error, "a plan of comments-only rooms should refuse");

// ---- the comment-to-post ratio -----------------------------------------
assert.strictEqual(V.ratio(10, 60).ok, true);
assert.strictEqual(V.ratio(10, 40).ok, false);
assert.strictEqual(V.ratio(10, 40).short, 10);

// ---- a room's own rules beat our guess ----------------------------------
assert.strictEqual(V.promoFromRules([{ short_name: "No self-promotion", description: "Do not advertise your services here." }]).promo, "no");
assert.strictEqual(V.promoFromRules([{ short_name: "Promo", description: "Self-promotion belongs in the weekly promo thread." }]).promo, "weekly");
assert.strictEqual(V.promoFromRules([{ short_name: "Promo", description: "Self-promotion is allowed as long as it is relevant." }]).promo, "ok");
assert.strictEqual(V.promoFromRules([{ short_name: "Be civil", description: "No personal attacks." }]), null, "an unrelated rule should not move a room");
assert.strictEqual(V.promoFromRules([]), null);
// the board stores rules trimmed to {name, what}; both shapes must read the same
assert.strictEqual(V.promoFromRules([{ name: "No self-promotion", what: "Do not advertise your services here." }]).promo, "no");
// the weekly reading wins over the blanket one, because it is the more specific
assert.strictEqual(V.promoFromRules([{ short_name: "No self-promotion", description: "No self-promotion except in the weekly promo thread." }]).promo, "weekly");

// ---- offers written in the studio ---------------------------------------
assert.strictEqual(V.OFFER_ANGLES.length, 10);
assert.strictEqual(new Set(V.OFFER_ANGLES.map((a) => a.key)).size, 10);
const madeOk = { name: "Free local pack report", gift: "a grid of where you rank across your city and who owns the squares you lose", ask: "business name and city", risk: "it is yours whether or not we ever speak again", spots: 10 };
assert.deepStrictEqual(V.offerChecks(madeOk), []);
assert.match(V.offerChecks({ ...madeOk, ask: "book a call with me" }).join(" | "), /asks for a call/);
assert.match(V.offerChecks({ ...madeOk, ask: "your email address" }).join(" | "), /email or a form/);
assert.match(V.offerChecks({ ...madeOk, gift: "a free chat" }).join(" | "), /too vague/);
assert.match(V.offerChecks({ ...madeOk, name: "Our $500 package" }).join(" | "), /money or a package/);
assert.match(V.offerChecks({ ...madeOk, spots: 400 }).join(" | "), /not believable/);
// an offer written in the studio is usable by the calendar the moment it is kept
const made = V.offerFromDraft({ name: "Free call-tracking setup", angle: "done_free", who: "roofers", gift: "call tracking installed on your existing ads so you can see which ones ring", ask: "the name of the business", risk: "no invoice until it is running", spots: 5, channel: "google_ads_seo", why_it_works: "nobody knows which ad rings" }, 0);
assert.deepStrictEqual(V.offerChecks(made), []);
V.POOL = [made];
assert.strictEqual(V.offer(made.key).name, "Free call-tracking setup");
assert.strictEqual(V.allOffers().length, 11);
assert.ok(V.plan({ days: 8, offers: [made.key] }).rows.filter((r) => r.magnet).every((r) => r.offerKey === made.key), "the calendar ignored the chosen offer");
V.POOL = [];
const osys = V.offerSystem({ name: "a Bangkok team" });
assert.match(osys, /risk sits on us/);
assert.match(osys, /Pay only on results/);
assert.match(V.offerUser("we run ads for clinics", { wins: "12 to 61 calls" }), /12 to 61 calls/);

// ---- the draft gate ----------------------------------------------------
const body = "We took a clinic from 12 calls a month to 61 in four months. ".repeat(14) + "\nWhat would you have done differently?";
const room = V.TARGETS.find((t) => t.sub === "PPC");
assert.deepStrictEqual(V.postChecks({ title: "What four months of local search did to one dental clinic's phone", body }, room, "result_story"), []);
const fails = (draft, type) => V.postChecks(draft, room, type || "result_story").join(" | ");
assert.match(fails({ title: "ok title that is long enough here", body: body.replace("What would you have done differently?", "Visit example.com to learn more?") }), /link or a domain/);
assert.match(fails({ title: "ok title that is long enough here", body: body + " 🚀" }), /emoji/);
assert.match(fails({ title: "ok title that is long enough here", body: body.replace(/\?$/, ".") }), /does not end on a question/);
assert.match(fails({ title: "ok title that is long enough here", body: "In today's digital landscape " + body }), /machine-written/);
assert.match(fails({ title: "ok title that is long enough here", body: body + " DM me for details?" }), /must not pitch/);
assert.match(fails({ title: "short", body }), /title is too short/);
// a magnet must ask for a comment, never a DM
assert.match(fails({ title: "Free audit for ten local businesses this week", body: "I will look at ten profiles. " .repeat(20) + "DM me your link?" }, "audit_magnet"), /must be a public comment/);
assert.deepStrictEqual(V.postChecks({ title: "Free audit for ten local businesses this week", body: "I will look at ten Google profiles this week and post what I find right here. ".repeat(6) + "Drop your Maps link below. Who wants one?" }, room, "audit_magnet"), []);

// ---- who is actually buying --------------------------------------------
const b = (t, x) => V.classifyBuyer(t, x || "");
assert.strictEqual(b("Spending $6k a month on Meta ads for my clinic and the leads dried up").badge, "spending");
assert.strictEqual(b("Spending $6k a month on Meta ads for my clinic and the leads dried up").amount, "$6k");
assert.strictEqual(b("Our agency charged us for six months and delivered nothing").tier, 3);
assert.strictEqual(b("I run a roofing company, how do I show up on Google Maps").badge, "owner");
assert.strictEqual(b("Anyone know a good CPL benchmark for google ads").badge, "asking");
// the people with no money are the ones v1 kept chasing
assert.strictEqual(b("Looking for a technical co-founder for my app, equity only").keep, false);
assert.strictEqual(b("[For hire] I will build your website cheap").keep, false);
assert.strictEqual(b("I'm a student, what is SEO").keep, false);
assert.strictEqual(b("what is a good colour for a logo").keep, false);
// searches hunt money, not ideas
assert.ok(V.SEARCHES.length >= 20, "not enough money searches");
assert.strictEqual(new Set(V.SEARCHES).size, V.SEARCHES.length, "a search is listed twice");
assert.ok(!V.SEARCHES.some((q) => /co-?founder|equity/i.test(q)), "a co-founder search survived into v2");

// ---- the public answer -------------------------------------------------
const answer = { answer: "Check your search terms report first. " .repeat(12) + "What is your target cost per booked job?" };
assert.deepStrictEqual(V.answerChecks(answer), []);
assert.match(V.answerChecks({ answer: "Happy to help, DM me. " .repeat(20) }).join(" | "), /points at a DM/);
assert.match(V.answerChecks({ answer: "We offer full service management. " .repeat(20) }).join(" | "), /pitches/);
assert.match(V.answerChecks({ answer: "yes do that" }).join(" | "), /too thin/);

// ---- the prompts carry the room, the shape and the offer ----------------
const sys = V.postSystem({ name: "a Bangkok team" });
assert.match(sys, /No links/);
assert.match(sys, /a Bangkok team/);
const magnetUser = V.postUser(room, "gbp_audit", "audit_magnet", { credit: "we run ads for 11 clinics" });
assert.match(magnetUser, /r\/PPC/);
assert.match(magnetUser, /Free Google Business Profile audit/);
assert.match(magnetUser, /never to DM/);
assert.match(magnetUser, /we run ads for 11 clinics/);
const valueUser = V.postUser(room, "gbp_audit", "result_story", {});
assert.match(valueUser, /makes no offer at all/);
assert.ok(!/Spots:/.test(valueUser), "a value post was given a spot count");
// the comments-only rule reaches the model
assert.match(V.postUser(V.TARGETS.find((t) => t.sub === "SEO"), "gbp_audit", "playbook", {}), /Comments only/);

// ---- the paid plan is a plan, not a paragraph ---------------------------
assert.strictEqual(V.ADS_PLAN.stages.length, 4);
assert.ok(V.ADS_PLAN.rules.length >= 5);
assert.ok(V.ADS_PLAN.stages[0].spend === "$0", "the paid plan should start at zero spend");

console.log("v2: all checks pass — " + V.TARGETS.length + " rooms, " + V.OFFERS.length + " shipped offers on " + V.OFFER_ANGLES.length + " angles, " + V.POST_TYPES.length + " shapes, " + V.LANES.length + " lanes a day, " + V.SEARCHES.length + " money searches");
