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
// an agency ban is a ban, including the "except approved vendors" form that
// r/MedSpa uses — and it outranks a weekly promo thread, because a weekly
// thread does not make anyone an approved vendor
assert.strictEqual(V.promoFromRules([{ short_name: "No Marketing Agencies (Except Approved Vendors)", description: "" }]).promo, "no");
assert.match(V.promoFromRules([{ short_name: "No Marketing Agencies (Except Approved Vendors)" }]).why, /approved vendor/);
assert.strictEqual(V.promoFromRules([{ short_name: "No agencies", description: "Agencies are not allowed. Self-promotion belongs in the weekly thread." }]).promo, "no");
assert.strictEqual(V.promoFromRules([{ short_name: "Vendors", description: "Approved vendors only." }]).promo, "no");
// the board stores rules trimmed to {name, what}; both shapes must read the same
assert.strictEqual(V.promoFromRules([{ name: "No self-promotion", what: "Do not advertise your services here." }]).promo, "no");
// the weekly reading wins over the blanket one, because it is the more specific
assert.strictEqual(V.promoFromRules([{ short_name: "No self-promotion", description: "No self-promotion except in the weekly promo thread." }]).promo, "weekly");

// ---- offers written in the studio ---------------------------------------
assert.strictEqual(V.OFFER_ANGLES.length, 10);
assert.strictEqual(new Set(V.OFFER_ANGLES.map((a) => a.key)).size, 10);
const madeOk = { posture: "free", name: "Free local pack report", gift: "a grid of where you rank across your city and who owns the squares you lose", ask: "business name and city", risk: "it is yours whether or not we ever speak again", spots: 10 };
assert.deepStrictEqual(V.offerChecks(madeOk), []);
assert.match(V.offerChecks({ ...madeOk, ask: "book a call with me" }).join(" | "), /asks for a call/);
assert.match(V.offerChecks({ ...madeOk, ask: "your email address" }).join(" | "), /email or a form/);
assert.match(V.offerChecks({ ...madeOk, gift: "a free chat" }).join(" | "), /too vague/);
assert.match(V.offerChecks({ ...madeOk, name: "Our $500 package" }).join(" | "), /packages|should not name a price/);
assert.match(V.offerChecks({ ...madeOk, spots: 400 }).join(" | "), /not believable/);
// an offer written in the studio is usable by the calendar the moment it is kept
const made = V.offerFromDraft({ posture: "free", name: "Free call-tracking setup", angle: "done_free", who: "roofers", gift: "call tracking installed on your existing ads so you can see which ones ring", ask: "the name of the business", risk: "yours to keep running whatever you decide next", spots: 5, channel: "google_ads_seo", why_it_works: "nobody knows which ad rings" }, 0);
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



// ---- an offer does not have to be free ----------------------------------
assert.strictEqual(V.POSTURES.length, 5);
assert.deepStrictEqual(V.POSTURES.map((p) => p.key), ["free", "guaranteed", "results", "credited", "swap"]);
// the shipped bench must itself pass, and must not be six free audits
for (const o of V.OFFERS) {
  assert.ok(o.posture, o.key + " has no posture");
  assert.deepStrictEqual(V.offerChecks(o), [], o.key + " fails its own checks");
}
const shipped = V.offerSpread(V.OFFERS);
assert.ok(shipped.ok, "the shipped offers are not spread: " + shipped.why);
assert.ok(shipped.kinds >= 4, "only " + shipped.kinds + " postures across ten offers");
assert.ok(shipped.free <= 5, shipped.free + " of the ten are simply free");
// money belongs where the posture puts it, and nowhere else
const money = { posture: "guaranteed", name: "Rebuild with a guarantee", who: "roofers", gift: "you pay $400 and we rebuild the campaign", ask: "the business name", risk: "if the calls do not rise in 30 days you get every penny back", spots: 5 };
assert.deepStrictEqual(V.offerChecks(money), []);
assert.match(V.offerChecks({ ...money, risk: "we will try our best" }).join(" | "), /what happens when the result does not arrive/);
assert.match(V.offerChecks({ ...money, posture: "free" }).join(" | "), /should not name a price/);
assert.match(V.offerChecks({ ...madeOk, posture: "guaranteed" }).join(" | "), /has to say what is paid/);
assert.match(V.offerChecks({ ...madeOk, posture: "results" }).join(" | "), /what triggers payment/);
assert.match(V.offerChecks({ ...madeOk, posture: "credited" }).join(" | "), /comes off the first invoice/);
assert.match(V.offerChecks({ ...madeOk, posture: "swap" }).join(" | "), /what they give instead of money/);
assert.strictEqual(V.offerSpread([{ posture: "free" }, { posture: "free" }, { posture: "free" }]).ok, false);

