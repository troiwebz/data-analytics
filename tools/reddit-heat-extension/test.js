// Node unit test for lib.js:  node test.js
require("./lib.js");
const assert = require("assert");
const H = globalThis;

// keyword text → categorised entries
const entries = H.parseKeywordText('# Offers — priced\n"for hire" website\n\n# Demand\n"need a website"\nplumber website\n');
assert.deepStrictEqual(entries, [{ kw: '"for hire" website', group: "Offers" }, { kw: '"need a website"', group: "Demand" }, { kw: "plumber website", group: "Demand" }]);
const defaults = H.parseKeywordText(H.DEFAULT_KEYWORD_TEXT);
assert.ok(defaults.length >= 250, "default keyword list should be large: " + defaults.length);
assert.deepStrictEqual(Array.from(new Set(defaults.map((e) => e.group))), ["Offers", "Freebies", "Value bombs", "Demand", "AI-era demand", "Niches"]);

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
assert.strictEqual(H.classifyPost("Random title", "[For Hire] I build websites, see body"), "offer");
assert.strictEqual(H.classifyPost("Random title", "[For Hire] in body, no web context"), "other");
assert.strictEqual(H.classifyPost("Photo of my cat", "cute"), "other");
assert.strictEqual(H.classifyPost("Built my site with Lovable, checkout is broken, who can fix it?", ""), "demand");
assert.strictEqual(H.classifyPost("Can anyone finish my vibe coded app? Budget $400", ""), "demand");
assert.strictEqual(H.classifyPost("Wix site not showing up on Google, help", ""), "demand");
assert.strictEqual(H.classifyPost("My web designer ghosted me after the deposit", ""), "demand");
// job seekers and job postings must not be demand
assert.strictEqual(H.classifyPost("Looking for a Digital Marketing / Performance Marketing Job – Immediate Joiner", "I have 4 years of experience working across Website Growth. If you know of any openings or are hiring, please DM me."), "job");
assert.strictEqual(H.classifyPost("Open to remote opportunities, 3 yrs React dev", "resume attached"), "job");
assert.strictEqual(H.classifyPost("[Hiring] Senior Frontend Engineer, full-time, $120k salary + equity", "job description: 5+ years experience required"), "job");
assert.strictEqual(H.classifyPost("Looking for a co-founder for my startup", ""), "other");
assert.strictEqual(H.classifyPost("How much should I charge my roommate for rent?", ""), "other");
// but a real web ask with a hiring tag is still demand
assert.strictEqual(H.classifyPost("[Hiring] Need a landing page for our ad campaign, budget $400", ""), "demand");
assert.ok(!H.keepPost({ type: "job", keywords: [] }));
assert.ok(!H.keepPost({ type: "other", keywords: ["restaurant website"], title: "Best restaurant in town?", body: "looking for dinner" }));
assert.ok(H.keepPost({ type: "other", keywords: ["restaurant website"], title: "Restaurant website menu page keeps breaking", body: "" }));
assert.ok(!H.keepPost({ type: "demand", keywords: ["x"], ignored: true }));

// opportunity: fresh, budget, ask, unanswered
const nowO = Date.now();
assert.strictEqual(H.opportunityScore({ type: "demand", title: "Need someone to fix my Lovable site, budget $300?", created: nowO - 86400000, comments: 0 }, nowO), 13 + 6 + 3 + 6);
assert.strictEqual(H.opportunityScore({ type: "offer", title: "x", created: nowO, comments: 0 }, nowO), 0);
assert.ok(H.opportunityScore({ type: "demand", title: "old thread", created: nowO - 60 * 86400000, comments: 40 }, nowO) <= 3);

// title phrases
const ph = H.titlePhrases(["Need someone to fix my Lovable site", "Lovable site broken after deploy", "fix my lovable site please", "Random cat photo"]);
assert.ok(ph.some(([p]) => p === "lovable site"), JSON.stringify(ph));

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
assert.ok(csv.split("\n")[0].startsWith("leadScore,opportunity,heat,type,groups,sub,price"));
assert.ok(csv.includes('"a | b"') && csv.includes('"Offers"') && csv.includes("[buyer] u/a:"));

console.log("lib.js: all tests passed");

