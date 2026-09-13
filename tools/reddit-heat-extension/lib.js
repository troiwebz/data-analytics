// Shared logic for background worker, popup and options page. No DOM and no
// chrome.* here so it can be unit-tested in Node (see test.js).

const HEAT = (typeof globalThis !== "undefined" ? globalThis : self);

// ---------------------------------------------------------------------------
// Defaults. Edit in the extension's Options page; these only seed first run.
// ---------------------------------------------------------------------------
HEAT.DEFAULT_SUBS = [
  "forhire", "b2bforhire", "slavelabour", "jobbit", "DesignJobs", "freelance_forhire",
  "smallbusiness", "sweatystartup", "Entrepreneur", "EntrepreneurRideAlong", "startups",
  "SideProject", "smallbusinessUS", "restaurantowners", "localseo", "webdev", "web_design",
];

// Lines starting with # are category headers; blank lines are ignored.
HEAT.DEFAULT_KEYWORD_TEXT = `
# Offers — priced website builds
"for hire" website
"for hire" "web developer"
"for hire" "web designer"
"for hire" "landing page"
"for hire" wordpress
"for hire" shopify
"for hire" webflow
"for hire" squarespace
"for hire" wix
"for hire" framer
"for hire" ecommerce
"for hire" "small business" website
"for hire" "website redesign"
"for hire" "website in"
"for hire" "full stack" website
"for hire" "front end" website
"for hire" "seo" website
[OFFER] website
[OFFER] "landing page"
[OFFER] wordpress
[OFFER] shopify
"build your website"
"build you a website"
"build a website for you"
"I'll build"
"I will build"
"I'll design"
"I will design"
"I'll make you a website"
"website for $"
"websites for $"
"website for 99"
"website for 199"
"website for 299"
"website for 499"
"website for 500"
"website for 999"
"$99 website"
"$199 website"
"$299 website"
"$499 website"
"$500 website"
"$999 website"
"landing page for $"
"flat fee" website
"flat rate" website
"fixed price" website
"starting at" website
"starting from" website
"one page website"
"one-page website"
"5 page website"
"five page website"
"website in 7 days"
"website in a week"
"website in 48 hours"
"website in 24 hours"
"website in 3 days"
"unlimited revisions" website
"money back" website
"refund" website build
"hosting included"
"no upfront" website
"per month" website build
"/month" website hosting edits
"website subscription"
"website as a service"
"website package"
"starter website"
"business website" package
"redesign your website"
"fix your website"
"website audit" $
"speed up your website"
"mobile friendly" website build

# Freebies — free work that captures leads
"free website"
"for free" website
"free landing page"
"free audit"
"free website audit"
"free seo audit"
"free homepage"
"free mockup"
"free redesign"
"free consultation" website
"free for the first"
"free for 5"
"free for 3"
"first 5" website
"first 10" website
"first 3" website
"in exchange for" testimonial
"in exchange for a review"
"for a testimonial"
"for a case study" free
"giveaway" website
"giving away" website
"I built" "for free"
"built a free"
"free template" website
"free tool" website
"no strings" website
"free roast" website
"roast my website"
"roast your website"
"I'll review your website"
"I'll audit your website"
"free feedback" website
"free 15 min" website
"free call" website
"portfolio building" free website
"need portfolio pieces"

# Value bombs — lessons, playbooks, case studies that attract DMs
"here's how" website clients
"here is how" website clients
"how I got" clients website
"how I landed" clients
"how I closed" client
"how I make" website business
"I made $" website
"made $" websites
"lessons learned" website
"what I learned" clients
"case study" website small business
"breakdown" website clients
AMA "web design"
AMA "web developer"
AMA "web agency"
"step by step" website clients
"playbook" web design clients
"mistakes" web design clients
"cold email" website clients
"cold outreach" website
"cold calling" website
"got my first client"
"first client" web design
"closed my first"
"my first $1000"
"my first $10k"
"pricing" web design clients
"how to price" website
"raised my rates"
"teardown" website
"I audited" websites
"I analyzed" websites
"what works" web design reddit
"reddit clients" web design

# Demand — buyers asking for a builder or a price
"need a website"
"need a web developer"
"need a web designer"
"need a landing page"
"need someone to build"
"looking for a web developer"
"looking for a web designer"
"looking for a developer" website
"looking for someone to build"
"looking to hire" website
"who can build"
"who should I hire" website
"can anyone build"
"recommend a web"
"recommend a website"
"recommendations" "web designer"
"website quote"
"quoted me" website
"got a quote" website
"how much" website
"how much should" website
"how much does" website cost
"how much to" build website
"fair price" website
"overpriced" website
"rip off" website
"should I pay" website
"worth it" website
"is it worth" website
"hiring" website
"hiring" "web developer"
"hiring" "web designer"
"hiring" "landing page"
[Hiring] website
[Hiring] "web developer"
[Hiring] wordpress
[Hiring] shopify
[Task] website
"website help"
"help with my website"
"my website" redesign
"my website sucks"
"my website is outdated"
"website is outdated"
"website looks dated"
"no website" business
"don't have a website"
"do I need a website"
"squarespace" vs
"wix" vs
"godaddy" website
"web agency" quote
"agency quoted"
"freelancer vs agency" website
"budget" website build
"$500 budget" website
"$1000 budget" website
"$2000" website quote
"$3000" website quote
"$5000" website quote

# AI-era demand — people stuck with DIY / AI-built sites
"vibe coded" website
"vibe coding" help
"lovable" website
"lovable" fix
"bolt.new"
"v0" website
"cursor" website broken
"built with ai" website
"ai built" website
"ai made" website
"chatgpt" built website
"chatgpt made" website
"ai website builder" broken
"ai generated" website fix
"wix" broken
"wix" not showing google
"squarespace" help website
"godaddy" website builder help
"durable" website
"framer" site help
"webflow" help fix
"shopify" store help
"shopify" not converting
"finish my website"
"finish my app"
"someone to finish"
"fix my website"
"my website is broken"
"website not loading"
"website not working"
"deploy my website"
"connect my domain"
"domain not working"
"hosting" help website
"not showing up on google"
"not ranking" website
"website not converting"
"no leads from my website"
"landing page for ads"
"landing page" facebook ads
"landing page" google ads
"website for my business" ai
"should I use ai" website
"ai vs hiring" web designer
"worth hiring" web designer ai
"is web design dead"
"replace my web designer"
"fired my web designer"
"web designer ghosted"
"developer ghosted"
"scammed" web designer
"redo my website"
"rebuild my website"
"migrate my website"
"move my website"

# Niches — local service buyers
plumber website
plumbing website
electrician website
hvac website
roofing website
roofer website
landscaping website
lawn care website
cleaning company website
cleaning business website
contractor website
handyman website
painter website
pest control website
auto repair website
detailing website
dentist website
dental website
chiropractor website
physical therapy website
med spa website
clinic website
lawyer website
law firm website
accountant website
bookkeeping website
salon website
barber website
gym website
personal trainer website
yoga studio website
restaurant website
cafe website
bakery website
food truck website
real estate agent website
realtor website
mortgage website
photographer website
wedding website business
florist website
tattoo website
coach website
consultant website
therapist website
nonprofit website
church website
etsy shop website
`;

