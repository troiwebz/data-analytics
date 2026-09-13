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

HEAT.DEFAULT_KEYWORDS = [
  // offers
  '"for hire" website', '"for hire" "web developer"', '"for hire" "web designer"', '"for hire" "landing page"',
  '"for hire" wordpress', '"for hire" shopify', '"for hire" "small business" website', "[OFFER] website", "[OFFER] landing page",
  '"build your website"', '"build you a website"', '"I\'ll build"', '"I will build"', '"website for $"', '"websites for"',
  '"website in 7 days"', '"website in 48 hours"', '"website in 24 hours"', '"starting at" website', '"flat fee" website',
  '"one page website"', '"5 page website"', '"redesign your website"', '"fix your website"', '"website audit"',
  // freebies and value bombs
  '"free website"', '"for free" website', '"free landing page"', '"free audit"', '"free website audit"',
  '"free homepage"', '"free mockup"', '"free redesign"', '"free consultation" website', '"in exchange for" testimonial',
  '"for a testimonial"', '"first 5"', '"first 10"', '"first 3"', '"giveaway" website', '"I made" website free',
  '"value bomb"', '"here\'s how" website', '"here is how" website', '"lessons learned" website', '"what I learned" website clients',
  '"I built" "for free"', '"built a free"', '"free template"', '"free tool" website', "AMA web design", "AMA web developer",
  // demand
  '"need a website"', '"need a web developer"', '"need a web designer"', '"looking for a web developer"', '"looking for a web designer"',
  '"looking for someone to build"', '"who can build"', '"recommend a web"', '"website quote"', '"quoted me" website',
  '"how much" website', '"how much should" website', '"is it worth" website', '"hiring" website', '"hiring" "web developer"',
  '"hiring" "landing page"', '"[Hiring]" website', '"[Task]" website', '"website help"', '"my website" redesign',
  '"squarespace" vs', '"wix" vs', '"godaddy" website hate', '"my website sucks"', '"website is outdated"', '"no website"',
];

// Reddit's search box accepts Lucene-style OR. Batching keeps request count low.
HEAT.BATCH_SIZE = 5;

HEAT.batchKeywords = function (keywords, size = HEAT.BATCH_SIZE) {
  const clean = (keywords || []).map((k) => k.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < clean.length; i += size) {
    const group = clean.slice(i, i + size).map((k) => `(${k})`);
    out.push({ keywords: clean.slice(i, i + size), q: group.join(" OR ") });
  }
  return out;
};

HEAT.searchUrl = function (sub, q, sort = "new", t = "month", limit = 100) {
  return `https://old.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(q)}&restrict_sr=on&sort=${sort}&t=${t}&limit=${limit}&raw_json=1`;
};

HEAT.commentsUrl = function (permalink) {
  return `https://old.reddit.com${permalink}.json?limit=300&depth=3&raw_json=1`;
};

// Which of the batch's keywords literally appear in the post. A keyword like
// '"for hire" website' matches when every quoted phrase / bare word appears.
HEAT.matchedKeywords = function (keywords, text) {
  const hay = (text || "").toLowerCase();
  return (keywords || []).filter((k) => {
    const parts = k.match(/"[^"]+"|\S+/g) || [];
    return parts.every((p) => hay.includes(p.replace(/^"|"$/g, "").toLowerCase()));
  });
};

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

HEAT.summariseComments = function (listing, opAuthor) {
  const out = { total: 0, buyer: 0, lead: 0, heckle: 0, op: 0, opReplies: 0, closed: false, uniqueCommenters: 0, sampleBuyer: "" };
  const people = new Set();
  const walk = (children, parentAuthor) => {
    for (const c of children || []) {
      if (!c || c.kind !== "t1") continue;
      const d = c.data || {};
      out.total += 1;
      if (d.author && d.author !== opAuthor) people.add(d.author);
      const cls = HEAT.classifyComment(d.body, d.author, opAuthor);
      if (cls === "buyer") { out.buyer += 1; if (!out.sampleBuyer) out.sampleBuyer = (d.body || "").slice(0, 140); }
      else if (cls === "lead") { out.lead += 1; if (!out.sampleBuyer) out.sampleBuyer = (d.body || "").slice(0, 140); }
      else if (cls === "heckle") out.heckle += 1;
      else if (cls === "op" || cls === "closed") {
        out.op += 1;
        if (parentAuthor && parentAuthor !== opAuthor) out.opReplies += 1;
        if (cls === "closed") out.closed = true;
      }
      if (d.replies && d.replies.data) walk(d.replies.data.children, d.author);
    }
  };
  if (Array.isArray(listing) && listing[1] && listing[1].data) walk(listing[1].data.children, opAuthor);
  out.uniqueCommenters = people.size;
  return out;
};

// ---------------------------------------------------------------------------
// Records and scoring
// ---------------------------------------------------------------------------
HEAT.postFromChild = function (c, sub, batch) {
  const p = c.data || {};
  const body = p.selftext || "";
  const text = (p.title || "") + "\n" + body;
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
    price: HEAT.extractPrice(text.slice(0, 1800)),
    keywords: HEAT.matchedKeywords(batch ? batch.keywords : [], text),
    score: p.score || 0,
    comments: p.num_comments || 0,
  };
};

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

HEAT.CSV_COLS = ["leadScore", "heat", "type", "sub", "price", "score", "comments", "dComments48h", "cmtsPerDay", "leadReplies", "buyerReplies", "opReplies", "uniqueCommenters", "heckles", "closed", "posted", "keywords", "title", "url", "sampleReply"];

HEAT.toCsv = function (rows) {
  const esc = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  return [HEAT.CSV_COLS.join(",")].concat(rows.map((r) => HEAT.CSV_COLS.map((c) => esc(Array.isArray(r[c]) ? r[c].join(" | ") : r[c])).join(","))).join("\n");
};

HEAT.toRow = function (p, snaps, now = Date.now()) {
  const h = HEAT.heatScore(p, snaps, now);
  const s = p.signals || {};
  return {
    id: p.id, leadScore: h.lead, heat: h.heat, type: p.type, sub: p.sub, price: p.price || "", score: p.score, comments: p.comments,
    dComments48h: h.dComments, cmtsPerDay: h.perDay, leadReplies: s.lead || 0, buyerReplies: s.buyer || 0, opReplies: s.opReplies || 0,
    uniqueCommenters: s.uniqueCommenters || 0, heckles: s.heckle || 0, closed: !!s.closed, posted: new Date(p.created).toISOString().slice(0, 10),
    keywords: p.keywords || [], title: p.title, url: p.url, sampleReply: s.sampleBuyer || "", analysed: !!p.signals,
  };
};
