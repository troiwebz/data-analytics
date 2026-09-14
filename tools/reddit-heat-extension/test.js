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
// sellers phrased as questions must be offers, not demand
assert.strictEqual(H.classifyPost("Need a website? I'll build you a 5-page site for $499", ""), "offer");
assert.strictEqual(H.classifyPost("Need a website for your business? I build them fast and affordable", ""), "offer");
assert.strictEqual(H.classifyPost("Looking for clients: web developer available, $25/hr", ""), "offer");
assert.strictEqual(H.classifyPost("I'm a web designer taking on 3 new clients this month", "DM me for rates"), "offer");
assert.strictEqual(H.classifyPost("Anyone need a website built? DM me for a free quote", ""), "offer");
assert.strictEqual(H.classifyPost("Website not showing on Google? I can fix that", "starting at $99"), "offer");
assert.strictEqual(H.classifyPost("Looking for a web developer? We build landing pages that convert", ""), "offer");
assert.strictEqual(H.classifyPost("Small business owners: how much are you paying for your website?", "I build websites and I'm curious. My rates start at $300."), "offer");
// genuine buyers still demand
assert.strictEqual(H.classifyPost("Need a website for my HVAC company, what's a fair budget?", ""), "demand");
assert.strictEqual(H.classifyPost("We need someone to fix our Shopify checkout, budget $200", ""), "demand");
assert.strictEqual(H.classifyPost("Looking for a web developer to rebuild my restaurant site", "current one is on Wix and broken"), "demand");
assert.strictEqual(H.classifyPost("How much should I pay for a 5 page website?", "got quoted $3000"), "demand");
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
assert.ok(csv.split("\n")[0].startsWith("status,statusAt,note,leadScore,opportunity,heat,type,groups,sub,price"));
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

// co-founder hunt
const cf = (t, b) => H.classifyCofounder(t, b || "");
assert.strictEqual(cf("Looking for a technical co-founder for my fitness app", "I cannot code. Equity only, no budget yet.").role, "technical");
assert.strictEqual(cf("Looking for a technical co-founder for my fitness app", "Equity only, no budget yet.").hasBudget, false, "no budget yet must not read as budget");
assert.strictEqual(cf("Looking for a technical co-founder for my fitness app", "Equity only, no budget yet.").equityOnly, true);
assert.strictEqual(cf("Need a marketing co-founder for my SaaS", "We do $4,000 MRR with 30 paying customers.").role, "marketing");
assert.strictEqual(cf("Need a marketing co-founder for my SaaS", "We do $4,000 MRR with 30 paying customers.").hasBudget, true);
assert.strictEqual(cf("[Seeking] Technical cofounder for AI-powered resume builder", "MVP is live.").keep, true, "a resume-builder product is not a job seeker");
assert.strictEqual(cf("Non-technical founder looking for a developer to build my marketplace", "Idea stage.").keep, true);
assert.strictEqual(cf("[FOR HIRE] Senior full-stack dev available for co-founder roles", "portfolio: x.com").keep, false);
assert.strictEqual(cf("Looking for a marketing job - immediate joiner", "notice period 15 days").keep, false);
assert.strictEqual(cf("What is your favourite CRM?", "Just curious.").keep, false);
assert.strictEqual(cf("[opportunity] FoodSignals - web app for glp-1 users, looking for beta testers", "Specific questions I need answered: is the onboarding clear? Would love a technical co-founder eventually.").why, "wants testers, not a partner");
assert.strictEqual(cf("Beta testers wanted for my fitness app", "free lifetime access for feedback").keep, false);

