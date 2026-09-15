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
// Job seekers and job postings are not website buyers. Detect them first.
const JOBSEEKER_RE = /looking for (a |an )?(new |remote |full[- ]time |part[- ]time |digital marketing |marketing |developer |design )*(job|opportunit|role|position|work|internship|gig)|immediate joiner|notice period|open to (remote|hybrid|on-?site|new)|seeking (a |an )?(job|role|position|employment|opportunit)|hire me|resume|\bcv\b|years? of experience (working|in|as)|(fresher|graduate) looking|any (openings|referrals)|referrals? (would|appreciated)|open to work|available for (full|part)[- ]time/i;
const JOBPOST_RE = /\b(salary|per annum|\blpa\b|\bctc\b|full[- ]time (position|role|employee)|we are hiring (a|an) (senior|junior|mid)|job (description|opening|requirements)|apply (here|now|at)|\b\d+\+? ?(yrs|years) (of )?experience (required|needed)|benefits (include|package)|401k|equity)\b/i;
// The ask must be about something a web builder can deliver.
const WEBCTX_RE = /web ?site|\bsite\b|landing ?page|home ?page|web (dev|design|developer|designer|page|app)|wordpress|shopify|wix|squarespace|godaddy|webflow|framer|lovable|bolt\.new|\bv0\b|vibe.?cod|online store|e-?commerce|\bapp\b|domain|hosting|\bseo\b|google (business|maps|profile)|not (showing|ranking) (up )?on google|booking (system|page)|portfolio site/i;

