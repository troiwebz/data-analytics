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
assert.strictEqual(short.split("\n").length, 1, "the public reply is one short line: " + short);
assert.ok(/dm/i.test(short), "it points at the DM: " + short);
assert.ok(short.length <= 70, "the public reply stays short: " + short.length);
assert.ok(!/https?:\/\//.test(short) && !/\$\d/.test(short), "no links and no price in public");
const opts = H.huntShortOptions(hp, { name: "Troi" }, 3);
assert.strictEqual(opts.length, 3, "asking for three gives three different ones");
assert.strictEqual(new Set(opts).size, 3);
assert.ok(opts.every((o) => o.split("\n").length === 1 && !/https?:\/\/|\$\d/.test(o)));
assert.ok(opts.some((o) => /interested|keen|help/i.test(o)), "they say you are interested");
const dm = H.huntDM(hp, { name: "Troi", role: "web developer" });
assert.ok(dm.length > 400 && dm.length < 1100, "the DM is an introduction, not a letter: " + dm.length);
assert.ok(dm.startsWith("Hi Jane,"), dm);
assert.ok(!/—|–/.test(dm), "no long dashes anywhere: " + dm);
assert.ok(!/^—/m.test(dm) && !/\n— \w+$/.test(dm.trim()), "no sign-off: " + dm);
// the long DM is numbered points with the offer on a line of its own; the
// short one is still the two-paragraph note
// the template has no market points or steps to number, but the offer still
// gets its own line; the numbered shape is checked on a written one below
assert.ok(/^The offer: /m.test(dm), "the offer sits on a line of its own: " + dm);
assert.strictEqual(H.huntDM(hp, { name: "Troi" }, "short").split("\n\n").length, 3, "the short DM is a greeting and two paragraphs");
// a first message has nothing to click and nothing to look up, and it ends
// on a question to them and a thank you
assert.ok(!/portfolio|case study|check out|https?:\/\//i.test(dm), "nothing to look at in a first DM: " + dm);
assert.ok(/\?/.test(dm) && /\bthank/i.test(dm), "it ends on a question and thanks: " + dm);
assert.ok(!/\?\s*$/.test(dm.trim()), "no question at the end: " + dm);
assert.ok(/co-founder/i.test(dm), "we answer as the co-founder: " + dm);
assert.ok(/team/i.test(dm) && /(costs?|expenses)/i.test(dm) && /profit|income|earns/i.test(dm), "the one sentence carries team, costs and profit: " + dm);
assert.ok(!/not applying|isn't a co-founder application|won't pitch myself/i.test(dm), "we no longer refuse the co-founder seat: " + dm);
assert.ok(!/\$\d|\d+%/.test(dm), "no price and no percentage in the first DM: " + dm);
assert.ok(/share the (?:income|expenses)|split equally|shared expenses/i.test(dm) && /You keep the company and the IP\./.test(dm), "the shape is the pitch: " + dm);
assert.ok(!/https?:\/\//.test(dm), "no link in a first DM, it sends Reddit chat to the requests folder: " + dm);
assert.ok(!/30 to 50 percent|three to six months|2 to 4 weeks/.test(dm), "no essay about co-founders: " + dm);
assert.ok(!/48 hours|prototype|no charge|costs you nothing|free build/i.test(dm), "no free work promised: " + dm);
assert.ok(H.huntComposeUrl(hp, dm).startsWith("https://www.reddit.com/message/compose/?to=jane&subject="));
assert.ok(H.huntScore({ ...hp, created: Date.now() }) > H.huntScore({ ...hp, created: Date.now() - 5 * 86400000 }), "fresher posts rank higher");
assert.ok(H.huntScore({ ...hp, hasBudget: true, equityOnly: false }) > H.huntScore(hp), "money ranks higher than equity-only");
console.log("co-founder hunt: ok");

// DM close: the free offer, then the private channel
const prof2 = { name: "Troi", role: "web developer", whatsapp: "+91 98765 43210", telegram: "@troibuilds" };
const dm2 = H.huntDM(hp, prof2);
assert.ok(/share the (?:income|expenses)|split equally|shared expenses/i.test(dm2) && !/\$\d/.test(dm2), "every DM says how we work, without a price");
assert.ok(!/wa\.me|t\.me/.test(dm2), "channels set but no links in the DM by default");
assert.ok(!/WhatsApp or Telegram/.test(dm2), "no channel line in the DM at all now");
assert.ok(!/—/.test(dm2), "no dashes: " + dm2);
const dmLinks = H.huntDM(hp, { ...prof2, dmLinks: true });
assert.ok(dmLinks.includes("https://wa.me/919876543210") && dmLinks.includes("https://t.me/troibuilds"), "links appear only when switched on");
assert.ok(!/wa\.me/.test(H.huntDM(hp, {})), "no channels set, nothing to offer");
assert.strictEqual(H.waLink("98765 43210"), "https://wa.me/9876543210");
assert.strictEqual(H.waLink("123"), "");
assert.strictEqual(H.tgLink("troi"), "https://t.me/troi");
assert.strictEqual(H.waLink(""), "");
// the 3-line public reply stays clean: no offer, no links
const short2 = H.huntShortReply(hp, { name: "Troi", whatsapp: "+919876543210" });
assert.ok(!/wa\.me|t\.me|48 hours|free/.test(short2) && short2.split("\n").length === 1);
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
// the two lengths are shaped differently now: short is the two-paragraph note,
// long puts the offer on a line of its own even when there is nothing to number
assert.ok(!/^The offer: /m.test(sizes[0]), "the short DM has no offer heading: " + sizes[0]);
assert.ok(/^The offer: /m.test(sizes[2]), "the long DM does: " + sizes[2]);
assert.strictEqual(sizes[1].length, sizes[2].length, "the same size asked for twice is the same text");
{
  // short is two paragraphs; long is the numbered version with the market points
  const withPts = H.huntSlotAssemble({ ...hp, id: "sz" }, { name: "Noah" }, { product: "fitness app", observation: "Four hundred on the waitlist answers the demand question", points: ["gyms churn every January and nobody budgets for it", "the front desk decides adoption, not the owner"], move: "pre-sell ten gyms a month of the beta", question: "q?", phrase: "", fit: "yes" });
  assert.ok(withPts.dm_long.length > withPts.dm_short.length, "long carries the two points");
  assert.ok(withPts.dm_long.includes("front desk decides adoption") && !withPts.dm_short.includes("front desk decides adoption"));
  // the plan is in both sizes, and both end on a question and thanks
  for (const d of [withPts.dm_short, withPts.dm_long]) {
    assert.ok(/pre-sell ten gyms/.test(d), "the plan is in both: " + d);
    assert.ok(/\?/.test(d) && /\bthank/i.test(d), "question and thanks in both: " + d);
    assert.ok(!/portfolio|case study/i.test(d), "nothing to look at in either: " + d);
  }
  assert.strictEqual(withPts.dm_short.split("\n\n").length, 3, "the short one is two paragraphs: " + withPts.dm_short);
  assert.ok(/^1\. /m.test(withPts.dm_long) && /^The offer: /m.test(withPts.dm_long), "the long one is a numbered list: " + withPts.dm_long);
}
assert.ok(sizes[0].length < 900, "the short one is actually short: " + sizes[0].length);
sizes.forEach((d) => { assert.ok(d.startsWith("Hi Jane,")); assert.ok(!/https?:\/\//.test(d), "no links"); assert.ok(!/\$\d/.test(d), "no price in the DM"); });
const builtDm = H.huntDM({ ...hp, stage: "building", body: "We already have a working product with paying recruiters." }, { name: "Noah" }, "short");
assert.ok(/already built/.test(builtDm) && !/2 to 4 weeks|first version/.test(builtDm), "a built product is not told to build v1: " + builtDm);
assert.strictEqual(H.huntThing({ title: "Looking for a Technical Co-Founder", body: "We started with an ATS for recruiters. This is not an idea-stage project, we have a working product. I'm looking for someone to build this long term with me." }), "your ats");
assert.strictEqual(H.huntThing({ title: "Looking for a co-founder for my company", body: "Our company does things." }), "what you're building", "'company' is not a thing");
assert.ok(!/\n1\. /.test(sizes[0]) && !/\n1\. /.test(sizes[2]), "short and long are introductions, no numbered plan");
assert.strictEqual(H.huntThing({ title: "Looking for a co-founder for my Liquor & wine delivery app", body: "" }), "your Liquor & wine delivery app", "an ampersand does not cut the name in half");

// the reading of a post
const syn = H.huntSynopsis({ title: "Looking for a technical co-founder for my fitness app", body: "I run a gym business in Bangalore. 400 users on the waitlist. Equity only (10%), nights and weekends.", role: "technical", stage: "idea", equityOnly: true, sub: "startups" });
assert.strictEqual(syn.who, "company owner");
assert.strictEqual(syn.wants, "someone to build it");
assert.strictEqual(syn.country, "Bangalore, India", "the city is shown when they named one");
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
assert.ok(pr.system.includes("Noah") && pr.system.includes("AS a co-founder"));
assert.ok(!/public reply is exactly two lines/.test(pr.system), "the public comment is built locally, not written by the model");
assert.ok(pr.user.includes("400 people on the waitlist") && pr.user.includes("r/startups") && pr.user.includes("Hi Jane,") && !pr.system.includes("Jane"));
assert.ok(pr.user.includes("GREETING (first line of every DM, verbatim)\nHi Jane,"), "the greeting is fixed, in the user turn so the system prompt stays cacheable");
assert.ok(!/wa\.me|CONTACT LINE/.test(pr.user), "no link and no channel line in a first DM by default");
assert.ok(pr.user.includes("CLOSING LINE") && pr.user.includes("if you are ready"), "the DM ends on the offer to send more");
assert.ok(H.huntAiPrompt(aiP, { name: "Noah", whatsapp: "+91 98765 43210", dmLinks: true }).user.includes("https://wa.me/919876543210"), "links are passed verbatim once switched on");
assert.ok(pr.user.includes("HOW WE WORK") && !/\$\d/.test(pr.user.split("HOW WE WORK")[1] || ""), "how we work is passed through without a price");
assert.ok(pr.system.includes("NO PRICE, NO PERCENTAGE") && pr.system.includes("READ THE STAGE"));
assert.ok(pr.system.includes("never for free"), "no free work in the instructions");
assert.strictEqual(pr.schema.required.length, 8, "the card, three answers, the two points, why, and the fit verdict"); assert.strictEqual(pr.schema.required[0], "concept", "the card is filled before the replies");
// cleaner: rejects links, prices, one-liners, stubs
const good = { public_reply: "Line one about the gym.\nLine two, free thing, in your DM.", dm_short: "x".repeat(300), dm_long: "z".repeat(900), why: "the waitlist" };
assert.ok(H.huntAiClean(good));
assert.strictEqual(H.huntAiClean({ ...good, public_reply: "only one line" }).public_reply, "only one line\nCheck your DM.", "one line is fine: the close is added");
assert.strictEqual(H.huntAiClean({ ...good, public_reply: "see https://x.com\nline two" }), null);
assert.strictEqual(H.huntAiClean({ ...good, public_reply: "costs $500\nline two" }), null);
assert.strictEqual(H.huntAiClean({ ...good, dm_long: "short" }), null);
assert.strictEqual(H.huntAiClean(good).public_reply.split("\n").length, 2);
assert.strictEqual(H.huntAiClean({ ...good, public_reply: "a\nb\nc" }).public_reply, "a\nCheck your DM.", "extra lines are dropped");
assert.ok(pr.schema.properties.public_reply.description.includes("Check your DM."), "the model's own line still ends that way when it writes one");
assert.deepStrictEqual(H.huntAiClean({ ...good, public_reply: ("word ".repeat(45)).trim() + "\nCheck your DM." }), { tooLong: true }, "a long public reply is sent back for a shorter one");
console.log("ai prompt + cleaner: ok");

// inbox: prompt, cleaner, template fallback
const thr = { id: "t4_a", with: "jane_builds92", messages: [
  { id: "t4_a", author: "Noah_Basera", mine: true, body: "Hi Jane, saw your post…", at: 1000 },
  { id: "t4_b", author: "jane_builds92", mine: false, body: "Thanks! How much would you charge to build the first version?", at: 2000 },
] };
const ip = H.inboxAiPrompt(thr, { sub: "startups", title: "Looking for a technical co-founder for my fitness app", body: "equity only" }, { name: "Noah", whatsapp: "+919000000000" }, H.INBOX_PLAN_DEFAULT);
assert.ok(ip.system.includes("50% of income") && ip.system.includes("No upfront") && ip.system.includes("WITH OUR OWN TEAM") && ip.system.includes("one step at a time") && ip.system.includes("THE REPLY MUST FIT THEIR LAST MESSAGE"));
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
assert.ok(H.INBOX_PLAN_DEFAULT.includes("WITH OUR OWN TEAM") && H.INBOX_PLAN_DEFAULT.includes("SHARE EXPENSES AND INCOME") && H.INBOX_PLAN_DEFAULT.includes("VERDICT"));
assert.ok(H.INBOX_PLAN_DEFAULT.includes("we ARE answering as a co-founder"), "the inbox takes the co-founder seat too");
const two = (body) => ({ ...thr, messages: [thr.messages[0], { ...thr.messages[1], body }] });
const cutR = H.inboxTemplateReply(two("I can't pay anything right now, it would be equity only"), dealP);
assert.strictEqual(cutR.stage, "cut"); assert.strictEqual(cutR.verdict, "not_interested"); assert.ok(/isn't something I can take on/.test(cutR.reply));
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
    assert.ok(/already built|running and growing|who runs it every day/i.test(d), size + " DM should talk about running what exists, not building it:\n" + d);
    assert.ok(!/[$%]/.test(d), size + " DM has no price or percentage");
    assert.ok(!/that paragraph/.test(d), "no dangling reference to a paragraph we never asked for");
  }
  const idea = { ...raw, body: "Just an idea for now, nothing built yet, need someone to build it." };
  const pi = { ...idea, ...H.classifyCofounder(idea.title, idea.body) };
  const ideaDm = H.huntDM(pi, prof, "long");
  assert.ok(/three screens|in front of ten people|needing the thing to exist/i.test(ideaDm), "idea stage gets a build-first step: " + ideaDm);
  assert.ok(!/already built|running and growing/i.test(ideaDm), "idea stage is not told it has a product");
  // the long team description stays out of a first DM (it was the noise); it
  // still drives the inbox, where they have asked what the team actually does
  const own = H.huntDM(p, { ...prof, deal: { teamDoes: "does the customer support" } }, "long");
  assert.ok(!own.includes("does the customer support"), "a first DM stays short: " + own);
  const thrOwn = { with: "jane", messages: [{ mine: true, body: "hi" }, { mine: false, body: "What are your terms?" }] };
  assert.ok(H.inboxTemplateReply(thrOwn, { ...prof, deal: { teamDoes: "does the customer support" } }).reply.includes("does the customer support"), "the user's own team wording is used when they ask");
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
  assert.ok(/shared expenses|share the expenses|split equally|expenses together/i.test(dflt), "default DM says the split in words:\n" + dflt);
  assert.ok(!/[$%]/.test(dflt), "no numbers in the first DM by default");
  const withNums = H.huntDM(p, { ...prof, deal: { numbersInDm: true } }, "long");
  assert.ok(withNums.includes("50% of income to us") && withNums.includes("50/50"), "numbers appear when switched on:\n" + withNums);
  assert.ok(!/split equally, agreed/.test(withNums), "with numbers on, the numbers replace the words");
  const up = H.huntDM(p, { ...prof, deal: { mode: "upfront_share" } }, "short");
  assert.ok(/small amount upfront to start, then a share of the income/i.test(up) && !/\$/.test(up), up);
  const shareOnly = H.huntDM(p, { ...prof, deal: { mode: "share" } }, "long");
  assert.ok(/nothing upfront/i.test(shareOnly), shareOnly);
  const paid = H.huntDM(p, { ...prof, deal: { mode: "upfront", numbersInDm: true, upfront: 900 } }, "long");
  assert.ok(paid.includes("$900 per block") && /no share of your income/.test(paid), paid);
  assert.ok(H.dealShape({}).tail && H.dealShape({ mode: "share" }).tail, "every shape has a terms line");
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
  assert.ok(/run your day-to-day as your VA team and split income and expenses 50\/50\./.test(dm) && /You keep the company and the IP\./.test(dm), dm);
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

// Template + AI slots: your skeleton, five shapes, nothing repeated, nothing filterable.
{
  const prof = { name: "Noah", role: "web developer", whatsapp: "+910000000000" };
  const slots = (n) => ({ fit: "yes", fit_reason: "founder", product: ["gym scheduling app", "SaaS for clinics", "booking platform", "HeySakhi"][n % 4], observation: `observation ${n} naming a number only this post gave`, move: `the concrete step ${n} for this week`, question: `which side is harder to fill for case ${n}?`, reply_line: `a useful line for ${n}`, phrase: "their words" });
  const post = (n) => ({ id: "p" + n, author: "user" + n, sub: "startups", title: "Looking for a co-founder", role: ["technical", "marketing", "design", "business"][n % 4], stage: ["idea", "building", "revenue"][n % 3] });
  assert.strictEqual(H.SLOT_STYLES.length, 5);
  const a = H.huntSlotAssemble(post(0), prof, slots(0));
  assert.ok(a.dm_short.startsWith("Hi User0,") || a.dm_short.startsWith("Hi there,"), a.dm_short.slice(0, 30));
  assert.strictEqual(a.dm_short.split("\n\n").length, 3, "greeting plus two paragraphs: " + a.dm_short);
  assert.ok(!/[—–]/.test(a.dm_short) && !/[—–]/.test(a.dm_long), "no dashes");
  assert.ok(!/https?:|[$%]/.test(a.dm_short), "the first DM carries no link, no price, no percentage");
  assert.ok(a.dm_short.length > 300 && a.dm_short.length < 900, "short enough for Reddit's chat filter: " + a.dm_short.length);
  assert.ok(!/https?:\/\//.test(a.dm_long) && !/WhatsApp or Telegram/.test(a.dm_long), "no links and no channel line in either DM by default");
  assert.ok(H.huntSlotAssemble(post(0), { ...prof, dmLinks: true }, slots(0)).dm_long.includes("wa.me"), "links only when switched on");
  assert.ok(a.dm_long.length >= a.dm_short.length, "the long one is never shorter");
  assert.ok(a.dm_short.includes("the gym scheduling app"), "their product in their words, with an article");
  assert.ok(H.huntSlotAssemble(post(3), prof, slots(3)).dm_short.includes("HeySakhi") && !H.huntSlotAssemble(post(3), prof, slots(3)).dm_short.includes("the HeySakhi"), "a product name keeps its own form");
  assert.ok(/dm/i.test(a.public_reply) && !a.public_reply.includes("\n"), "one line pointing at the DM: " + a.public_reply);
  // the offer follows the deal dropdown, custom offers included
  const own = H.huntSlotAssemble(post(1), { ...prof, deal: { mode: "custom:c1", custom: [{ id: "c1", name: "VA", dm: "we run your day-to-day as your VA team and split income and expenses 50/50" }] } }, slots(1));
  assert.ok(/run your day-to-day as your VA team/i.test(own.dm_short), own.dm_short);
  // twelve in a row: every one a different text, no style twice running, overlap kept low
  const sent = []; const styles = []; let worst = 0; const texts = new Set();
  for (let i = 0; i < 12; i += 1) {
    const x = H.huntSlotAssemble(post(i), prof, slots(i), { avoid: sent, recentStyles: styles });
    sent.push(x.shingles); styles.unshift(x.style); texts.add(x.dm_short); worst = Math.max(worst, x.overlap);
    assert.notStrictEqual(x.style, styles[1], "never the same shape twice running");
  }
  assert.strictEqual(texts.size, 12, "twelve different messages");
  // the offer paragraph is meant to repeat (it is the offer), so some overlap
  // is structural in a short message; what must never happen is two identical
  // messages, which the line above checks.
  assert.ok(worst < 0.8, "no message is nearly a copy of an earlier one: " + worst);
  assert.strictEqual(H.dmOverlap(H.dmShingles("a b c d e f g"), [H.dmShingles("a b c d e f g")]), 1);
  assert.strictEqual(H.dmOverlap(H.dmShingles("a b c d e f g"), [H.dmShingles("z y x w v u t")]), 0);
  const pr = H.huntSlotPrompt(post(0), prof);
  assert.ok(pr.system.includes("FIRST, DECIDE FIT") && pr.system.includes("no emoji") && pr.schema.required.includes("observation"));
  assert.ok(!pr.system.includes("HOW WE WORK"), "the model never writes the offer");
}
console.log("template + ai slots: ok");

// Two points that prove you know their market, straight after their post.
{
  const prof = { name: "Noah" };
  const p = { id: "sal", author: "sam", sub: "SaaS", title: "Looking for a co-founder for my salon SaaS", body: "Paying salons already.", role: "marketing", stage: "revenue" };
  const slots = {
    product: "salon SaaS", observation: "Paying salons already on board means the question is who runs it every day",
    points: ["no-shows quietly eat the margin long before churn shows up", "stylists decide whether it gets used, not the owner who signed up"],
    move: "interview five of the paying salons about where they first heard of you",
    question: "q?", reply_line: "l", phrase: "", fit: "yes",
  };
  const a = H.huntSlotAssemble(p, prof, slots);
  // the long DM is a numbered list now: the points, then the plan, then the offer
  assert.ok(/^1\. No-shows/mi.test(a.dm_long) && /^2\. Stylists decide/mi.test(a.dm_long), "the points are numbered: " + a.dm_long);
  const offerLine = a.dm_long.split("\n").find((x) => /^The offer: /.test(x)) || "";
  assert.ok(/co-found/i.test(offerLine), "the offer line carries the stance: " + offerLine);
  assert.ok(/interview five/.test(a.dm_long), "the plan is still there: " + a.dm_long);
  assert.ok(!/portfolio/i.test(a.dm_long), "and the portfolio is not: " + a.dm_long);
  assert.ok(a.dm_long.indexOf("1. No-shows") < a.dm_long.indexOf(offerLine), "the offer comes last");
  // the short one keeps the two-paragraph shape
  assert.strictEqual(a.dm_short.split("\n\n").length, 3, "the short one is a greeting and two paragraphs: " + a.dm_short);
  // one point, or none, means the section is left out rather than half-written
  assert.ok(!/no-shows/i.test(H.huntSlotAssemble(p, prof, { ...slots, points: ["only one point here"] }).dm_long));
  assert.ok(!H.huntSlotAssemble(p, prof, { ...slots, points: [] }).dm_long.includes("that decide"));
  // templates never invent them
  assert.deepStrictEqual(H.huntLocalSlots(p).points, undefined);
  const pr = H.huntSlotPrompt(p, prof);
  assert.ok(pr.schema.required.includes("points") && /EXACTLY TWO/.test(pr.schema.properties.points.description), "the model is told exactly two");
  // the API rejects minItems/maxItems above 1 on a structured-output schema
  const badArray = (o) => !o || typeof o !== "object" ? false : Object.keys(o).some((k) => ((k === "minItems" || k === "maxItems") && o[k] > 1) || badArray(o[k]));
  assert.ok(!badArray(pr.schema) && !badArray(H.AI_SCHEMA), "no array constraint the API refuses");
  // more than two come back: the first two are used, the rest dropped
  const three = H.huntSlotAssemble(p, prof, { ...slots, points: [...slots.points, "a third the model threw in"] });
  // numbered lines start with a capital now, so match without case
  assert.ok(/no-shows/i.test(three.dm_long) && !/a third the model/i.test(three.dm_long), three.dm_long);
  assert.ok(pr.system.includes("no-shows, rebooking rates, stylist adoption"), "the prompt shows what a real market point looks like");
  assert.ok(H.AI_SCHEMA.required.includes("points"), "the full writer supplies them too");
}
console.log("two points from their market: ok");

// The public comment: one line, built here, hundreds of them, never repeated.
{
  const mk = (id, t) => ({ id, author: "sam", sub: "SaaS", title: t, body: "" });
  const used = [];
  for (let i = 0; i < 40; i += 1) {
    const p = mk("p" + i, ["Marketing co-founder wanted for Konnekt", "Looking for a co-founder for my salon SaaS", "Need a technical co-founder for my gym scheduling app"][i % 3]);
    const line = H.huntPublicLine(p, {}, { avoid: used });
    assert.ok(line.length <= 70 && !/\n/.test(line), "one short line: " + line);
    assert.ok(!/https?:|[$%]/.test(line), "no link, no price: " + line);
    assert.ok(/dm/i.test(line), "it points at the DM: " + line);
    used.push(line);
  }
  assert.strictEqual(new Set(used).size, 40, "forty in a row, none repeated");
  // "Check DM." and "Let's talk further. Check DM." - nothing longer than that
  const many = Array.from({ length: 200 }, (_, i) => H.huntPublicLine(mk("z" + i, "Looking for a co-founder for my salon SaaS"), {}));
  assert.ok(many.every((l) => l.length <= 45), "every one is very short: " + Math.max(...many.map((l) => l.length)));
  assert.ok(many.every((l) => l.split(". ").length <= 2), "at most two little sentences: " + many.find((l) => l.split(". ").length > 2));
  assert.ok(many.some((l) => l === "Check DM."), "the bare pointer is in there");
  assert.ok(many.some((l) => /^Let's talk further\./.test(l)), "so is the lead they asked for");
  assert.ok(!many.some((l) => /salon SaaS/i.test(l)), "the public line never names their thing");
  // hundreds of them, so the pool does not run dry on a busy day
  const pool = new Set(Array.from({ length: 5000 }, (_, i) => H.huntPublicLine(mk("s" + i, "t"), {})));
  assert.ok(pool.size >= 250, "hundreds of distinct lines: " + pool.size);
  // the slot engine uses it, and no longer pays the model for a reply line
  const a = H.huntSlotAssemble(mk("q", "Looking for a co-founder for my salon SaaS"), { name: "Noah" }, { product: "salon SaaS", observation: "o", points: [], move: "", question: "q?", phrase: "", fit: "yes" });
  assert.ok(/dm/i.test(a.public_reply) && !/\n/.test(a.public_reply), a.public_reply);
  assert.ok(!H.huntSlotPrompt(mk("q", "t"), {}).schema.required.includes("reply_line"), "the model is not asked for a public line");
}
console.log("public one-liner: ok");

// Where they are, and how that reads next to where you are.
{
  const mk = (t, b) => ({ id: "L", author: "sam", sub: "SaaS", title: t, body: b });
  assert.deepStrictEqual(H.huntPlace(mk("Co-founder", "We are in Bangalore")), { city: "Bangalore", country: "India" });
  assert.deepStrictEqual(H.huntPlace(mk("Co-founder", "Berlin based")), { city: "Berlin", country: "Germany" });
  assert.deepStrictEqual(H.huntPlace(mk("Co-founder", "nothing said")), { city: "", country: "" });
  assert.strictEqual(H.huntPlace(mk("Co-founder", "we sell across India")).country, "India", "a country with no city still counts");
  const me = { name: "Noah", location: "Bangkok, Thailand" };
  assert.ok(/same day/.test(H.huntLocationLine(mk("x", "we are in Bangkok"), me)), "same country reads as an advantage");
  assert.ok(/close enough to Bangalore/.test(H.huntLocationLine(mk("x", "Bangalore"), me)), "same region says so");
  assert.ok(/overlap Berlin/.test(H.huntLocationLine(mk("x", "Berlin"), me)), "far apart is said plainly");
  assert.strictEqual(H.huntLocationLine(mk("x", "nothing said"), me), "", "nothing invented when they said nothing");
  assert.strictEqual(H.huntLocationLine(mk("x", "Bangalore"), { name: "Noah" }), "", "nothing said when you have not set your own");
  // it lands in the DM, and only when both are known
  const p = { ...mk("Looking for a co-founder for my salon SaaS", "We are in Bangalore, paying salons already."), role: "marketing", stage: "revenue" };
  assert.ok(/I'm in Bangkok/.test(H.huntDM(p, me, "long")), H.huntDM(p, me, "long"));
  assert.ok(!/I'm in/.test(H.huntDM(p, { name: "Noah" }, "long")), "no location set, no line");
  // the writer is told both places
  const pr = H.huntSlotPrompt(p, me);
  assert.ok(pr.user.includes("Where they are: Bangalore") && pr.user.includes("Where we are: Bangkok, Thailand"));
  assert.ok(pr.system.includes("WHERE THEY ARE MATTERS"), "and told to make one point local");
  // the table and the card show the city
  assert.strictEqual(H.huntSynopsis(p).country, "Bangalore, India");
}
console.log("location: ok");

// a post that never names a product falls back to "what you're building", and
// that phrase must not pick up an article: never "the what you're building"
{
  const p = { id: "nothing", sub: "cofounderhunt", title: "Technical founder and engineer looking to join a project", body: "I'm a technical founder with 4 years in AI and DevOps. The ecosystem in India is tough right now." };
  assert.strictEqual(H.huntThing(p), "what you're building");
  for (let i = 0; i < 40; i += 1) {
    const b = H.huntSlotBuild({ ...p, id: "nothing" + i }, { city: "Bangkok", country: "Thailand" }, {}, {});
    assert.ok(!/\bthe what you're building\b/i.test(b.text), "article on the fallback phrase: " + b.text);
  }
  const named = H.huntSlotBuild({ id: "gym", sub: "startups", title: "Looking for a technical co-founder for my gym scheduling app", body: "Building a gym scheduling app." }, {}, {}, {});
  assert.ok(/the gym scheduling app/.test(named.text), "a named product keeps its article: " + named.text);
}
console.log("no article on the fallback: ok");

// The opening: their own title when the post names no product, and the
// subreddit never appears - "came up in r/cofounderhunt" reads like a scraper.
{
  const named = { id: "np", sub: "startups", title: "Looking for a technical co-founder for my live logistics SaaS", body: "Real time fleet tracking for small carriers." };
  const bare = { id: "bp", sub: "cofounderhunt", title: "Marketing Co-founder wanted! 1600+ users", body: "I am building Konnekt, a language social application." };
  const long = { id: "lp", sub: "cofounderhunt", title: "[Seeking CTO] " + "Anyone here interested in solving the hardest problem in Indian healthcare logistics right now, and willing to talk this week".repeat(1), body: "we move samples between labs" };
  assert.strictEqual(H.huntTitleLine(long).length <= 101, true, "a long title is cut: " + H.huntTitleLine(long));
  assert.ok(!/^\[/.test(H.huntTitleLine(long)), "tags are dropped: " + H.huntTitleLine(long));
  assert.strictEqual(H.huntTitleLine(bare), "Marketing Co-founder wanted! 1600+ users");
  const texts = [];
  for (let i = 0; i < 40; i += 1) for (const p of [named, bare, long]) texts.push(H.huntSlotBuild({ ...p, id: p.id + i }, { name: "Noah" }, {}, {}).text);
  assert.ok(!texts.some((t) => /\br\/[A-Za-z]/.test(t)), "no subreddit in any DM: " + texts.find((t) => /\br\/[A-Za-z]/.test(t)));
  assert.ok(!texts.some((t) => /what you're building/i.test(t)), "never the placeholder: " + texts.find((t) => /what you're building/i.test(t)));
  const bareOpens = texts.filter((t) => t.includes("Konnekt") || t.includes("1600+ users"));
  assert.ok(bareOpens.length && bareOpens.every((t) => t.includes('"Marketing Co-founder wanted! 1600+ users"')), "a post with no product quotes its own title");
  const namedOpens = texts.filter((t) => /live logistics SaaS/.test(t));
  assert.ok(namedOpens.length && namedOpens.every((t) => /the live logistics SaaS/.test(t) && !/"Looking for a technical/.test(t)), "a post that names a product still names it");
  // the model is told the same thing
  assert.ok(/Never name the subreddit/.test(H.huntSlotPrompt(named, { name: "Noah" }, {}).system), "the slot prompt forbids it");
  assert.ok(/Never name the subreddit/.test(H.huntAiPrompt(named, { name: "Noah" }).system), "the full letter forbids it");
}
console.log("openings: ok");

// How hard the writer may veto is a setting, and it reaches both prompts.
{
  const p = { id: "ag", sub: "cofounderhunt", title: "Looking for an Agency / Sales Partner in Australia", body: "we are a dev agency and want someone to sell for us" };
  const seen = {};
  for (const mode of ["strict", "loose", "off", undefined, "nonsense"]) {
    const prof = { name: "Noah", fitStrict: mode };
    const rule = H.fitRule(prof);
    seen[String(mode)] = rule.mode;
    assert.ok(H.huntSlotPrompt(p, prof, {}).system.includes(rule.text), "the slot prompt carries the rule for " + mode);
    assert.ok(H.huntAiPrompt(p, prof).system.includes(rule.text), "the full letter carries the rule for " + mode);
  }
  assert.deepStrictEqual(seen, { strict: "strict", loose: "loose", off: "off", undefined: "strict", nonsense: "strict" }, "anything unknown falls back to strict");
  assert.ok(/only want founders/i.test(H.fitRule({ fitStrict: "strict" }).text));
  assert.ok(/clear non-starters/i.test(H.fitRule({ fitStrict: "loose" }).text));
  assert.ok(/Set fit = "yes" unless/.test(H.fitRule({ fitStrict: "off" }).text));
  assert.deepStrictEqual(H.FIT_MODES.map((m) => m.key), ["strict", "loose", "off"]);
}
console.log("how strict the veto is: ok");

// The offer you pick has to reach the DM. Every shape used to produce the same
// sentence - "split both the expenses and the profit" - whatever was chosen.
{
  const p = { id: "of", sub: "microsaas", author: "Jeet", title: "Left my job to build an AI research agent", body: "no paying user yet" };
  const slots = { fit: "yes", product: "AI research agent", observation: "No paying user yet is a marketing problem", points: ["one thing here", "two thing here"], move: "pick ten teams", question: "who buys?", phrase: "" };
  const custom = { id: "va1", name: "VA team", dm: "my VA team runs your back office and we split what it earns", terms: "50/50 on the income", question: "" };
  const deals = [{ mode: "split" }, { mode: "upfront_share" }, { mode: "share" }, { mode: "upfront" }, { mode: "custom:va1", custom: [custom] }];
  const second = [];
  for (const deal of deals) {
    const out = H.huntSlotAssemble(p, { name: "Noah", deal }, slots, {});
    assert.deepStrictEqual(out.checks, [], deal.mode + " failed its own checks: " + out.checks.join("; "));
    assert.ok(out.dm_short && out.dm_long && out.dm_short !== out.dm_long, deal.mode + ": both lengths, and different");
    // the long DM's offer now sits on its own line, wherever the list ends
    const para = out.dm_long.split("\n").find((x) => /^The offer: /.test(x)) || "";
    second.push(para);
    const sh = H.dealShape(deal);
    // no shape may promise a split it was not asked for
    if (deal.mode !== "split" && !deal.mode.startsWith("custom")) {
      assert.ok(!/split both the expenses and the profit|shared expenses, shared profit/i.test(para), deal.mode + " promises a 50/50 split: " + para);
    }
    if (deal.mode === "upfront") {
      assert.ok(/paid work|paid in fixed blocks/i.test(para), "paid-only work is not sold as a co-founder seat: " + para);
      assert.ok(!/co-found/i.test(para.split(".")[0]), "the stance for paid work does not say co-founder: " + para);
    }
    assert.ok(para.toLowerCase().includes(String(sh.tail || "").toLowerCase().split(" ")[0].toLowerCase()), deal.mode + ": the offer is in the DM");
  }
  assert.strictEqual(new Set(second).size, deals.length, "every offer reads differently");
  // the checker catches a broken pair
  const bad = H.dmChecks("Hi\n\nsee https://x.com", "", {});
  assert.ok(bad.some((x) => /link/.test(x)) && bad.some((x) => /empty/.test(x)), "the checks catch a link and an empty DM: " + bad.join("; "));
}
console.log("the offer drives the DM: ok");

// The long DM: their post, the two market points and the first two weeks as
// numbered lines, then the offer alone where it cannot be skimmed past.
{
  const p = { id: "lg", sub: "startups", author: "Jane", title: "Looking for a technical co-founder for my gym scheduling app", body: "400 on the waitlist, equity only" };
  const slots = { fit: "yes", product: "gym scheduling app", observation: "Four hundred on a waitlist answers the demand question",
    points: ["gyms churn in January and nobody budgets for it", "the front desk decides adoption, not the owner"],
    steps: ["call ten gyms that already pay for software", "put a one page booking mock in front of them", "measure how many book without being helped"],
    move: "pre-sell ten gyms", question: "who pays first?", phrase: "" };
  const out = H.huntSlotAssemble(p, { name: "Noah" }, slots, {});
  const L = out.dm_long;
  assert.deepStrictEqual(out.checks, [], "the long DM passes its own checks: " + out.checks.join("; "));
  assert.ok(/^Two things that decide it in your market:$/m.test(L), "the market points have a heading: " + L);
  assert.ok(/^1\. Gyms churn in January/m.test(L) && /^2\. The front desk decides/m.test(L), "the points are numbered: " + L);
  assert.ok(/^What I would do in the first two weeks:$/m.test(L), "the steps have a heading: " + L);
  assert.ok(/^3\. Measure how many book/m.test(L), "three numbered steps: " + L);
  const offer = L.split("\n").filter((x) => /^The offer: /.test(x));
  assert.strictEqual(offer.length, 1, "exactly one offer line: " + L);
  assert.ok(/split equally/.test(offer[0]), "the offer line carries the deal: " + offer[0]);
  assert.ok(L.indexOf(offer[0]) > L.indexOf("1. Gyms churn"), "the offer comes after the points");
  // the short one is unchanged: two paragraphs, no numbering
  assert.strictEqual(out.dm_short.split("\n\n").length, 3, "the short DM stays two paragraphs: " + out.dm_short);
  assert.ok(!/^\d\. /m.test(out.dm_short), "the short DM is not a list: " + out.dm_short);
  // no steps from the model is not a broken DM, just a shorter one
  const bare = H.huntSlotAssemble(p, { name: "Noah" }, { ...slots, steps: [], points: [] }, {});
  assert.deepStrictEqual(bare.checks, [], "a long DM with nothing to number still passes: " + bare.checks.join("; "));
  assert.ok(/^The offer: /m.test(bare.dm_long));
}
console.log("the long DM is a list, not a wall: ok");

// The detailed public comment: a real answer, numbered, and never a pitch.
{
  const p = { id: "gd", sub: "microsaas", author: "Jeet", title: "Left my SDE job to build an AI research agent", body: "could not market it, no paying user" };
  const pr = H.huntGuidePrompt(p, { name: "Noah" });
  assert.deepStrictEqual(Object.keys(pr.schema.properties), ["opener", "points", "close", "channel", "hook"]);
  assert.ok(/never mention yourself, a team/i.test(pr.system), "the prompt forbids the pitch");
  assert.ok(!/minItems|maxItems/.test(JSON.stringify(pr.schema)), "no array constraint the API refuses");
  const out = { opener: "Four years as an SDE and no paying user says the problem was never the building",
    points: ["Pick the ten companies that already pay for research reports and email each one offering a free week",
             "Write down what they ask for in the first call, because that is the product",
             "Charge the third one, even badly, before you write another feature"],
    close: "The first person who pays decides what you build next" };
  out.hook = "How many of those ten have you actually emailed so far";
  const txt = H.huntGuideBuild(out, { name: "Noah" }, { pointAtDm: true });
  assert.ok(/^1\. Pick the ten/m.test(txt) && /^3\. Charge the third/m.test(txt), "numbered points: " + txt);
  assert.ok(txt.startsWith("Four years as an SDE"), "the opener leads: " + txt);
  assert.deepStrictEqual(H.huntGuideChecks(txt), [], "a good comment passes");
  // the last paragraph is the hook: a question, then the DM
  const last = txt.split("\n\n").pop();
  assert.ok(/^How many of those ten have you actually emailed so far\?/.test(last), "it ends on a question to them: " + last);
  assert.ok(/Sent you a DM with more on that\.$/.test(last), "then the DM: " + last);
  assert.ok(!/12 person team/.test(txt), "nothing about you unless you wrote it");
  // your own line goes between the two, and only yours
  const withCred = H.huntGuideBuild(out, { name: "Noah", credit: "I run a 12 person team in Bangkok that has shipped 40 of these" }, { pointAtDm: true });
  const credLast = withCred.split("\n\n").pop();
  assert.ok(/emailed so far\? I run a 12 person team in Bangkok that has shipped 40 of these\. Sent you a DM/.test(credLast), "question, then you, then the DM: " + credLast);
  assert.deepStrictEqual(H.huntGuideChecks(withCred), [], "your own line is not counted as a pitch");
  // a comment with no hook still works
  const noHook = H.huntGuideBuild({ ...out, hook: "" }, { name: "Noah" }, { pointAtDm: true });
  assert.ok(/Sent you a DM with more on that\.$/.test(noHook) && !/\?/.test(noHook.split("\n\n").pop()), "no hook, no dangling question mark: " + noHook);
  // the model is told what the question is for
  assert.ok(/a question they will want to answer in public/i.test(pr.schema.properties.hook.description), "the hook is specified");
  // and the checks catch a pitch, a link and a price
  assert.ok(H.huntGuideChecks("1. My team can build this for you").some((x) => /pitch/.test(x)));
  assert.ok(H.huntGuideChecks("1. See https://example.com").some((x) => /link/.test(x)));
  assert.ok(H.huntGuideChecks("1. It costs $200 a month").some((x) => /price/.test(x)));
  assert.ok(H.huntGuideChecks("just a sentence").some((x) => /numbered/.test(x)));
  // without points there is nothing worth posting
  assert.strictEqual(H.huntGuideBuild({ opener: "x", points: [], close: "y" }, {}), "");
}
console.log("the detailed public reply: ok");
// Every plan leads to a channel we can actually deliver, chosen from the post.
{
  assert.deepStrictEqual(H.CHANNELS.map((c) => c.key), ["local_seo", "google_ads_seo", "meta_ads", "instagram_tiktok", "none"]);
  assert.strictEqual(H.channelLabel("meta_ads"), "Meta ads");
  assert.strictEqual(H.channelLabel("nonsense"), "");
  const p = { id: "ch", sub: "startups", author: "Jane", title: "Looking for a co-founder for my salon booking SaaS", body: "three pilot salons" };
  const slot = H.huntSlotPrompt(p, { name: "Noah" }, {});
  const guide = H.huntGuidePrompt(p, { name: "Noah" });
  for (const [what, pr] of [["the writer", slot], ["the public reply", guide]]) {
    assert.ok(/THE CHANNEL/.test(pr.system), what + " is told to pick one");
    for (const c of H.CHANNELS) assert.ok(pr.system.includes(c.when), what + " is told when " + c.key + " applies");
    assert.deepStrictEqual(pr.schema.properties.channel.enum, ["local_seo", "google_ads_seo", "meta_ads", "instagram_tiktok", "none"], what + " can only pick one of ours");
    assert.ok(pr.schema.required.includes("channel"), what + " must pick one");
  }
  assert.ok(/never as something being offered|never as a service being sold/i.test(slot.system + guide.system), "and never sell it");
  // it survives into the answer and onto the card
  const slots = { fit: "yes", product: "salon booking SaaS", observation: "Three pilot salons is enough to know what renews",
    points: ["salons churn when the owner stops seeing bookings", "the front desk decides adoption"],
    steps: ["set up a Google Business Profile for each pilot salon", "put the before and after numbers on one page", "measure map pack position after a week"],
    move: "call the three pilots", question: "q?", phrase: "", channel: "local_seo", channel_reason: "salons are found on the map" };
  const out = H.huntSlotAssemble(p, { name: "Noah" }, slots, {});
  assert.strictEqual(out.channel, "local_seo");
  assert.strictEqual(out.channel_reason, "salons are found on the map");
  assert.ok(/Google Business Profile/.test(out.dm_long), "the first move is in the DM: " + out.dm_long);
  assert.deepStrictEqual(out.checks, [], "and it still passes the checks");
  // a channel we do not offer is dropped rather than shown
  assert.strictEqual(H.huntSlotAssemble(p, { name: "Noah" }, { ...slots, channel: "billboards" }, {}).channel, "");
}
console.log("every plan leads to a channel: ok");

// A first message has nothing to click and nothing to look up, and it ends on
// a question to them and a thank you.
{
  const p = { id: "fm", sub: "startups", author: "Jane", title: "Looking for a technical co-founder for my gym scheduling app", body: "400 on the waitlist" };
  const slots = { fit: "yes", product: "gym scheduling app", observation: "Four hundred on a waitlist answers the demand question",
    points: ["gyms churn in January and nobody budgets for it", "the front desk decides adoption, not the owner"],
    steps: ["call ten gyms that already pay for software", "put a booking mock in front of them", "measure who books without help"],
    move: "pre-sell ten gyms", question: "which of those two is costing you more right now", phrase: "",
    channel: "local_seo", channel_reason: "gyms are found on the map" };
  for (const profile of [{ name: "Noah" }, { name: "Noah", portfolio: "https://example.com", credit: "I run a team." }]) {
    const out = H.huntSlotAssemble(p, profile, slots, {});
    for (const d of [out.dm_short, out.dm_long]) {
      assert.ok(!/https?:\/\//.test(d), "no link: " + d);
      assert.ok(!/\b[a-z0-9-]+\.(com|net|io|co|ai|app|dev|org)\b/i.test(d), "no domain name: " + d);
      assert.ok(!/portfolio|case study|check out|our website/i.test(d), "nothing to look at: " + d);
      assert.ok(/\?/.test(d), "it asks them something: " + d);
      assert.ok(/\bthank/i.test(d.split("\n").pop()), "and thanks them at the end: " + d);
    }
    assert.deepStrictEqual(out.checks, [], "and it passes its own checks: " + out.checks.join("; "));
  }
  // the checks refuse anything that breaks those rules
  const ok = H.huntSlotAssemble(p, { name: "Noah" }, slots, {});
  assert.ok(H.dmChecks(ok.dm_short + " See mysite.com", ok.dm_long, {}).some((x) => /domain name/.test(x)));
  assert.ok(H.dmChecks(ok.dm_short + " I can send the portfolio.", ok.dm_long, {}).some((x) => /look at/.test(x)));
  assert.ok(H.dmChecks(ok.dm_short.replace(/\?/g, "."), ok.dm_long, {}).some((x) => /end on a question/.test(x)));
  assert.ok(H.dmChecks(ok.dm_short.replace(/Thanks[^.]*\./i, ""), ok.dm_long, {}).some((x) => /thank you/.test(x)));
  // and both writers are told
  assert.ok(/no link, no domain name, no website, no portfolio/i.test(H.huntSlotPrompt(p, {}, {}).system), "the writer is told");
  assert.ok(/no link, no domain, no website, no portfolio/i.test(H.huntAiPrompt(p, {}).system), "the full letter is told");
}
console.log("a first message has nothing to click: ok");
