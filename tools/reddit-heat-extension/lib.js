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
  if (/\[(hiring|task)\]|\bhiring\b|need a (web|website|developer|designer)|looking for (a|an|someone)|who can build|recommend|how much|quoted me|is it worth|my website (sucks|is outdated)|website help/.test(t)) return "demand";
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

HEAT.CSV_COLS = ["leadScore", "heat", "type", "groups", "sub", "price", "score", "ratio", "comments", "dComments48h", "cmtsPerDay", "leadReplies", "buyerReplies", "opReplies", "uniqueCommenters", "heckles", "closed", "posted", "author", "flair", "keywords", "title", "url", "linkUrl", "body", "replies"];

HEAT.toCsv = function (rows) {
  const esc = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  return [HEAT.CSV_COLS.join(",")].concat(rows.map((r) => HEAT.CSV_COLS.map((c) => esc(Array.isArray(r[c]) ? r[c].join(" | ") : r[c])).join(","))).join("\n");
};

HEAT.toRow = function (p, snaps, now = Date.now()) {
  const h = HEAT.heatScore(p, snaps, now);
  const s = p.signals || {};
  return {
    id: p.id, leadScore: h.lead, heat: h.heat, type: p.type, groups: p.groups || [], sub: p.sub, price: p.price || "", score: p.score, ratio: p.ratio || "",
    comments: p.comments, dComments48h: h.dComments, cmtsPerDay: h.perDay, leadReplies: s.lead || 0, buyerReplies: s.buyer || 0, opReplies: s.opReplies || 0,
    uniqueCommenters: s.uniqueCommenters || 0, heckles: s.heckle || 0, closed: !!s.closed, posted: new Date(p.created).toISOString().slice(0, 10),
    author: p.author || "", flair: p.flair || "", keywords: p.keywords || [], title: p.title, url: p.url, linkUrl: p.linkUrl || "", body: p.body || "",
    replies: s.replies || [], sampleReply: s.sampleBuyer || "", analysed: !!p.signals,
  };
};