// Sellers phrase offers as questions ("Need a website? I'll build it"), so
// seller language is checked before buyer language.
const SELLER_RE = /\[(for hire|offer|selling)\]|\bfor hire\b|\bhire me\b|\bi(?:'m| am) (?:a|an) (?:web|wordpress|shopify|freelance|full[- ]stack|front[- ]end|ui|ux|graphic|seo)\b|\bi (?:build|design|develop|create|make|offer|specialize|specialise|help (?:businesses|companies|brands|founders))\b|\bi(?:'ll| will| can) (?:build|design|develop|create|make|fix|set up|setup|handle|deliver)\b|\bwe (?:build|design|develop|create|offer|specialize|specialise|help (?:businesses|companies|brands))\b|\bmy (?:services|rates|portfolio|agency|studio|clients)\b|\bour (?:services|rates|agency|studio|clients|team)\b|\b(?:taking|accepting|looking for) (?:new )?clients\b|\bavailable for (?:work|projects|hire|freelance|new)\b|\bdm me (?:for|if|to)\b|\bstarting (?:at|from) (?:\$|€|£)|\b(?:\$|€|£)\s?\d+\s?(?:\/|per)\s?(?:hr|hour|h)\b|\bflat (?:fee|rate)\b|\bfree (?:consultation|quote|audit) (?:for|if)\b|\byour (?:business|website|site|store|brand|company) (?:needs|deserves|could|will|to the next)\b|\bneed (?:a |an )?(?:website|site|landing page|logo|store)\??\s*(?:i|we|dm|let)\b|\bportfolio:|\bcheck (?:out )?my (?:work|portfolio)\b|\bturnaround\b|\brevisions? included\b|\bmoney[- ]back\b/i;
// Buyers speak in first person about their own thing.
const BUYER_VOICE_RE = /\b(?:i|we)(?:'m| am|'re| are|'ve| have|'d| would)? (?:need|looking|searching|trying|want|wondering|hoping|struggling|paid|hired|got quoted|was quoted)\b|\bmy (?:website|site|web ?site|store|shop|app|landing page|business|company|restaurant|salon|clinic|practice|domain|designer|developer|dev)\b|\bour (?:website|site|store|shop|app|landing page|business|company|team's site)\b|\bfor my (?:business|company|shop|store|restaurant|salon|clinic|practice|startup|side hustle)\b|\bwho (?:can|should) (?:i|we)\b|\bcan (?:anyone|someone|somebody)\b|\bany(?:one|body) (?:know|recommend|have)\b|\brecommend(?:ations?)?\b|\bhow much (?:should|does|would|do|to|for)\b|\bis it worth\b|\bwhat should i\b|\bquoted (?:me|us)\b|\bghosted (?:me|us)\b|\bscammed\b|\bbudget\b/i;

HEAT.classifyPost = function (title, body) {
  const t = (title || "").toLowerCase();
  const b = (body || "").slice(0, 2000).toLowerCase();
  const all = t + "\n" + b;
  if (JOBSEEKER_RE.test(t) || (JOBSEEKER_RE.test(b) && !WEBCTX_RE.test(t))) return "job";
  if (JOBPOST_RE.test(all) && !/landing page|website (for|redesign|build)/i.test(t)) return "job";
  const web = WEBCTX_RE.test(all);
  // Freebies (seller giving something away) before general seller check.
  const freeThing = /\bfree (?:website|site|landing page|home ?page|mockup|redesign|template|tool|audit|roast|feedback|review|seo audit|website audit)s?\b|giveaway|giving away|for a testimonial|in exchange for|first (3|5|10)\b/.test(t);
  const freeBait = /\bfree (?:quote|consultation|estimate|call|demo|trial)s?\b/.test(t);
  if (freeThing && !freeBait && web) return "freebie";
  if (/\bama\b|here'?s how|here is how|lessons? learned|what i learned|i made \$|case study|breakdown|value bomb|how i (got|landed|built|made)/.test(t)) return "value";
  const sellerTitle = SELLER_RE.test(t);
  const sellerBody = SELLER_RE.test(b.slice(0, 600));
  const buyerTitle = BUYER_VOICE_RE.test(t);
  if (sellerTitle && !(buyerTitle && /\b(?:i|we) (?:need|paid|hired|got quoted|was quoted)|\bmy (?:website|site|designer|developer)\b|ghosted|scammed/.test(t))) return web ? "offer" : "other";
  const demandAsk = /\[(hiring|task)\]|\bhiring\b|need (a |an |some |someone to )?(web|website|developer|designer|landing|dev\b|help)|need (?:someone|somebody|a dev|a developer|a designer|an expert) (?:to |who can )?(?:fix|finish|build|make|redo|rebuild|migrate|set up|update|deploy|help)|looking for (a |an |someone )?(web|website|developer|designer|dev\b|freelancer|agency|someone to (build|fix|make|finish))|who can (build|fix|finish|help|make)|can (anyone|someone) (build|fix|finish|help|make|recommend)|recommend(ations?)? (a |an |for )?(web|website|developer|designer|agency|freelancer)|how much (does|should|would|to|for|is)|quoted me|got quoted|is it worth|worth (hiring|paying)|my (website|site|app|store) (sucks|is outdated|is broken|isn'?t working|won'?t|looks|doesn'?t)|website help|help with my (website|site|store|landing|app)|(fix|finish|rebuild|redo|migrate|deploy|update) my (website|site|app|store)|(lovable|bolt|v0|vibe.?cod|ai.?(built|made|generated)|chatgpt|cursor)\b.*\b(site|website|app|landing|store)|(site|website|app|landing|store)\b.*\b(lovable|bolt\.new|vibe.?cod|built with ai)|not (showing|ranking|converting|loading|working)|(designer|developer|dev|agency) (ghosted|scammed|disappeared)|ghosted (me|us)|scammed (me|us)/;
  if (demandAsk.test(t) && web && (buyerTitle || !sellerBody)) return "demand";
  if (sellerBody && web) return "offer";
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
HEAT.keepPost = function (post) {
  if (post.ignored || post.status === "not_lead") return false;
  if (["offer", "demand", "freebie", "value"].includes(post.type)) return true;
  if (post.type === "job") return false;
  // keyword-only hit: only if the thread is actually about a website / web work
  return !!(post.keywords && post.keywords.length && WEBCTX_RE.test((post.title || "") + " " + (post.body || "")));
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

// Opportunity = a demand thread you could answer now: recent, unanswered,
// with a budget or a clear ask, not already swarmed.
HEAT.opportunityScore = function (post, now = Date.now()) {
  if (post.type !== "demand" || post.ignored) return 0;
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

HEAT.CSV_COLS = ["status", "statusAt", "note", "leadScore", "opportunity", "heat", "type", "groups", "sub", "price", "score", "ratio", "comments", "dComments48h", "cmtsPerDay", "leadReplies", "buyerReplies", "opReplies", "uniqueCommenters", "heckles", "closed", "posted", "author", "flair", "keywords", "title", "url", "linkUrl", "body", "replies"];

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
    runs: p.runs || [], firstRun: p.firstRun || (p.runs || [])[0] || "", firstSeen: p.firstSeen || 0, lastSeen: p.lastSeen || 0,
    status: HEAT.statusOf(p), statusAt: p.statusAt ? new Date(p.statusAt).toISOString().slice(0, 16).replace("T", " ") : "", note: p.note || "",
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
  const demand = list.filter((p) => p.type === "demand" && !p.ignored);
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

// ---------------------------------------------------------------------------
// Value-bomb replies (Laurel Portié style): lead with their exact situation,
// diagnose it, give the complete fix in steps they can do today, no link,
// no price, no pitch; end with an open door. Subreddit-rule safe.
// ---------------------------------------------------------------------------
HEAT.REPLY_PLAYBOOKS = [
  { key: "ai-broken", match: /lovable|bolt\.new|\bv0\b|vibe.?cod|built with ai|ai.?(built|made|generated)|chatgpt|cursor|finish my (site|app)|someone to finish|deploy|checkout (is )?broken|auth/i,
    diagnose: "Nine times out of ten an AI-built site that \"almost works\" is failing at one of three seams: the generated code calls an API key or backend that only existed in the builder's preview, the form or checkout posts to a placeholder endpoint, or the deploy points at a build that is older than the code you see.",
    steps: [
      "Open the live site, press F12 → Console, reload, and copy the first red error. That line names the seam. If it mentions 401/403 or \"undefined\" next to a key, it is an environment-variable problem: the key is set in the builder but not in your host (Vercel/Netlify/Lovable → Settings → Environment variables). Add it there and redeploy.",
      "Test the broken action (checkout, form, login) with the Network tab open. Click it, look for the request that turns red. If the URL contains \"localhost\", \"example\", or \"your-api\", the code still has a placeholder; search the project for that string and replace it with the real URL.",
      "If it works on desktop but not on phone, it is almost always a fixed-width container. Search the CSS for \"width: 1\" (e.g. 1200px) and change those to max-width with width 100%.",
      "Before touching anything else, export the code (Lovable → GitHub sync, Bolt → download) so you have a copy that isn't locked in the builder. Fixes are far easier in a real editor.",
      "Deploy from that exported repo, not from the builder, so the version on your domain is exactly the version you fixed.",
    ],
    watch: "Don't let anyone \"rebuild it from scratch\" as the first answer. What you have is usually 80% done; it needs the last 20%, which is a few hours, not a new project." },
  { key: "google", match: /not (showing|ranking|appearing|found)|google (business|profile|maps)|\bseo\b|index|can'?t find my (site|website)/i,
    diagnose: "\"Not showing on Google\" is usually one of three separate problems that look the same: the site isn't indexed at all, it's indexed but has no page that matches what people search, or your Google Business Profile isn't linked to it.",
    steps: [
      "Search Google for site:yourdomain.com (no spaces). Zero results = not indexed. Fix: add the site to Google Search Console (free), submit the sitemap (usually yourdomain.com/sitemap.xml; Wix/Squarespace/Shopify all generate one), then use \"Request indexing\" on the home page. Takes 2 to 14 days.",
      "If results appear but not for your service: your home page title is probably your brand name only. Change the page title to \"[Service] in [City] | [Brand]\", e.g. \"Emergency Plumber in Austin | Smith Plumbing\", and put that same phrase in the first heading and first paragraph.",
      "Create or claim your Google Business Profile at business.google.com, pick the most specific primary category, add your website URL, 10 real photos, and your service area. For local searches this matters more than the website.",
      "Make one page per service you want to be found for (\"water heater repair\", \"drain cleaning\"), each with 300+ words of your own words and a phone number. One page trying to rank for everything ranks for nothing.",
      "Ask your last five happy customers for a Google review this week. Reviews are the biggest ranking lever in the map pack.",
    ],
    watch: "Ignore anyone selling \"guaranteed page 1\" or 500 backlinks. For a local business, the four steps above are the whole game for the first six months." },
  { key: "ghosted", match: /ghosted|scammed|disappeared|never finished|half.?(done|built|finished)|took my (money|deposit)|abandoned/i,
    diagnose: "Sorry, this is common and it's not your fault. The good news: you almost always own more than you think, and you can lock it down today before anything else.",
    steps: [
      "Find out who controls the three things that matter: the domain (check at who.is; the registrar and the account email), the hosting, and the site files. If any account is in your name, change the password now and turn on 2FA.",
      "If the domain is in the designer's name, email them a short written request to transfer it to a registrar account you own (Namecheap, Cloudflare). Domain ownership is the one thing that can really hold you hostage; everything else is replaceable.",
      "Ask for a copy of whatever exists: for WordPress a full-site export or backup file, for Wix/Squarespace the login to the site, for custom code a zip or GitHub repo. Even a half-built site saves days.",
      "Write down exactly what was promised, what was paid, and dates. If it was PayPal Goods & Services or a card, you have a dispute window (usually 180 days PayPal, 120 days card). File it with that timeline; it often gets money back or a sudden reply.",
      "Whoever finishes it next: agree a written scope, milestone payments, and that every account is created in YOUR name from day one.",
    ],
    watch: "Don't pay anyone a new full deposit until step 1 is done. You want the domain and files in your hands before another dollar moves." },
  { key: "pricing", match: /how much (does|should|would|to|for|is)|quoted|quote|fair price|overpriced|rip ?off|worth it|budget/i,
    diagnose: "Prices for a small business website range from $100 to $10k because they are different products with the same name. Here is how to tell what you're actually being quoted for, so you can compare like with like.",
    steps: [
      "Ask each person for the scope in five lines: number of pages, who writes the text, who supplies photos, what happens with hosting and domain, and what's included after launch (edits, updates, support). A $500 and a $3,000 quote often differ only in the last three.",
      "Rough 2026 anchors people report on here: DIY builder $200–600/yr; template-based 5-page site from a freelancer $500–1,500; custom design with copywriting and SEO setup $2,000–4,000; e-commerce $3,000+. Under about $500 you're buying a template with your logo on it, which is fine if that's what you need.",
      "Ask what you own at the end: domain in your name, admin login, ability to move hosts. If the answer is vague, walk away regardless of price.",
      "Pay in milestones (e.g. 40/40/20) through PayPal Goods & Services or Stripe, never full upfront to someone you found online.",
      "Decide what the site must DO before comparing: get calls, take bookings, sell products, or just exist so you look real. Each needs a different build, and the cheapest one that does your job is the right one.",
    ],
    watch: "Be suspicious of anyone who quotes without asking a single question about your business." },
  { key: "landing", match: /landing ?page|facebook ads|google ads|\bppc\b|\bads\b|not converting|conversion/i,
    diagnose: "If ads are sending people to a page that doesn't convert, the fix is usually in the page, not the ad. The page has one job: match the promise in the ad and make the next step obvious.",
    steps: [
      "Headline = the exact promise from the ad, same words. If the ad says \"$99 gutter cleaning this week\", the page headline is \"$99 gutter cleaning this week\", not your company tagline.",
      "One action only. Remove the menu, the footer links, the social icons. A single form or call button, repeated at top, middle, bottom.",
      "Proof above the fold: one review with a name and town, or a before/after photo, or a number (\"412 homes this year\").",
      "Speed test the page on your phone on mobile data. If it takes more than 3 seconds, compress images (tinypng.com) and remove any embedded video. Most ad traffic is mobile.",
      "Install the pixel and set the form submit as the conversion event, then let the ad run 7 days before judging. Under 50 clicks tells you nothing.",
    ],
    watch: "A 2–5% form rate on cold ad traffic is normal. If you're at 0.5% the page is the problem; if you're at 3% and unhappy, the offer or targeting is." },
  { key: "slow", match: /slow|speed|loading|mobile|phone|responsive|broken|not working|not loading/i,
    diagnose: "A slow or broken-on-phone site is almost always images and plugins, not \"bad hosting\", and you can fix most of it yourself in an hour.",
    steps: [
      "Run the site through pagespeed.web.dev on mobile. Look only at the first three items under \"Opportunities\"; they are usually \"properly size images\", \"eliminate render-blocking resources\" and \"reduce unused JavaScript\".",
      "Images: anything over 300 KB is too big for a web page. Resize to max 1600px wide and compress with tinypng.com or squoosh.app, then re-upload. This alone usually halves load time.",
      "If WordPress: deactivate every plugin you don't remember installing, then install one caching plugin (LiteSpeed Cache or WP Rocket). Sliders, page-builder add-ons and social feeds are the usual culprits.",
      "Mobile layout broken: open the site on your phone, find the element that overflows, and in the builder set its width to 100% / auto instead of a fixed pixel width.",
      "Check that you're on PHP 8+ and HTTPS; both are one-click in most hosting panels and both affect speed.",
    ],
    watch: "Don't move hosts as the first step. Nine out of ten slow sites are slow on any host until the images and plugins are handled." },
  { key: "need-site", match: /need (a |an )?(website|web|site|landing|developer|designer)|looking for (a |an |someone)|who can build|recommend|no website|don'?t have a website|do i need a website/i,
    diagnose: "Before choosing who builds it, decide what it has to do. For most local and service businesses the answer is \"make the phone ring and look legit when someone Googles us\", and that needs a lot less than people are often sold.",
    steps: [
      "Write the five pages on paper first: Home (what you do, where, one call button), Services (one section per service), About (photo of you, why you), Reviews (copy five real ones), Contact (phone, form, map, hours). Anyone can build this in a week once the words exist.",
      "Get the words done before design. Write like you talk to a customer on the phone. Text is the part every builder will ask you for, and it's the part that stalls projects for months.",
      "Buy the domain yourself, in your own account (Namecheap or Cloudflare, about $12/yr). Never let a builder register it for you.",
      "Then decide the route: DIY on Wix/Squarespace if you have a weekend and no budget; a freelancer if you want it done properly and want to own it; an agency only if you need e-commerce or integrations.",
      "Whatever route: ask for a Google Business Profile to be set up and linked, and for the site to be handed over with admin login and a 10-minute walkthrough on how to change text and photos.",
    ],
    watch: "The site that gets finished beats the perfect site that doesn't. Five plain pages live this month is worth more than a redesign next quarter." },
];

HEAT.pickPlaybook = function (post) {
  const text = (post.title || "") + " " + (post.body || "");
  return HEAT.REPLY_PLAYBOOKS.find((p) => p.match.test(text)) || HEAT.REPLY_PLAYBOOKS[HEAT.REPLY_PLAYBOOKS.length - 1];
};

// Pull a short quote of their situation for the opening line.
HEAT.situationLine = function (post) {
  const t = (post.title || "").replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim().replace(/[?!.]+$/, "");
  return t.length > 110 ? t.slice(0, 107) + "…" : t;
};

HEAT.valueBombReply = function (post, profile = {}) {
  const pb = HEAT.pickPlaybook(post);
  const body = (post.body || "").toLowerCase();
  const mentions = [];
  for (const [re, label] of [[/\bwix\b/, "Wix"], [/squarespace/, "Squarespace"], [/shopify/, "Shopify"], [/wordpress/, "WordPress"], [/lovable/, "Lovable"], [/bolt/, "Bolt"], [/webflow/, "Webflow"], [/godaddy/, "GoDaddy"], [/framer/, "Framer"]]) if (re.test(body) || re.test((post.title || "").toLowerCase())) mentions.push(label);
  const platform = mentions.length ? ` Since you're on ${mentions[0]}, the steps below are ${mentions[0]}-specific where it matters.` : "";
  const price = (post.body || "").match(/(\$|€|£)\s?\d{2,5}/);
  const budgetLine = price ? ` A ${price[0].replace(/\s/, "")} budget is workable for this if it's scoped right, so don't let anyone tell you it isn't.` : "";
  const steps = pb.steps.map((s, i) => `${i + 1}. ${s}`).join("\n\n");
  const sign = profile.name ? `\n\n– ${profile.name}${profile.role ? `, ${profile.role}` : ""}` : "";
  return `Re: "${HEAT.situationLine(post)}"\n\n${pb.diagnose}${platform}${budgetLine}\n\nHere's exactly what I'd do, in order:\n\n${steps}\n\n${pb.watch}\n\nIf you get stuck on any step, reply here with what you see and I'll walk you through it. No charge for that, and no need to hire anyone for most of the above.${sign}`;
};

// ---------------------------------------------------------------------------
// Status pipeline. "Done" = anything that is not "new".
// ---------------------------------------------------------------------------
HEAT.STATUSES = [
  { key: "new", label: "New", hint: "found, not looked at" },
  { key: "seen", label: "Seen", hint: "opened, nothing to do yet" },
  { key: "replied", label: "Replied", hint: "value-bomb comment submitted" },
  { key: "dm", label: "DM'd", hint: "private conversation started" },
  { key: "quoted", label: "Quoted", hint: "price sent" },
  { key: "won", label: "Won", hint: "booked" },
  { key: "lost", label: "Lost", hint: "went elsewhere / no reply" },
  { key: "not_lead", label: "Not a lead", hint: "seller, job post, junk" },
];
HEAT.statusOf = function (p) { return p.status || (p.ignored ? "not_lead" : p.replied ? "replied" : "new"); };
HEAT.isBuyer = function (p) { return p.type === "demand"; };
HEAT.isSeller = function (p) { return p.type === "offer" || p.type === "freebie" || p.type === "value"; };

// ===========================================================================
// CO-FOUNDER HUNT
// One narrow job: watch subreddits where people ask for a co-founder, show one
// post at a time, give a 3-line public reply to copy and a long DM to send,
// and never show the same person twice once you've contacted them.
// ===========================================================================
HEAT.HUNT_SUBS = ["cofounder", "CoFounderHunt", "startups", "Entrepreneur", "indiehackers", "SideProject", "EntrepreneurRideAlong", "startup", "TechStartups", "ycombinator", "SaaS", "microsaas", "AppIdeas", "Startup_Ideas", "cofoundermatch", "IndianStartups"];

HEAT.HUNT_QUERIES = [
  '"technical co-founder" OR "technical cofounder"',
  '"looking for a cofounder" OR "looking for a co-founder"',
  '"seeking cofounder" OR "seeking co-founder" OR "need a cofounder"',
  '"marketing co-founder" OR "growth co-founder" OR "marketing cofounder"',
  '"cto co-founder" OR "developer co-founder" OR "engineering co-founder"',
  '"non-technical founder" (developer OR technical OR build)',
];

// What kind of partner are they asking for?
const ROLE_TECH = /\b(technical|tech)\s*(co[- ]?founder|partner)|\bcto\b|\b(developer|engineer|engineering|dev)\s*(co[- ]?founder|partner)|need (someone|somebody) (to|who can) (build|code|develop)|looking for (a |an )?(developer|engineer|coder|programmer)|can'?t code|no technical|non[- ]?technical founder/i;
const ROLE_MARKETING = /\b(marketing|growth|sales|gtm|go[- ]to[- ]market|distribution)\s*(co[- ]?founder|partner|person|lead)|\bcmo\b|need (someone|help) (to|with) (market|sell|grow|distribution)/i;
const ROLE_DESIGN = /\b(design|ui|ux|product design)\s*(co[- ]?founder|partner)|\bcdo\b|need (a )?designer/i;
const ROLE_BIZ = /\b(business|ops|operations|finance|bizdev)\s*(co[- ]?founder|partner)|\bcoo\b|\bcfo\b/i;
const COFOUNDER_ASK = /co[- ]?founder|cofounder|\bcto\b|\bcmo\b|\bcoo\b|technical partner|business partner|join (me|us|my|our) (startup|project|venture|team)|looking for (a )?partner|(?:looking for|need|want|seeking) (?:a |an |someone |somebody )?(?:technical person|developer|engineer|coder|programmer|designer|marketer)\b|need (?:someone|somebody|help) (?:to|who can) (?:build|code|develop|market|launch)|build(ing)? (a|my|our) (startup|saas|app|product) (and|but)/i;
// Narrower than JOBSEEKER_RE: here we only want to drop people hunting for a
// salaried job. "resume builder" is a product, not a CV.
const HUNT_JOBSEEKER = /looking for (a |an )?(new |remote |full[- ]time |part[- ]time |paid )*(job|employment|internship)\b|seeking (a |an )?(job|employment|full[- ]time|position)\b|immediate joiner|notice period|open to work|my (resume|cv)\b|years? of experience (working|in|as)|any (openings|referrals)|available for (full|part)[- ]time/i;
// Recruiters, agencies and people selling services are not prospects.
const HUNT_SELLER = /\bfor hire\b|\bi(?:'m| am) (?:a|an) (?:agency|freelancer|dev shop|development (?:agency|company))|\bwe (?:are|build) (?:a|an) (?:agency|dev shop|software (?:house|agency))|\bhire us\b|\bour agency\b|\bdm me (?:for|if) (?:rates|pricing|a quote)|\bportfolio:|\bcheck out my (?:agency|studio|service)|\bstarting (?:at|from) (?:\$|€|£)/i;

HEAT.classifyCofounder = function (title, body) {
  const t = (title || "").toLowerCase();
  const all = (t + "\n" + (body || "").slice(0, 1500)).toLowerCase();
  if (HUNT_SELLER.test(t) || HUNT_SELLER.test(all.slice(0, 400))) return { keep: false, why: "seller/agency" };
  // Beta-tester and feedback requests read like "help me" but want users, not a partner.
  if (/\b(?:beta ?test(?:ers?|ing)?|alpha test|test my (?:app|site|product)|looking for testers|need testers|feedback on my (?:app|site|mvp|product|landing page)|try my (?:app|tool)|roast my)\b/i.test(t) && !/co[- ]?founder|cofounder|\bcto\b|partner/i.test(t)) return { keep: false, why: "wants testers, not a partner" };
  if (HUNT_JOBSEEKER.test(t)) return { keep: false, why: "job seeker" };
  if (!COFOUNDER_ASK.test(all)) return { keep: false, why: "not a co-founder ask" };
  // Someone OFFERING to be a co-founder is not a prospect either.
  if (/\b(i|we)(?:'m| am|'re| are)? (?:a |an )?(?:available|open|looking to join|offering)\b|\bi want to be (?:a |your )?co[- ]?founder|\bjoin your (?:startup|team|project)\b|\b(?:co[- ]?founder|cto|cmo|developer|engineer|marketer)\s+available\b|\bavailable\s*(?::|as|for)\s*(?:a |an )?(?:co[- ]?founder|cto|technical)|\b\[?(?:offering|available|for hire)\]?\s*[:\-–]/i.test(t)) return { keep: false, why: "offering to join" };
  // The body says it when the title does not: an "ideal fit" list, "drop a comment or DM", "I own the growth + product".
  const ownAsk = /\b(?:need|looking for|seeking|want)\b[^.]{0,80}\bfor (?:my|our)\b/i.test(t);   // "need a co-founder for my app": a founder
  if (!ownAsk && /\bideal (?:fit|founder)\s*:|\bhappy to share more\b|\bdrop a comment or dm\b|\bi(?:'d| would)? (?:own|run|handle) (?:the )?(?:growth|product|tech|engineering)\b|\bwhat i bring\b|\bmy background\s*:|\bi(?:'m| am) (?:less|more) interested in\b.*\b(?:equity|co[- ]?founder|jv)\b|\blooking to (?:join|partner with|team up with) (?:a |an )?(?:founder|startup|team)\b/i.test(all)) return { keep: false, why: "offering to join" };
  // Nor is a builder describing what THEY can build. "I can handle the
  // technical side, feel free to reach out" is a competitor, not a lead.
  const builderVoice = /\bi (?:can|could|will|would) (?:handle|build|code|develop|take care of|own|cover) (?:the |all )?(?:technical|tech|dev|development|engineering|backend|coding|product)\b|\bi(?:'m| am) (?:a |an )?(?:developer|engineer|programmer|coder|cto|full[- ]stack|backend|frontend|ml engineer|ai engineer|data scientist|software (?:engineer|developer)|technical (?:person|founder|guy|co[- ]?founder))\b|\bi have (?:\d+\+? years|years of|a background|experience) (?:in|of|with) (?:software|coding|engineering|development|programming|ml|ai|backend)\b|\bmy (?:tech|technical|engineering) (?:skills|background|expertise|experience)\b|\bi handle the technical\b|\bhappy to build (?:it|this|the)\b|\bi can build (?:it|this|the mvp|anything)\b|\blooking for (?:an? )?(?:idea|ideas|problem to solve|non[- ]technical (?:co[- ]?founder|partner|founder))\b/i;
  const asksForBuilder = /\b(?:need|looking for|seeking|want) (?:a |an |someone |somebody )?(?:technical|tech|developer|engineer|coder|programmer|cto)\b|\bcan'?t code\b|\bno technical\b|\bnon[- ]?technical founder\b|\bcannot (?:build|code)\b|\bi(?:'m| am) not technical\b/i;
  if (builderVoice.test(all) && !asksForBuilder.test(t) && !/\b(?:i|we) (?:can'?t|cannot|don'?t) (?:code|build)\b|\bnot technical\b/i.test(all)) return { keep: false, why: "is a builder themselves" };
  let role = "unclear";
  if (ROLE_TECH.test(all)) role = "technical";
  else if (ROLE_MARKETING.test(all)) role = "marketing";
  else if (ROLE_DESIGN.test(all)) role = "design";
  else if (ROLE_BIZ.test(all)) role = "business";
  const equityOnly = /\bequity only\b|\bsweat equity\b|\bno (?:pay|salary|budget|money|funding)\b|\bunpaid\b|\bcan'?t pay\b|\bzero budget\b/i.test(all);
  // "no budget yet" must not count as budget, so negations are checked first.
  const noMoney = equityOnly || /\bnot funded\b|\bun ?funded\b|\bpre[- ]?revenue\b|\bbootstrapp?ed with nothing\b|\bwithout (?:pay|a budget|funding)\b|\bno (?:revenue|customers|users)\b/i.test(all);
  const hasBudget = !noMoney && /(\$|€|£)\s?\d{3,}|\b(?:have|has|got|with) (?:a |some )?budget\b|\bbudget (?:of|is|available)\b|\bfunded\b|\braised\b|\brevenue\b|\bpaying customers\b|\bmrr\b/i.test(all);
  const stage = /\bidea stage\b|\bjust an idea\b|\bpre[- ]?idea\b/i.test(all) ? "idea"
    : /\bmvp\b|\bprototype\b|\bbuilt\b|\blaunched\b|\bbeta\b|\busers\b/i.test(all) ? "building"
    : /\brevenue\b|\bmrr\b|\bpaying\b|\bcustomers\b/i.test(all) ? "revenue" : "unknown";
  return { keep: true, role, stage, equityOnly, hasBudget };
};

// Fit score: who is most worth your 3 lines right now.
HEAT.huntScore = function (p, now = Date.now()) {
  const ageH = Math.max(0, (now - (p.created || 0)) / 3600000);
  let s = 0;
  s += ageH < 2 ? 25 : ageH < 8 ? 18 : ageH < 24 ? 12 : ageH < 72 ? 6 : 0;  // fresh wins: be early
  if (p.role === "technical") s += 20;
  else if (p.role === "design" || p.role === "unclear") s += 8;
  if (p.hasBudget) s += 15;
  if (p.equityOnly) s -= 12;
  if (p.stage === "building") s += 10; else if (p.stage === "revenue") s += 14; else if (p.stage === "idea") s += 2;
  s += Math.min(8, Math.floor((p.comments || 0) / 3));     // some traction
  if ((p.comments || 0) > 25) s -= 6;                       // already crowded
  if ((p.body || "").length > 400) s += 5;                  // they wrote a real post
  return Math.max(0, Math.round(s));
};

// --------------------------------------------------------------- templates
// PUBLIC: exactly three lines. One specific observation, one free useful
// thing, one line saying a DM is on the way. No pitch, no price, no link.
// Built from pools so two posts never get the same three lines, and so the
// wording tracks what THIS person said: their role, their stage, whether they
// have money or are trading equity.
const SHORT_OBS = {
  technical: [
    (m) => `The hard part on ${m.thing} usually isn't the build, it's deciding what NOT to build for v1.`,
    (m) => `Ideas like ${m.thing} usually die waiting for the perfect technical co-founder instead of shipping a rough v1.`,
    (m) => `A v1 of ${m.thing} is normally 2 to 4 weeks of work, which is a lot smaller than a co-founder-sized commitment.`,
    (m) => `Most technical co-founder searches take 3 to 6 months. Most first versions take 3 to 4 weeks.`,
    (m) => `Worth knowing before you hand over equity: ten real users change the terms of that conversation completely.`,
  ],
  marketing: [
    (m) => `For ${m.thing} the first 100 users almost never come from marketing, they come from one channel you can work by hand.`,
    (m) => `A growth partner before the offer is repeatable usually just spreads the guessing around.`,
    (m) => `The first twenty sales for ${m.thing} are almost always manual, and they tell you which channel to hire for.`,
    (m) => `"We need marketing" is usually a symptom. The offer being hard to repeat is usually the cause.`,
  ],
  design: [
    (m) => `Design is rarely what's blocking ${m.thing} at this stage, the flow is.`,
    (m) => `Early products almost never fail for looking bad, they fail for asking too much before giving anything back.`,
    (m) => `A designer joining now would be guessing at the same unknowns you are.`,
  ],
  business: [
    (m) => `The fastest way to find out whether ${m.thing} needs a co-founder is to try to sell it once, first.`,
    (m) => `One real buyer saying yes tells you more than ten partner conversations.`,
    (m) => `Execution you can buy. A co-founder you can't easily undo.`,
  ],
  unclear: [
    (m) => `Worth deciding whether you need a partner or just the first version built, they're very different commitments.`,
    (m) => `Two things look identical from the inside: needing a co-founder, and needing the thing to exist.`,
    (m) => `If ${m.thing} doesn't exist yet, that's a build problem before it's a partner problem.`,
  ],
};
// Lines that only fire when the post actually says so.
const SHORT_CTX = {
  equityOnly: (m) => `Equity-only is a hard sell to a good builder, but the first version is cheap enough that you may not need to make it.`,
  hasBudget: (m) => `Since you can pay for execution, a co-founder is a choice here rather than the only route.`,
  building: (m) => `You've already built something, which puts you ahead of most people posting this — the next gap is usually users, not a partner.`,
  revenue: (m) => `With revenue already coming in you're in the strongest position of anyone posting this, and you can buy execution instead of trading equity.`,
  idea: (m) => `At idea stage the cheapest next step is almost never a co-founder, it's a version ten people can touch.`,
  crowded: (m) => `Plenty of replies here already, so I'll be short.`,
};
const SHORT_GIVE = {
  technical: [
    `I wrote down how I'd sequence the first version and what I'd cut.`,
    `Put my read on what to build first, and what not to, in a short note.`,
    `I've a short take on the fastest route to a first version for you.`,
  ],
  marketing: [
    `I wrote down the one channel I'd start with for this and why.`,
    `Put a short take on where your first hundred users are in a note.`,
  ],
  design: [
    `I wrote down the three screens that actually matter here.`,
    `Put a short take on the flow that would unblock this in a note.`,
  ],
  business: [
    `I wrote down how I'd get one paying customer before anything else.`,
    `Put a short take on the first sale, not the first hire, in a note.`,
  ],
  unclear: [
    `I wrote down whether this needs a partner or a first version, and why.`,
    `Put a short take on the smallest next step in a note.`,
  ],
};
// The second line carries the give and the DM pointer together: two lines total.
const SHORT_CLOSE = [
  `Sent it to your DMs.`,
  `It's in your inbox.`,
  `Just DM'd it to you.`,
  `Sent it over in DM.`,
  `Put it in your inbox.`,
];

// n distinct 3-line replies for THIS post. Line 1 speaks to their situation,
// line 2 gives something away, line 3 points at the DM. No link, no price.
HEAT.PUBLIC_CLOSE = "Check your DM.";
// The public comment says one thing: there is a DM waiting, about their thing.
// Built from pools so the same line never appears twice on Reddit.
// Short. It says one thing: I'm interested, the details are in your DM.
const PUB_LINE = [
  () => `Interested. Check your DM.`,
  () => `Interested, DM sent.`,
  () => `Check your DM, I'm interested.`,
  () => `Sent you a DM, interested.`,
  () => `DM sent. Interested.`,
  () => `Interested in this. Check your DM.`,
  () => `Keen on this one. Check your DM.`,
  () => `Check your DM, would like to help.`,
  () => `DM'd you, interested.`,
  () => `Interested. Details in your DM.`,
  (t) => `Interested in ${t}. Check your DM.`,
  (t) => `Check your DM about ${t}.`,
  (t) => `Sent you a DM about ${t}.`,
  (t) => `DM'd you about ${t}, interested.`,
  (t) => `Interested in ${t}, DM sent.`,
  (t) => `${t.charAt(0).toUpperCase() + t.slice(1)} sounds good. Check your DM.`,
];
const PUB_TAIL = [
  () => ``, () => ``, () => ``, () => ``,   // usually nothing at all
  () => ` No rush.`,
  () => ` Short one.`,
];
function pubHash(x) { let h = 2166136261; for (let i = 0; i < String(x).length; i += 1) { h ^= String(x).charCodeAt(i); h = Math.imul(h, 16777619); } return Math.abs(h); }
// 20 openings x 6 endings, and never one you used on a recent post
HEAT.huntPublicLine = function (p, profile = {}, opts = {}) {
  const thing = HEAT.huntThing(p);
  const used = new Set(opts.avoid || []);
  const seed = pubHash(p.id || p.title || "");
  for (let i = 0; i < PUB_LINE.length * PUB_TAIL.length; i += 1) {
    const line = PUB_LINE[(seed + i) % PUB_LINE.length](thing) + PUB_TAIL[(seed + i * 7) % PUB_TAIL.length]();
    if (!used.has(line)) return line;
  }
  return PUB_LINE[seed % PUB_LINE.length](thing);
};
// One public reply, not a menu: the single most specific useful line for
// THIS post, then "Check your DM." The context lines win over the role pool.
// One short line, the same everywhere: interested, the rest is in the DM.
HEAT.huntShortOptions = function (p, profile = {}, n = 1, opts = {}) {
  const out = [];
  const avoid = [...(opts.avoid || [])];
  for (let i = 0; i < Math.max(1, n); i += 1) { const line = HEAT.huntPublicLine(p, profile, { avoid }); avoid.push(line); out.push(line); }
  return out;
};
HEAT.SHORT_ROLE = function (p) { return SHORT_OBS[p.role] ? p.role : "unclear"; };
HEAT.huntShortReply = function (p, profile = {}, variant = 0) {
  const opts = HEAT.huntShortOptions(p, profile, 6);
  return opts[((variant % opts.length) + opts.length) % opts.length];
};

// The DM closes on two things: a free deliverable worth saying yes to, and a
// private channel where the conversation actually continues. Reddit DMs get
// buried; WhatsApp and Telegram do not.
// What we ask for. One dropdown; every reply, DM and inbox step reads it.
HEAT.DEAL_MODES = [
  { key: "split", label: "VA team · income + expense split (default 50/50)" },
  { key: "upfront_share", label: "VA team · upfront to start + income share" },
  { key: "share", label: "VA team · income share only, no upfront" },
  { key: "upfront", label: "VA team · paid work, upfront only, no share" },
];
// Presets plus the operator's own offers (deal.custom = [{ id, name, dm, terms, question, qualify }]).
HEAT.dealOffers = function (deal) {
  const custom = Array.isArray((deal || {}).custom) ? deal.custom : [];
  return [...HEAT.DEAL_MODES, ...custom.filter((c) => c && c.id && c.name).map((c) => ({ key: "custom:" + c.id, label: c.name, custom: true }))];
};
HEAT.customOffer = function (c) {
  const dm = String(c.dm || "").trim().replace(/[.\s]+$/, "");
  const q = String(c.question || "").trim() || "is that a shape you're open to?";
  return {
    mode: "custom:" + c.id, custom: true, label: String(c.name || "").trim(),
    shape: dm, shapeShort: dm.length > 160 ? dm.slice(0, 157).replace(/\s+\S*$/, "") + "…" : dm,
    clause: dm.replace(/^we\s+/i, ""), tail: dm.charAt(0).toUpperCase() + dm.slice(1) + ".",
    question: q, terms: String(c.terms || "").trim() || dm + ".",
    qualify: String(c.qualify || "").trim() || "is there a budget to start, yes or no? And is that shape open for you?",
    numbers: false, upfront: 0, share: 0, expenseShare: 0, hasUpfront: false,
  };
};
// The deal in words. `shape`/`shapeShort` go in the first DM (numbers only
// when numbersInDm is on); `terms` is the full offer with numbers for the
// inbox; `qualify` is the two questions that fit this shape.
HEAT.dealShape = function (deal) {
  const d = { ...HEAT.DEAL_DEFAULT, ...(deal || {}) };
  if (typeof d.mode === "string" && d.mode.startsWith("custom:")) {
    const c = (Array.isArray(d.custom) ? d.custom : []).find((x) => x && "custom:" + x.id === d.mode);
    if (c && String(c.dm || "").trim()) return HEAT.customOffer(c);
  }
  const mode = HEAT.DEAL_MODES.some((x) => x.key === d.mode) ? d.mode : "split";
  const nums = !!d.numbersInDm;
  const up = "$" + (Number(d.upfront) || HEAT.DEAL_DEFAULT.upfront);
  const shareN = Number(d.share) || HEAT.DEAL_DEFAULT.share, expN = Number(d.expenseShare) || HEAT.DEAL_DEFAULT.expenseShare;
  const sh = shareN + "%", ex = `${expN}/${100 - expN}`;
  const equal = shareN === 50 && expN === 50;
  const S = {
    split: {
      label: "income + expense split",
      shape: nums ? `we share the income and the expenses with you — ${sh} of income to our team, expenses split ${ex} — agreed in writing before anything is spent` : `we share the income and the expenses with you${equal ? ", equally" : ""}, agreed in writing before anything is spent`,
      shapeShort: nums ? `share income and expenses with you (${sh} of income, expenses ${ex})` : `share the income and expenses with you${equal ? " equally" : ""}`,
      clause: nums ? `share the income and the expenses with you, ${sh} of income to us and expenses split ${ex}` : `share the income and the expenses with you${equal ? ", equally" : ""}`,
      tail: nums ? `${sh} of income to us, expenses split ${ex}, all agreed in writing before anything is spent.` : `Everything split${equal ? " equally" : ""}, agreed in writing before anything is spent.`,
      question: `is a co-founder on a split of income and expenses, rather than equity, a shape you're open to?`,
      terms: `No upfront. ${sh} of income to our team for as long as we run it; expenses split ${ex} (us/you), agreed in writing before anything is spent. You keep the company and the IP.`,
      qualify: `can you carry your side of the expenses to start, yes or no? And are you open to a co-founder on a split of income and expenses rather than equity?`,
    },
    upfront_share: {
      label: "upfront + income share",
      shape: nums ? `${up} upfront to start, then ${sh} of income to our team for as long as we run it, agreed in writing` : `a small amount upfront to start, then a share of the income for as long as we run it, agreed in writing`,
      shapeShort: nums ? `${up} to start, then ${sh} of income` : `a small upfront to start, then a share of the income`,
      clause: nums ? `take ${up} upfront to start, then ${sh} of the income for as long as we run it` : `take a small amount upfront to start, then a share of the income for as long as we run it`,
      tail: nums ? `${up} upfront to start, then ${sh} of the income for as long as we run it, agreed in writing.` : `A small amount upfront to start, then a share of the income for as long as we run it, agreed in writing.`,
      question: `is a co-founder who is paid to start and then shares the income, rather than one on equity, a shape you're open to?`,
      terms: `${up} upfront to start, which covers our team's first block of work. Then ${sh} of income to our team for as long as we run it; expenses split ${ex} (us/you), agreed in writing. You keep the company and the IP.`,
      qualify: `is there a budget to start, yes or no? And are you open to a co-founder on a share of income rather than on equity?`,
    },
    share: {
      label: "income share only",
      shape: nums ? `no upfront: we carry our own costs and take ${sh} of income for as long as we run it, agreed in writing` : `no upfront: we carry our own costs and take a share of the income for as long as we run it, agreed in writing`,
      shapeShort: nums ? `no upfront, ${sh} of income` : `no upfront, a share of the income`,
      clause: nums ? `take nothing upfront and ${sh} of the income once it earns` : `take nothing upfront and a share of the income once it earns`,
      tail: nums ? `Nothing upfront; ${sh} of the income once it earns, agreed in writing.` : `Nothing upfront; the share starts when the income does, agreed in writing.`,
      question: `is a co-founder on a share of income, rather than on equity, a shape you're open to?`,
      terms: `No upfront. ${sh} of income to our team for as long as we run it, agreed in writing; we carry our own costs. You keep the company and the IP.`,
      qualify: `is there income today, or a clear path to it? And are you open to a co-founder on a share of income rather than on equity?`,
    },
    upfront: {
      label: "upfront only, paid work",
      shape: nums ? `paid work, ${up} per block, no equity and no share of your income` : `paid work in fixed blocks, no equity and no share of your income`,
      shapeShort: nums ? `paid work, ${up} per block, no equity` : `paid work in blocks, no equity, no share`,
      clause: nums ? `work at ${up} per block, with no equity and no share of your income` : `work in fixed paid blocks, with no equity and no share of your income`,
      tail: nums ? `${up} per block of work, paid before each block, and no share of your income.` : `Paid in fixed blocks, and no share of your income.`,
      question: `is a paid team, rather than a co-founder on equity, a shape you're open to?`,
      terms: `${up} per block of work, paid before each block starts; no equity and no share of your income. You keep the company and the IP.`,
      qualify: `is there a budget to start, yes or no? And is a paid team, rather than an equity co-founder, open for you?`,
    },
  };
  return { mode, ...S[mode], numbers: nums, upfront: Number(d.upfront) || 0, share: shareN, expenseShare: expN, hasUpfront: mode === "upfront_share" || mode === "upfront" };
};

// How we work, in their terms. The shape is the pitch; numbers only if the
// operator switched them on for the first DM.
// A custom offer is the operator's own sentence, used whole; presets get the role flavour.
const OFFER_CUSTOM = (m, sh) => `How we work, so you can decide fast: ${sh.shape}. You keep the company and the IP.

One question so neither of us wastes time: ${sh.question}`;
const OFFER_CUSTOM_SHORT = (m, sh) => `${sh.shapeShort.charAt(0).toUpperCase() + sh.shapeShort.slice(1)}; you keep the company. Is that shape open for you?`;
HEAT.HUNT_OFFER = {
  technical: (m) => { const sh = m.shape || HEAT.dealShape(m.deal); if (sh.custom) return OFFER_CUSTOM(m, sh); return `How it would work: I'd be a co-founder here, but not on equity and not for free. The team comes with me — ${m.deal.teamDoes} — and ${sh.shape}. You keep the company and the IP.

One question so neither of us wastes time: ${sh.question}`; },
  marketing: (m) => { const sh = m.shape || HEAT.dealShape(m.deal); if (sh.custom) return OFFER_CUSTOM(m, sh); return `How it would work: a co-founder on income and expenses rather than equity, with the growth team that comes with me — ${m.deal.teamDoes} — and ${sh.shape}. You keep the company.

One question: ${sh.question}`; },
  design: (m) => { const sh = m.shape || HEAT.dealShape(m.deal); if (sh.custom) return OFFER_CUSTOM(m, sh); return `How it would work: co-founder, but on income and expenses instead of equity, with a team behind me — ${m.deal.teamDoes} — and ${sh.shape}. You keep the company and the IP.

One question: ${sh.question}`; },
  business: (m) => { const sh = m.shape || HEAT.dealShape(m.deal); if (sh.custom) return OFFER_CUSTOM(m, sh); return `How it would work: co-founder on a split of income and expenses, not equity, with the operating team that comes with me — ${m.deal.teamDoes} — and ${sh.shape}. You keep the company.

One question: ${sh.question}`; },
  unclear: (m) => { const sh = m.shape || HEAT.dealShape(m.deal); if (sh.custom) return OFFER_CUSTOM(m, sh); return `How it would work: a co-founder on income and expenses rather than equity, with a team behind me — ${m.deal.teamDoes} — and ${sh.shape}. You keep the company and the IP.

One question: ${sh.question}`; },
};
HEAT.HUNT_OFFER_SHORT = {
  technical: (m) => { const sh = m.shape || HEAT.dealShape(m.deal); if (sh.custom) return OFFER_CUSTOM_SHORT(m, sh); return `Co-founder, but on income and expenses rather than equity — the team comes with me and we ${sh.shapeShort}; you keep the company. Is that shape open for you?`; },
  marketing: (m) => { const sh = m.shape || HEAT.dealShape(m.deal); if (sh.custom) return OFFER_CUSTOM_SHORT(m, sh); return `Co-founder on income and expenses, not equity — the growth team comes with me and we ${sh.shapeShort}; you keep the company. Is that open for you?`; },
  design: (m) => { const sh = m.shape || HEAT.dealShape(m.deal); if (sh.custom) return OFFER_CUSTOM_SHORT(m, sh); return `Co-founder without equity: a team comes with me and we ${sh.shapeShort}; you keep the company. Is that shape open for you?`; },
  business: (m) => { const sh = m.shape || HEAT.dealShape(m.deal); if (sh.custom) return OFFER_CUSTOM_SHORT(m, sh); return `Co-founder on a split rather than equity: the operating team comes with me and we ${sh.shapeShort}; you keep the company. Is that open for you?`; },
  unclear: (m) => { const sh = m.shape || HEAT.dealShape(m.deal); if (sh.custom) return OFFER_CUSTOM_SHORT(m, sh); return `Co-founder on income and expenses rather than equity — a team comes with me and we ${sh.shapeShort}; you keep the company. Is that shape open for you?`; },
};

// WhatsApp and Telegram links, from whatever the user typed in Options.
HEAT.waLink = function (v) {
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  const digits = s.replace(/[^\d]/g, "");
  return digits.length >= 8 ? "https://wa.me/" + digits : "";
};
HEAT.tgLink = function (v) {
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return "https://t.me/" + s.replace(/^@/, "");
};
// Links in a first Reddit DM are the surest way into the "requests" folder,
// so by default no DM carries one: the numbers go over once they answer.
// Switch them back on with profile.dmLinks = true.
HEAT.huntContactLine = function (profile = {}, short = false) {
  const wa = HEAT.waLink(profile.whatsapp), tg = HEAT.tgLink(profile.telegram);
  const both = [wa ? "WhatsApp: " + wa : "", tg ? "Telegram: " + tg : ""].filter(Boolean);
  if (!profile.dmLinks) {
    if (!both.length) return "";
    return short ? "Say the word and I'll move this to WhatsApp or Telegram." : "If it's easier we can carry on over WhatsApp or Telegram — say which and I'll send the number.";
  }
  if (!both.length) return "Reply here and I'll get started on it today.";
  if (short) return `Faster here than Reddit DMs — ${both.join("  ·  ")}`;
  return `Reddit DMs get buried, so it's faster to send it here — ${both.join("  ·  ")}\nOne message with a yes or a no is enough and I'll send the next step. Reply here if you'd rather stay on Reddit.`;
};

HEAT.huntName = function (author) {
  const raw = String(author || "").replace(/^\/?u\//, "").trim();
  if (!raw) return "there";
  // Reddit's auto-generated handles: Acceptable_Win_1921, Fragrant_Audience215 — not a name
  if (/^[A-Z][a-z]+[_-][A-Z][a-z]+[_-]?\d{2,4}$/.test(raw)) return "there";
  const first = raw.split(/[_\-.\d]+/).filter(Boolean)[0] || "";
  if (!/^[A-Za-z]{2,14}$/.test(first)) return "there";
  const junk = /^(the|real|its|it'?s|mr|mrs|ms|dr|sir|lord|king|queen|big|lil|little|dev|founder|startup|user|reddit|anon|anonymous|deleted|random|just|some|my|new|old|xx|hi|hey|no|not|why|what|who|how)$/i;
  if (/^(throw|anon|deleted|account|redditor|username)/i.test(first)) return "there";
  if (junk.test(first)) return "there";
  return first[0].toUpperCase() + first.slice(1).toLowerCase();
};

// ---------- what kind of person is this, in one glance -------------------
const COUNTRIES = [
  ["India", /\b(india|indian|bangalore|bengaluru|mumbai|delhi|hyderabad|chennai|pune|kolkata|gurgaon|noida|\binr\b|₹)\b/i],
  ["United States", /\b(usa|u\.s\.|united states|america|american|new york|nyc|san francisco|\bsf\b|bay area|austin|seattle|chicago|boston|los angeles|\bla\b|miami|denver|atlanta|texas|california)\b/i],
  ["United Kingdom", /\b(uk|u\.k\.|england|london|manchester|british|britain|scotland|£)\b/i],
  ["Canada", /\b(canada|canadian|toronto|vancouver|montreal|ottawa|calgary)\b/i],
  ["Australia", /\b(australia|australian|sydney|melbourne|brisbane|perth)\b/i],
  ["Germany", /\b(germany|german|berlin|munich|hamburg)\b/i],
  ["Netherlands", /\b(netherlands|dutch|amsterdam|rotterdam)\b/i],
  ["Nigeria", /\b(nigeria|nigerian|lagos|abuja)\b/i],
  ["Pakistan", /\b(pakistan|pakistani|karachi|lahore|islamabad)\b/i],
  ["Philippines", /\b(philippines|filipino|manila|cebu)\b/i],
  ["Singapore", /\bsingapore(an)?\b/i],
  ["UAE", /\b(uae|dubai|abu dhabi|emirates)\b/i],
  ["Brazil", /\b(brazil|brazilian|sao paulo|são paulo|rio de janeiro)\b/i],
  ["France", /\b(france|french|paris)\b/i],
  ["Spain", /\b(spain|spanish|madrid|barcelona)\b/i],
  ["Poland", /\b(poland|polish|warsaw|krakow)\b/i],
  ["Indonesia", /\b(indonesia|jakarta|bali)\b/i],
  ["Kenya", /\b(kenya|nairobi)\b/i],
  ["South Africa", /\b(south africa|johannesburg|cape town)\b/i],
  ["Thailand", /\b(thailand|thai|bangkok|chiang mai)\b/i],
  ["Europe", /\b(europe|european|\beu\b|€|eur\b)\b/i],
];
HEAT.huntCountry = function (p) {
  const t = ((p.title || "") + " " + (p.body || "") + " " + (p.flair || "")).slice(0, 3000);
  const based = t.match(/\b(?:based|living|located|i'?m|we'?re|from)\s+(?:in|out of|at)?\s*([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)/);
  for (const [name, re] of COUNTRIES) if (re.test(t)) return name;
  if (based && based[1].length > 3) return based[1];
  if (/\b(r\/)?(indianstartups|indiabusiness)\b/i.test(p.sub || "")) return "India";
  return "";
};

// The city they named, if they named one. Better than the country in a DM.
const CITIES = [
  ["Bangalore", /\b(bangalore|bengaluru)\b/i, "India"], ["Mumbai", /\bmumbai\b/i, "India"], ["Delhi", /\b(new )?delhi\b/i, "India"],
  ["Hyderabad", /\bhyderabad\b/i, "India"], ["Chennai", /\bchennai\b/i, "India"], ["Pune", /\bpune\b/i, "India"],
  ["Kolkata", /\bkolkata\b/i, "India"], ["Gurgaon", /\b(gurgaon|gurugram)\b/i, "India"], ["Noida", /\bnoida\b/i, "India"],
  ["New York", /\b(new york|nyc)\b/i, "United States"], ["San Francisco", /\b(san francisco|bay area)\b/i, "United States"],
  ["Austin", /\baustin\b/i, "United States"], ["Seattle", /\bseattle\b/i, "United States"], ["Chicago", /\bchicago\b/i, "United States"],
  ["Boston", /\bboston\b/i, "United States"], ["Los Angeles", /\blos angeles\b/i, "United States"], ["Miami", /\bmiami\b/i, "United States"],
  ["London", /\blondon\b/i, "United Kingdom"], ["Manchester", /\bmanchester\b/i, "United Kingdom"],
  ["Toronto", /\btoronto\b/i, "Canada"], ["Vancouver", /\bvancouver\b/i, "Canada"], ["Montreal", /\bmontreal\b/i, "Canada"],
  ["Sydney", /\bsydney\b/i, "Australia"], ["Melbourne", /\bmelbourne\b/i, "Australia"], ["Brisbane", /\bbrisbane\b/i, "Australia"],
  ["Berlin", /\bberlin\b/i, "Germany"], ["Munich", /\bmunich\b/i, "Germany"], ["Hamburg", /\bhamburg\b/i, "Germany"],
  ["Amsterdam", /\bamsterdam\b/i, "Netherlands"], ["Rotterdam", /\brotterdam\b/i, "Netherlands"],
  ["Lagos", /\blagos\b/i, "Nigeria"], ["Abuja", /\babuja\b/i, "Nigeria"],
  ["Karachi", /\bkarachi\b/i, "Pakistan"], ["Lahore", /\blahore\b/i, "Pakistan"], ["Islamabad", /\bislamabad\b/i, "Pakistan"],
  ["Manila", /\bmanila\b/i, "Philippines"], ["Cebu", /\bcebu\b/i, "Philippines"],
  ["Singapore", /\bsingapore\b/i, "Singapore"], ["Dubai", /\bdubai\b/i, "UAE"], ["Abu Dhabi", /\babu dhabi\b/i, "UAE"],
  ["Sao Paulo", /\b(sao paulo|são paulo)\b/i, "Brazil"], ["Rio de Janeiro", /\brio de janeiro\b/i, "Brazil"],
  ["Paris", /\bparis\b/i, "France"], ["Madrid", /\bmadrid\b/i, "Spain"], ["Barcelona", /\bbarcelona\b/i, "Spain"],
  ["Warsaw", /\bwarsaw\b/i, "Poland"], ["Krakow", /\bkrakow\b/i, "Poland"],
  ["Jakarta", /\bjakarta\b/i, "Indonesia"], ["Bali", /\bbali\b/i, "Indonesia"],
  ["Nairobi", /\bnairobi\b/i, "Kenya"], ["Johannesburg", /\bjohannesburg\b/i, "South Africa"], ["Cape Town", /\bcape town\b/i, "South Africa"],
  ["Bangkok", /\bbangkok\b/i, "Thailand"], ["Chiang Mai", /\bchiang mai\b/i, "Thailand"],
];
HEAT.huntPlace = function (p) {
  const t = ((p.title || "") + " " + (p.body || "") + " " + (p.flair || "")).slice(0, 3000);
  for (const [city, re, country] of CITIES) if (re.test(t)) return { city, country };
  return { city: "", country: HEAT.huntCountry(p) || "" };
};
// One line about where you are, only when they said where they are. The same
// country is an advantage; far apart is said plainly rather than hidden.
const REGION = { India: "Asia", Pakistan: "Asia", Singapore: "Asia", Indonesia: "Asia", Philippines: "Asia", UAE: "Asia", Thailand: "Asia", "United Kingdom": "Europe", Germany: "Europe", Netherlands: "Europe", France: "Europe", Spain: "Europe", Poland: "Europe", Europe: "Europe" };
HEAT.huntLocationLine = function (p, profile = {}) {
  const mine = String(profile.location || "").trim();
  if (!mine) return "";
  const them = HEAT.huntPlace(p);
  const where = them.city || them.country;
  if (!where) return "";
  const myCountry = (COUNTRIES.find(([, re]) => re.test(mine)) || [])[0] || mine.split(",").pop().trim();
  const myCity = mine.split(",")[0].trim();
  if (them.country && myCountry && them.country.toLowerCase() === myCountry.toLowerCase()) return `I'm in ${myCity} too, so we would be working the same day.`;
  if (REGION[them.country] && REGION[myCountry] && REGION[them.country] === REGION[myCountry]) return `I'm in ${myCity}, close enough to ${where} that our working days overlap.`;
  return `I'm in ${myCity} and keep hours that overlap ${where}.`;
};

// Who is asking: a freelancer, someone running a company, a solo founder.
HEAT.huntWho = function (p) {
  const t = ((p.title || "") + " " + (p.body || "")).slice(0, 3000);
  if (/\b(?:co[- ]?founder|cto|developer|marketer)\s+available\b|\bideal (?:fit|founder)\s*:|\bwhat i bring\b|\blooking to join\b/i.test(t)) return "offering themselves — not a prospect";
  if (/\b(my|our)\s+(agency|studio|dev shop|firm|consultancy)\b|\bwe(?:'| a)re an? (agency|studio|company)\b/i.test(t)) return "agency owner";
  if (/\bi (?:run|own|started|founded)\b|\bmy (?:company|business|startup|brand|store|shop)\b|\bwe (?:run|own|have|do|make|hit|are at)\b|\bour (?:company|business|customers|revenue|users|team)\b|\bpaying customers\b/i.test(t)) return "company owner";
  if (/\bfreelanc|\bindie hacker\b|\bsolo (?:dev|developer|builder)\b|\bi consult\b/i.test(t)) return "freelancer";
  if (/\b(student|college|university|final year|undergrad)\b/i.test(t)) return "student";
  if (/\b(my day job|9[ -]?to[ -]?5|9-5|full[- ]time job|currently (?:employed|working at)|after work|nights and weekends)\b/i.test(t)) return "employed, building on the side";
  return "solo founder";
};

// A one-glance reading of the post, shown under it in the hunt.
HEAT.huntSynopsis = function (p) {
  const t = ((p.title || "") + " " + (p.body || "")).slice(0, 3000);
  const wants = { technical: "someone to build it", marketing: "marketing / growth", design: "design / UX", business: "business / sales", unclear: "unclear — read the post" }[p.role] || "unclear";
  const users = t.match(/\b([\d][\d,.]*\s*(?:k|thousand)?)\s*(users|customers|signups|sign-ups|waitlist|downloads|subscribers)\b/i);
  const money = t.match(/(?:\$|€|£)\s?([\d][\d,.]*\s*k?)\s*(?:\/\s*mo|per month|a month|mrr|arr)?/i);
  const commit = /\b(full[- ]time)\b/i.test(t) ? "full-time" : /\b(part[- ]time|side project|nights and weekends|evenings|weekends)\b/i.test(t) ? "part-time / side project" : "";
  const equity = t.match(/\b(\d{1,2})\s*%\s*(?:equity|stake)?/i);
  return {
    who: HEAT.huntWho(p),
    wants,
    country: (() => { const q = HEAT.huntPlace(p); return q.city ? `${q.city}, ${q.country}` : q.country; })(),
    stage: p.stage === "unknown" ? "" : p.stage === "idea" ? "idea only" : p.stage === "building" ? "something built" : "has revenue",
    money: p.equityOnly ? "equity only, no cash" : p.hasBudget ? "has money to spend" : "",
    equity: equity ? equity[1] + "% on offer" : "",
    traction: users ? users[1].trim() + " " + users[2].toLowerCase() : "",
    revenue: money && /mrr|arr|month/i.test(t.slice(Math.max(0, t.indexOf(money[0])), t.indexOf(money[0]) + 40)) ? money[0].trim() : "",
    commit,
    posted: p.created ? p.created : 0,
    sub: p.sub || "",
  };
};

// Pull a short, natural noun phrase for "their thing".
HEAT.huntThing = function (p) {
  let t = (p.title || "").replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
  // Drop the ask itself ("Looking for a technical co-founder ...") so what is
  // left is the venture: "for my fitness app" -> "your fitness app".
  t = t.replace(/^.*\b(?:co[- ]?founders?|cofounders?|cto|cmo|coo|technical partner|business partner|developer|engineer|designer|partner)\b/i, " ").trim();
  const junk = /^(?:co[- ]?founder|cofounder|partner|someone|somebody|anyone|help|equity|my (?:startup|idea|project)|our (?:startup|idea|project)|the (?:project|idea)|this|it)\b/i;
  // "more product ideas", "advice", "feedback": not a venture, so never "your more product ideas"
  const filler = /\b(?:ideas?|advice|feedback|thoughts|tips|suggestions|opinions?|input|recommendations?|guidance|mentor|mentorship|networking|connections?|people|folks|anyone|everyone|founders?|partners?|team ?mates?|members?|investors?|funding|money|equity|job|work|role|position|opportunit|company|business|startup|venture|project)\b|^(?:more|some|any|new|good|great|the best|a few|few|other|fellow)\b/i;
  const clean = (x) => x.replace(/\s*[-–—|(,.:;!?&/+]+\s*$/, "").replace(/\s+/g, " ").trim();
  // one bare word that is only a category ("Liquor", "Fitness") reads wrong on
  // its own, so add the noun the post used if there is one
  const bare = /^(?:[A-Z][a-z]+|[a-z]+)$/;
  const nounAfter = (word) => {
    const m2 = t.match(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s+([A-Za-z][\\w-]{2,20}(?:\\s+[A-Za-z][\\w-]{2,20})?)", "i"));
    return m2 ? word + " " + m2[1] : "";
  };
  const tries = [
    /(?:^|\s)(?:for|on|behind|building|built|launching|making|developing|to build)\s+(?:my|our|a|an|the)\s+([A-Za-z0-9][\w'&/+. -]{2,44})/,
    /(?:^|\s)(?:for|on|behind|building|built|launching|making|developing)\s+([A-Za-z0-9][\w'&/+. -]{2,44})/,
  ];
  for (const re of tries) {
    const m = t.match(re);
    if (m) {
      let phrase = clean(m[1]);
      if (bare.test(phrase)) phrase = nounAfter(phrase) || phrase;
      if (phrase.length > 2 && !junk.test(phrase) && !filler.test(phrase)) return "your " + phrase;
    }
  }
  const b = (p.body || "").replace(/\s+/g, " ");
  const built = b.match(/\b(?:building|built|launching|launched|working on|creating|developing|making)\s+(?:a|an|the|my|our)\s+([a-z0-9][\w' -]{2,40}?)(?=[.,;:!?)]|\s(?:that|which|for|to|and|but|so|where)\b)/i);
  if (built) { const phrase = clean(built[1]); if (phrase.length > 2 && !filler.test(phrase)) return "your " + phrase; }
  const app = b.match(/\b(?:app|platform|marketplace|saas|tool|ats|extension|bot|api)\b/i);
  return app ? "your " + app[0].toLowerCase() : "what you're building";
};

HEAT.huntVars = function (p, profile = {}) {
  const stage = p.stage;
  const stageLine = p.stage === "revenue" ? "Since you already have revenue, you're in a much stronger position than most people posting this, and you can almost certainly pay for execution instead of trading equity for it."
    : p.stage === "building" ? "Since you've already built something, you're further along than most, and the next step is usually users rather than a partner."
    : p.equityOnly ? "I know budget is the constraint, so everything above is meant to be doable by you for close to nothing."
    : "";
  const thing = HEAT.huntThing(p);
  const deal = { ...HEAT.DEAL_DEFAULT, ...(profile.deal || {}) };
  // Someone with a working product isn't told we "build the first version".
  if ((stage === "building" || stage === "revenue") && deal.teamDoes === HEAT.DEAL_DEFAULT.teamDoes) deal.teamDoes = HEAT.DEAL_DEFAULT.teamDoesLater;
  const shape = HEAT.dealShape(deal);
  const offerFn = HEAT.HUNT_OFFER[p.role] || HEAT.HUNT_OFFER.unclear;
  return {
    name: HEAT.huntName(p.author),
    thing, stageLine, deal, stage, shape,
    offer: offerFn({ thing, deal, shape }),
    contact: HEAT.huntContactLine(profile),
    shortContact: HEAT.huntContactLine(profile, true),
    sign: profile.name ? `— ${profile.name}${profile.role ? ", " + profile.role : ""}` : "",
  };
};


// Without the AI, the slots are filled from what the classifier already knows,
// so a template DM reads like the written ones: same skeleton, same length,
// same five shapes, no essay and no links.
HEAT.huntLocalSlots = function (p) {
  const role = HEAT.SHORT_ROLE(p);
  const thing = HEAT.huntThing(p).replace(/^your /, "");
  const stage = p.stage;
  const observation = stage === "revenue" ? `Money already coming in changes the question from whether it works to who runs it every day`
    : stage === "building" ? `Something already built puts you past the part where most of these posts are still stuck`
    : p.equityOnly ? `Equity-only is a hard sell to anyone good, and the first version is usually cheaper than the search for a partner`
    : p.hasBudget ? `Being able to pay for execution makes a co-founder a choice here rather than the only route`
    : `Two different things look identical from the inside: needing a partner, and needing the thing to exist`;
  const move = { technical: `cut it to the three screens that carry the whole idea and put those in front of ten people`, marketing: `work one channel by hand for twenty customers before hiring anyone to scale it`, design: `watch five people use it without helping them and write down every hesitation`, business: `try to sell it once, manually, to one real buyer before splitting anything`, unclear: `write down what has to be true in ninety days, then ask what actually stands in the way` }[role];
  const question = { technical: `what is the one thing it has to do on day one?`, marketing: `where did the last handful of interested people come from?`, design: `where do people stop today?`, business: `who has already told you they would pay for this?`, unclear: `what would tell you in ninety days that this is worth continuing?` }[role];
  // no "move" here on purpose: a step guessed from the category reads as
  // filler. Only a model that has read the post supplies one.
  return { product: thing, observation, move: "", question, reply_line: observation, phrase: "", fit: "yes", fit_reason: "" };
};
HEAT.huntDmShort = function (p, profile = {}) {
  return HEAT.huntSlotBuild(p, profile, HEAT.huntLocalSlots(p)).text;
};

HEAT.DM_SIZES = [
  { key: "short", label: "Short" },
  { key: "medium", label: "Medium" },
  { key: "long", label: "Long" },
];
HEAT.huntDM = function (p, profile = {}, size = "long") {
  if (size === "short") return HEAT.huntDmShort(p, profile);
  return HEAT.huntDmLong(p, profile);
};
HEAT.huntDmLong = function (p, profile = {}) {
  return HEAT.huntSlotBuild(p, profile, HEAT.huntLocalSlots(p), { long: true }).text;
};
HEAT.huntDmSubject = function (p) {
  const thing = HEAT.huntThing(p);
  return `Re: your co-founder post — a few notes on ${thing}`.slice(0, 100);
};
HEAT.huntComposeUrl = function (p, body) {
  return `https://www.reddit.com/message/compose/?to=${encodeURIComponent(p.author)}&subject=${encodeURIComponent(HEAT.huntDmSubject(p))}&message=${encodeURIComponent(body)}`;
};

// ===========================================================================
// AI-WRITTEN REPLIES
// A language model reads the actual post and writes to it. The prompt is
// built here (pure, testable); the request is made in background.js.
// ===========================================================================
// What the founder is actually building, in their words. Filled BEFORE the
// replies are written; the replies must be built from it.
HEAT.CONCEPT_TYPES = ["marketplace", "saas", "consumer_app", "hardware", "service_agency", "community_content", "other"];
HEAT.CONCEPT_SCHEMA = {
  type: "object",
  properties: {
    product: { type: "string", description: "What they are building, in their own words, under 12 words." },
    customer: { type: "string", description: "Who it is for, in their words." },
    problem: { type: "string", description: "The problem it solves, in their words." },
    stage_now: { type: "string", description: "What exists today: idea / mockups / MVP / users / revenue, with the numbers they gave." },
    missing: { type: "string", description: "What they say is missing or what they are asking for." },
    type: { type: "string", enum: HEAT.CONCEPT_TYPES },
    phrases: { type: "array", items: { type: "string" }, description: "Two or three short phrases quoted VERBATIM from the post (3 to 12 words each) that a reply should echo." },
    biggest_unknown: { type: "string", description: "The one thing they most need to find out next, from what they wrote." },
  },
  required: ["product", "customer", "problem", "stage_now", "missing", "type", "phrases", "biggest_unknown"],
  additionalProperties: false,
};
// One concrete first move per concept type: the "useful thought" is picked
// from here and adapted to the card, so it is specific and correct.
HEAT.PLAYBOOK = {
  marketplace: ["Fill the supply side by hand before spending anything on demand: twenty providers you personally onboarded beat a launch.", "Run the first ten transactions manually (you are the matching engine) and only build what those ten needed.", "Pick one city or one niche; a marketplace that is thin everywhere is empty everywhere."],
  saas: ["Get five paying customers on a manual version before automating; their first month tells you the real feature list.", "Charge from day one, even a small amount; free users tell you nothing about the product.", "Watch churn before growth: one lost customer interviewed is worth more than ten new sign-ups."],
  consumer_app: ["Find one community where the first hundred users already gather and be useful there by hand before any store launch.", "Cut to the single action that gives value in the first minute; accounts, settings and social can wait.", "Measure day-seven return rate before spending on installs; installs without return are rented, not owned."],
  hardware: ["Sell ten units of a hand-built version before tooling; a pre-order with money down is the only real validation.", "Separate the risky part (the sensor, the battery, the compliance) and test it alone first.", "Write the unit cost at 1,000 units now; most hardware ideas die on that line, not on the prototype."],
  service_agency: ["Productise one offer with a fixed price and a fixed deliverable; 'we do everything' sells nothing.", "Land the first three clients from your own network before any marketing; their results are the marketing.", "Write the delivery checklist once so the second client costs half the first."],
  community_content: ["Run it manually for 90 days (one channel, one format, one cadence) before building anything.", "Pick the one metric that means it is alive (replies, not members) and post that weekly.", "Monetise the smallest thing people already ask you for, not a course you have not written."],
  other: ["Write the one sentence a user would say after using it; everything gets judged against that sentence.", "Try to sell it once, manually, to one real buyer before building anything else.", "Find out who already pays for the workaround today; that is the customer and the price."],
};
HEAT.AI_SCHEMA = {
  type: "object",
  properties: {
    concept: HEAT.CONCEPT_SCHEMA,
    public_reply: { type: "string", description: "Exactly two lines separated by one newline. Line one: ONE specific, useful solution or observation for their exact situation, under 25 words, in their own terms. Line two: exactly the text \"Check your DM.\" No links, no prices, no pitch, no greeting." },
    dm_short: { type: "string", description: "70 to 110 words. An introduction, not a letter." },
    dm_long: { type: "string", description: "130 to 190 words. An introduction with one useful thought and how we work; no numbered plan." },
    points: { type: "array", items: { type: "string" }, description: "EXACTLY TWO short clauses, each under 18 words, proving you know THIS market from the inside: the metric that decides it, how its real users behave, an integration or rule everyone in it deals with, or how these products usually fail. Lower case start, no full stop, no generic startup advice." },
    why: { type: "string", description: "One short phrase: the single most specific thing in the post the replies are built around." },
    fit: { type: "string", enum: ["yes", "no"], description: "yes only if the poster is a founder looking for a co-founder for their own idea or product. no if they are offering themselves, recruiting for a job, selling a service, a student project, or otherwise not someone who would pay a team." },
    fit_reason: { type: "string", description: "Under 15 words: why yes or no." },
  },
  required: ["concept", "public_reply", "dm_short", "dm_long", "points", "why", "fit", "fit_reason"],
  additionalProperties: false,
};

HEAT.huntAiPrompt = function (p, profile = {}, opts = {}) {
  const compact = !!opts.compact;   // on-device model: small context, shorter targets
  const m = HEAT.huntVars(p, profile);
  const s = HEAT.huntSynopsis(p);
  const offerShort = (HEAT.HUNT_OFFER_SHORT[HEAT.SHORT_ROLE(p)] || HEAT.HUNT_OFFER_SHORT.unclear)({ thing: m.thing, deal: m.deal });
  const system = `You write Reddit replies for ${profile.name || "the user"}${profile.role ? ", " + profile.role : ""}, who answers co-founder posts and comes in AS a co-founder, but on a split of income and expenses instead of equity (the deal shape: ${m.shape.label}). He brings his own small team with him. The person you are writing to posted on Reddit asking for a co-founder. You ARE offering to be that co-founder — on those terms, never for equity alone and never for free. The public reply gives ONE genuinely useful, specific line for their situation. The DM is an INTRODUCTION, not a letter: what you noticed in their post, one specific useful thought, how we work (the HOW WE WORK text below, adapted), the two questions — then stop. Never pitch, never use marketing words (leverage, unlock, elevate, game-changer, seamless), never open with a compliment, never say "great post" or "I'd love to". Write like one founder talking to another over coffee: direct, plain, warm, specific.

FIRST, DECIDE FIT. We only want founders who own an idea or product and are looking for a co-founder to build or grow it. Set fit = "no" and explain in fit_reason when the poster is offering THEMSELVES as a co-founder, CTO, developer or marketer ("available", "looking to join", "ideal fit:", "what I bring"), is recruiting for a salaried job, is selling a service, is a student project with no path to any income, or is asking for something we do not do. When fit is "no", still fill the other fields briefly, but nobody will read them.

WORK IN THIS ORDER. Step 1: fill the CONCEPT card from the post alone, quoting two or three of their phrases verbatim. Step 2: pick the concept type and take ONE move from the PLAYBOOK for that type; adapt it to their product, stage and numbers — that adapted move is the "useful thought" in the replies. Step 3: write, building every sentence from the card.

PLAYBOOK (one move per type; adapt it, never paste it)
${Object.entries(HEAT.PLAYBOOK).map(([k, v]) => k + ": " + v.map((x, i) => (i + 1) + ") " + x).join(" ")).join("\n")}

Rules that make the reply feel written for THIS post and nobody else:
- The DM answers their post as a co-founder candidate whose terms are an income and expense split, never equity and never free work. Say that plainly once; do not argue against co-founders.
- The first line of the DM after the greeting names their product in THEIR words (the card's product), never "your app" or "your startup".
- Quote at least two of the card's phrases verbatim inside the DMs, in quotation marks, where they fit naturally.
- Both DMs carry the TWO POINTS as one short paragraph, straight after the line about their post: two specifics from their market that an outsider could not name. They are the reason the message gets read; never replace them with compliments or with advice that would fit any startup.
- End every DM with the CLOSING LINE (below, verbatim). No question at the end, no "let me know", no link, nothing after it but the sign-off.
- If COMMENTS ON THE THREAD are given, do not offer what others already offered there, and address any pushback the founder wrote in them.
- If THE AUTHOR ELSEWHERE is given, you may use one detail from it, named as such ("you mentioned in r/SaaS that…"), only when it truly fits.
- Refer to at least two concrete details from their post in their own words (the product, the stage, the constraint they named, a number they gave, the market, the city). Quote a short phrase of theirs where it is natural.
- Never use a placeholder or generic noun where they gave a specific one. If they said "a scheduling app for dental clinics", say that, not "your app".
- Diagnose their real next step from what they wrote, not from a template. If they already have users, do not tell them to get users. If they said they are technical, do not tell them to build.
- Both DMs are exactly TWO paragraphs after the greeting. First: their post and what it means, in their words. Second: the offer, what you would do in the first two weeks, and the offer to send the portfolio and that plan in writing. No sign-off, no dashes of any kind, no bullet points. dm_short is 70 to 110 words; dm_long is 130 to 190 words. Never promise a prototype, a free build, or free work of any kind.
- ${m.shape.numbers ? "Use the numbers exactly as written in HOW WE WORK; never invent or change a number." : "NO PRICE, NO PERCENTAGE in the DM. The shape is the pitch: " + m.shape.shapeShort + "; they keep the company. Numbers come later, in the conversation, when they ask."}
- READ THE STAGE. If they already have a working product, users or revenue, never tell them to build a first version or that "v1 is 2 to 4 weeks" — talk about running and growing what exists. Only idea-stage posts get first-version advice.
- The offer and the contact line are the only pre-written parts. Everything else is written to this post.`;
  const user = `THE POST
Subreddit: r/${p.sub || "?"}
Author: ${p.author || "?"}
Title: ${p.title || ""}
Body:
${(p.body || "(no body)").slice(0, compact ? 2500 : 6000)}

WHAT WE READ FROM IT (may be wrong; trust the post over this)
Wants: ${s.wants}. Who: ${s.who}. Country: ${s.country || "not stated"}. Stage: ${s.stage || "not stated"}. Money: ${s.money || "not stated"}. ${s.traction ? "Traction: " + s.traction + ". " : ""}${s.commit ? "Time: " + s.commit + "." : ""}
${HEAT.huntContextText(p, compact)}
THE DEAL SHAPE: ${m.shape.label}. Present exactly this shape, no other.

HOW WE WORK, short (for dm_short)
${offerShort}

HOW WE WORK, full (for dm_long)
${m.offer}

GREETING (first line of every DM, verbatim)
Hi ${m.name},

CLOSING LINE (the last sentence of every DM, verbatim)
Happy to send the portfolio and a short plan for the first block of work if you are ready.
${profile.dmLinks && m.contact ? "\nCONTACT LINE (after the closing line)\n" + m.contact + "\n" : ""}
(No sign-off. The message ends on the portfolio and plan sentence.)

Write dm_short, dm_long, the points and why. Be quick and concrete; no preamble.${compact ? " Keep dm_short about 80 words and dm_long about 220 words with four numbered steps." : ""}`;
  return { system, user, schema: HEAT.AI_SCHEMA };
};

// Make sure what came back is usable before it reaches the screen.
HEAT.huntAiClean = function (out) {
  if (!out || typeof out !== "object") return null;
  const str = (v) => String(v || "").replace(/\r/g, "").trim();
  let pub = str(out.public_reply).split("\n").map((l) => l.trim()).filter(Boolean).filter((l) => !/^check your dm\.?$/i.test(l));
  if (!pub.length) return null;
  const first = pub[0];                 // one solution line; anything extra is dropped
  if (/https?:\/\/|\$\s?\d|€\s?\d|£\s?\d/.test(first)) return null;
  if (first.split(/\s+/).length > 40) return { tooLong: true };   // caller asks again, shorter
  pub = [first, HEAT.PUBLIC_CLOSE];
  const dm_short = str(out.dm_short), dm_long = str(out.dm_long);
  if (dm_short.length < 180 || dm_long.length < 450) return null;
  const c = out.concept && typeof out.concept === "object" ? out.concept : null;
  const concept = c ? { product: str(c.product).slice(0, 120), customer: str(c.customer).slice(0, 120), problem: str(c.problem).slice(0, 200), stage_now: str(c.stage_now).slice(0, 160), missing: str(c.missing).slice(0, 160), type: HEAT.CONCEPT_TYPES.includes(c.type) ? c.type : "other", phrases: (Array.isArray(c.phrases) ? c.phrases : []).map((x) => str(x).slice(0, 120)).filter(Boolean).slice(0, 3), biggest_unknown: str(c.biggest_unknown).slice(0, 200) } : null;
  const both = (dm_short + "\n" + dm_long).toLowerCase();
  const quoted = concept ? concept.phrases.filter((ph) => ph.length >= 6 && both.includes(ph.toLowerCase())) : [];
  return { public_reply: pub.join("\n"), dm_short, dm_long, why: str(out.why).slice(0, 300), fit: out.fit === "no" ? "no" : "yes", fit_reason: str(out.fit_reason).slice(0, 200), concept, quoted, generic: !!concept && concept.phrases.length > 0 && quoted.length === 0 };
};

// Comments on the thread and the author's other posts, as text for the prompt
// (read through the pinned tab, cached on the post; both optional).
HEAT.huntContextText = function (p, compact) {
  const ctx = p.ctx || {};
  const parts = [];
  if (Array.isArray(ctx.comments) && ctx.comments.length) {
    parts.push("COMMENTS ON THE THREAD (what others already offered; the founder's own replies matter most)");
    for (const c of ctx.comments.slice(0, compact ? 4 : 8)) parts.push(`- ${c.author}${c.op ? " (the founder)" : ""}: ${String(c.body || "").slice(0, compact ? 160 : 260)}`);
    parts.push("");
  }
  if (Array.isArray(ctx.author) && ctx.author.length) {
    parts.push("THE AUTHOR ELSEWHERE (their other recent posts and comments)");
    for (const a of ctx.author.slice(0, compact ? 3 : 6)) parts.push(`- r/${a.sub}: ${String(a.text || "").slice(0, compact ? 140 : 220)}`);
    parts.push("");
  }
  return parts.join("\n");
};

// The polish pass: a second, cheaper model reads the post and the drafts and
// rewrites only the sentences that could have been sent to anyone.
HEAT.POLISH_SCHEMA = {
  type: "object",
  properties: {
    generic: { type: "array", items: { type: "string" }, description: "Each sentence in the drafts that carries no detail from this post (could be sent to any founder). Empty if none." },
    public_reply: { type: "string", description: "The public reply, two lines: the (rewritten if needed) first line, then exactly 'Check your DM.'" },
    dm_short: { type: "string", description: "dm_short with only the generic sentences rewritten; everything else word for word." },
    dm_long: { type: "string", description: "dm_long with only the generic sentences rewritten; everything else word for word." },
  },
  required: ["generic", "public_reply", "dm_short", "dm_long"],
  additionalProperties: false,
};
HEAT.huntPolishPrompt = function (p, ai) {
  const c = ai.concept || {};
  const system = `You are the editor of Reddit replies written to a founder. Your only job: find every sentence in the drafts that could have been sent to ANY founder — it carries no detail from this post — and rewrite that sentence so it uses a specific detail from the post or the concept card (their product name in their words, a number they gave, their customer, their stage, a phrase of theirs in quotation marks). Keep every other sentence word for word. Never touch the greeting line, the paragraph that starts "How we work", the contact line, or the sign-off. Keep each text about the same length. Keep the public reply's first line under 25 words and its second line exactly "Check your DM.". No marketing words, no compliments, no new promises, no prices.`;
  const user = `THE POST
Title: ${p.title || ""}
Body:
${(p.body || "(no body)").slice(0, 5000)}

CONCEPT CARD
Product: ${c.product || "?"} · Customer: ${c.customer || "?"} · Problem: ${c.problem || "?"} · Today: ${c.stage_now || "?"} · Missing: ${c.missing || "?"} · Biggest unknown: ${c.biggest_unknown || "?"}
Their phrases: ${(c.phrases || []).map((x) => '"' + x + '"').join(", ") || "none"}

DRAFTS
public_reply:
${ai.public_reply}

dm_short:
${ai.dm_short}

dm_long:
${ai.dm_long}

List the generic sentences, then return all three texts with only those sentences rewritten.`;
  return { system, user, schema: HEAT.POLISH_SCHEMA };
};

// ===========================================================================
// INBOX: replies to your DMs, answered according to a plan
// ===========================================================================
// Editable terms. The instructions below reference them as {{UPFRONT}} etc.
HEAT.DEAL_DEFAULT = { mode: "split", numbersInDm: false, upfront: 350, share: 50, expenseShare: 50, teamDoes: "builds and runs the first version: development, design, launch, the day-to-day operating work — a dedicated team, not a freelancer", teamDoesLater: "runs and grows what you've already built: development, growth, support, the day-to-day operating work — a dedicated team, not a freelancer", disqualify: "equity-only; wants free work; no budget at all; refuses any income share; wants an employee, not a partner; can't say who the customer is" };

HEAT.INBOX_PLAN_DEFAULT = `WHAT WE ARE DOING: we ARE answering as a co-founder, but never for equity alone and never for free. The arrangement is that we come in as a co-founder WITH OUR OWN TEAM, we work as one team with them, and we SHARE EXPENSES AND INCOME. Most people posting for a co-founder want free labour under a nicer name. Our job is to find the few who don't, quickly, and cut the rest politely.

THE OFFER, when they show interest (the shape is: {{DEAL_MODE}}):
- {{DEAL}}
- Our team {{TEAM_DOES}}.
- They keep the company and the IP. We are their team, not their boss.
- Present exactly this shape. Do not offer any other shape (no upfront where none is asked, no share where none is asked).

HOW TO GET THERE, one step per reply:
1. Answer what they actually asked, completely. Never dodge a question to pitch.
2. Qualify early. Ask, plainly and warmly, the two questions that matter for this shape: {{QUALIFY}} Ask in the second reply at the latest.
3. If they are open: present the offer above, plainly, in one paragraph. No pressure, no fake urgency.
4. Objections: "equity instead" → no; equity in a pre-product company pays nobody's rent, income share does. "Too expensive" → it is the cheapest way to get a whole team; compare with one hire. "Let me think" → fine; say what would change their mind and leave the door open.
5. Close: agree the scope in three lines, the terms in writing ({{DEAL}}), how to pay if anything is paid upfront (say the method will be confirmed if not set), and move to WhatsApp/Telegram.

CUT, politely, in one short message, and do not chase: anyone who {{DISQUALIFY}}. Wish them well, leave one line saying if that changes we are here.

VERDICT on every reply: "interested" only when they have said yes to the terms above — money where money is asked, the share where a share is asked — or asked how to start; "not_interested" when they hit a disqualifier or say no; otherwise "unclear".

COMMON ASKS:
- "Where are you based / what time zone": answer plainly — {{LOCATION}} — then carry on with the step you are at. Never dodge it.
- "How are you / hello": one warm line back, then straight to the step you are at; do not pad.
- "Share your LinkedIn / portfolio": give it — {{LINKEDIN}}. If none is set, say a quick call shows more than a profile and offer one.
- "Can we have a call / short meet": yes, always. Offer {{CALL}} and two concrete time windows today or tomorrow; ask which suits.
- "Send me examples of your work": give {{PORTFOLIO}} if set; otherwise offer a call and a short written plan for their product.

VOICE: one founder to another, direct, warm, specific, no marketing words, never a compliment opener, no long letters — chat replies are 40 to 150 words.`;

// The instructions with the operator's own terms and links filled in.
HEAT.inboxPlanFor = function (plan, profile = {}, deal) {
  const d = { ...HEAT.DEAL_DEFAULT, ...(deal || profile.deal || {}) };
  const wa = HEAT.waLink(profile.whatsapp), tg = HEAT.tgLink(profile.telegram);
  const call = profile.booking ? `my booking link ${profile.booking}` : wa ? `a WhatsApp call on ${wa}` : tg ? `a Telegram call on ${tg}` : "a call (ask which app suits them)";
  const sh = HEAT.dealShape({ ...d, numbersInDm: true });
  return String(plan || HEAT.INBOX_PLAN_DEFAULT)
    .replace(/\{\{DEAL_MODE\}\}/g, sh.label)
    .replace(/\{\{DEAL\}\}/g, sh.terms)
    .replace(/\{\{QUALIFY\}\}/g, sh.qualify)
    .replace(/\{\{UPFRONT\}\}/g, "$" + d.upfront)
    .replace(/\{\{SHARE\}\}/g, String(d.share))
    .replace(/\{\{EXPENSE_SHARE\}\}/g, String(d.expenseShare))
    .replace(/\{\{TEAM_DOES\}\}/g, d.teamDoes || "")
    .replace(/\{\{DISQUALIFY\}\}/g, d.disqualify || "")
    .replace(/\{\{LINKEDIN\}\}/g, profile.linkedin || "(no LinkedIn set)")
    .replace(/\{\{CALL\}\}/g, call)
    .replace(/\{\{PORTFOLIO\}\}/g, profile.portfolio || "(no portfolio set)")
    .replace(/\{\{LOCATION\}\}/g, profile.location || "(location not set — say you work remotely and ask where they are)");
};

HEAT.INBOX_STAGES = [
  { key: "answer", label: "Answering" },
  { key: "deliver", label: "Delivering the free thing" },
  { key: "offer", label: "Presenting the offer" },
  { key: "objection", label: "Handling an objection" },
  { key: "qualify", label: "Qualifying" },
  { key: "close", label: "Closing" },
  { key: "cut", label: "Cut — not a fit" },
  { key: "done", label: "Done / no reply needed" },
];

HEAT.INBOX_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "The reply to send, ready to paste. 40 to 150 words. Plain text." },
    stage: { type: "string", enum: ["answer", "qualify", "deliver", "offer", "objection", "close", "cut", "done"], description: "Which step of the instructions this reply performs." },
    verdict: { type: "string", enum: ["interested", "not_interested", "unclear"], description: "Per the VERDICT rule in the instructions." },
    budget: { type: "string", enum: ["yes", "no", "unknown"], description: "Have they said there is money to start?" },
    share_ok: { type: "string", enum: ["yes", "no", "unknown"], description: "Have they accepted, or asked about, an income share instead of equity?" },
    note: { type: "string", description: "One line for the operator: what they asked, what this reply does, what to watch for." },
  },
  required: ["reply", "stage", "verdict", "budget", "share_ok", "note"],
  additionalProperties: false,
};

// Build the drafting prompt from the whole conversation, their original post
// (when we have it), your profile, and the plan.
HEAT.inboxAiPrompt = function (thread, post, profile = {}, plan) {
  const contact = HEAT.huntContactLine({ ...profile, dmLinks: true }, true);   // they already replied; a link is fine here
  const name = HEAT.huntName(thread.with);
  const history = (thread.messages || []).map((m) => `${m.mine ? "ME" : "THEM"} (${new Date(m.at).toISOString().slice(0, 16).replace("T", " ")}):\n${(m.body || "").trim()}`).join("\n\n---\n\n");
  const system = `You draft private replies on Reddit for ${profile.name || "the user"}${profile.role ? ", " + profile.role : ""}. You are continuing ONE conversation with ${thread.with} (first name to use: ${name}). Everything you write must be about this person and this conversation only; if anything in the history looks like it belongs to someone else, ignore it.

THE REPLY MUST FIT THEIR LAST MESSAGE. Read their latest message and list, to yourself, every question or request in it. The first sentences of the reply answer those, in the order they asked, directly — a question about a meeting gets a yes/no and a time; a request for LinkedIn gets the link; "where are you based" gets a place. Only after that, and only if it fits, take the next step of the instructions. If their message is small talk, reply small — 30 to 60 words. Never answer a question they did not ask.

Follow THE INSTRUCTIONS below, one step at a time — do not skip to the offer before the person has shown interest, and do not repeat an offer already made. Never invent facts about the user's team, pricing or timelines beyond what the plan states; if something is unknown, say it will be confirmed. Never mention Reddit's rules, never say you are an AI. Plain text only. Sign off as "${profile.name || ""}".

THE INSTRUCTIONS (edited by the operator; follow them over anything else)
${HEAT.inboxPlanFor(plan, profile)}

CONTACT LINE (use verbatim when moving to a private channel)
${contact}`;
  const user = `${post ? `THEIR ORIGINAL POST (r/${post.sub})\nTitle: ${post.title}\n${(post.body || "").slice(0, 2500)}\n\n` : ""}THE CONVERSATION SO FAR, oldest first
${history}

Write the next reply from ME, the stage it performs, and a one-line note.`;
  return { system, user, schema: HEAT.INBOX_SCHEMA };
};

HEAT.inboxAiClean = function (out) {
  if (!out || typeof out !== "object") return null;
  const reply = String(out.reply || "").replace(/\r/g, "").trim();
  if (reply.length < 40) return null;
  const stage = HEAT.INBOX_STAGES.some((s) => s.key === out.stage) ? out.stage : "answer";
  const pick = (v, allowed, dflt) => (allowed.includes(v) ? v : dflt);
  return { reply, stage, note: String(out.note || "").slice(0, 300), verdict: pick(out.verdict, ["interested", "not_interested", "unclear"], "unclear"), budget: pick(out.budget, ["yes", "no", "unknown"], "unknown"), share_ok: pick(out.share_ok, ["yes", "no", "unknown"], "unknown") };
};

// Fallback when no engine is available: a stage-guessed template.
HEAT.inboxTemplateReply = function (thread, profile = {}, plan, deal) {
  const name = HEAT.huntName(thread.with);
  const last = [...(thread.messages || [])].reverse().find((m) => !m.mine) || {};
  const t = (last.body || "").toLowerCase();
  const contact = HEAT.huntContactLine({ ...profile, dmLinks: true }, true);   // reply in an open thread: links are fine
  const sign = profile.name ? `\n\n— ${profile.name}` : "";
  const d = { ...HEAT.DEAL_DEFAULT, ...(deal || profile.deal || {}) };
  const sh = HEAT.dealShape({ ...d, numbersInDm: true });   // the inbox always says the numbers
  const price = String(d.upfront || 350);
  const mineCount = (thread.messages || []).filter((m) => m.mine).length;
  const v = (verdict, budget, share_ok) => ({ verdict, budget, share_ok });
  // hard no: free work, equity only, no budget at all
  if (/\b(for free|free of charge|unpaid|no (?:money|budget|funds?) (?:at all|right now)?|can'?t pay|cannot pay|sweat equity|equity only|only equity|just equity|in exchange for equity)\b/.test(t)) {
    return { stage: "cut", note: "disqualified — free work / equity only. Send and move on, do not chase.", ...v("not_interested", "no", "no"), reply: `Hi ${name},\n\nThanks for being straight about it. Equity-only or unpaid isn't something I can take on — the team needs to be paid for its time this month, not in three years, so we'd be a bad fit for what you're after.\n\nIf that changes and there's a budget to start plus an income share on the table, we're here. Good luck with it.${sign}` };
  }
  if (/\b(yes|ok(ay)?|sounds good|let'?s do|interested|how do we start|next step|i'?m in|deal)\b/.test(t) && /\b(share|percent|%|budget|pay|upfront|\$)\b/.test(t)) {
    return { stage: "close", note: "they accepted money + share — close", ...v("interested", "yes", "yes"), reply: `Hi ${name},\n\nGood — then ${sh.hasUpfront ? "three" : "two"} things and we start:\n1. The scope in three lines, so we both know what "done" looks like for the first block.\n${sh.hasUpfront ? `2. The $${price} to start, and how you'd like to pay (I'll confirm the method).\n3. ` : "2. "}In writing: ${sh.terms}\n\nThen WhatsApp or Telegram so updates reach you daily: ${contact}${sign}` };
  }
  if (/\b(equity|co-?founder (?:share|stake)|what (?:percent|%) (?:equity|of the company))\b/.test(t)) {
    return { stage: "objection", note: "equity talk — redirect to income share, ask the two questions", ...v("unclear", "unknown", "unknown"), reply: `Hi ${name},\n\nEquity in a pre-product company doesn't pay anyone's rent, so that isn't the part I'd take — and I'd rather say it now than waste your time. Co-founder yes, equity no: ${sh.shapeShort}. You keep the company.\n\nTwo quick questions so we both know if this is worth continuing: ${sh.qualify}${sign}` };
  }
  if (/how much|price|cost|charge|rate|\$|what do you (want|expect|charge)|your terms|how does (this|it) work/.test(t)) {
    return { stage: "offer", note: "they asked for terms — the offer, plainly", ...v("unclear", "unknown", "unknown"), reply: `Hi ${name},\n\nStraight answer. I'd be a co-founder here, but not on equity — on a split of income and expenses. It works like this: ${sh.terms}${sh.custom ? "" : " Our team " + d.teamDoes + "."}\n\nIf that's the kind of partner you want, say so and we'll write the scope in three lines: ${contact}${sign}` };
  }
  if (/linkedin|portfolio|your work|examples?/.test(t) || /meet|call|zoom|google meet|hop on|chat (today|tomorrow)/.test(t)) {
    const li = profile.linkedin ? `LinkedIn: ${profile.linkedin}\n` : "";
    const call = profile.booking ? `pick a slot here: ${profile.booking}` : `${contact} — say a time today or tomorrow and I'll be there`;
    return { stage: "answer", note: "LinkedIn / call — give both, then qualify on the call", ...v("unclear", "unknown", "unknown"), reply: `Hi ${name},\n\nHappy to. ${li}And yes to a short call — ${call}. Two windows that work for me: this evening or tomorrow morning, your time; tell me which.\n\nSo the call is useful: I'd come in as a co-founder on ${sh.label}, not on equity — ${sh.qualify} Either answer is fine, it just tells us what to talk about.${sign}` };
  }
  if (/where are you (based|from|located)|which (country|city|time ?zone)|your (location|timezone)/.test(t)) {
    const where = profile.location ? `I'm based in ${profile.location}` : "I work remotely with founders in a few time zones";
    return { stage: "answer", note: "they asked where you are — answer, then qualify", ...v("unclear", "unknown", "unknown"), reply: `Hi ${name},\n\nDoing well, thanks. ${where}, and I work with founders wherever they are — time zones haven't been a problem so far.\n\nSo we don't waste each other's time: I'd come in as a co-founder on ${sh.label}, not on equity. ${sh.qualify} A one-line answer is enough.${sign}` };
  }
  const ask = mineCount >= 1 ? `\n\nTwo quick questions so we both know if this is worth continuing: ${sh.qualify}` : "";
  return { stage: mineCount >= 1 ? "qualify" : "answer", note: "answer, then the two qualifying questions", ...v("unclear", "unknown", "unknown"), reply: `Hi ${name},\n\nThanks for coming back. Happy to go through what you asked properly.${ask}\n\nFaster here: ${contact}${sign}` };
};


// ===========================================================================
// CLAUDE IN CHROME (paste): the same brief the API gets, as text you paste
// into the Claude browser extension; its answer is pasted back and parsed.
// ===========================================================================
HEAT.BRIEF_LAYOUT = `ANSWER IN EXACTLY THIS LAYOUT for every post, plain text, no markdown, no commentary before or after:

=== POST <id> ===
FIT: yes or no — under 15 words why
WHY: one short phrase, the most specific thing the replies are built around
REPLY:
<one line, under 25 words>
Check your DM.
DM SHORT:
<70 to 110 words>
DM LONG:
<130 to 190 words>
=== END ===`;
HEAT.huntBrief = function (posts, profile = {}) {
  const list = Array.isArray(posts) ? posts : [posts];
  if (!list.length) return "";
  const first = HEAT.huntAiPrompt(list[0], profile);
  const parts = [first.system, "", HEAT.BRIEF_LAYOUT, ""];
  for (const p of list) {
    const { user } = HEAT.huntAiPrompt(p, profile);
    parts.push(`=== POST ${p.id} ===`, user.replace(/\n\nWrite public_reply, dm_short, dm_long and why\.[^\n]*$/, ""), "");
  }
  parts.push(list.length > 1 ? `There are ${list.length} posts. Answer each one in the layout above, in order, each starting with its "=== POST <id> ===" line.` : `Answer in the layout above, starting with "=== POST ${list[0].id} ===".`);
  return parts.join("\n");
};
// Parse what came back. Returns [{ id, ai }] — id is null when no header was pasted.
HEAT.huntParseAnswers = function (text) {
  const raw = String(text || "").replace(/\r/g, "").replace(/\*\*/g, "");
  const chunks = [];
  const re = /===\s*POST\s+([^\s=]+)\s*===/g;
  let m, last = null;
  while ((m = re.exec(raw))) { if (last) chunks.push({ id: last.id, body: raw.slice(last.end, m.index) }); last = { id: m[1], end: m.index + m[0].length }; }
  if (last) chunks.push({ id: last.id, body: raw.slice(last.end) }); else chunks.push({ id: null, body: raw });
  const out = [];
  for (const c of chunks) {
    const body = c.body.replace(/===\s*END\s*===/gi, "");
    const grab = (label, next) => {
      const r = new RegExp(`(?:^|\\n)\\s*${label}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:${next})\\s*:|$)`, "i");
      const x = body.match(r); return x ? x[1].trim() : "";
    };
    const fitLine = grab("FIT", "WHY|REPLY|DM SHORT|DM LONG");
    const ai = {
      fit: /^no\b/i.test(fitLine) ? "no" : "yes",
      fit_reason: fitLine.replace(/^(yes|no)\s*[—–-]?\s*/i, ""),
      why: grab("WHY", "FIT|REPLY|DM SHORT|DM LONG"),
      public_reply: grab("REPLY", "DM SHORT|DM LONG|FIT|WHY"),
      dm_short: grab("DM SHORT", "DM LONG|FIT|WHY|REPLY"),
      dm_long: grab("DM LONG", "FIT|WHY|REPLY|DM SHORT"),
    };
    if (ai.public_reply || ai.dm_short || ai.dm_long) out.push({ id: c.id, ai });
  }
  return out;
};

// ===========================================================================
// TEMPLATE + AI SLOTS
// One fixed skeleton (saw your post → what I understand → how we work → next
// step), five different styles, sentence pools rotated per post, and only four
// short slots written by the model. Built to look hand-written every time:
// no two DMs share the same style, the same sentences, or the same phrasing,
// and each one is checked against the last ones you sent before it is shown.
// ===========================================================================
HEAT.SLOT_SCHEMA = {
  type: "object",
  properties: {
    fit: { type: "string", enum: ["yes", "no"], description: "no if they are offering themselves, recruiting for a salaried job, selling a service, or otherwise not a founder who might take on a paid partner team." },
    fit_reason: { type: "string", description: "Under 15 words." },
    product: { type: "string", description: "What they are building, in THEIR words, 2 to 6 words, no article. e.g. 'gym scheduling app', 'marketplace for dentists'." },
    observation: { type: "string", description: "ONE sentence, under 30 words, about THIS post: a number they gave, the stage they are at, the constraint they named. No advice, no compliment, no marketing words. Must contain a detail nobody else's post would have." },
    move: { type: "string", description: "ONE sentence, under 30 words: the single most useful next step for this exact product and stage. Concrete and doable this week. Never 'find a co-founder'." },
    question: { type: "string", description: "ONE short question about the thing they most need to find out next, in their terms, answerable in a line. Never 'does that work for you'." },
    points: { type: "array", items: { type: "string" }, description: "EXACTLY TWO short clauses, each under 18 words, that prove you know THIS market from the inside: a metric that decides it, a behaviour of its real users, an integration or rule everyone in it deals with, or the way these products usually fail. Something an outsider could not name. Lower case start, no full stop, no generic startup advice, no flattery, no mention of your offer." },
    phrase: { type: "string", description: "One short phrase quoted VERBATIM from the post, 3 to 10 words, that can be dropped into a sentence in quotation marks." },
  },
  required: ["fit", "fit_reason", "product", "observation", "move", "question", "phrase", "points"],
  additionalProperties: false,
};
HEAT.huntSlotPrompt = function (p, profile = {}, opts = {}) {
  const compact = !!opts.compact;
  const recent = (opts.recent || []).filter(Boolean).slice(0, 5);
  const sh = HEAT.dealShape({ ...HEAT.DEAL_DEFAULT, ...(profile.deal || {}) });
  const system = `You read one Reddit post from a founder looking for a co-founder and fill in short slots that a message is built from. The message answers as a co-founder candidate whose terms are a split of income and expenses rather than equity. You never write the whole message and you never mention the terms — that text already exists. Your job is only the parts that must come from THIS post.

FIRST, DECIDE FIT. fit = "no" when the poster is offering THEMSELVES as a co-founder, CTO, developer or marketer, is recruiting for a salaried job, is selling a service, or is a student project with no path to paying anyone.

WHERE THEY ARE MATTERS. When the post names a city, a country or a local market, make ONE of the two points local: the payment rail everyone there uses, the rule that applies there, the platform that owns that market, how customers there actually buy, what hiring or pricing is really like. Never "the Indian market is growing" or anything a brochure would say.

The two POINTS are what make this message land: they must read like someone who has built in this exact market. For a salon booking product that is no-shows, rebooking rates, stylist adoption, walk-ins, deposits; for a clinic tool it is intake, no-shows, insurance codes, staff who hate new software; for a marketplace it is the thin side, take rate, leakage off-platform. Name the real thing for THEIR market, never "user acquisition" or "product-market fit".

Then fill the slots. Rules for every slot:
- Use their own words for their product. Never "your app", "your startup", "your project".
- Every sentence must contain something only this post could have said: a number, a city, a customer type, a constraint they named.
- No marketing words (leverage, unlock, elevate, seamless, game-changer), no compliments, no "great post", no exclamation marks, no emoji.
- Never promise free work, a free prototype, or a timeline you were not told.
- No links, no prices, no percentages, anywhere.
- Plain words a busy person reads in one pass.`;
  const s = HEAT.huntSynopsis(p);
  const user = `THE POST
Subreddit: r/${p.sub || "?"}
Author: ${p.author || "?"}
Title: ${p.title || ""}
Body:
${(p.body || "(no body)").slice(0, compact ? 2000 : 5000)}

WHAT WE READ FROM IT (may be wrong; trust the post)
Wants: ${s.wants}. Stage: ${s.stage || "not stated"}. Money: ${s.money || "not stated"}. ${s.traction ? "Traction: " + s.traction + "." : ""}
Where they are: ${HEAT.huntPlace(p).city || HEAT.huntPlace(p).country || "not stated"}. Where we are: ${profile.location || "not stated"}.
${HEAT.huntContextText(p, true)}
For context only, never write about it: we answer as a co-founder who ${sh.clause || sh.shapeShort}.

${recent.length ? `\nOPENINGS ALREADY USED ON OTHER POSTS TODAY (say something different)\n${recent.map((x) => "- " + x).join("\n")}\n` : ""}
Fill every slot. Be concrete and quick.`;
  return { system, user, schema: HEAT.SLOT_SCHEMA };
};

// --- sentence pools -------------------------------------------------------
// Each line is a whole sentence. The builder picks one per slot, per style,
// so the same two DMs never read alike.
const S_OPEN = [
  (m) => `Came across your post about ${m.the}.`,
  (m) => `Saw your post about ${m.the}.`,
  (m) => `Read your post on ${m.the} this morning.`,
  (m) => `Your post about ${m.the} came up in r/${m.sub}.`,
  (m) => `Just read what you wrote about ${m.the}.`,
  (m) => `Your post about ${m.the} is the reason I'm writing.`,
];
// yes to co-founder, a team comes with me, expenses and profit both shared
const S_STAND = [
  () => `I can co-found this with you: my team joins the work, and the expenses and the profit are both split.`,
  () => `I can be your co-founder here. My team works alongside you, and we share the expenses and the profit.`,
  () => `Happy to co-found this with you: shared team, shared expenses, shared profit.`,
  () => `I'd come in as your co-founder with my own team, sharing what it costs to run and what it earns.`,
  () => `Yes to the co-founder seat, on a shared footing: my team, shared costs, shared profit.`,
  () => `I'm offering to co-found this, bring my team, and split both the expenses and the profit with you.`,
  () => `Co-founder works for me: a team comes along, and we carry the costs together and split the profit.`,
  () => `I can take the co-founder seat with my team behind me, expenses shared and profit shared.`,
];
// the plan and the portfolio, offered together, as the last sentence
const S_PROOF = [
  (m) => `I'll send the portfolio and that plan in writing if you want it.`,
  (m) => `Portfolio and the written plan are yours whenever you want them.`,
  (m) => `Say the word and the portfolio plus that plan come straight over.`,
  (m) => `If you're ready I'll send the portfolio and the plan in writing.`,
  (m) => `Tell me and I'll send our portfolio together with that plan.`,
  (m) => `The portfolio and a written version of that plan are ready to send.`,
];
// what we would actually do, from the step the model wrote for this post
const S_PLAN = [
  (m) => `First two weeks I'd ${m.moveLower}`,
  (m) => `The plan I'd start with: ${m.moveLower}`,
  (m) => `Week one, here is what I'd do: ${m.moveLower}`,
  (m) => `My first move would be simple: ${m.moveLower}`,
  (m) => `Straight away I'd ${m.moveLower}`,
];
const S_POINTS = [
  (m) => `From building in this space: ${m.p1}, and ${m.p2}.`,
  (m) => `Two things that decide these: ${m.p1}, and ${m.p2}.`,
  (m) => `Two details that matter more than people expect: ${m.p1}, and ${m.p2}.`,
  (m) => `What usually decides it: ${m.p1}. And ${m.p2}.`,
  (m) => `Two things I'd be watching: ${m.p1}, and ${m.p2}.`,
  (m) => `In this market: ${m.p1}, and ${m.p2}.`,
];
// Two paragraphs. One about them, one about the offer, the plan and the
// portfolio. No sign-off, no dashes.
const STYLES = [
  { key: "plain", build: (m, pick) => [
    [pick(S_OPEN)(m), m.observation, m.long && m.pts ? pick(S_POINTS)(m) : ""].filter(Boolean).join(" "), "",
    [pick(S_STAND)(m), m.offer, "You keep the company and the IP.", m.where, m.plan, pick(S_PROOF)(m)].filter(Boolean).join(" "),
  ] },
  { key: "observation-first", build: (m, pick) => [
    [m.observation, pick(S_OPEN)(m), m.long && m.pts ? pick(S_POINTS)(m) : ""].filter(Boolean).join(" "), "",
    [pick(S_STAND)(m), m.offer, "You keep the company and the IP.", m.where, m.plan, pick(S_PROOF)(m)].filter(Boolean).join(" "),
  ] },
  { key: "points-led", build: (m, pick) => [
    [pick(S_OPEN)(m), m.long && m.pts ? pick(S_POINTS)(m) : "", m.observation].filter(Boolean).join(" "), "",
    [pick(S_STAND)(m), m.offer, "You keep the company and the IP.", m.where, m.plan, pick(S_PROOF)(m)].filter(Boolean).join(" "),
  ] },
  { key: "plan-led", build: (m, pick) => [
    [pick(S_OPEN)(m), m.observation, m.long && m.pts ? pick(S_POINTS)(m) : ""].filter(Boolean).join(" "), "",
    [m.plan, pick(S_STAND)(m), m.offer, "You keep the company and the IP.", m.where, pick(S_PROOF)(m)].filter(Boolean).join(" "),
  ] },
  { key: "brief", build: (m, pick) => [
    [pick(S_OPEN)(m), m.observation].filter(Boolean).join(" "), "",
    [pick(S_STAND)(m), "You keep the company and the IP.", m.where, m.plan, pick(S_PROOF)(m)].filter(Boolean).join(" "),
  ] },
];
function lower(s) { return /^I\b|^I'/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1); }
HEAT.SLOT_STYLES = STYLES.map((s) => s.key);

// A small deterministic hash, so the same post always gets the same style
// unless it clashes with something already sent.
function slotHash(s) { let h = 2166136261; for (let i = 0; i < String(s).length; i += 1) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); } return Math.abs(h); }

// Six-word shingles: how a new DM is compared with the ones already sent.
HEAT.dmShingles = function (text, n = 6) {
  const w = String(text || "").toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i + n <= w.length; i += 1) out.push(w.slice(i, i + n).join(" "));
  return out;
};
HEAT.dmOverlap = function (shingles, previous) {
  if (!shingles.length || !previous || !previous.length) return 0;
  const mine = new Set(shingles);
  let worst = 0;
  for (const prev of previous) {
    const set = new Set(prev);
    let hit = 0;
    for (const s of mine) if (set.has(s)) hit += 1;
    worst = Math.max(worst, hit / mine.size);
  }
  return Math.round(worst * 100) / 100;
};

// Build the message from the slots. Tries every style and variant and keeps
// the one that reads least like anything already sent.
HEAT.huntSlotBuild = function (p, profile = {}, slots = {}, opts = {}) {
  const avoid = opts.avoid || [];
  const v = HEAT.huntVars(p, profile);
  const sh = v.shape;
  const product = String(slots.product || HEAT.huntThing(p).replace(/^your /, "")).trim().replace(/^(?:the|a|an|your|my)\s+/i, "");
  // "the gym scheduling app", but "HeySakhi" keeps its own name
  const proper = /^[A-Z][A-Za-z0-9]*$/.test(product.split(" ")[0]) && product.split(" ").length <= 2;
  const theProduct = proper ? product : "the " + product;   // case kept: "the SaaS for clinics", not "the saas…"
  const move = sentence(slots.move);
  const pts = (Array.isArray(slots.points) ? slots.points : []).map((x) => String(x || "").replace(/\s+/g, " ").trim().replace(/[.;,]+$/, "")).filter((x) => x.length > 8).slice(0, 2);
  const base = {
    p1: pts[0] ? pts[0].charAt(0).toLowerCase() + pts[0].slice(1) : "",
    p2: pts[1] ? pts[1].charAt(0).toLowerCase() + pts[1].slice(1) : "",
    product,
    the: theProduct,
    observation: sentence(slots.observation),
    move,
    moveLower: move.charAt(0).toLowerCase() + move.slice(1),
    question: sentence(slots.question, "?"),
    sub: p.sub || "reddit",
    name: v.name,
  };
  const tries = [];
  const seed = slotHash(p.id || p.title || "");
  const recent = opts.recentStyles || [];
  for (let si = 0; si < STYLES.length; si += 1) {
    for (let vi = 0; vi < 8; vi += 1) {
      const style = STYLES[(seed + si) % STYLES.length];
      if (!opts.anyStyle && recent.slice(0, 2).includes(style.key)) continue;   // never the same shape twice running
      let n = 0;
      const pick = (pool) => pool[(seed + vi * 11 + (n++) * 5) % pool.length];
      // the offer is always your chosen shape, in one sentence, worded a few ways
      const tl = sh.tail || ("we " + lower(sh.clause || sh.shapeShort));
      const shapes = [
        `${tl}`,
        `In practice: ${lower(tl)}`,
        `Concretely, ${lower(tl)}`,
        `Put plainly, ${lower(tl)}`,
        `On the money side, ${lower(tl)}`,
        `The arrangement: ${lower(tl)}`,
      ];
      let offer = pick(shapes);
      offer = offer.replace(/;?\s*(you keep the company[^.]*)\.?$/i, "").replace(/\s*(is that (?:shape )?open for you\??)$/i, "").trim().replace(/[.;,]$/, "");
      const m = {
        ...base,
        where: HEAT.huntLocationLine(p, profile),
        long: !!opts.long,
        pts: !!(base.p1 && base.p2),
        plan: base.move ? pick(S_PLAN)(base) : "",
        offer: /[.!?]$/.test(offer) ? offer : offer + ".",
      };
      const lines = style.build(m, pick);
      // the channel line only appears if you switched the links on
      const all = profile.dmLinks && HEAT.huntContactLine(profile, true) ? [...lines, "", HEAT.huntContactLine(profile, true)] : lines;
      const body = all.filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
      const text = `Hi ${base.name},\n\n${body}`.trim();      // no sign-off: this is a chat, they can see who wrote it
      tries.push({ style: style.key, variant: vi, text: clean(text) });
    }
  }
  if (!tries.length) return HEAT.huntSlotBuild(p, profile, slots, { ...opts, anyStyle: true });
  let best = null;
  for (const t of tries) {
    const overlap = HEAT.dmOverlap(HEAT.dmShingles(t.text), avoid);
    if (!best || overlap < best.overlap) best = { ...t, overlap };
    if (overlap < 0.1) break;
  }
  return best;

  function sentence(x, end = ".") {
    let s = String(x || "").replace(/\s+/g, " ").trim();
    if (!s) return "";
    s = s.charAt(0).toUpperCase() + s.slice(1);
    if (!/[.!?]$/.test(s)) s += end;
    return s.replace(/!+$/, ".");
  }
  function clean(s) {
    return s
      .replace(/\s*[—–]\s*/g, ", ")                                     // no long dashes: they read as a template
      .replace(/,\s*,/g, ",")
      .replace(profile.dmLinks ? /$^/ : /https?:\/\/\S+/g, "")           // no link in a first message unless you switch them on
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")          // no emoji
      .replace(/ {2,}/g, " ")
      .replace(/ \n/g, "\n")
      .trim();
  }
};

// The whole answer for one post, built from the slots: public reply + both DMs.
HEAT.huntSlotAssemble = function (p, profile = {}, slots = {}, opts = {}) {
  const built = HEAT.huntSlotBuild(p, profile, slots, opts);
  const v = HEAT.huntVars(p, profile);
  const line = HEAT.huntPublicLine(p, profile, { avoid: opts.avoidLines || [] });
  const long = HEAT.huntSlotBuild(p, profile, slots, { ...opts, long: true }).text;
  return {
    concept: { product: String(slots.product || ""), customer: "", problem: "", stage_now: "", missing: "", type: "other", phrases: [], biggest_unknown: String(slots.question || "") },
    public_reply: line,
    dm_short: built.text,
    dm_long: long,
    why: String(slots.observation || "").slice(0, 200),
    fit: slots.fit === "no" ? "no" : "yes",
    fit_reason: String(slots.fit_reason || "").slice(0, 200),
    style: built.style,
    overlap: built.overlap,
    shingles: HEAT.dmShingles(built.text),
  };
};