// campaign ideas
const demandPosts = {
  a: { id: "a", type: "demand", title: "Built my site with Lovable, checkout is broken, who can fix it? Budget $300", body: "", sub: "lovable", created: Date.now() - 86400000, comments: 2, url: "u1" },
  b: { id: "b", type: "demand", title: "Lovable site not working after deploy, need someone to finish it", body: "", sub: "lovable", created: Date.now() - 2 * 86400000, comments: 0, url: "u2" },
  c: { id: "c", type: "demand", title: "Wix site not showing up on Google, help?", body: "", sub: "Wix", created: Date.now() - 3 * 86400000, comments: 12, url: "u3" },
  d: { id: "d", type: "offer", title: "[For Hire] Websites for $500", body: "", sub: "forhire", created: Date.now(), comments: 17, url: "u4" },
};
const ideas = H.buildIdeas(demandPosts, ["smallbusiness"]);
assert.strictEqual(ideas.length, 10);
assert.strictEqual(ideas[0].key, "ai-rescue");
assert.strictEqual(ideas[0].matched, 2);
assert.ok(ideas[0].targets.includes("lovable") && ideas[0].targets.includes("smallbusiness"));
assert.strictEqual(ideas[0].opps[0].id, "a");
assert.ok(ideas.some((i) => i.key === "google-visibility" && i.matched === 1));
assert.ok(ideas.every((i) => i.title && i.body && i.price));
console.log("campaign ideas: ok");

// sweep queue
const sq = H.buildSweepQueue(["forhire", "lovable"], ["need", "nope"], 5, "new");
assert.strictEqual(sq.length, 3);
assert.strictEqual(sq[0].url, "https://old.reddit.com/r/forhire/new/");
assert.strictEqual(sq[2].kind, "query");
assert.ok(sq[2].url.startsWith("https://old.reddit.com/search?q=") && sq[2].url.endsWith("&sort=new"));
assert.strictEqual(H.sweepUrl({ kind: "sub", sub: "Wix" }, "week"), "https://old.reddit.com/r/Wix/top/?t=week");
assert.ok(H.CANDIDATE_SUBS.reduce((n, g) => n + g.subs.length, 0) >= 55);
console.log("sweep: ok");

// keyword sweep + demand by keyword
const kq = H.buildKeywordSweepQueue(H.parseKeywordText('# Demand\n"need a website"\n"who can build"\n"fix my website"\n"how much" website\n"website quote"\n# Offers\n"for hire" website'), ["Demand"], 3, "relevance", "week", 4);
assert.strictEqual(kq.length, 2);
assert.strictEqual(kq[0].keywords.length, 4);
assert.ok(kq[0].url.includes("&sort=relevance&t=week"), kq[0].url);
assert.ok(decodeURIComponent(kq[0].url).includes('("need a website") OR ("who can build")'));
assert.strictEqual(H.sweepUrl({ kind: "sub", sub: "Wix" }, "top", "week"), "https://old.reddit.com/r/Wix/top/?t=week");
assert.strictEqual(H.sweepUrl({ kind: "query", q: "x" }, "new"), "https://old.reddit.com/search?q=x&sort=new");
const dbk = H.demandByKeyword({ a: { type: "demand", created: Date.now() - 86400000, keywords: ['"need a website"'], comments: 3, signals: { lead: 1, buyer: 2 } }, b: { type: "demand", created: Date.now() - 40 * 86400000, keywords: ['"need a website"'], comments: 9 }, c: { type: "offer", created: Date.now(), keywords: ['"need a website"'] } }, 7);
assert.deepStrictEqual(dbk, [{ kw: '"need a website"', posts: 1, replies: 3, comments: 3 }]);
console.log("keyword sweep: ok");

// value-bomb replies
const rp = H.valueBombReply({ title: "Built my site with Lovable, checkout is broken, who can fix it?", body: "Budget $300, on Lovable" }, { name: "Noah" });
assert.ok(rp.startsWith('Re: "Built my site with Lovable, checkout is broken, who can fix it"'), rp.slice(0, 80));
assert.ok(rp.includes("Since you're on Lovable") && rp.includes("$300 budget") && rp.includes("1. Open the live site") && rp.includes("– Noah"));
assert.ok(!/https?:\/\//.test(rp.replace(/pagespeed\.web\.dev|tinypng\.com|squoosh\.app|business\.google\.com|who\.is/g, "")), "no links except free tools");
assert.strictEqual(H.pickPlaybook({ title: "My web designer ghosted me after the deposit" }).key, "ghosted");
assert.strictEqual(H.pickPlaybook({ title: "How much should a 5 page site cost?" }).key, "pricing");
assert.strictEqual(H.pickPlaybook({ title: "Wix site not showing up on Google" }).key, "google");
assert.strictEqual(H.pickPlaybook({ title: "Need a website for my HVAC company" }).key, "need-site");
console.log("replies: ok");