// the venture, not the ask, and never doubled
assert.strictEqual(H.huntThing({ title: "Looking for a technical co-founder for my fitness app" }), "your fitness app");
assert.strictEqual(H.huntThing({ title: "[Seeking] Technical cofounder for AI-powered resume builder" }), "your AI-powered resume builder");
assert.strictEqual(H.huntThing({ title: "Need a marketing co-founder for my SaaS (B2B)" }), "your SaaS");
assert.strictEqual(H.huntThing({ title: "Anyone want to join my startup?", body: "Building a scheduling tool for gyms that saves time." }), "your scheduling tool");
assert.strictEqual(H.huntThing({ title: "Looking for more product ideas", body: "" }), "what you're building", "filler titles never become 'your more product ideas'");
assert.strictEqual(H.huntThing({ title: "Looking for advice on finding a cofounder", body: "" }), "what you're building");
// the poster who IS the builder is a competitor, not a lead
assert.strictEqual(cf("Looking for more product ideas", "I can handle the technical side, especially AI/ML and backend. If someone is looking for a technical co-founder, feel free to reach out.").why, "is a builder themselves");
assert.strictEqual(cf("Need a marketing co-founder", "I am a full-stack developer, built the MVP alone, need someone for growth.").why, "is a builder themselves");
assert.strictEqual(cf("Looking for a technical co-founder", "I am not technical. I have an idea for a fitness app and cannot build it.").keep, true, "non-technical founders stay");
assert.strictEqual(cf("Cofounder Available: DTC marketing & Full Stack Tech Development", "AI workflows, automation, CRM. I'm less interested in pure agency retainer work and more in equity / co-founder / JV where I own the growth + product systems end-to-end. Ideal fit: health / wellness. If you're a founder in SG / AU / HK looking for a tech / growth co-founder, drop a comment or DM — happy to share more.").why, "offering to join", "someone offering himself is not a lead");
assert.strictEqual(cf("[Offering] Senior dev looking to join an early-stage team", "10 years experience").keep, false);
assert.strictEqual(cf("Need a technical co-founder for my clinic booking app", "I run two clinics. Ideal partner: someone who can build and ship.").keep, true, "'ideal partner' from a founder is still a lead");
assert.strictEqual(H.huntAiClean({ ...{ public_reply: "x\nCheck your DM.", dm_short: "s".repeat(300), dm_long: "l".repeat(900), why: "w" }, fit: "no", fit_reason: "offering himself" }).fit, "no");
assert.strictEqual(cf("Need a developer co-founder", "I have 10 years in sales. My technical skills are zero.").keep, true, "'my technical skills are zero' is not builder voice");