HEAT.parseKeywordText = function (text) {
  const out = [];
  let group = "Other";
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) { group = line.replace(/^#+\s*/, "").split(/\s[—-]\s/)[0].trim() || "Other"; continue; }
    out.push({ kw: line, group });
  }
  return out;
};

HEAT.DEFAULT_KEYWORDS = HEAT.parseKeywordText(HEAT.DEFAULT_KEYWORD_TEXT).map((k) => k.kw);

// ---------------------------------------------------------------------------
// Crawler URLs. Two transports:
//   public : old.reddit.com/....json          ~10 requests/min, no key needed
//   oauth  : oauth.reddit.com/...  (bearer)   100 requests/min with a free
//            "installed app" client id from https://www.reddit.com/prefs/apps
// ---------------------------------------------------------------------------
HEAT.listingUrl = function (sub, after, limit = 100, oauth = false) {
  const base = oauth ? `https://oauth.reddit.com/r/${sub}/new` : `https://old.reddit.com/r/${sub}/new.json`;
  return `${base}?limit=${limit}&raw_json=1${after ? `&after=${encodeURIComponent(after)}` : ""}`;
};

HEAT.searchUrl = function (sub, q, sort = "new", t = "month", limit = 100, oauth = false) {
  const base = oauth ? `https://oauth.reddit.com/r/${sub}/search` : `https://old.reddit.com/r/${sub}/search.json`;
  return `${base}?q=${encodeURIComponent(q)}&restrict_sr=on&sort=${sort}&t=${t}&limit=${limit}&raw_json=1`;
};

HEAT.commentsUrl = function (permalink, oauth = false) {
  const base = oauth ? `https://oauth.reddit.com${permalink}` : `https://old.reddit.com${permalink}.json`;
  return `${base}?limit=300&depth=3&raw_json=1`;
};