// ---- five offers written for one room ----------------------------------
const roomItem = V.ROOM_OFFER_SCHEMA.properties.offers.items;
assert.ok(roomItem.required.includes("fit_here"));
assert.ok(roomItem.required.includes("posture"));
const roomSys = V.roomOfferSystem({ name: "a Bangkok team" });
assert.match(roomSys, /exactly five/);
assert.match(roomSys, /It does not have to be free/);
for (const p of V.POSTURES) assert.ok(roomSys.includes(p.name), "the prompt never mentions " + p.name);
// a room that never allows an offer is told the offer must live in a comment
const quiet = V.roomOfferUser("dentistry", V.campaign("chair_time"), {}, {});
assert.match(quiet, /r\/dentistry/);
assert.match(quiet, /never allows an offer post/);
assert.match(quiet, /underneath somebody else's thread/);
assert.match(quiet, /dental, orthodontic/);
const loud = V.roomOfferUser("Roofing", V.campaign("trade_lock"), {}, { members: 40000, online: 300 });
assert.ok(!/never allows an offer post/.test(loud), "a room that takes posts was told it does not");
assert.match(loud, /40,000 members, 300 online/);

// ---- improving one ------------------------------------------------------
assert.match(V.improveSystem({}), /Return one offer, not five/);
const weak = { name: "Free audit", posture: "free", gift: "an audit", ask: "your link", risk: "none", spots: 10 };
const iu = V.improveUser(weak, "make it paid, free looks cheap", "Roofing", { wins: "12 to 61 calls" });
assert.match(iu, /It is for r\/Roofing\./, "the subreddit name came out wrong");
assert.match(iu, /fails these checks/);
assert.match(iu, /make it paid, free looks cheap/);
assert.match(iu, /12 to 61 calls/);
// with no note it still has something to work from
assert.match(V.improveUser(weak, "", { sub: "medspa" }, {}), /make your own judgement/);
assert.match(V.improveUser(weak, "", { sub: "medspa" }, {}), /It is for r\/medspa\./);


// ---- reading a room before posting in it --------------------------------
const NOWB = Date.UTC(2026, 5, 1, 12);
const post = (o) => V.classifyPromoPost({ id: "x", author: "a", subreddit: "s", permalink: "/p", score: 5, num_comments: 3, created_utc: (NOWB - (o.ageH || 100) * 3600000) / 1000, ...o }, NOWB);
assert.strictEqual(post({ title: "Free Google audit for 10 roofers, drop your link" }).kind, "offer");
assert.strictEqual(post({ title: "Free Google audit for 10 roofers, drop your link" }).survived, true);
assert.strictEqual(post({ title: "Free audit", selftext: "[removed]" }).removed, true);
assert.strictEqual(post({ title: "Free audit", selftext: "[removed]" }).survived, false);
assert.strictEqual(post({ title: "Free audit", author: "[deleted]" }).removed, true);
assert.strictEqual(post({ title: "Free audit", removed_by_category: "moderator" }).removed, true);
// a post from an hour ago has not survived anything yet
assert.strictEqual(post({ title: "Free audit for ten of you", ageH: 2 }).tooNew, true);
assert.strictEqual(post({ title: "Free audit for ten of you", ageH: 2 }).survived, false);
assert.strictEqual(post({ title: "What four months of SEO did to one clinic", selftext: "we went from 12 to 61 calls" }).kind, "case");
assert.strictEqual(post({ title: "I run a marketing agency in Leeds, AMA" }).kind, "ama");
assert.strictEqual(post({ title: "Slow month, anyone else?", selftext: "our agency has been quiet" }).kind, "service");
assert.strictEqual(post({ title: "Best drill for roofing?" }), null, "an ordinary post is not precedent");
assert.ok(V.PROBE_QUERIES.length >= 10);

// the verdict: rules outrank precedent, always
const V1 = V.briefVerdict({ rule: { promo: "no", why: "its own rules ban marketing agencies unless you are an approved vendor" },
  precedent: { offer: 8, survivedOffer: 8, removedOffer: 0, case: 0, survivedCase: 0 } });
assert.strictEqual(V1.verdict, "never");
assert.strictEqual(V1.blocked, true, "an agency ban must block posting even when eight such posts survived");
assert.strictEqual(V.briefVerdict({ rule: { promo: "no", why: "no self-promotion" }, precedent: {} }).verdict, "comments");
assert.strictEqual(V.briefVerdict({ rule: { promo: "no", why: "no self-promotion" }, precedent: {} }).blocked, true);
assert.strictEqual(V.briefVerdict({ rule: { promo: "weekly", why: "weekly thread" }, precedent: {} }).verdict, "weekly");
assert.strictEqual(V.briefVerdict({ rule: { promo: "weekly", why: "weekly thread" }, precedent: {} }).blocked, false);
assert.strictEqual(V.briefVerdict({ precedent: { offer: 5, survivedOffer: 4, removedOffer: 1, case: 2, survivedCase: 2 } }).verdict, "ok");
assert.strictEqual(V.briefVerdict({ precedent: { offer: 3, survivedOffer: 0, removedOffer: 3 } }).verdict, "risky");
assert.match(V.briefVerdict({ precedent: { offer: 1, survivedOffer: 0, removedOffer: 1 } }).reasons.join(" "), /one was removed/);
assert.strictEqual(V.briefVerdict({ precedent: {} }).verdict, "untested");
assert.match(V.briefVerdict({ precedent: {} }).reasons[0], /no precedent/);

// ---- what Claude is asked, and what it is not allowed to get away with --
assert.match(V.rulesSystem(), /approved vendors only/);
assert.match(V.rulesSystem(), /Quote the deciding sentence exactly/);
const RULES = [{ name: "No Marketing Agencies", what: "Agencies may not post unless they are approved vendors." }, { name: "Be civil", what: "No personal attacks." }];
const ru = V.rulesUser("medspa", { title: "MedSpa owners", members: 3300, submitText: "Read the rules first" }, RULES, [post({ title: "Free audit", selftext: "[removed]" })]);
assert.match(ru, /r\/medspa/);
assert.match(ru, /Agencies may not post/);
assert.match(ru, /Read the rules first/);
assert.match(ru, /\[REMOVED\]/);
assert.match(V.rulesUser("x", {}, [], []), /publishes no rules/);
assert.match(V.rulesUser("x", {}, RULES, []), /Nothing like our post has been tried/);
// a quote that is not in the rules we sent is an invention, not a rule
assert.deepStrictEqual(V.rulesChecks({ may_post: "no", quote: "Agencies may not post unless they are approved vendors.", plain: "Agencies cannot post here at all unless the moderators have approved them as a vendor.", shape: "Answer questions in the comments instead.", watch: "rule one" }, RULES), []);
assert.match(V.rulesChecks({ may_post: "no", quote: "No promotion of any kind is permitted at any time", plain: "x".repeat(40), shape: "y".repeat(30), watch: "z" }, RULES).join(" | "), /paraphrased or invented/);
assert.match(V.rulesChecks({ may_post: "maybe", quote: "", plain: "x".repeat(40), shape: "y".repeat(30), watch: "z" }, RULES).join(" | "), /whether we may post/);
assert.deepStrictEqual(V.rulesChecks({ may_post: "yes", quote: "", plain: "x".repeat(40), shape: "y".repeat(30), watch: "z" }, RULES), [], "an empty quote is allowed when no rule addresses it");


// ---- the fit matrix: which offer may go into which room -----------------
const OFF0 = V.offer("gbp_audit");
const ROOMS = ["Roofing", "Contractor", "medspa", "smallbusiness", "HVAC"].map((x) => V.TARGETS.find((t) => t.sub === x));
const BRIEFS = {
  medspa: { verdict: { blocked: true, headline: "Do not post here", reasons: ["its own rules ban marketing agencies"] }, counts: {} },
  Roofing: { verdict: { blocked: false }, counts: { survivedOffer: 4, removedOffer: 0, recent: 100, recentRemoved: 3, survivedCase: 1 } },
  Contractor: { verdict: { blocked: false }, counts: { survivedOffer: 0, removedOffer: 2, recent: 100, recentRemoved: 20 } },
};
const CHAIN = V.fitChain(OFF0, ROOMS, { briefs: BRIEFS, ledger: { "gbp_audit|smallbusiness": { at: 1, survived: true } },
  checked: { Roofing: { members: 40000, online: 300 } }, campaignRooms: ROOMS.map((r) => r.sub), campaignNiche: "roofers hvac plumbers contractors" });
const cell = (sub) => CHAIN.find((c) => c.sub === sub);
// a written ban is a hard no whatever the score would have been
assert.strictEqual(cell("medspa").state, "red");
assert.strictEqual(cell("medspa").allowed, false);
// a room that never takes an offer post is a no as well
assert.strictEqual(cell("HVAC").state, "red");
assert.match(cell("HVAC").why.join(" "), /does not take an offer post/);
// four survivors is the best cell, and it comes first
assert.strictEqual(cell("Roofing").state, "green");
assert.strictEqual(CHAIN[0].sub, "Roofing");
assert.match(cell("Roofing").why.join(" "), /4 offer posts are still standing/);
// everything removed and nothing standing is not somewhere to run it
assert.strictEqual(cell("Contractor").state, "amber");
assert.match(cell("Contractor").why.join(" "), /every offer post tried here was removed/);
// the same offer never goes back into a room it already ran in
assert.strictEqual(cell("smallbusiness").state, "amber");
assert.match(cell("smallbusiness").why.join(" "), /repeat it somewhere new/);
// and never back into one where it was removed
const removedHere = V.fitScore(OFF0, ROOMS[0], { brief: BRIEFS.Roofing, used: { removed: true } });
assert.strictEqual(removedHere.state, "red");
assert.match(removedHere.why.join(" "), /was removed/);
// an offer pulled twice anywhere stops being scheduled at all
assert.strictEqual(V.fitScore(OFF0, ROOMS[0], { brief: BRIEFS.Roofing, health: { removed: 2, retired: true } }).state, "red");
assert.strictEqual(V.offerHealth("k", { "k|a": { removed: true }, "k|b": { removed: true }, "k|c": { survived: true } }).retired, true);
assert.strictEqual(V.offerHealth("k", { "k|a": { removed: true }, "k|c": { survived: true } }).retired, false);
assert.strictEqual(V.offerHealth("k", {}).used, 0);
// an unread room is neither promised nor condemned
const unread = V.fitScore(OFF0, ROOMS[0], {});
assert.match(unread.why.join(" "), /has not been read yet/);
// the chain is ordered: everything runnable before everything that is not
const ranks = CHAIN.map((c) => V.FIT_STATES[c.state].rank);
assert.deepStrictEqual(ranks, ranks.slice().sort((a, b) => b - a), "the chain is out of order");

// ---- learning the shape that survived, without lying about who we are ---
const SHAPE = { stance: "They are practitioners inside the trade. An outside team stands on volume instead: how many of these businesses it has worked across.",
  gives: "a whole system, step by step", asks: "nothing",
  structure: "opens with a number from a real account, then five numbered findings, then a question",
  length: "700 to 1000 words", avoid: "the removed ones offered spots and asked for links",
  opening: "I have rebuilt attribution for 11 clinics this year and two numbers predicted revenue every time.", confidence: "low" };
assert.deepStrictEqual(V.shapeChecks(SHAPE), []);
assert.match(V.shapeChecks({ ...SHAPE, opening: "I am the CMO of a med spa doing $350K a month." }).join(" | "), /inside the trade/);
assert.match(V.shapeChecks({ ...SHAPE, opening: "I'm the owner of a busy clinic." }).join(" | "), /inside the trade/);
assert.match(V.shapeChecks({ ...SHAPE, stance: "Present yourself as an owner in the trade." }).join(" | "), /someone we are not/);
assert.match(V.shapeChecks({ ...SHAPE, stance: "Pose as a customer asking a question." }).join(" | "), /someone we are not/);
assert.match(V.shapeChecks({ ...SHAPE, confidence: "certain" }).join(" | "), /how much evidence/);
assert.match(V.shapeSystem({}), /never describe a stance they cannot honestly take/i);
assert.match(V.shapeSystem({}), /Never suggest claiming to be an owner/);
// no evidence means no instruction, rather than an invented one
assert.strictEqual(V.shapeBlock({ ...SHAPE, confidence: "none" }), "");
assert.match(V.shapeBlock(SHAPE), /thin evidence/);
assert.match(V.shapeBlock({ ...SHAPE, confidence: "high" }), /What actually survives in this room:/);
assert.match(V.shapeBlock(SHAPE), /must read as one/);
// and it reaches the post writer
assert.match(V.postUser(V.TARGETS.find((t) => t.sub === "medspa"), "gbp_audit", "result_story", {}, "", { shape: SHAPE }), /What actually survives in this room/);
assert.ok(!/What actually survives/.test(V.postUser(V.TARGETS.find((t) => t.sub === "medspa"), "gbp_audit", "result_story", {})), "the shape block appeared without a shape");
assert.match(V.shapeUser("medspa", [{ title: "A post", body: "body", score: 5, comments: 9, kind: "case" }], [{ title: "A removed one" }]), /still standing[\s\S]*A post[\s\S]*removed[\s\S]*A removed one/i);
assert.match(V.shapeUser("medspa", [], []), /No post like ours has survived here/);


// ---- what it costs, and which model does which job ----------------------
assert.deepStrictEqual(Object.keys(V.PRICES).sort(), ["claude-haiku-4-5", "claude-opus-5", "claude-sonnet-5"]);
// extraction is never worth the expensive model, whatever is picked
for (const j of ["rules", "shape", "ideas"]) {
  assert.strictEqual(V.jobModel(j, {}), "claude-haiku-4-5", j + " should be on the cheap model");
  assert.strictEqual(V.jobModel(j, { aiModel: "claude-opus-5" }), "claude-haiku-4-5", "picking Opus must not raise " + j);
}
// the writing jobs follow the picked model, and default to the middle one
for (const j of ["post", "offers", "answer", "improve"]) {
  assert.strictEqual(V.jobModel(j, {}), "claude-sonnet-5");
  assert.strictEqual(V.jobModel(j, { aiModel: "claude-opus-5" }), "claude-opus-5");
}
// cheap mode puts everything on the cheapest, even the writing
for (const j of Object.keys(V.JOBS)) assert.strictEqual(V.jobModel(j, { cheap: true }), "claude-haiku-4-5");
// a nonsense model choice is ignored rather than sent
assert.strictEqual(V.jobModel("post", { aiModel: "gpt-9" }), "claude-sonnet-5");
// the arithmetic: cache reads cost a tenth, writes a quarter more, output five times input
assert.strictEqual(V.cents("claude-sonnet-5", { input_tokens: 1e6 }), 200);
assert.strictEqual(V.cents("claude-sonnet-5", { output_tokens: 1e6 }), 1000);
assert.strictEqual(V.cents("claude-sonnet-5", { cache_read_input_tokens: 1e6 }), 20);
assert.strictEqual(V.cents("claude-sonnet-5", { cache_creation_input_tokens: 1e6 }), 250);
assert.strictEqual(V.cents("claude-haiku-4-5", { input_tokens: 1e6, output_tokens: 1e6 }), 600);
assert.strictEqual(V.cents("claude-opus-5", { input_tokens: 1e6, output_tokens: 1e6 }), 3000);
// the split says where the money went and which half it was
const split = V.costSplit([
  { kind: "board post", cents: 1.2, in: 900, cached: 0, out: 1100 },
  { kind: "board post", cents: 1.1, in: 200, cached: 700, out: 1000 },
  { kind: "read a room's rules", cents: 0.2, in: 1400, cached: 0, out: 300 },
]);
assert.strictEqual(split.rows[0].kind, "board post", "the split is not sorted by cost");
assert.strictEqual(split.rows[0].calls, 2);
assert.strictEqual(split.cents, 2.5);
assert.strictEqual(split.cached, 700);
assert.match(split.note, /what the model wrote/);
assert.match(V.costSplit([{ kind: "x", cents: 1, in: 9000, out: 100 }]).note, /what the model read/);
assert.strictEqual(V.costSplit([]).cents, 0);

// ---- brainstorming, and where each idea belongs -------------------------
const isys = V.ideaSystem({ name: "a Bangkok team" });
for (const t of V.POST_TYPES) assert.ok(isys.includes(t.key), "the idea prompt never mentions " + t.key);
assert.match(isys, /Only two of the eight may be magnet shapes/);
assert.match(isys, /Never propose an idea that needs us to claim we work inside the trade/);
const ideaPrompt = V.ideaUser("free map audits for roofers", V.campaign("trade_lock"), { wins: "12 to 61 calls" });
assert.match(ideaPrompt, /roofers, HVAC/);
assert.match(ideaPrompt, /free map audits for roofers/);
assert.match(ideaPrompt, /12 to 61 calls/);
assert.match(V.ideaUser("", null, {}), /No particular starting point/);
// an idea with a shape we do not have falls back rather than breaking
assert.strictEqual(V.ideaClean({ title: "x", shape: "nonsense", room_kind: "martian" }, 0).shape, "playbook");
assert.strictEqual(V.ideaClean({ title: "x", shape: "nonsense", room_kind: "martian" }, 0).kind, "biz");
assert.strictEqual(V.ideaClean({ title: "x", shape: "audit_magnet" }, 0).magnet, true);
assert.strictEqual(V.ideaClean({ title: "x", shape: "playbook" }, 0).magnet, false);
const goodIdeas = ["playbook", "result_story", "mistakes", "teardown", "comparison", "question_ask", "audit_magnet", "giveaway"]
  .map((shape, i) => V.ideaClean({ title: "A specific title about roofing work " + i, shape, room_kind: "owner" }, i));
assert.deepStrictEqual(V.ideaChecks(goodIdeas), []);
assert.match(V.ideaChecks(Array.from({ length: 5 }, (_, i) => V.ideaClean({ title: "Free audit for ten roofers now", shape: "audit_magnet" }, i))).join(" | "), /mostly offers is not a brainstorm/);
assert.match(V.ideaChecks([V.ideaClean({ title: "Go to example.com now please", shape: "playbook" }, 0), ...goodIdeas.slice(1)]).join(" | "), /link in it/);
assert.match(V.ideaChecks([V.ideaClean({ title: "hi", shape: "playbook" }, 0), ...goodIdeas.slice(1)]).join(" | "), /too short/);
assert.match(V.ideaChecks([V.ideaClean({ title: "A specific title about roofing 🚀", shape: "playbook" }, 0), ...goodIdeas.slice(1)]).join(" | "), /emoji/);
assert.deepStrictEqual(V.ideaChecks([]), ["nothing came back"]);


// ---- writing it for nothing ---------------------------------------------
const FREE_ROOM = V.TARGETS.find((t) => t.sub === "Roofing");
const FREE_PROFILE = { credit: "we run ads for 11 clinics and trades", wins: "12 calls a month to 61 in four months" };
for (const shape of ["audit_magnet", "playbook", "mistakes", "result_story", "giveaway"]) {
  const made = V.freePost({ room: FREE_ROOM, offer: V.offer("gbp_audit"), type: shape, campaign: V.campaign("trade_lock"), profile: FREE_PROFILE });
  assert.deepStrictEqual(V.postChecks(made, FREE_ROOM, shape), [], shape + " fails the same gate a written post has to pass");
  assert.ok(made.first_comment.length > 20, shape + " has no first comment");
  assert.ok(/roofing/i.test(made.title + made.body), shape + " never names the trade");
}
// no profile at all still produces something postable
assert.deepStrictEqual(V.postChecks(V.freePost({ room: FREE_ROOM, offer: V.offer("gbp_audit"), type: "playbook" }), FREE_ROOM, "playbook"), []);
// deterministic, and different seeds give different posts
const a1 = V.freePost({ room: FREE_ROOM, offer: V.offer("gbp_audit"), type: "playbook", seed: "a" });
const a2 = V.freePost({ room: FREE_ROOM, offer: V.offer("gbp_audit"), type: "playbook", seed: "a" });
const b1 = V.freePost({ room: FREE_ROOM, offer: V.offer("gbp_audit"), type: "playbook", seed: "b" });
assert.deepStrictEqual(a1, a2, "the free engine is not deterministic");
assert.notDeepStrictEqual(a1.body, b1.body, "two seeds produced the same post");
// the offer's own words reach the magnet post
const mag = V.freePost({ room: FREE_ROOM, offer: V.offer("local_pack"), type: "audit_magnet", profile: FREE_PROFILE });
assert.ok(mag.body.includes("business name and city"), "the magnet never states the ask");
assert.ok(/\b10 spots\b/.test(mag.body), "the magnet never states the number of spots");
// a trade the bank does not know still reads as a business
assert.match(V.freePost({ room: { sub: "Welding", kind: "owner", promo: "value", note: "" }, offer: V.offer("gbp_audit"), type: "playbook" }).title, /business|welding/i);
// "business" + "s" is not a word
assert.strictEqual(V.plural("business"), "businesses");
assert.strictEqual(V.plural("practice"), "practices");
assert.strictEqual(V.plural("company"), "companies");
assert.strictEqual(V.plural("firm"), "firms");
assert.strictEqual(V.plural("med spa"), "med spas");
for (const room of ["Roofing", "Contractor", "dentistry", "medspa", "Lawyertalk", "ecommerce"]) {
  const r = V.TARGETS.find((t) => t.sub === room);
  for (const shape of ["playbook", "mistakes", "result_story"]) {
    const made = V.freePost({ room: r, offer: V.offer("gbp_audit"), type: shape, campaign: V.campaign("trade_lock") });
    assert.ok(!/\bsss?\b|businesss|practicess/i.test(made.title + made.body), room + "/" + shape + " has a mangled plural: " + made.title);
  }
}
for (const c of V.CAMPAIGNS) for (const i of V.freeIdeas(c, "x")) assert.ok(!/businesss|sss/i.test(i.title), c.name + " has a mangled plural: " + i.title);

// eight free ideas, spread, and they pass the same idea checks
const fi = V.freeIdeas(V.campaign("trade_lock"), "seed");
assert.strictEqual(fi.length, 8);
assert.deepStrictEqual(V.ideaChecks(fi), []);
assert.strictEqual(new Set(fi.map((x) => x.shape)).size, 8);
assert.deepStrictEqual(V.freeIdeas(V.campaign("trade_lock"), "seed"), fi, "free ideas are not deterministic");

// ---- which country the money is in --------------------------------------
const co = (t, sub) => V.countryOf(t, sub);
assert.strictEqual(co("Spending $4k a month, my zip code area is competitive").key, "us");
assert.strictEqual(co("Ltd company in Manchester, VAT registered").key, "uk");
assert.strictEqual(co("Toronto, Ontario — what is a good postal code radius").key, "ca");
assert.strictEqual(co("Sydney, NSW, ABN registered").key, "au");
for (const k of ["us", "uk", "ca", "au"]) assert.strictEqual(V.COUNTRY[k].tier1, true);
// a low-budget market is recognised even when a dollar sign is in the text
assert.strictEqual(co("budget is 20000 INR, about $200, agency in India").key, "low");
assert.strictEqual(co("budget is 20000 INR, about $200, agency in India").tier1, false);
// a country's own room settles it outright
assert.strictEqual(co("no clues at all", "smallbusinessUK").key, "uk");
assert.strictEqual(co("no clues at all", "smallbusinessUK").sure, true);
// and silence is unknown, not a guess
assert.strictEqual(co("what colour should my logo be").key, "");
assert.strictEqual(co("what colour should my logo be").tier1, null);
// the filter keeps tier one, drops the rest, and keeps unknowns unless strict
assert.strictEqual(V.tierScore({ title: "spending $5k, zip code" }, { tier1Only: true }).keep, true);
assert.strictEqual(V.tierScore({ title: "20000 INR budget in India" }, { tier1Only: true }).keep, false);
assert.strictEqual(V.tierScore({ title: "no clues" }, { tier1Only: true }).keep, true);
assert.strictEqual(V.tierScore({ title: "no clues" }, { tier1Only: true, strict: true }).keep, false);
assert.strictEqual(V.tierScore({ title: "20000 INR budget in India" }, {}).keep, true, "the filter must do nothing when it is off");

// ---- the audit, produced for nothing ------------------------------------
assert.ok(V.AUDIT_KIT.steps.length >= 6);
assert.ok(V.AUDIT_KIT.report.length >= 6);
assert.ok(V.AUDIT_KIT.rules.length >= 4);
for (const s2 of V.AUDIT_KIT.steps) for (const f of ["do", "find", "note"]) assert.ok(s2[f] && s2[f].length > 10, "an audit step is missing " + f);
// nothing in it asks for money or an email
assert.ok(!/\$|price|charge|email/i.test(JSON.stringify(V.AUDIT_KIT.report)), "the report template asks for money or an email");
assert.match(V.AUDIT_KIT.rules.join(" "), /thread, not in a DM/);


// ---- does this offer fit these people -----------------------------------
const GBP = V.offer("gbp_audit");        // local search
const CREATIVE = V.offer("creative_pack"); // instagram / tiktok
const PLAN = V.offer("90_day_plan");     // channel "none", takes anyone
const aRoom = (x) => V.TARGETS.find((t) => t.sub === x) || { sub: x, kind: "biz" };
// the one that started this: founders have no Google Business Profile
assert.strictEqual(V.audienceOf("roastmystartup"), "founder");
assert.strictEqual(V.audienceFit(GBP, aRoom("roastmystartup")).ok, false);
assert.match(V.audienceFit(GBP, aRoom("roastmystartup")).why, /founders and makers/);
for (const s2 of ["SideProject", "indiehackers", "startups", "Business_Ideas"]) {
  assert.strictEqual(V.audienceFit(GBP, aRoom(s2)).ok, false, "a local offer was allowed into r/" + s2);
}
// marketers are never a market, whatever the offer
for (const o of [GBP, CREATIVE, PLAN]) {
  for (const s2 of ["PPC", "SEO", "marketing", "GoogleAds", "agency"]) {
    const f = V.audienceFit(o, aRoom(s2));
    assert.strictEqual(f.ok, false, o.key + " was allowed into r/" + s2);
    assert.match(f.why, /marketers and agencies/);
  }
}
// a local offer does not belong to online stores or B2B either
assert.strictEqual(V.audienceFit(GBP, aRoom("shopify")).ok, false);
assert.strictEqual(V.audienceFit(GBP, aRoom("msp")).ok, false);
// but it does belong everywhere a business has an address
for (const s2 of ["Roofing", "medspa", "dentistry", "Contractor", "sweatystartup", "smallbusiness"]) {
  assert.strictEqual(V.audienceFit(GBP, aRoom(s2)).ok, true, "a local offer was blocked from r/" + s2);
}
// a creative pack suits stores as well as local; a plain plan suits anyone
assert.strictEqual(V.audienceFit(CREATIVE, aRoom("shopify")).ok, true);
assert.strictEqual(V.audienceFit(PLAN, aRoom("msp")).ok, true);
assert.strictEqual(V.audienceFit(PLAN, aRoom("shopify")).ok, true);
// and the gate is a gate: it outranks every score the matrix could give
const wrong = V.fitScore(GBP, aRoom("roastmystartup"), { brief: { verdict: { blocked: false }, counts: { survivedOffer: 9 } }, members: 500000 });
assert.strictEqual(wrong.state, "red");
assert.strictEqual(wrong.headline, "Wrong people");
assert.ok(!V.fitChain(GBP, ["roastmystartup", "PPC", "shopify", "Roofing"].map(aRoom), {}).filter((c) => c.state !== "red").some((c) => c.sub !== "Roofing"), "a wrong-audience room reached the runnable list");

// ---- finding rooms from the evidence ------------------------------------
assert.ok(V.offerPhrases(GBP).some((p2) => /google business profile/i.test(p2)));
assert.ok(V.offerPhrases(CREATIVE).some((p2) => /instagram|tiktok|creative/i.test(p2)));
assert.ok(V.offerPhrases(GBP, true).length > V.offerPhrases(GBP).length, "widening added nothing");
const disc = V.discoverRank([
  { sub: "smallbusiness", survived: true, comments: 40, author: "a", permalink: "/1", title: "t1" },
  { sub: "smallbusiness", survived: true, comments: 22, author: "b", permalink: "/2", title: "t2" },
  { sub: "Roofing", survived: true, comments: 12, author: "a", permalink: "/3", title: "t3" },
  { sub: "juststart", removed: true, author: "c", title: "t4" },
  { sub: "juststart", removed: true, author: "c", title: "t5" },
  { sub: "BrandNewRoom", survived: true, comments: 18, author: "e", permalink: "/6", title: "t6" },
]);
assert.strictEqual(disc.rows[0].sub, "smallbusiness", "ranked wrong: " + disc.rows.map((r) => r.sub).join(","));
assert.strictEqual(disc.rows[0].posts, 2);
assert.strictEqual(disc.rows[0].authors, 2);
assert.strictEqual(disc.rows[0].rate, 100);
// a room where every one was removed ranks below every room where one stood
assert.strictEqual(disc.rows[disc.rows.length - 1].sub, "juststart");
assert.ok(disc.rows.find((r) => r.sub === "juststart").score < 0);
// rooms nobody listed are marked, and only suggested when something survived
assert.deepStrictEqual(disc.newRooms, ["BrandNewRoom"]);
assert.strictEqual(disc.rows.find((r) => r.sub === "BrandNewRoom").known, false);
assert.strictEqual(disc.rows.find((r) => r.sub === "Roofing").known, true);
// the best surviving post is kept per room, and a removed one never is
assert.strictEqual(disc.rows[0].best.comments, 40);
assert.strictEqual(disc.rows.find((r) => r.sub === "juststart").best, null);
assert.match(V.discoverRank([]).verdict, /nobody has posted anything like this/);

// ---- campaigns: one niche, its rooms, its questions ---------------------
assert.ok(V.CAMPAIGNS.length >= 6, "not enough campaigns");
assert.strictEqual(new Set(V.CAMPAIGNS.map((c) => c.key)).size, V.CAMPAIGNS.length);
for (const c of V.CAMPAIGNS) {
  assert.deepStrictEqual(V.campaignCheck(c), [], c.name + " is broken");
  assert.ok(c.name && c.name.length <= 20, c.key + " has no usable name");
  assert.ok(c.searches.length >= 5, c.name + " has too few money searches");
  assert.strictEqual(new Set(c.subs).size, c.subs.length, c.name + " lists a room twice");
  // every room it names is a real one in the bench
  for (const sub of c.subs) assert.ok(V.TARGETS.some((t) => t.sub === sub), c.name + " names r/" + sub + ", which is not in the room list");
}
// a campaign plans only into its own rooms
const trade = V.campaign("trade_lock");
const tradeRooms = V.campaignRooms(trade).filter(V.postable).map((t) => t.sub);
const tradeShape = V.campaignShape(trade);
const tradePlan = V.plan({ days: 10, perDay: tradeShape.perDay, subCoolDays: tradeShape.subCoolDays, subs: tradeRooms });
assert.ok(tradePlan.rows.filter((r) => r.sub).every((r) => tradeRooms.includes(r.sub)), "the calendar left the campaign's rooms");
assert.strictEqual(tradePlan.skipped, 0, "a trade campaign should fill every slot");
// a niche whose rooms are nearly all comments-only is told so rather than
// planning days it will only skip
const clinic = V.campaignShape(V.campaign("chair_time"));
assert.strictEqual(clinic.mode, "answer-led");
assert.strictEqual(clinic.nichePostable, 3);
assert.match(clinic.note, /answer-led/);
assert.strictEqual(V.campaignShape(trade).mode, "post-led");
// every campaign's cadence must be one its own rooms can actually carry
for (const c of V.CAMPAIGNS) {
  const sh = V.campaignShape(c);
  assert.ok(sh.subCoolDays >= 5 || sh.postable < 5, c.name + " brings a room round every " + sh.subCoolDays + " days");
  assert.ok(sh.postable >= sh.perDay * 5, c.name + " has too few rooms for " + sh.perDay + " lanes");
  const rooms = V.campaignRooms(c).filter(V.postable).map((t) => t.sub);
  const pl = V.plan({ days: 21, perDay: sh.perDay, subCoolDays: sh.subCoolDays, subs: rooms });
  assert.strictEqual(pl.skipped, 0, c.name + " skips " + pl.skipped + " slots over three weeks");
  assert.ok(pl.rows.filter((r) => r.sub).every((r) => rooms.includes(r.sub)), c.name + " planned outside its rooms");
}
// the general business rooms are shared by every campaign, because an owner
// with a marketing problem asks in r/smallbusiness as often as in their trade
for (const sub of V.SHARED_ROOMS) assert.ok(V.TARGETS.some((t) => t.sub === sub), "shared room r/" + sub + " is not in the list");
assert.ok(V.campaignRooms(trade).length > V.campaignRooms(trade, true).length, "the shared rooms were not added");

// ---- which post deserves the money -------------------------------------
const NOW = Date.UTC(2026, 5, 1, 12);
const bs = (p) => V.boostScore(p, NOW);
assert.strictEqual(bs({ comments: 26, score: 18, hot: 9, magnet: true, created: NOW - 6 * 3600000 }).verdict, "boost");
assert.strictEqual(bs({ comments: 1, score: 2, created: NOW - 8 * 3600000 }).verdict, "quiet");
assert.strictEqual(bs({ comments: 3, score: 30, created: NOW - 3 * 3600000 }).verdict, "quiet", "upvotes without comments are not worth paying for");
assert.strictEqual(bs({ comments: 30, score: 40, hot: 5, magnet: true, created: NOW - 12 * 86400000 }).verdict, "stale");
// an offer post beats a value post with the same numbers, because every extra
// reader of an offer can raise a hand
assert.ok(bs({ comments: 9, score: 9, created: NOW - 10 * 3600000, magnet: true }).score > bs({ comments: 9, score: 9, created: NOW - 10 * 3600000 }).score);
// the only number that matters
assert.strictEqual(V.boostCost({ spent: 42, commentsAtStart: 26, commentsNow: 48 }).per, 1.91);
assert.strictEqual(V.boostCost({ spent: 42, commentsAtStart: 26, commentsNow: 48 }).stop, false);
assert.strictEqual(V.boostCost({ spent: 50, commentsAtStart: 26, commentsNow: 31 }).stop, true);
assert.strictEqual(V.boostCost({ spent: 20, commentsAtStart: 5, commentsNow: 5 }).got, 0);
// spend with nothing to show for it stops too, not just expensive comments
assert.strictEqual(V.boostCost({ spent: 60, commentsAtStart: 6, commentsNow: 6 }).stop, true);
assert.strictEqual(V.boostCost({ spent: 4, commentsAtStart: 6, commentsNow: 6 }).stop, false, "four dollars in is too early to call");
assert.match(V.boostCost({ spent: 60, commentsAtStart: 6, commentsNow: 6 }).verdict, /not one comment/);
// a small budget is planned one room at a time
const bp = V.boostPlan(7, 7, { sub: "Roofing", comments: 20 });
assert.strictEqual(bp.total, 49);
assert.match(bp.room, /Roofing/);
assert.match(bp.judge, /cost per comment/);
assert.strictEqual(V.boostPlan(0, 0).daily, 7, "an empty budget falls back to the default");

console.log("v2: all checks pass — " + V.TARGETS.length + " rooms, " + V.OFFERS.length + " shipped offers on " + V.OFFER_ANGLES.length + " angles and " + V.POSTURES.length + " postures, " + V.POST_TYPES.length + " shapes, " + V.LANES.length + " lanes a day, " + V.CAMPAIGNS.length + " campaigns, " + Object.keys(V.JOBS).length + " jobs across " + Object.keys(V.PRICES).length + " models, " + V.SEARCHES.length + " money searches");