const hp = { title: "Looking for a technical co-founder for my fitness app", body: "x", author: "jane", role: "technical", stage: "idea", equityOnly: true, hasBudget: false, created: Date.now() - 3600000, comments: 4 };
const short = H.huntShortReply(hp, { name: "Troi" });
assert.strictEqual(short.split("\n").length, 2, "the public reply is exactly two lines:\n" + short);
assert.strictEqual(short.split("\n")[1], "Check your DM.");
assert.ok(short.length < 420, "the public reply stays short: " + short.length);
assert.ok(!/https?:\/\//.test(short) && !/\$\d/.test(short), "no links and no price in public");
const opts = H.huntShortOptions(hp, { name: "Troi" });
assert.strictEqual(opts.length, 1, "one public reply, not a menu");
assert.strictEqual(opts[0].split("\n").length, 2);
assert.strictEqual(opts[0].split("\n")[1], "Check your DM.");
assert.ok(!/https?:\/\/|\$\d/.test(opts[0]));
assert.ok(opts[0].includes("Equity-only"), "equity-only posts lead with the equity line");
assert.ok(H.huntShortOptions({ ...hp, equityOnly: false, hasBudget: true, stage: "revenue" }, {})[0].includes("pay for execution"), "funded posts lead with money");
for (let v = 0; v < 8; v += 1) assert.strictEqual(H.huntShortReply(hp, {}, v).split("\n").length, 2);
const dm = H.huntDM(hp, { name: "Troi", role: "web developer" });
assert.ok(dm.length > 500 && dm.length < 1600, "the long DM is an introduction, not a letter: " + dm.length);
assert.ok(dm.startsWith("Hi Jane,") && dm.includes("— Troi, web developer"));
assert.ok(!/\$\d|\d+%/.test(dm), "no price and no percentage in the first DM: " + dm);
assert.ok(dm.includes("share the income and the expenses") && /open (?:for you|to)\?/.test(dm), "the shape is the pitch, then the one question");
assert.ok(!/48 hours|prototype|no charge|costs you nothing|free build/i.test(dm), "no free work promised: " + dm);
assert.ok(H.huntComposeUrl(hp, dm).startsWith("https://www.reddit.com/message/compose/?to=jane&subject="));
assert.ok(H.huntScore({ ...hp, created: Date.now() }) > H.huntScore({ ...hp, created: Date.now() - 5 * 86400000 }), "fresher posts rank higher");
assert.ok(H.huntScore({ ...hp, hasBudget: true, equityOnly: false }) > H.huntScore(hp), "money ranks higher than equity-only");
console.log("co-founder hunt: ok");

// DM close: the free offer, then the private channel
const dm2 = H.huntDM(hp, { name: "Troi", role: "web developer", whatsapp: "+91 98765 43210", telegram: "@troibuilds" });
assert.ok(dm2.includes("How we work") && dm2.includes("income and expenses") && !/\$\d/.test(dm2), "every DM says how we work, without a price");
assert.ok(dm2.includes("https://wa.me/919876543210") && dm2.includes("https://t.me/troibuilds"), "both private channels appear");
assert.ok(dm2.indexOf("wa.me") > dm2.indexOf("How we work"), "the channel comes after how we work");
assert.ok(dm2.trim().endsWith("— Troi, web developer"));
const dm3 = H.huntDM({ ...hp, role: "marketing" }, { name: "Troi", whatsapp: "https://wa.me/1555" });
assert.ok(dm3.includes("growth team") && dm3.includes("https://wa.me/1555") && !dm3.includes("t.me"));
assert.ok(H.huntDM(hp, {}).includes("Reply here and I'll get started"), "no channels set: falls back to replying on Reddit");
assert.strictEqual(H.waLink("98765 43210"), "https://wa.me/9876543210");
assert.strictEqual(H.waLink("123"), "");
assert.strictEqual(H.tgLink("troi"), "https://t.me/troi");
assert.strictEqual(H.waLink(""), "");
// the 3-line public reply stays clean: no offer, no links
const short2 = H.huntShortReply(hp, { name: "Troi", whatsapp: "+919876543210" });
assert.ok(!/wa\.me|t\.me|48 hours|free/.test(short2) && short2.split("\n").length === 2);
console.log("dm offer + private channel: ok");

// names read like a person wrote them
assert.strictEqual(H.huntName("jane_builds92"), "Jane");
assert.strictEqual(H.huntName("Noah_Basera"), "Noah");
assert.strictEqual(H.huntName("throwaway_8812"), "there", "junk handles get no fake first name");
assert.strictEqual(H.huntName("xX_99_Xx"), "there");
assert.strictEqual(H.huntName("Acceptable_Win_1921"), "there", "Reddit's generated handles are not names");
assert.strictEqual(H.huntName("Fragrant_Audience215"), "there");
assert.strictEqual(H.huntName("Fantastic_Feeling123"), "there");
assert.strictEqual(H.huntName("jane_builds92"), "Jane", "a real first name still works");
assert.strictEqual(H.huntName(""), "there");

// three lengths of the same letter, same offer and close in each
const sizes = ["short", "long", "long"].map((s) => H.huntDM(hp, { name: "Noah", whatsapp: "+919000000000" }, s));
assert.ok(sizes[0].length < sizes[2].length, "short < long: " + sizes.map((x) => x.length));
assert.ok(sizes[0].length < 900, "the short one is actually short: " + sizes[0].length);
sizes.forEach((d) => { assert.ok(d.startsWith("Hi Jane,")); assert.ok(/wa\.me\/919000000000/.test(d)); assert.ok(!/\$\d/.test(d), "no price in the DM"); });
const builtDm = H.huntDM({ ...hp, stage: "building", body: "We already have a working product with paying recruiters." }, { name: "Noah" }, "short");
assert.ok(/working product/.test(builtDm) && !/2 to 4 weeks|first version/.test(builtDm), "a built product is not told to build v1: " + builtDm);
assert.strictEqual(H.huntThing({ title: "Looking for a Technical Co-Founder", body: "We started with an ATS for recruiters. This is not an idea-stage project, we have a working product. I'm looking for someone to build this long term with me." }), "your ats");
assert.strictEqual(H.huntThing({ title: "Looking for a co-founder for my company", body: "Our company does things." }), "what you're building", "'company' is not a thing");
assert.ok(!/\n1\. /.test(sizes[0]) && !/\n1\. /.test(sizes[2]), "short and long are introductions, no numbered plan");

// the reading of a post
const syn = H.huntSynopsis({ title: "Looking for a technical co-founder for my fitness app", body: "I run a gym business in Bangalore. 400 users on the waitlist. Equity only (10%), nights and weekends.", role: "technical", stage: "idea", equityOnly: true, sub: "startups" });
assert.strictEqual(syn.who, "company owner");
assert.strictEqual(syn.wants, "someone to build it");
assert.strictEqual(syn.country, "India");
assert.strictEqual(syn.money, "equity only, no cash");
assert.strictEqual(syn.equity, "10% on offer");
assert.strictEqual(syn.traction, "400 users");
assert.strictEqual(syn.commit, "part-time / side project");
assert.strictEqual(H.huntWho({ title: "x", body: "I freelance as a designer" }), "freelancer");
assert.strictEqual(H.huntCountry({ title: "cofounder wanted", body: "we are based in Austin, Texas" }), "United States");
assert.strictEqual(H.huntCountry({ title: "cofounder wanted", body: "no location given" }), "");
console.log("synopsis, names, dm sizes: ok");

// AI prompt: built from the post, offer and contact line passed through
const aiP = { title: "Looking for a technical co-founder for my fitness app", body: "I run a gym in Bangalore. 400 people on the waitlist. Equity only.", author: "jane_builds92", sub: "startups", role: "technical", stage: "idea", equityOnly: true, hasBudget: false };
const pr = H.huntAiPrompt(aiP, { name: "Noah", role: "web developer", whatsapp: "+91 98765 43210" });
assert.ok(pr.system.includes("Noah") && pr.system.includes("partner team") && pr.system.includes("exactly two lines"));
assert.ok(pr.user.includes("400 people on the waitlist") && pr.user.includes("r/startups") && pr.user.includes("Hi Jane,") && !pr.system.includes("Jane"));
assert.ok(pr.user.includes("GREETING (first line of every DM, verbatim)\nHi Jane,"), "the greeting is fixed, in the user turn so the system prompt stays cacheable");
assert.ok(pr.user.includes("https://wa.me/919876543210"), "the contact line is passed verbatim");
assert.ok(pr.user.includes("HOW WE WORK") && !/\$\d/.test(pr.user.split("HOW WE WORK")[1] || ""), "how we work is passed through without a price");
assert.ok(pr.system.includes("NO PRICE, NO PERCENTAGE") && pr.system.includes("READ THE STAGE"));
assert.ok(pr.system.includes("never offer free work"), "no free work in the instructions");
assert.strictEqual(pr.schema.required.length, 6, "three answers, why, and the fit verdict");
// cleaner: rejects links, prices, one-liners, stubs
const good = { public_reply: "Line one about the gym.\nLine two, free thing, in your DM.", dm_short: "x".repeat(300), dm_long: "z".repeat(900), why: "the waitlist" };
assert.ok(H.huntAiClean(good));
assert.strictEqual(H.huntAiClean({ ...good, public_reply: "only one line" }).public_reply, "only one line\nCheck your DM.", "one line is fine: the close is added");
assert.strictEqual(H.huntAiClean({ ...good, public_reply: "see https://x.com\nline two" }), null);
assert.strictEqual(H.huntAiClean({ ...good, public_reply: "costs $500\nline two" }), null);
assert.strictEqual(H.huntAiClean({ ...good, dm_long: "short" }), null);
assert.strictEqual(H.huntAiClean(good).public_reply.split("\n").length, 2);
assert.strictEqual(H.huntAiClean({ ...good, public_reply: "a\nb\nc" }).public_reply, "a\nCheck your DM.", "extra lines are dropped");
assert.ok(pr.system.includes('exactly "Check your DM."') && pr.schema.properties.public_reply.description.includes("Check your DM."), "the public reply ends with Check your DM.");
assert.deepStrictEqual(H.huntAiClean({ ...good, public_reply: ("word ".repeat(45)).trim() + "\nCheck your DM." }), { tooLong: true }, "a long public reply is sent back for a shorter one");
console.log("ai prompt + cleaner: ok");

// inbox: prompt, cleaner, template fallback
const thr = { id: "t4_a", with: "jane_builds92", messages: [
  { id: "t4_a", author: "Noah_Basera", mine: true, body: "Hi Jane, saw your post…", at: 1000 },
  { id: "t4_b", author: "jane_builds92", mine: false, body: "Thanks! How much would you charge to build the first version?", at: 2000 },
] };
const ip = H.inboxAiPrompt(thr, { sub: "startups", title: "Looking for a technical co-founder for my fitness app", body: "equity only" }, { name: "Noah", whatsapp: "+919000000000" }, H.INBOX_PLAN_DEFAULT);
assert.ok(ip.system.includes("50% of income") && ip.system.includes("No upfront") && ip.system.includes("HIRE OUR TEAM") && ip.system.includes("one step at a time") && ip.system.includes("THE REPLY MUST FIT THEIR LAST MESSAGE"));
assert.ok(ip.user.includes("THEM (") && ip.user.includes("How much would you charge") && ip.user.includes("THEIR ORIGINAL POST"));
assert.ok(ip.system.includes("wa.me/919000000000"));
assert.deepStrictEqual(ip.schema.required, ["reply", "stage", "verdict", "budget", "share_ok", "note"]);
assert.strictEqual(H.inboxAiClean({ reply: "x".repeat(80), stage: "offer", note: "n" }).stage, "offer");
assert.strictEqual(H.inboxAiClean({ reply: "x".repeat(80), stage: "bogus", note: "n" }).stage, "answer", "unknown stage falls back");
assert.strictEqual(H.inboxAiClean({ reply: "too short", stage: "offer", note: "n" }), null);
const tr = H.inboxTemplateReply(thr, { name: "Noah", whatsapp: "+919000000000" }, H.INBOX_PLAN_DEFAULT);
assert.strictEqual(tr.stage, "offer", "a price question gets the offer");
assert.ok(tr.reply.startsWith("Hi Jane,") && tr.reply.includes("No upfront") && tr.reply.includes("50% of income") && tr.reply.includes("50/50") && tr.reply.includes("wa.me"), "default deal is a 50/50 income + expense split:\n" + tr.reply);
assert.strictEqual(H.inboxTemplateReply({ ...thr, messages: [thr.messages[0], { ...thr.messages[1], body: "Can we do this for equity only? I have no money" }] }, {}).stage, "cut");
assert.strictEqual(H.inboxTemplateReply({ ...thr, messages: [thr.messages[0], { ...thr.messages[1], body: "ok sounds good, I have a budget, how do we start" }] }, {}).stage, "close");
assert.strictEqual(H.inboxTemplateReply({ ...thr, messages: [thr.messages[0], { ...thr.messages[1], body: "It is a gym app, first users are my members" }] }, {}).stage, "qualify");
assert.ok(H.inboxTemplateReply(thr, { deal: { mode: "upfront_share", upfront: 500 } }).reply.includes("$500"), "the upfront comes from the deal terms");
assert.ok(!H.inboxTemplateReply(thr, { deal: { upfront: 500 } }).reply.includes("$500"), "no upfront is mentioned in split mode");
console.log("inbox: ok");

// plan links + the LinkedIn / call template
const planned = H.inboxPlanFor(H.INBOX_PLAN_DEFAULT, { linkedin: "https://linkedin.com/in/noah", whatsapp: "+919000000000" });
assert.ok(planned.includes("https://linkedin.com/in/noah") && planned.includes("a WhatsApp call on https://wa.me/919000000000") && !planned.includes("{{"));
assert.ok(H.inboxPlanFor(H.INBOX_PLAN_DEFAULT, { booking: "https://cal.com/noah" }).includes("my booking link https://cal.com/noah"));
const askLi = H.inboxTemplateReply({ ...thr, messages: [thr.messages[0], { ...thr.messages[1], body: "Would you be open for a short meet today? Also could you share your LinkedIn?" }] }, { name: "Noah", linkedin: "https://linkedin.com/in/noah", whatsapp: "+919000000000" });
assert.strictEqual(askLi.stage, "answer");
assert.ok(askLi.reply.includes("LinkedIn: https://linkedin.com/in/noah") && askLi.reply.includes("wa.me") && /expenses to start, yes or no/.test(askLi.reply), askLi.reply);
console.log("plan links: ok");

assert.ok(H.inboxTemplateReply({ ...thr, messages: [thr.messages[0], { ...thr.messages[1], body: "Hello, how are you? Where are you based?" }] }, { name: "Noah", location: "Bangkok, Thailand" }).reply.includes("based in Bangkok, Thailand"));
assert.ok(H.inboxPlanFor(H.INBOX_PLAN_DEFAULT, { location: "Bangkok" }).includes("Bangkok"));
console.log("location: ok");

// partner-team instructions: verdicts, cut, terms
const dealP = { name: "Noah", whatsapp: "+919000000000", deal: { mode: "upfront_share", upfront: 500, share: 25, expenseShare: 40 } };
const planX = H.inboxPlanFor(H.INBOX_PLAN_DEFAULT, dealP);
assert.ok(planX.includes("$500 upfront") && planX.includes("25% of income") && planX.includes("split 40/60") && planX.includes("upfront + income share") && !planX.includes("{{"), planX.slice(0, 300));
assert.ok(H.INBOX_PLAN_DEFAULT.includes("HIRE OUR TEAM") && H.INBOX_PLAN_DEFAULT.includes("SHARE EXPENSES AND INCOME") && H.INBOX_PLAN_DEFAULT.includes("VERDICT"));
const two = (body) => ({ ...thr, messages: [thr.messages[0], { ...thr.messages[1], body }] });
const cutR = H.inboxTemplateReply(two("I can't pay anything right now, it would be equity only"), dealP);
assert.strictEqual(cutR.stage, "cut"); assert.strictEqual(cutR.verdict, "not_interested"); assert.ok(/isn't something we do/.test(cutR.reply));
const offerR = H.inboxTemplateReply(two("What are your terms? How does it work?"), dealP);
assert.strictEqual(offerR.stage, "offer"); assert.ok(offerR.reply.includes("$500 upfront") && offerR.reply.includes("25% of income") && offerR.reply.includes("40/60"));
const closeR = H.inboxTemplateReply(two("Yes, I have a budget and I'm ok with a share"), dealP);
assert.strictEqual(closeR.stage, "close"); assert.strictEqual(closeR.verdict, "interested"); assert.ok(closeR.reply.includes("25% of income"));
const eqR = H.inboxTemplateReply(two("How much equity do you want?"), dealP);
assert.strictEqual(eqR.stage, "objection"); assert.ok(/budget to start/.test(eqR.reply));
const qR = H.inboxTemplateReply(two("It's a gym app for my members"), dealP);
assert.strictEqual(qR.stage, "qualify", "after our first message, the next answer asks the two questions");
assert.ok(H.INBOX_STAGES.some((s) => s.key === "cut") && H.INBOX_STAGES.some((s) => s.key === "qualify"));
assert.deepStrictEqual(H.inboxAiClean({ reply: "x".repeat(80), stage: "cut", verdict: "not_interested", budget: "no", share_ok: "no", note: "n" }).verdict, "not_interested");
assert.strictEqual(H.inboxAiClean({ reply: "x".repeat(80), stage: "offer", verdict: "bogus", note: "n" }).verdict, "unclear");
console.log("partner instructions: ok");

assert.strictEqual(H.huntAiClean({ ...good, public_reply: "One specific line about the gym.\nSomething else entirely" }).public_reply, "One specific line about the gym.\nCheck your DM.", "line two is always Check your DM.");
console.log("single public reply: ok");

// Stage-aware DM: someone with a working product is never told to build a first version.
{
  const prof = { name: "Noah", role: "VA team lead", whatsapp: "+910000000000" };
  const raw = { title: "Looking for a technical co-founder for my fintech app", body: "I have an MVP with 200 users and some revenue. Need someone to take over the product and grow it.", author: "maxb", subreddit: "cofounder" };
  const p = { ...raw, ...H.classifyCofounder(raw.title, raw.body) };
  assert.strictEqual(p.stage, "building");
  for (const size of ["short", "long"]) {
    const d = H.huntDM(p, prof, size);
    assert.ok(!/first version|2 to 4 weeks|v1\b/i.test(d), size + " DM must not pitch a first build to someone who has a product:\n" + d);
    assert.ok(/runs and grows|running and growing|already have something working/i.test(d), size + " DM should talk about running and growing");
    assert.ok(!/[$%]/.test(d), size + " DM has no price or percentage");
    assert.ok(!/that paragraph/.test(d), "no dangling reference to a paragraph we never asked for");
  }
  const idea = { ...raw, body: "Just an idea for now, nothing built yet, need someone to build it." };
  const pi = { ...idea, ...H.classifyCofounder(idea.title, idea.body) };
  assert.ok(/first version/i.test(H.huntDM(pi, prof, "long")), "idea stage still talks about the first version");
  const own = H.huntDM(p, { ...prof, deal: { teamDoes: "does the customer support" } }, "long");
  assert.ok(own.includes("does the customer support"), "the user's own team wording always wins");
}
console.log("stage-aware dm: ok");

// The deal dropdown: one shape drives the DM, the AI prompt, the plan and the inbox replies.
{
  const prof = { name: "Noah", whatsapp: "+910000000000" };
  const raw = { title: "Looking for a technical co-founder for my gym app", body: "Just an idea for now, need someone to build it.", author: "sam_k", subreddit: "cofounder" };
  const p = { ...raw, ...H.classifyCofounder(raw.title, raw.body) };
  assert.deepStrictEqual(H.DEAL_MODES.map((m) => m.key), ["split", "upfront_share", "share", "upfront"]);
  assert.strictEqual(H.DEAL_DEFAULT.mode, "split"); assert.strictEqual(H.DEAL_DEFAULT.share, 50); assert.strictEqual(H.DEAL_DEFAULT.expenseShare, 50);
  const dflt = H.huntDM(p, prof, "long");
  assert.ok(/share the income and the expenses with you, equally/.test(dflt), "default DM says the split in words:\n" + dflt);
  assert.ok(!/[$%]/.test(dflt), "no numbers in the first DM by default");
  const withNums = H.huntDM(p, { ...prof, deal: { numbersInDm: true } }, "long");
  assert.ok(withNums.includes("50% of income") && withNums.includes("50/50"), "numbers appear when switched on:\n" + withNums);
  const up = H.huntDM(p, { ...prof, deal: { mode: "upfront_share" } }, "short");
  assert.ok(/small upfront to start, then a share of the income/.test(up) && !/\$/.test(up), up);
  const shareOnly = H.huntDM(p, { ...prof, deal: { mode: "share" } }, "long");
  assert.ok(/no upfront: we carry our own costs/.test(shareOnly), shareOnly);
  const paid = H.huntDM(p, { ...prof, deal: { mode: "upfront", numbersInDm: true, upfront: 900 } }, "long");
  assert.ok(paid.includes("$900 per block") && /no share of your income/.test(paid) && /a paid team, rather than a co-founder/.test(paid), paid);
  for (const mode of ["split", "upfront_share", "share", "upfront"]) {
    const pr = H.huntAiPrompt(p, { ...prof, deal: { mode } });
    assert.ok(pr.user.includes("THE DEAL SHAPE: " + H.dealShape({ mode }).label), mode + " named in the prompt");
    assert.ok(pr.system.includes("NO PRICE, NO PERCENTAGE"), mode + ": numbers off by default");
    const plan = H.inboxPlanFor(H.INBOX_PLAN_DEFAULT, { ...prof, deal: { mode } });
    assert.ok(!plan.includes("{{") && plan.includes(H.dealShape({ mode, numbersInDm: true }).terms), mode + " plan carries the terms");
  }
  assert.ok(H.huntAiPrompt(p, { ...prof, deal: { numbersInDm: true } }).system.includes("exactly as written"), "numbers on: the AI must use them verbatim");
  const thrX = { with: "jane", messages: [{ mine: true, body: "hi" }, { mine: false, body: "What are your terms?" }] };
  assert.ok(H.inboxTemplateReply(thrX, { ...prof, deal: { mode: "share", share: 30 } }).reply.includes("30% of income") && !H.inboxTemplateReply(thrX, { ...prof, deal: { mode: "share", share: 30 } }).reply.includes("upfront to start"));
  const closeX = H.inboxTemplateReply({ ...thrX, messages: [thrX.messages[0], { mine: false, body: "yes, ok with the share, let's start" }] }, prof);
  assert.ok(closeX.stage === "close" && /then two things/.test(closeX.reply) && closeX.reply.includes("50/50"), closeX.reply);
}
console.log("deal shapes: ok");

// The system prompt is byte-identical across posts, so the API can cache it.
{
  const prof = { name: "Noah", role: "web developer", whatsapp: "+910000000000" };
  const a = H.huntAiPrompt({ title: "Need a technical co-founder for my gym app", body: "idea stage", author: "jane", role: "technical", stage: "idea" }, prof);
  const b = H.huntAiPrompt({ title: "Looking for a marketing co-founder for my SaaS", body: "$4k MRR", author: "sam_k", role: "marketing", stage: "revenue" }, prof);
  assert.strictEqual(a.system, b.system, "system prompt must not vary per post");
  assert.ok(a.user.includes("GREETING") && a.user.includes("Hi Jane,") && b.user.includes("Hi Sam,"));
  const custom = { mode: "custom:c1", custom: [{ id: "c1", name: "VA · 50/50", dm: "we run your day-to-day as your VA team and split income and expenses 50/50" }] };
  assert.deepStrictEqual(H.dealOffers(custom).map((o) => o.key).slice(-1), ["custom:c1"]);
  const dm = H.huntDM({ title: "Need a co-founder for my app", body: "idea", author: "x", role: "unclear" }, { ...prof, deal: custom }, "short");
  assert.ok(dm.includes("We run your day-to-day as your VA team and split income and expenses 50/50; you keep the company."), dm);
  assert.ok(H.huntAiPrompt({ title: "t", body: "b", author: "x", role: "unclear" }, { ...prof, deal: custom }).user.includes("THE DEAL SHAPE: VA · 50/50"));
  assert.strictEqual(H.dealShape({ mode: "custom:missing", custom: [] }).mode, "split", "unknown custom falls back to the default");
}
console.log("cacheable prompt + custom offers: ok");

// Claude in Chrome: the brief carries the same rules as the API prompt; the pasted answer parses back.
{
  const prof = { name: "Noah", role: "web developer", whatsapp: "+910000000000" };
  const a = { id: "p1", author: "sam", sub: "SaaS", title: "Need a marketing co-founder for my SaaS", body: "$4k MRR", role: "marketing", stage: "revenue" };
  const b = { id: "p2", author: "rob", sub: "x", title: "Looking for a design co-founder", body: "MVP built", role: "design", stage: "building" };
  const brief = H.huntBrief([a, b], prof);
  assert.ok(brief.includes("FIRST, DECIDE FIT") && brief.includes("=== POST p1 ===") && brief.includes("=== POST p2 ===") && brief.includes("DM LONG:"), "brief has the rules, both posts and the layout");
  assert.ok(brief.includes("There are 2 posts"));
  assert.ok(!H.huntBrief([a], prof).includes("There are"));
  const filler = (n) => "word ".repeat(n).trim();
  const ans = `=== POST p1 ===\nFIT: yes — founder with revenue\nWHY: $4k MRR\nREPLY:\nInterview five paying customers before hiring for growth.\nCheck your DM.\nDM SHORT:\n${filler(80)}\nDM LONG:\n${filler(150)}\n=== END ===\n=== POST p2 ===\n**FIT:** no — offering himself\nWHY: x\nREPLY: line\nDM SHORT: ${filler(80)}\nDM LONG: ${filler(150)}`;
  const out = H.huntParseAnswers(ans);
  assert.deepStrictEqual(out.map((o) => [o.id, o.ai.fit]), [["p1", "yes"], ["p2", "no"]]);
  assert.strictEqual(H.huntAiClean(out[0].ai).public_reply, "Interview five paying customers before hiring for growth.\nCheck your DM.");
  assert.strictEqual(H.huntAiClean(out[0].ai).why, "$4k MRR");
  assert.strictEqual(H.huntParseAnswers(`REPLY:\nline\nDM SHORT:\n${filler(80)}\nDM LONG:\n${filler(150)}`)[0].id, null, "no header → the current card");
  assert.deepStrictEqual(H.huntParseAnswers("Sure! Here is nothing useful."), []);
}
console.log("claude in chrome brief + parse: ok");