// Keywords are compiled once per run: each keyword becomes the list of
// lowercase phrases that must ALL appear in the post text.
HEAT.compileKeywords = function (entries) {
  return (entries || []).map((e) => {
    const kw = typeof e === "string" ? e : e.kw;
    const parts = (kw.match(/"[^"]+"|\S+/g) || []).map((p) => p.replace(/^"|"$/g, "").toLowerCase()).filter(Boolean);
    return { kw, group: (typeof e === "string" ? "Other" : e.group) || "Other", parts };
  });
};

// Which keywords literally appear in the text. Accepts compiled entries or
// plain strings. Returns { keywords: [...], groups: [...] }.
HEAT.matchKeywords = function (compiled, text) {
  const hay = (text || "").toLowerCase();
  const keywords = [], groups = new Set();
  for (const c of compiled || []) {
    const e = c.parts ? c : HEAT.compileKeywords([c])[0];
    if (e.parts.length && e.parts.every((p) => hay.includes(p))) { keywords.push(e.kw); groups.add(e.group); }
  }
  return { keywords, groups: Array.from(groups) };
};

HEAT.matchedKeywords = function (keywords, text) { return HEAT.matchKeywords(keywords, text).keywords; };

// ---------------------------------------------------------------------------
// Post typing and price extraction
// ---------------------------------------------------------------------------
HEAT.classifyPost = function (title, body) {
  const t = (title || "").toLowerCase();
  const all = (t + "\n" + (body || "").slice(0, 2000)).toLowerCase();
  if (/\[(hiring|task)\]|\bhiring\b|need a (web|website|developer|designer|landing)|need (someone|help)|looking for (a|an|someone)|who can (build|fix|finish|help)|can (anyone|someone) (build|fix|finish|help)|recommend|how much|quoted me|is it worth|worth (hiring|paying)|my (website|site|app) (sucks|is outdated|is broken|isn'?t working|won'?t)|website help|help with my (website|site|store|landing)|(fix|finish|rebuild|redo|migrate|deploy) my (website|site|app|store)|(lovable|bolt|v0|vibe.?cod|ai.?(built|made|generated)|chatgpt|cursor)\b.*\b(site|website|app|landing|store)|(site|website|app|landing|store)\b.*\b(lovable|bolt\.new|vibe.?cod|built with ai)|not (showing|ranking|converting|loading|working)|ghosted|scammed/.test(t)) return "demand";
  if (/\bfree\b|giveaway|for a testimonial|in exchange for|first (3|5|10)\b/.test(t)) return "freebie";
  if (/\bama\b|here'?s how|here is how|lessons? learned|what i learned|i made \$|case study|breakdown|value bomb|how i (got|landed|built|made)/.test(t)) return "value";
  if (/\[(for hire|offer)\]|\bfor hire\b|\boffer\b|i(?:'ll| will) build|build you(?:r)? (?:a )?website|websites? for \$?\d|starting at|flat fee|\$\d+/.test(t)) return "offer";
  if (/\[(for hire|offer)\]/.test(all)) return "offer";
  return "other";
};

HEAT.extractPrice = function (text) {
  if (!text) return "";
  const t = text.replace(/,/g, "");
  const hourly = t.match(/(\$|€|£)\s?(\d{2,3})\s?(?:\/|per)\s?(?:hr|hour|h)\b/i) || t.match(/(\d{2,3})\s?(\$|€|£)\s?(?:\/|per)\s?(?:hr|hour|h)\b/i);
  const flat = t.match(/(\$|€|£)\s?(\d{2,5})(?!\s?(?:\/|per)\s?(?:hr|hour|h))/i) || t.match(/(\d{2,5})\s?(\$|€|£)(?!\s?(?:\/|per)\s?(?:hr|hour|h))/i);
  const startsAt = /\b(starting|start|from)\b[^.\n]{0,15}(\$|€|£)/i.test(t) || /(\$|€|£)\s?\d+\s?\+/.test(t);
  if (flat) {
    const sym = flat[1].length === 1 ? flat[1] : flat[2];
    const num = flat[1].length === 1 ? flat[2] : flat[1];
    return (startsAt ? "from " : "") + sym + num;
  }
  if (hourly) {
    const sym = hourly[1].length === 1 ? hourly[1] : hourly[2];
    const num = hourly[1].length === 1 ? hourly[2] : hourly[1];
    return sym + num + "/hr";
  }
  if (/\bfree\b/i.test(t)) return "free";
  return "";
};

// ---------------------------------------------------------------------------
// Comment classification: the lead evidence
// ---------------------------------------------------------------------------
// buyer  = a prospective client asking a real question about the service
// lead   = someone raising their hand: "DM'd", "interested", "send me the link",
//          "can I get one" (the freebie / value-bomb conversion signal)
// closed = OP says booked / filled / found someone
// heckle = price policing or scam accusations
const BUYER_RE = /\b(how much|what(?:'s| is| are) (?:the|your) (?:price|rate|cost|fee)s?|quote|can you (?:do|build|make|handle|help)|do you (?:do|build|make|offer|work with)|i need|i'?m looking for|i am looking for|we need|our (?:business|company|shop|store|restaurant|clinic|salon)|for my (?:business|shop|store|company|restaurant|salon|clinic|practice)|timeline|turnaround|wordpress\?|shopify\?|ecommerce\?|e-commerce\?|do you take|payment|deposit)\b/i;
const LEAD_RE = /\b(dm'?d you|dm'?d|pm'?d|sent you a (?:dm|pm|message)|messaged you|i'?m interested|interested!?$|send me|can i (?:get|have)|could i (?:get|have)|i'?d (?:like|love) (?:one|this|to)|sign me up|count me in|link\??$|link please|please share|me too|\+1|i'?ll take (?:one|it)|in for one|dm me)\b/i;
const CLOSED_RE = /\b(fully booked|booked (?:up|out|solid)|no longer available|not (?:taking|accepting) (?:any )?(?:more|new)|slots? (?:are|is) (?:full|taken|gone|filled)|all (?:slots|spots) (?:are )?(?:taken|filled|gone)|closed|filled|found (?:someone|a dev|a developer|a designer)|thanks everyone,? (?:i|we)(?:'ve| have) (?:found|hired)|position (?:has been )?filled|hired someone)\b/i;
const HECKLE_RE = /\b(scam|scammer|too cheap|race to the bottom|undercut|red flag|lol|lmao|ai slop|why so cheap|no way|spam|self[- ]promo)\b/i;

HEAT.classifyComment = function (body, author, opAuthor) {
  const b = (body || "").trim();
  if (!b || b === "[deleted]" || b === "[removed]") return "other";
  const isOp = author && opAuthor && author.toLowerCase() === opAuthor.toLowerCase();
  if (isOp) return CLOSED_RE.test(b) ? "closed" : "op";
  if (LEAD_RE.test(b)) return "lead";
  if (BUYER_RE.test(b)) return "buyer";
  if (HECKLE_RE.test(b)) return "heckle";
  return "other";
};

// Flat form: comments = [{ author, body, parentAuthor }]. Used by both the
// JSON walker below and the page scraper (content.js).
HEAT.summariseFlat = function (comments, opAuthor) {
  const out = { total: 0, buyer: 0, lead: 0, heckle: 0, op: 0, opReplies: 0, closed: false, uniqueCommenters: 0, sampleBuyer: "", replies: [] };
  const people = new Set();
  const keep = (d, cls) => { if (out.replies.length < 5) out.replies.push(`[${cls}] u/${d.author}: ${(d.body || "").replace(/\s+/g, " ").slice(0, 160)}`); };
  for (const d of comments || []) {
    out.total += 1;
    if (d.author && d.author !== opAuthor) people.add(d.author);
    const cls = HEAT.classifyComment(d.body, d.author, opAuthor);
    if (cls === "buyer") { out.buyer += 1; if (!out.sampleBuyer) out.sampleBuyer = (d.body || "").slice(0, 140); keep(d, cls); }
    else if (cls === "lead") { out.lead += 1; if (!out.sampleBuyer) out.sampleBuyer = (d.body || "").slice(0, 140); keep(d, cls); }
    else if (cls === "heckle") out.heckle += 1;
    else if (cls === "op" || cls === "closed") {
      out.op += 1;
      if (d.parentAuthor && d.parentAuthor !== opAuthor) out.opReplies += 1;
      if (cls === "closed") { out.closed = true; keep(d, cls); }
    }
  }
  out.uniqueCommenters = people.size;
  return out;
};

HEAT.summariseComments = function (listing, opAuthor) {
  const flat = [];
  const walk = (children, parentAuthor) => {
    for (const c of children || []) {
      if (!c || c.kind !== "t1") continue;
      const d = c.data || {};
      flat.push({ author: d.author, body: d.body, parentAuthor });
      if (d.replies && d.replies.data) walk(d.replies.data.children, d.author);
    }
  };
  if (Array.isArray(listing) && listing[1] && listing[1].data) walk(listing[1].data.children, opAuthor);
  return HEAT.summariseFlat(flat, opAuthor);
};

// Build a post record from fields scraped off an old.reddit page.
HEAT.postFromScrape = function (f, compiled) {
  const text = (f.title || "") + "\n" + (f.body || "");
  const m = HEAT.matchKeywords(compiled || [], text);
  const permalink = (f.permalink || "").replace(/^https?:\/\/[^/]+/, "");
  return {
    id: f.id, sub: f.sub || "", type: HEAT.classifyPost(f.title, f.body), title: f.title || "", author: f.author || "", flair: f.flair || "",
    created: f.created || 0, permalink, url: "https://old.reddit.com" + permalink, linkUrl: f.linkUrl || "",
    body: (f.body || "").replace(/\s+/g, " ").slice(0, 1200), price: HEAT.extractPrice(text.slice(0, 1800)),
    keywords: m.keywords, groups: m.groups, score: f.score || 0, ratio: 0, comments: f.comments || 0, source: "page",
  };
};

// ---------------------------------------------------------------------------
// Records and scoring
// ---------------------------------------------------------------------------
// `compiled` is the output of compileKeywords (all keywords, matched locally).
HEAT.postFromChild = function (c, sub, compiled) {
  const p = c.data || {};
  const body = p.selftext || "";
  const text = (p.title || "") + "\n" + body;
  const m = HEAT.matchKeywords(compiled || [], text);
  return {
    id: p.name,
    sub: p.subreddit || sub,
    type: HEAT.classifyPost(p.title, body),
    title: p.title || "",
    author: p.author || "",
    flair: p.link_flair_text || "",
    created: (p.created_utc || 0) * 1000,
    permalink: p.permalink || "",
    url: "https://old.reddit.com" + (p.permalink || ""),
    linkUrl: p.is_self ? "" : (p.url || ""),
    body: body.replace(/\s+/g, " ").slice(0, 1200),
    price: HEAT.extractPrice(text.slice(0, 1800)),
    keywords: m.keywords,
    groups: m.groups,
    score: p.score || 0,
    ratio: p.upvote_ratio || 0,
    comments: p.num_comments || 0,
  };
};

// Keep a crawled post if any keyword matched, or it is clearly an offer /
// demand / freebie / value post even without a keyword hit.
HEAT.keepPost = function (post) { return (post.keywords && post.keywords.length > 0) || post.type !== "other"; };

// Lead score = evidence that the thread produced real prospects.
// Heat = how fast it is moving right now.
HEAT.leadScore = function (post) {
  const s = post.signals || {};
  return (s.lead || 0) * 5 + (s.buyer || 0) * 4 + (s.opReplies || 0) * 2 + (s.closed ? 20 : 0) + Math.min(10, (s.uniqueCommenters || 0)) - (s.heckle || 0) * 2;
};

HEAT.heatScore = function (post, snaps, now = Date.now(), windowMs = 48 * 3600 * 1000) {
  const cutoff = now - windowMs;
  const s = (snaps || []).slice().sort((a, b) => a.t - b.t);
  const latest = s[s.length - 1] || { score: post.score, comments: post.comments, t: now };
  let base = s.find((x) => x.t >= cutoff) || s[0] || latest;
  if (post.created >= cutoff) base = { score: 0, comments: 0, t: post.created };
  const dComments = Math.max(0, latest.comments - base.comments);
  const dScore = Math.max(0, latest.score - base.score);
  const ageDays = Math.max(0.25, (now - post.created) / 86400000);
  const lead = HEAT.leadScore(post);
  const heat = dComments * 3 + dScore + lead;
  return { heat: Math.round(heat * 10) / 10, lead, dComments, dScore, ageDays: Math.round(ageDays * 10) / 10, perDay: Math.round(((post.comments || 0) / ageDays) * 10) / 10 };
};

// Opportunity = a demand thread you could answer now: recent, unanswered,
// with a budget or a clear ask, not already swarmed.
HEAT.opportunityScore = function (post, now = Date.now()) {
  if (post.type !== "demand") return 0;
  const ageDays = Math.max(0, (now - (post.created || 0)) / 86400000);
  const text = (post.title || "") + " " + (post.body || "");
  const budget = /(\$|€|£)\s?\d{2,5}|\bbudget\b/i.test(text) ? 6 : 0;
  const ask = /\?|recommend|looking for|need (a|someone|help)|who can|can (anyone|someone)/i.test(text) ? 3 : 0;
  const fresh = Math.max(0, 14 - ageDays);
  const unanswered = (post.comments || 0) === 0 ? 6 : (post.comments || 0) < 6 ? 4 : (post.comments || 0) < 15 ? 1 : 0;
  return Math.round(fresh + budget + ask + unanswered);
};

const STOP = new Set("a an the and or of to for my our your with in on at is are was be it its this that i we you me they them from by as if any some please get got has have do does can would should could about just not after who up on off out so than then when where which what how why been being am into over under very really still also".split(" "));
// Frequent 2–3 word phrases in titles, for discovering how buyers actually phrase things.
HEAT.titlePhrases = function (titles, max = 25) {
  const counts = {};
  for (const t of titles || []) {
    const words = String(t || "").toLowerCase().replace(/\[[^\]]*\]/g, " ").replace(/[^a-z0-9$' ]+/g, " ").split(/\s+/).filter(Boolean);
    const seen = new Set();
    for (let n = 2; n <= 3; n++) for (let i = 0; i + n <= words.length; i++) {
      const g = words.slice(i, i + n);
      if (STOP.has(g[0]) || STOP.has(g[g.length - 1])) continue;
      if (g.every((w) => STOP.has(w) || w.length < 3)) continue;
      const p = g.join(" ");
      if (!seen.has(p)) { seen.add(p); counts[p] = (counts[p] || 0) + 1; }
    }
  }
  return Object.entries(counts).filter((e) => e[1] >= 2).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, max);
};

HEAT.CSV_COLS = ["leadScore", "opportunity", "heat", "type", "groups", "sub", "price", "score", "ratio", "comments", "dComments48h", "cmtsPerDay", "leadReplies", "buyerReplies", "opReplies", "uniqueCommenters", "heckles", "closed", "posted", "author", "flair", "keywords", "title", "url", "linkUrl", "body", "replies"];

HEAT.toCsv = function (rows) {
  const esc = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  return [HEAT.CSV_COLS.join(",")].concat(rows.map((r) => HEAT.CSV_COLS.map((c) => esc(Array.isArray(r[c]) ? r[c].join(" | ") : r[c])).join(","))).join("\n");
};

HEAT.toRow = function (p, snaps, now = Date.now()) {
  const h = HEAT.heatScore(p, snaps, now);
  const s = p.signals || {};
  return {
    id: p.id, leadScore: h.lead, opportunity: HEAT.opportunityScore(p, now), heat: h.heat, type: p.type, groups: p.groups || [], sub: p.sub, price: p.price || "", score: p.score, ratio: p.ratio || "",
    comments: p.comments, dComments48h: h.dComments, cmtsPerDay: h.perDay, leadReplies: s.lead || 0, buyerReplies: s.buyer || 0, opReplies: s.opReplies || 0,
    uniqueCommenters: s.uniqueCommenters || 0, heckles: s.heckle || 0, closed: !!s.closed, posted: new Date(p.created).toISOString().slice(0, 10),
    author: p.author || "", flair: p.flair || "", keywords: p.keywords || [], title: p.title, url: p.url, linkUrl: p.linkUrl || "", body: p.body || "",
    replies: s.replies || [], sampleReply: s.sampleBuyer || "", analysed: !!p.signals,
  };
};

// ---------------------------------------------------------------------------
// Campaign planner: turn scraped demand into 10 service ideas the user can
// edit, approve or reject before anything starts. Nothing is ever posted.
// ---------------------------------------------------------------------------
HEAT.IDEA_POOL = [
  { key: "ai-rescue", name: "AI-site rescue", who: "Owners stuck with a Lovable / Bolt / v0 / vibe-coded site or app",
    offer: "Fix or finish your AI-built site so it actually launches: broken checkout, auth, deploy, domain, mobile.", price: "$249 flat, 48 hours", upsell: "$99/mo hosting + fixes",
    match: /lovable|bolt\.new|\bv0\b|vibe.?cod|built with ai|ai.?(built|made|generated)|chatgpt|cursor|finish my (site|app|website)|someone to finish|deploy/i,
    title: "[For Hire] I finish and fix AI-built websites (Lovable, Bolt, v0, vibe-coded) — $249 flat, live in 48h",
    body: "You built it with AI and it almost works. I take it the last mile: broken checkout or forms, auth, deploy, custom domain, mobile layout, speed.\n\nIncluded: audit of what's wrong, the fixes, deploy on your domain, a 15-minute handover call, 14 days of follow-up fixes.\nPrice: $249 flat. 50% via PayPal Goods & Services or Stripe to start, 50% when it's live.\nPortfolio: [link]. DM me the site URL and what's broken." },
  { key: "google-visibility", name: "Not showing on Google fix", who: "Wix / Squarespace / GoDaddy / Shopify owners invisible on Google",
    offer: "Google Business Profile + on-page SEO + indexing fix so the business shows up for its own name and service.", price: "$149 flat", upsell: "$79/mo local SEO upkeep",
    match: /not (showing|ranking|appearing|found)|google (business|profile|maps)|\bseo\b|index/i,
    title: "[For Hire] Your website isn't showing on Google? I fix indexing, Google Business Profile and on-page SEO — $149 flat",
    body: "If you search your business name and your site doesn't come up, this is for you. Works on Wix, Squarespace, Shopify, WordPress.\n\nIncluded: indexing and Search Console fix, Google Business Profile set up or cleaned, titles/descriptions for every page, 5 local keywords placed, before/after report in 7 days.\nPrice: $149 flat, PayPal Goods & Services or Stripe.\nDM your URL and city." },
  { key: "ads-landing", name: "Landing page for ads", who: "Anyone running or about to run Facebook / Google ads",
    offer: "One conversion-focused landing page with form, tracking pixel and thank-you page.", price: "$299, 48 hours", upsell: "$149 per extra variant for A/B",
    match: /landing page|facebook ads|google ads|\bppc\b|\bads\b|conversion|not converting/i,
    title: "[For Hire] Landing page for your ad campaign, with pixel and form, $299 in 48 hours",
    body: "Sending ads to your homepage wastes budget. I build one page that matches the ad: headline, proof, offer, form, pixel + conversion event, thank-you page.\n\nIncluded: copy from your ad and offer, mobile-first design, Meta/Google tracking, one round of revisions, live on your domain in 48h.\nPrice: $299 flat. Extra variant for testing: $149.\nPortfolio: [link]. DM the ad or offer you're running." },
  { key: "ghosted-rescue", name: "Abandoned-project takeover", who: "Owners whose designer ghosted or delivered half a site",
    offer: "Take over a half-built site, finish it, and hand over full ownership with a written scope and escrow.", price: "$499 flat, scoped after a free 20-min review", upsell: "",
    match: /ghosted|scammed|disappeared|never finished|half.?(done|built|finished)|took my (money|deposit)|abandoned/i,
    title: "[For Hire] Designer ghosted you? I take over half-finished websites and get them live — fixed quote, milestone payments",
    body: "You paid a deposit, got a half-built site, and now nobody answers. I finish it.\n\nHow it works: free 20-minute review of what exists, written scope and fixed price, 3 milestones paid through PayPal Goods & Services or escrow, you own every login and file at the end.\nTypical: $499 for a 5-page site takeover, live in 7 days.\nPortfolio: [link]. DM the URL and what you were promised." },
  { key: "local-5page", name: "5-page local business site", who: "Trades and local services: plumbers, HVAC, salons, dentists, contractors",
    offer: "5-page site with booking or quote form, Google Business Profile connected, hosting set up.", price: "$499 flat, 7 days", upsell: "$99/mo hosting, edits, monthly report",
    match: /plumb|hvac|electric|roof|landscap|clean|contractor|handyman|dentist|dental|chiro|salon|barber|gym|restaurant|cafe|bakery|realtor|real estate|photograph|lawyer|law firm|accountant|clinic|need a website|small business/i,
    title: "[For Hire] 5-page website for local service businesses, $499 flat, live in 7 days, Google Business Profile included",
    body: "For plumbers, HVAC, cleaners, salons, clinics, contractors: a site that gets the phone to ring.\n\nIncluded: 5 pages (home, services, about, reviews, contact), click-to-call and quote form, Google Business Profile connected, hosting and domain set up, mobile-first, 30 days of edits.\nPrice: $499 flat. 50% to start via PayPal Goods & Services or Stripe.\nPortfolio: [link]. DM your trade and city." },
  { key: "subscription", name: "Website subscription, $0 down", who: "Owners who won't pay upfront", offer: "Site built free, then a monthly fee that covers hosting, edits and support. Cancel any time after 6 months.", price: "$0 down, $99/month", upsell: "",
    match: /budget|afford|cheap|expensive|how much|too much|can't pay|monthly|subscription|per month/i,
    title: "[For Hire] Business website for $0 down, $99/month: build, hosting, unlimited small edits, cancel after 6 months",
    body: "No upfront cost. I build your 5-page site, host it, and keep it updated for $99/month.\n\nIncluded: design and build, hosting and SSL, unlimited small edits (hours, prices, photos), monthly backup, a real person to email. After 6 months you can cancel and keep the site.\nPortfolio: [link]. DM your business type." },
  { key: "free-audit", name: "Free 5-point website audit (lead magnet)", who: "Any owner unsure why their site isn't working", offer: "Free written audit: speed, mobile, Google visibility, conversion, security. Upsell the fixes.", price: "Free, fixes quoted from $99", upsell: "Fix packages $99–$499",
    match: /roast|audit|feedback|review my|what's wrong|not (working|converting)|no leads/i,
    title: "Free 5-point audit of your business website this week (speed, mobile, Google, conversion, security), first 10 who comment",
    body: "Drop your URL in the comments. I'll reply with a short written audit: page speed score, mobile issues, whether Google can find you, what stops visitors from contacting you, and any security red flags.\n\nNo strings. If you want the fixes done I'll quote them, most are $99–$299. Limiting to the first 10 so I can do them properly." },
  { key: "speed-mobile", name: "Speed and mobile fix", who: "Owners with a slow or broken-on-phone site", offer: "Make the existing site fast and correct on mobile without a rebuild.", price: "$99 flat", upsell: "",
    match: /slow|speed|loading|mobile|phone|responsive|broken|not working/i,
    title: "[For Hire] Slow website or broken on phones? Fixed for $99 flat, same week, no rebuild",
    body: "Included: image and script optimisation, caching, mobile layout fixes, before/after PageSpeed report. Works on WordPress, Wix, Shopify, Squarespace, custom sites.\nPrice: $99 flat. PayPal Goods & Services or Stripe.\nDM your URL." },
  { key: "migration", name: "Platform migration", who: "Owners who outgrew Wix / GoDaddy / Squarespace", offer: "Move the site to WordPress or Webflow with no lost pages, redirects, and SEO preserved.", price: "$399 flat", upsell: "$99/mo hosting",
    match: /migrat|move my (site|website)|switch(ing)? (from|to)|leave wix|wix to|squarespace to|godaddy to|rebuild|redo my/i,
    title: "[For Hire] Move your site off Wix / GoDaddy / Squarespace to WordPress or Webflow, $399 flat, nothing lost",
    body: "Included: every page and image moved, same or better design, all URLs redirected so Google rankings hold, forms and booking reconnected, hosting set up, training video.\nPrice: $399 flat for up to 10 pages.\nDM your current URL." },
  { key: "shopify-setup", name: "Shopify store setup or fix", who: "Product sellers with a broken or empty store", offer: "Store set up with products, payments, shipping, theme tweaks, or fix a store that isn't converting.", price: "$349 setup / $149 fix", upsell: "",
    match: /shopify|woocommerce|store|ecommerce|e-commerce|checkout|products/i,
    title: "[For Hire] Shopify store set up properly ($349) or fixed ($149): products, payments, shipping, theme, checkout",
    body: "Included: theme set up to your brand, up to 20 products loaded, payments and shipping zones, legal pages, checkout tested, basic SEO. Fix package covers one clear problem: checkout, speed, theme bug, apps conflict.\nPrices: $349 setup, $149 fix.\nDM your store URL." },
  { key: "booking", name: "Booking and quote system add-on", who: "Service businesses taking bookings by phone or DM", offer: "Add online booking or a quote request flow to the existing site, connected to calendar and email.", price: "$199 flat", upsell: "",
    match: /booking|appointment|schedule|calendar|quote form|estimate/i,
    title: "[For Hire] Add online booking or a quote form to your existing website, $199 flat, connected to your calendar",
    body: "Included: booking or quote flow that fits your services, calendar sync, email/SMS confirmations, works on any platform.\nPrice: $199 flat.\nDM your URL and how you take bookings today." },
  { key: "hiring-responder", name: "Answer [Hiring] posts with a fixed quote", who: "Posters in r/forhire [Hiring] and 'looking for a developer' threads", offer: "A reply-and-DM template with a fixed quote and delivery date, sent within an hour of the post.", price: "Quote per post, typically $300–$1,500", upsell: "",
    match: /\[hiring\]|\[task\]|\bhiring\b|looking for (a|an|someone)|need (a|someone)|who can build|recommend/i,
    title: "(reply template) Fixed quote for your post",
    body: "Hi, I can do this for $[price], delivered by [date]. [One sentence on exactly how.] Two similar things I built: [link], [link]. Happy to do a 10-minute call first. Payment via PayPal Goods & Services or milestones, your choice. DM sent." },
];

HEAT.buildIdeas = function (posts, confirmedSubs = [], now = Date.now()) {
  const list = Object.values(posts || {});
  const demand = list.filter((p) => p.type === "demand");
  const ideas = HEAT.IDEA_POOL.map((idea) => {
    const hits = demand.filter((p) => idea.match.test((p.title || "") + " " + (p.body || "")));
    const recent = hits.filter((p) => now - (p.created || 0) < 30 * 86400000);
    const subs = {};
    for (const p of hits) subs[p.sub] = (subs[p.sub] || 0) + 1;
    const targets = Object.entries(subs).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([s]) => s);
    for (const s of confirmedSubs) if (!targets.includes(s) && targets.length < 6) targets.push(s);
    const opps = hits.map((p) => ({ p, o: HEAT.opportunityScore(p, now) })).sort((a, b) => b.o - a.o).slice(0, 8).map(({ p, o }) => ({ id: p.id, title: p.title, url: p.url, sub: p.sub, opp: o }));
    const evidence = recent.length * 3 + hits.length;
    return { key: idea.key, name: idea.name, who: idea.who, offer: idea.offer, price: idea.price, upsell: idea.upsell, title: idea.title, body: idea.body,
      matched: hits.length, recent: recent.length, evidence, targets, opps };
  });
  return ideas.sort((a, b) => b.evidence - a.evidence).slice(0, 10);
};

// ---------------------------------------------------------------------------
// Batch sweep: candidate subreddits (grouped), discovery searches, and the
// URL builder for one sweep item.
// ---------------------------------------------------------------------------
HEAT.CANDIDATE_SUBS = [
  { group: "AI & no-code builders", subs: ["lovable", "vibecoding", "boltnewbuilders", "cursor", "nocode", "webflow", "framer", "Wix", "squarespace", "GoDaddy", "Wordpress", "elementor", "shopify", "ecommerce", "woocommerce"] },
  { group: "Business owners", subs: ["smallbusiness", "smallbusinessowners", "sweatystartup", "Entrepreneur", "EntrepreneurRideAlong", "startups", "SaaS", "microsaas", "indiehackers", "SideProject", "Solopreneur"] },
  { group: "Niche owners", subs: ["restaurantowners", "EtsySellers", "realtors", "Contractor", "HVAC", "Plumbing", "electricians", "lawncare", "Landscaping", "cleaningbusiness", "photographybusiness", "Salon", "gymowners", "dentistry", "LawFirm", "therapists"] },
  { group: "Marketing", subs: ["PPC", "FacebookAds", "googleads", "localseo", "SEO", "GoogleMyBusiness", "DigitalMarketing", "AskMarketing"] },
  { group: "Hiring boards", subs: ["forhire", "b2bforhire", "jobbit", "DesignJobs", "freelance_forhire", "slavelabour", "hireaideveloper", "developers_hire"] },
  { group: "Regional", subs: ["smallbusinessUS", "smallbusinessuk", "ausbusiness", "Startups_EU", "uae_startups"] },
];

HEAT.DISCOVERY_QUERIES = [
  { key: "need", label: "need a website / developer / designer", q: '"need a website" OR "need a web developer" OR "need a web designer" OR "need a landing page"' },
  { key: "ai-fix", label: "AI-built site: fix / finish / broken", q: '(lovable OR "bolt.new" OR "vibe coded" OR "built with ai" OR chatgpt) (website OR site OR app) (fix OR finish OR broken OR help OR deploy)' },
  { key: "stuck", label: "Wix / Squarespace / Shopify owners stuck", q: '(wix OR squarespace OR godaddy OR shopify) ("not showing" OR broken OR "help with my" OR "not converting" OR "not working")' },
  { key: "designer", label: "quoted / ghosted / recommend a web designer", q: '"web designer" (ghosted OR quoted OR recommend OR "how much" OR scammed)' },
  { key: "ads", label: "landing page for ads: need / looking for", q: '"landing page" (need OR "looking for" OR ads OR "not converting")' },
  { key: "hiring", label: "[Hiring] website / developer, all subreddits", q: '"[hiring]" (website OR "web developer" OR "landing page" OR wordpress OR shopify)' },
  { key: "fix", label: "fix / rebuild / finish my website", q: '"fix my website" OR "rebuild my website" OR "finish my website" OR "my website is broken" OR "website not loading"' },
  { key: "google", label: "not showing up on Google", q: '"not showing up on google" OR "not ranking" OR "can\'t find my website on google"' },
];

// One sweep item → the first page URL. kind: "sub" | "query"
// sort: "new" | "top" | "relevance"; t: "day" | "week" | "month" | "year" | "all".
// Backward compatible: sort of "week"/"month" means top over that window.
HEAT.sweepUrl = function (item, sort = "new", t = "") {
  if (sort === "week" || sort === "month" || sort === "year") { t = sort; sort = "top"; }
  if (item.kind === "query") {
    const tt = sort === "new" ? "" : `&t=${t || "month"}`;
    return `https://old.reddit.com/search?q=${encodeURIComponent(item.q)}&sort=${sort}${tt}`;
  }
  if (sort === "new") return `https://old.reddit.com/r/${encodeURIComponent(item.sub)}/new/`;
  return `https://old.reddit.com/r/${encodeURIComponent(item.sub)}/top/?t=${t || "month"}`;
};

// Keyword sweep: each selected category's keywords are OR-ed in groups of
// `batch` into site-wide searches, sorted by relevance/top/new over window t.
HEAT.buildKeywordSweepQueue = function (entries, groups, pages, sort = "relevance", t = "week", batch = 4) {
  const q = [];
  const wanted = new Set(groups || []);
  const byGroup = {};
  for (const e of entries || []) if (wanted.has(e.group)) (byGroup[e.group] = byGroup[e.group] || []).push(e.kw);
  for (const [g, kws] of Object.entries(byGroup)) {
    for (let i = 0; i < kws.length; i += batch) {
      const chunk = kws.slice(i, i + batch);
      const query = chunk.map((k) => `(${k})`).join(" OR ");
      q.push({ kind: "query", group: g, keywords: chunk, label: `${g}: ${chunk[0]}${chunk.length > 1 ? ` +${chunk.length - 1}` : ""}`, pages, url: HEAT.sweepUrl({ kind: "query", q: query }, sort, t) });
    }
  }
  return q;
};

// Demand by keyword within a window: [{ kw, group, posts, recent, replies }]
HEAT.demandByKeyword = function (posts, days = 7, now = Date.now(), groupsOf = null) {
  const cutoff = now - days * 86400000;
  const m = {};
  for (const p of Object.values(posts || {})) {
    if (p.type !== "demand" || (p.created || 0) < cutoff) continue;
    const ev = p.signals ? (p.signals.lead || 0) + (p.signals.buyer || 0) : 0;
    for (const k of p.keywords || []) { const e = m[k] || (m[k] = { kw: k, posts: 0, replies: 0, comments: 0 }); e.posts += 1; e.replies += ev; e.comments += p.comments || 0; }
  }
  const out = Object.values(m);
  if (groupsOf) for (const e of out) e.group = groupsOf[e.kw] || "Other";
  return out.sort((a, b) => b.posts - a.posts || b.comments - a.comments);
};

HEAT.buildSweepQueue = function (subs, queryKeys, pages, sort) {
  const q = [];
  for (const s of subs || []) q.push({ kind: "sub", sub: s, label: `r/${s}`, pages, url: HEAT.sweepUrl({ kind: "sub", sub: s }, sort) });
  for (const k of queryKeys || []) { const d = HEAT.DISCOVERY_QUERIES.find((x) => x.key === k); if (d) q.push({ kind: "query", key: k, label: d.label, pages, url: HEAT.sweepUrl({ kind: "query", q: d.q }, sort) }); }
  return q;
};
