// Node unit test for lib.js:  node test.js
require("./lib.js");
const assert = require("assert");
const H = globalThis;

// keyword text → categorised entries
const entries = H.parseKeywordText('# Offers — priced\n"for hire" website\n\n# Demand\n"need a website"\nplumber website\n');
assert.deepStrictEqual(entries, [{ kw: '"for hire" website', group: "Offers" }, { kw: '"need a website"', group: "Demand" }, { kw: "plumber website", group: "Demand" }]);
const defaults = H.parseKeywordText(H.DEFAULT_KEYWORD_TEXT);
assert.ok(defaults.length >= 250, "default keyword list should be large: " + defaults.length);
assert.deepStrictEqual(Array.from(new Set(defaults.map((e) => e.group))), ["Offers", "Freebies", "Value bombs", "Demand", "Niches"]);

// compiled matching: every quoted phrase / bare word must appear
const compiled = H.compileKeywords(entries);
assert.deepStrictEqual(H.matchKeywords(compiled, "[For Hire] I build your WEBSITE fast"), { keywords: ['"for hire" website'], groups: ["Offers"] });
assert.deepStrictEqual(H.matchKeywords(compiled, "Plumber here, need a website for my company").keywords, ['"need a website"', "plumber website"]);
assert.deepStrictEqual(H.matchedKeywords(['"free website"', "AMA web design"], "free website for you"), ['"free website"']);

// URLs for both transports
assert.strictEqual(H.listingUrl("forhire", "", 100, false), "https://old.reddit.com/r/forhire/new.json?limit=100&raw_json=1");
assert.strictEqual(H.listingUrl("forhire", "t3_abc", 100, true), "https://oauth.reddit.com/r/forhire/new?limit=100&raw_json=1&after=t3_abc");
assert.ok(H.commentsUrl("/r/forhire/comments/x/y/", true).startsWith("https://oauth.reddit.com/r/forhire/comments/x/y/?limit=300"));
assert.ok(H.searchUrl("forhire", "a OR b", "new", "month", 100, false).includes("/search.json?q=a%20OR%20b&restrict_sr=on"));

// post typing
assert.strictEqual(H.classifyPost("[For Hire] Websites for 500$", ""), "offer");
assert.strictEqual(H.classifyPost("I'll build a free website for the first 5 businesses that comment", ""), "freebie");
assert.strictEqual(H.classifyPost("[Hiring] Need a website for my bakery, budget $800", ""), "demand");
assert.strictEqual(H.classifyPost("Here's how I got 12 web design clients from Reddit in 30 days", ""), "value");
assert.strictEqual(H.classifyPost("How much should a 5 page site cost?", ""), "demand");
assert.strictEqual(H.classifyPost("Random title", "[For Hire] in body"), "offer");
assert.strictEqual(H.classifyPost("Photo of my cat", "cute"), "other");

// price extraction
assert.strictEqual(H.extractPrice("[FOR HIRE] Websites for 500$"), "$500");
assert.strictEqual(H.extractPrice("Clean, Modern Website for $99\nPrice: Starting at $99"), "from $99");
assert.strictEqual(H.extractPrice("modern websites in 7 days, starting from $599"), "from $599");
assert.strictEqual(H.extractPrice("WordPress Designer & Developer $25/hr"), "$25/hr");
assert.strictEqual(H.extractPrice("Full-Stack | From €300 / $20/hr"), "from €300");
assert.strictEqual(H.extractPrice("Free website for your business"), "free");
assert.strictEqual(H.extractPrice("Senior Product Designer, no price here"), "");

// comment classification
assert.strictEqual(H.classifyComment("How much for a 3 page site for my restaurant?", "bob", "op"), "buyer");
assert.strictEqual(H.classifyComment("DM'd you", "bob", "op"), "lead");
assert.strictEqual(H.classifyComment("Interested! Can I get one for my shop?", "bob", "op"), "lead");
assert.strictEqual(H.classifyComment("This is a race to the bottom lol", "bob", "op"), "heckle");
assert.strictEqual(H.classifyComment("Thanks all, fully booked for this month", "OP", "op"), "closed");
assert.strictEqual(H.classifyComment("Sure, sending details now", "op", "op"), "op");
assert.strictEqual(H.classifyComment("[deleted]", "x", "op"), "other");

// comment summary over a Reddit listing shape, with OP replying to a buyer
const listing = [{}, { data: { children: [
  { kind: "t1", data: { author: "a", body: "Can you build a Shopify store? What's your price?", replies: { data: { children: [
    { kind: "t1", data: { author: "op", body: "Yes, $600. All slots are taken after this one, closed for July." } } ] } } } },
  { kind: "t1", data: { author: "b", body: "dm'd you" } },
  { kind: "t1", data: { author: "c", body: "why so cheap, red flag" } },
  { kind: "t1", data: { author: "d", body: "nice portfolio" } },
] } }];
const s = H.summariseComments(listing, "op");
assert.deepStrictEqual([s.total, s.buyer, s.lead, s.heckle, s.op, s.opReplies, s.closed, s.uniqueCommenters], [5, 1, 1, 1, 1, 1, true, 4]);
assert.strictEqual(s.replies.length, 3);
assert.ok(s.replies[0].startsWith("[buyer] u/a:"));

// crawl record from a listing child, keep/drop rule
const child = { data: { name: "t3_x", subreddit: "forhire", title: "[For Hire] Websites for 500$", author: "z", created_utc: 1700000000, permalink: "/r/forhire/comments/x/y/", selftext: "Developer here. I need portfolio pieces.", score: 7, num_comments: 17, upvote_ratio: 0.8, is_self: true } };
const rec = H.postFromChild(child, "forhire", H.compileKeywords(defaults));
assert.strictEqual(rec.type, "offer");
assert.strictEqual(rec.price, "$500");
assert.deepStrictEqual(rec.keywords, ['"for hire" website', '"need portfolio pieces"']);
assert.ok(rec.groups.includes("Offers") && rec.groups.includes("Freebies"));
assert.strictEqual(rec.body, "Developer here. I need portfolio pieces.");
assert.ok(H.keepPost(rec));
assert.ok(!H.keepPost(H.postFromChild({ data: { name: "t3_y", title: "Photo of my cat", selftext: "cute", created_utc: 1 } }, "pics", compiled)));

// lead score and heat
const now = Date.now();
const post = { created: now - 3 * 86400000, score: 9, comments: 12, signals: { ...s } };
assert.strictEqual(H.leadScore(post), 1 * 5 + 1 * 4 + 1 * 2 + 20 + 4 - 2);
const snaps = [{ t: now - 3 * 86400000, score: 1, comments: 0 }, { t: now - 40 * 3600000, score: 4, comments: 2 }, { t: now, score: 9, comments: 12 }];
const h = H.heatScore(post, snaps, now);
assert.strictEqual(h.dComments, 10);
assert.strictEqual(h.dScore, 5);
assert.strictEqual(h.heat, 10 * 3 + 5 + H.leadScore(post));
assert.strictEqual(H.heatScore({ created: now - 3600000, score: 5, comments: 4 }, [{ t: now, score: 5, comments: 4 }], now).dComments, 4);

// row + csv
const row = H.toRow({ ...post, ...rec, groups: ["Offers"], keywords: ["a", "b"] }, snaps, now);
assert.strictEqual(row.leadScore, H.leadScore(post));
const csv = H.toCsv([row]);
assert.ok(csv.split("\n")[0].startsWith("leadScore,heat,type,groups,sub,price"));
assert.ok(csv.includes('"a | b"') && csv.includes('"Offers"') && csv.includes("[buyer] u/a:"));

console.log("lib.js: all tests passed");
