// v2-lib.js — the Growth Board: where we post, what we offer, what we write.
//
// v1 hunts other people's threads and messages them. That is push, and push
// is the weakest move on Reddit. v2 is pull: we post value into rooms that
// contain people with budgets, answer in public, and let the buyers come to
// us. Everything here is plain data and pure functions so `node v2-test.js`
// can check it without a browser.
const V2 = (globalThis.V2 = globalThis.V2 || {});

// ---------------------------------------------------------------- targets
// kind  — ads: people already spending money and complaining about it
//         owner: a trade's own room, where the buyer has no marketing team
//         biz: general business rooms, big but noisier
// promo — what the room tolerates. This is our starting guess; the board
//         re-checks every subreddit against Reddit itself (subscribers,
//         whether it still exists, whether text posts are allowed) so a
//         wrong guess here is corrected by the tool, not by us.
//         no     → never post an offer; answer in the comments only
//         weekly → offers belong in the sub's weekly/self-promo thread
//         value  → a post is fine if it gives before it asks
//         ok     → self-promotion is allowed outright
V2.TARGETS = [
  // --- people who already spend money on ads ---
  { sub: "PPC", kind: "ads", promo: "value", note: "Ad spenders debugging campaigns. Teardowns land; pitches get removed." },
  { sub: "FacebookAds", kind: "ads", promo: "value", note: "Meta buyers. Post creative and account teardowns." },
  { sub: "GoogleAds", kind: "ads", promo: "value", note: "Search buyers. Wasted-spend audits do well." },
  { sub: "adwords", kind: "ads", promo: "value", note: "Older Google Ads room, still active." },
  { sub: "SEO", kind: "ads", promo: "no", note: "Strict. Answer in comments, never post an offer." },
  { sub: "bigseo", kind: "ads", promo: "no", note: "Senior SEO room. Reputation only, never an offer." },
  { sub: "TechSEO", kind: "ads", promo: "no", note: "Technical. Good for credibility, not offers." },
  { sub: "juststart", kind: "ads", promo: "value", note: "Beginners building sites. Playbooks land." },
  { sub: "marketing", kind: "ads", promo: "no", note: "Big and strict about promotion. Comment first, always." },
  { sub: "DigitalMarketing", kind: "ads", promo: "value", note: "Mixed. Result posts do well." },
  { sub: "advertising", kind: "ads", promo: "no", note: "Agency-side industry talk. Credibility only, not leads." },
  { sub: "content_marketing", kind: "ads", promo: "value", note: "Playbooks and teardowns." },
  { sub: "Emailmarketing", kind: "ads", promo: "value", note: "Dead-list revival offers fit here." },
  { sub: "analytics", kind: "ads", promo: "no", note: "Tracking and measurement questions. Answering them earns trust fast." },
  { sub: "GoogleAnalytics", kind: "ads", promo: "no", note: "GA4 pain. Free fixes earn trust." },
  { sub: "GoogleTagManager", kind: "ads", promo: "no", note: "Conversion tracking. Very high-intent comments." },
  { sub: "SocialMediaMarketing", kind: "ads", promo: "value", note: "IG/TikTok buyers." },
  { sub: "socialmedia", kind: "ads", promo: "value", note: "Broad social room. Creative packs and teardowns land here." },
  { sub: "Affiliatemarketing", kind: "ads", promo: "value", note: "Performance-minded. Pay-on-results offers fit." },
  { sub: "agency", kind: "ads", promo: "value", note: "Other agencies — partners and white-label, not clients." },
  { sub: "PPCMastery", kind: "ads", promo: "value", note: "Smaller PPC room, easier to be seen in than r/PPC." },
  { sub: "GoogleBusinessProfile", kind: "ads", promo: "value", note: "Exactly our local audit offer's room." },
  { sub: "LocalSEO", kind: "ads", promo: "value", note: "Local pack reports belong here." },

  // --- business owners in their own rooms (the real buyers) ---
  { sub: "dentistry", kind: "owner", promo: "no", note: "Practice owners. Comment-first, then they DM." },
  { sub: "Dentists", kind: "owner", promo: "no", note: "Smaller than r/dentistry and heavier on practice owners." },
  { sub: "optometry", kind: "owner", promo: "no", note: "Private practice owners competing with chains locally." },
  { sub: "Chiropractic", kind: "owner", promo: "no", note: "Small clinics, heavy local-search need." },
  { sub: "physicaltherapy", kind: "owner", promo: "no", note: "Cash-pay clinics buy marketing." },
  { sub: "medspa", kind: "owner", promo: "value", note: "High ticket, heavy ad spend. Best owner room we have." },
  { sub: "Lawyertalk", kind: "owner", promo: "no", note: "Solo firms. Very high case value." },
  { sub: "LawFirm", kind: "owner", promo: "no", note: "Firm operations and intake — intake is a marketing problem." },
  { sub: "Accounting", kind: "owner", promo: "no", note: "Practice owners in the off-season." },
  { sub: "InsuranceAgent", kind: "owner", promo: "value", note: "Agents buying leads already." },
  { sub: "realtors", kind: "owner", promo: "no", note: "Agents, obsessed with lead generation and already paying for it." },
  { sub: "RealEstate", kind: "owner", promo: "no", note: "Huge and mostly consumers. Comment only, for reach." },
  { sub: "Contractor", kind: "owner", promo: "value", note: "Trades owners. Our strongest fit." },
  { sub: "HVAC", kind: "owner", promo: "no", note: "Technicians and owners mixed; the owners talk about slow seasons." },
  { sub: "hvacadvice", kind: "owner", promo: "no", note: "Mostly homeowners — comment for reach, not leads." },
  { sub: "Plumbing", kind: "owner", promo: "no", note: "Owners answer in the comments here more than they post." },
  { sub: "Roofing", kind: "owner", promo: "value", note: "Owners buy leads constantly." },
  { sub: "Electricians", kind: "owner", promo: "no", note: "Trade room; the owners are in the comments, not the posts." },
  { sub: "Construction", kind: "owner", promo: "no", note: "Broad trades room, owners mixed with crew. Comment only." },
  { sub: "landscaping", kind: "owner", promo: "value", note: "Seasonal spend spikes." },
  { sub: "PestControl", kind: "owner", promo: "value", note: "Route businesses, local search heavy." },
  { sub: "AutoDetailing", kind: "owner", promo: "value", note: "Owner-operators, very active." },
  { sub: "Welding", kind: "owner", promo: "no", note: "Job shops looking for more work coming through the door." },
  { sub: "restaurateur", kind: "owner", promo: "value", note: "Restaurant owners; covers, delivery apps and local search." },
  { sub: "Bartenders", kind: "owner", promo: "no", note: "Staff rather than owners, so no offers ever go here." },
  { sub: "smallbusiness", kind: "biz", promo: "weekly", note: "The single best audit-magnet room. Use the weekly promo thread for offers." },
  { sub: "gym", kind: "owner", promo: "no", note: "Members and owners mixed; owner threads are worth answering." },
  { sub: "personaltraining", kind: "owner", promo: "value", note: "Trainers who need clients." },
  { sub: "Fitness", kind: "owner", promo: "no", note: "Consumers, not gym owners. Kept out of the offer rotation." },
  { sub: "Esthetician", kind: "owner", promo: "value", note: "Solo operators, booking-driven." },
  { sub: "Hairstylist", kind: "owner", promo: "no", note: "Chair renters and salon owners chasing a full book." },
  { sub: "tattooadvice", kind: "owner", promo: "no", note: "Consumers asking about tattoos, not artists buying marketing." },
  { sub: "Veterinary", kind: "owner", promo: "no", note: "Clinic owners and practice managers; high client value." },
  { sub: "photography", kind: "owner", promo: "no", note: "Freelancers who need bookings but guard their wallets." },
  { sub: "WeddingPhotography", kind: "owner", promo: "value", note: "Booking-season spend." },
  { sub: "moving", kind: "owner", promo: "value", note: "Movers buy local leads year-round." },
  { sub: "juniordev", kind: "biz", promo: "no", note: "Not buyers at all. Listed so it stays out of the rotation." },

  // --- general business rooms ---
  { sub: "Entrepreneur", kind: "biz", promo: "no", note: "Huge and hostile to promotion. Result posts and comments only." },
  { sub: "EntrepreneurRideAlong", kind: "biz", promo: "value", note: "Build-in-public. Result posts do very well." },
  { sub: "sweatystartup", kind: "biz", promo: "value", note: "Service businesses — trades, cleaning, local. Great fit." },
  { sub: "business", kind: "biz", promo: "no", note: "Broad business talk, low intent. Comment only." },
  { sub: "ecommerce", kind: "biz", promo: "value", note: "Store owners with real ad spend and constant creative fatigue." },
  { sub: "shopify", kind: "biz", promo: "value", note: "Store owners. Creative and CRO offers." },
  { sub: "Etsy", kind: "biz", promo: "no", note: "Sellers with small budgets; useful for reach, rarely for retainers." },
  { sub: "FulfillmentByAmazon", kind: "biz", promo: "no", note: "Amazon sellers, different channel." },
  { sub: "dropship", kind: "biz", promo: "value", note: "Low budgets, high ad appetite." },
  { sub: "SaaS", kind: "biz", promo: "value", note: "B2B founders, longer sales cycles but real budgets." },
  { sub: "msp", kind: "owner", promo: "value", note: "IT shops. High contract value, weak marketing." },
  { sub: "Franchising", kind: "biz", promo: "value", note: "Multi-location — our best ticket size." },
  { sub: "PrintShop", kind: "owner", promo: "value", note: "Local print shops that live or die on nearby search." },
  { sub: "CommercialCleaning", kind: "owner", promo: "value", note: "Contract cleaners chasing B2B leads." },
  { sub: "forhire", kind: "biz", promo: "ok", note: "Offers allowed outright, but price-driven and low ticket." },
  { sub: "B2BForHire", kind: "biz", promo: "ok", note: "Business-to-business hiring." },
  { sub: "DoneDirtCheap", kind: "biz", promo: "ok", note: "Very low ticket. Use only to build karma." },
];

V2.KINDS = [
  { key: "ads", name: "Already spending", why: "They have a budget and a complaint. Shortest path to a paying client." },
  { key: "owner", name: "Business owners", why: "No marketing team, no agency, pays for calls. Best ticket size." },
  { key: "biz", name: "General business", why: "Big rooms. Reach and credibility more than direct leads." },
];
V2.PROMO = {
  no: { name: "Comments only", rank: 0, why: "Offers get removed here. Answer questions, build the name, they DM you." },
  weekly: { name: "Weekly thread", rank: 1, why: "Offers belong in the sub's own promo thread — still works, less reach." },
  value: { name: "Value post ok", rank: 2, why: "A post is welcome if it gives something away before it asks." },
  ok: { name: "Offers ok", rank: 3, why: "Straight offers are allowed." },
};
V2.targetsBy = function (kind) { return V2.TARGETS.filter((t) => !kind || kind === "all" || t.kind === kind); };
V2.postable = function (t) { return (V2.PROMO[t.promo] || {}).rank >= 1; };

// ----------------------------------------------------------------- offers
// An offer is irresistible when the risk sits on us, the value arrives
// before the invoice, and the ask is smaller than the gift. Every one of
// these gives something real away first. `ask` is the only thing we want
// back, and it is never "book a call" on the first touch.
V2.OFFERS = [
  { key: "gbp_audit", name: "Free Google Business Profile audit", channel: "local_seo",
    who: "any business with a physical location or a service area",
    gift: "where you rank for your main keyword, the three profiles sitting above you, what they have that you do not, and the two things I would fix first",
    ask: "drop your Maps link or business name and city",
    risk: "posted publicly in the thread — no email, no call, no signup",
    spots: 10 },
  { key: "ads_teardown", name: "Free ad account teardown", channel: "meta_ads",
    who: "anyone spending over $1,000 a month on Meta or Google",
    gift: "a walk through your structure, your worst-spending ad set, and the three changes I would make on Monday",
    ask: "share a screenshot of your last 30 days with the account name blurred",
    risk: "I post the teardown in the thread so everyone learns from it",
    spots: 5 },
  { key: "local_pack", name: "Free local pack report", channel: "local_seo",
    who: "local service businesses fighting for map positions",
    gift: "a grid of where you actually rank across your city, not just from your own office chair, plus who owns the squares you are losing",
    ask: "business name and city",
    risk: "the report is yours whether or not we ever speak again",
    spots: 10 },
  { key: "free_build", name: "We build it free, you only pay the ad spend", channel: "meta_ads",
    who: "businesses that have never run paid ads properly",
    gift: "campaign build, audience, tracking and the first creative set at no cost — you pay the platform, not us",
    ask: "tell me the business and what a new customer is worth to you",
    risk: "if month one does not beat what you are doing now, we stop and you owe nothing",
    spots: 3 },
  { key: "pay_on_results", name: "Pay per booked lead, no retainer", channel: "google_ads_seo",
    who: "owners burned by a monthly retainer that produced nothing",
    gift: "we carry the setup and the management cost",
    ask: "agree a price per booked call before we start",
    risk: "no lead, no invoice",
    spots: 3 },
  { key: "creative_pack", name: "10 ad creatives, free, you run them", channel: "instagram_tiktok",
    who: "brands whose ads have gone stale",
    gift: "ten scroll-stopping IG and TikTok concepts scripted and edited for your product",
    ask: "send a link to what you sell",
    risk: "run them yourself, keep them forever, pay only if you want the next batch",
    spots: 5 },
  { key: "landing_fix", name: "Free landing page teardown", channel: "google_ads_seo",
    who: "anyone sending paid traffic to a page that does not convert",
    gift: "a line-by-line teardown of the page your ads point at and the rewrite I would ship first",
    ask: "post the URL",
    risk: "public teardown, no strings",
    spots: 10 },
  { key: "seo_gap", name: "Free competitor keyword gap report", channel: "google_ads_seo",
    who: "businesses being out-ranked and not sure why",
    gift: "every search your top competitor ranks for that you do not, sorted by what those searches are worth",
    ask: "your site and one competitor",
    risk: "you keep the file",
    spots: 10 },
  { key: "dead_leads", name: "We work your dead lead list free", channel: "meta_ads",
    who: "anyone sitting on months of old enquiries that went cold",
    gift: "we write and run the reactivation sequence over your existing list",
    ask: "export the list",
    risk: "you pay only on jobs booked from it",
    spots: 3 },
  { key: "90_day_plan", name: "Free 90-day growth plan, written, no call", channel: "none",
    who: "owners who want the plan without being sold to",
    gift: "a written 90-day plan for your business — channels, budget split, what to do in which week",
    ask: "three lines about the business and the goal",
    risk: "no call required, ever — I send the document and you do what you like with it",
    spots: 5 },
];
V2.offer = function (key) { return V2.OFFERS.find((o) => o.key === key) || V2.OFFERS[0]; };

// -------------------------------------------------------------- post types
// `magnet` posts ask for something back in the comments. `value` posts ask
// for nothing — they exist so that the name behind the magnet posts is worth
// answering. A board that only runs magnets reads as spam within a fortnight.
V2.POST_TYPES = [
  { key: "audit_magnet", name: "Free audit magnet", magnet: true,
    shape: "Offer the audit, say how many spots, say exactly what they get, ask them to drop the one thing you need in the comments. Do the audits publicly in the thread." },
  { key: "result_story", name: "Result story", magnet: false,
    shape: "One client, real numbers, the whole method given away step by step, including what failed. No offer at the end — a question instead." },
  { key: "teardown", name: "Public teardown", magnet: false,
    shape: "Take one anonymised account or profile and pull it apart in public. Show the fix. Invite others to post theirs." },
  { key: "playbook", name: "Playbook", magnet: false,
    shape: "The full step-by-step of something you do for money, written so a reader could do it alone this weekend." },
  { key: "mistakes", name: "Mistakes list", magnet: false,
    shape: "Five things you keep seeing this industry get wrong, each with the fix and what it cost someone." },
  { key: "comparison", name: "Channel comparison", magnet: false,
    shape: "Two channels compared with your own numbers across several accounts. Say which loses and why." },
  { key: "giveaway", name: "Template giveaway", magnet: true,
    shape: "Give away the sheet, checklist or script itself, pasted into the post so nobody has to leave Reddit. Ask for nothing but a comment on what they would add." },
  { key: "question_ask", name: "Real question", magnet: false,
    shape: "Ask the room a genuine question you want the answer to. Buyers reveal themselves in the replies." },
  { key: "ama", name: "AMA", magnet: true,
    shape: "Say who you are, what you run, the unusual thing you know, and open the floor. Answer every single comment." },
  { key: "local_case", name: "Local case", magnet: false,
    shape: "A story rooted in one city and one trade, with the local search detail that only someone who did the work would know." },
];
V2.postType = function (key) { return V2.POST_TYPES.find((t) => t.key === key) || V2.POST_TYPES[0]; };

// ------------------------------------------------------------ the writing
V2.POST_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "The post title. Plain, specific, no emoji, no clickbait, under 140 characters." },
    body: { type: "string", description: "The post body in Reddit markdown. No links of any kind. No prices. No agency name." },
    first_comment: { type: "string", description: "The comment to leave on your own post a minute after posting: the extra detail that did not fit, ending in a question." },
    why_this_sub: { type: "string", description: "One line on why this room in particular will take this post well." },
    risk: { type: "string", description: "The most likely reason a moderator would remove this, or 'none'." },
  },
  required: ["title", "body", "first_comment", "why_this_sub", "risk"],
  additionalProperties: false,
};

V2.postSystem = function (profile = {}) {
  const me = profile.name || "a small marketing team";
  const where = profile.place || "";
  return [
    "You write Reddit posts for " + me + (where ? ", based in " + where : "") + ". They run paid ads and local search for small businesses.",
    "",
    "The single rule: the post must be worth reading by someone who will never hire anybody. Reddit removes posts that read as advertising, and readers downvote them long before a moderator arrives.",
    "",
    "Hard constraints:",
    "- No links, no URLs, no domain names, no email addresses. Nothing that could be a funnel.",
    "- No agency name, no brand name, no 'we are a full-service agency'.",
    "- No prices, no packages, no 'starting at'.",
    "- No emoji. No bold-everything. No em-dash-heavy corporate rhythm.",
    "- Never say 'in today's digital landscape', 'leverage', 'unlock', 'game-changer', 'delve', 'elevate your'.",
    "- Write like a person typing on a phone who knows the trade: short sentences, concrete numbers, one admission of something that went wrong.",
    "- Specifics beat adjectives. '12 calls to 61 calls in four months' beats 'incredible results'.",
    "- The post must end with a question to the room.",
    "",
    "Formatting: Reddit markdown. Short paragraphs. Numbered lists where there are steps. No headers larger than bold text.",
  ].join("\n");
};

V2.postUser = function (target, offer, type, profile = {}, extra = "") {
  const t = V2.postType(type.key ? type.key : type);
  const o = V2.offer(offer.key ? offer.key : offer);
  const tg = typeof target === "string" ? (V2.TARGETS.find((x) => x.sub === target) || { sub: target, kind: "biz", promo: "value", note: "" }) : target;
  const promo = V2.PROMO[tg.promo] || V2.PROMO.value;
  const lines = [
    "Room: r/" + tg.sub,
    "What that room is: " + (tg.note || "a business subreddit"),
    "What that room allows: " + promo.name + " — " + promo.why,
    "",
    "Post type: " + t.name,
    "Shape: " + t.shape,
    "",
  ];
  if (t.magnet) {
    lines.push(
      "The offer to make: " + o.name,
      "Who it is for: " + o.who,
      "What they get free: " + o.gift,
      "What we ask for: " + o.ask,
      "Why it is safe for them: " + o.risk,
      "Spots: " + o.spots,
      "",
      "Make the offer the point of the post. State the number of spots. Say plainly that the work will be posted back in this thread in public. Ask them to comment, never to DM.",
      ""
    );
  } else {
    lines.push(
      "This post makes no offer at all. Nothing is sold. The subject should sit next to this work so that the people it attracts are the same people who would buy it later: " + o.name.toLowerCase() + " — " + o.who + ".",
      "Give the method away completely. If a reader could do it themselves after reading, the post is correct.",
      ""
    );
  }
  if (profile.credit) lines.push("True things about us that may be used, in our own words, and only if they fit naturally: " + profile.credit, "");
  if (profile.wins) lines.push("Real results we can cite: " + profile.wins, "");
  if (extra) lines.push("Extra instruction for this one: " + extra, "");
  lines.push("Write the post.");
  return lines.join("\n");
};

// The gate every draft passes before it is allowed onto the board. Anything
// that fails here would have been removed by a moderator or ignored by the
// room, so it is cheaper to catch it now.
V2.AI_TELLS = ["in today's digital landscape", "leverage", "unlock the", "game-changer", "game changer", "delve", "elevate your", "in conclusion", "furthermore", "it's important to note", "as an ai"];
V2.postChecks = function (draft, target, type) {
  const t = V2.postType(type && type.key ? type.key : type);
  const title = String((draft && draft.title) || "");
  const body = String((draft && draft.body) || "");
  const all = (title + "\n" + body).toLowerCase();
  const bad = [];
  if (title.length < 15) bad.push("the title is too short");
  if (title.length > 300) bad.push("Reddit cuts titles at 300 characters");
  if (title === title.toUpperCase() && /[A-Z]{6}/.test(title)) bad.push("the title is shouting");
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(title + body)) bad.push("there is an emoji in it");
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|agency|marketing)\b/i.test(body)) bad.push("there is a link or a domain name in the body");
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(body)) bad.push("there is an email address in it");
  if (/\bstarting at\b|\bper month we charge\b|\bour (packages|pricing|rates)\b/i.test(body)) bad.push("it quotes a price");
  if (body.length < (t.magnet ? 320 : 700)) bad.push("the body is too thin for " + t.name.toLowerCase() + " (" + body.length + " characters)");
  if (body.length > 9000) bad.push("the body is longer than Reddit will take comfortably");
  if (!/\?\s*$/.test(body.trim())) bad.push("it does not end on a question");
  const tell = V2.AI_TELLS.find((w) => all.includes(w));
  if (tell) bad.push('it contains "' + tell + '", which reads as machine-written');
  if (t.magnet) {
    if (/\bdm me\b|\bpm me\b|\bsend me a (dm|pm)\b/i.test(body)) bad.push("it asks for a DM — the ask must be a public comment");
    if (!/\bcomment|\bdrop\b|\breply\b|\bpost (it|your|below)\b/i.test(body)) bad.push("it never asks them to comment");
  } else {
    if (/\bdm me\b|\bpm me\b|\bhire\b.*\bus\b|\bwe offer\b|\bour service\b/i.test(body)) bad.push("a value post must not pitch");
  }
  return bad;
};

// --------------------------------------------------------------- calendar
// One post a day, and the board decides which room, which offer and which
// shape so that nothing repeats in a pattern a moderator would notice.
// Deterministic: the same inputs always produce the same calendar, so
// re-planning after a change does not shuffle everything you already sent.
V2.PLAN_DEFAULT = { days: 30, perDay: 1, subCoolDays: 14, magnetEvery: 4, kinds: "all" };
V2.plan = function (opts = {}) {
  const o = { ...V2.PLAN_DEFAULT, ...opts };
  const start = o.start || Date.now();
  const pool = (o.subs && o.subs.length ? o.subs.map((s) => V2.TARGETS.find((t) => t.sub === s)).filter(Boolean) : V2.targetsBy(o.kinds)).filter(V2.postable);
  if (!pool.length) return { rows: [], error: "no room in the list allows a post — pick some subreddits that are not comments-only" };
  const offers = (o.offers && o.offers.length ? o.offers : V2.OFFERS.map((x) => x.key)).map(V2.offer);
  const allowed = (o.types && o.types.length) ? V2.POST_TYPES.filter((t) => o.types.includes(t.key)) : V2.POST_TYPES;
  const magnets = allowed.filter((t) => t.magnet);
  const values = allowed.filter((t) => !t.magnet);
  if (!magnets.length && !values.length) return { rows: [], error: "no post types selected" };

  // when each subreddit was last posted to, from real history first
  const last = {};
  for (const h of o.history || []) if (h.sub) last[h.sub] = Math.max(last[h.sub] || 0, h.at || 0);

  const rows = [];
  let cursor = 0;
  let magnetN = 0;
  const slots = Math.max(1, o.days) * Math.max(1, o.perDay);
  for (let i = 0; i < slots; i += 1) {
    const at = start + Math.floor(i / o.perDay) * 86400000;
    const wantMagnet = magnets.length && (i % Math.max(2, o.magnetEvery) === 0);
    const type = wantMagnet ? magnets[Math.floor(i / o.magnetEvery) % magnets.length] : (values.length ? values[i % values.length] : magnets[i % magnets.length]);
    // the next room that has cooled down; a magnet never goes somewhere
    // offers are not welcome
    let pick = null;
    for (let k = 0; k < pool.length; k += 1) {
      const c = pool[(cursor + k) % pool.length];
      const rank = (V2.PROMO[c.promo] || {}).rank || 0;
      if (type.magnet && rank < 1) continue;
      if ((last[c.sub] || 0) > at - o.subCoolDays * 86400000) continue;
      pick = c; cursor = (cursor + k + 1) % pool.length; break;
    }
    if (!pick) { rows.push({ n: i + 1, at, skipped: true, why: "every room is still cooling down — add more subreddits or shorten the gap" }); continue; }
    last[pick.sub] = at;
    // offers walk in order across the offer days, so all ten get an airing
    // before any of them comes round again
    const offer = type.magnet ? offers[magnetN++ % offers.length] : offers[i % offers.length];
    rows.push({
      n: i + 1, at, sub: pick.sub, kind: pick.kind, promo: pick.promo,
      weekly: pick.promo === "weekly",
      typeKey: type.key, typeName: type.name, magnet: !!type.magnet,
      offerKey: offer.key, offerName: offer.name,
      why: type.magnet
        ? "offer day — " + offer.name.toLowerCase() + " into r/" + pick.sub + (pick.promo === "weekly" ? ", inside that sub's weekly promo thread" : "")
        : "value day — " + type.name.toLowerCase() + " into r/" + pick.sub + ", nothing sold",
      state: "planned",
    });
  }
  const magnetCount = rows.filter((r) => r.magnet).length;
  return { rows, magnets: magnetCount, values: rows.filter((r) => r.sub && !r.magnet).length, skipped: rows.filter((r) => r.skipped).length, rooms: new Set(rows.filter((r) => r.sub).map((r) => r.sub)).size };
};

// ---------------------------------------------------- who is actually buying
// The v1 hunt scored intent. This one scores money. A post with a number in
// it beats a post with a feeling in it every time.
// A dollar figure or the word "spending" is proof. Jargon like CPL is not —
// anybody who read one blog post uses it — so the two are weighed apart.
V2.SPEND_RE = /\$\s?\d|\bad spend\b|\bspend(?:ing|s)?\b[^.?!]{0,40}(?:\d|month|week|day)|\bbudget of\b|\bretainer\b|\bquoted (?:me|us)\b|\bpaying\b[^.?!]{0,30}(?:\$|\ba month\b|\bper month\b)|\b\d[\d,]*\s?k?\s?(?:per month|a month|\/mo|monthly)\b/i;
V2.JARGON_RE = /\bcpl\b|\bcpa\b|\broas\b|\bcost per (?:lead|acquisition|click)\b|\bconversion rate\b|\bfunnel\b/i;
V2.AGENCY_RE = /\b(?:our|my|the|an|current|previous|last) (?:agency|marketing (?:agency|company|firm)|freelancer|consultant)\b|\bfired (?:our|the|my)\b|\blooking for an agency\b|\bhire an agency\b|\bagency (?:isn'?t|is not|stopped|charged|quoted)\b/i;
V2.TOOL_RE = /\b(?:ads manager|google ads|meta ads|facebook ads|tiktok ads|google business profile|gbp|klaviyo|hubspot|gohighlevel|go high ?level|semrush|ahrefs|shopify|wordpress|wix|squarespace|mailchimp|ga4|tag manager|search console)\b/i;
V2.OWNER_RE = /\b(?:my|our) (?:clinic|practice|shop|store|salon|gym|restaurant|firm|business|company|dealership|office|studio|brand)\b|\bi own\b|\bwe own\b|\bwe run a\b|\bi run a\b|\bowner of\b|\bwe have \d+ locations?\b/i;
V2.BROKE_RE = /\bno budget\b|\bfree (?:help|advice only|tool)\b|\bstudent\b|\bintern(?:ship)?\b|\bcan'?t afford\b|\bfor hire\b|\bhire me\b|\bmy portfolio\b|\blooking for work\b|\bequity only\b|\bco-?founder\b/i;
V2.classifyBuyer = function (title, body, sub) {
  const text = String(title || "") + " \n " + String(body || "");
  if (V2.BROKE_RE.test(text)) return { tier: 0, badge: "", keep: false, why: "no money in this one — someone selling, studying or asking for free help" };
  const spend = V2.SPEND_RE.test(text);
  const agency = V2.AGENCY_RE.test(text);
  const tool = V2.TOOL_RE.test(text);
  const owner = V2.OWNER_RE.test(text);
  const jargon = V2.JARGON_RE.test(text);
  const amount = (text.match(/\$\s?\d[\d,]*(?:\s?k\b)?/i) || [])[0] || "";
  if (spend) return { tier: 3, badge: "spending", keep: true, amount, why: "already spending money" + (amount ? " (" + amount.replace(/\s+/g, "") + ")" : "") + " and saying so in public" };
  if (agency) return { tier: 3, badge: "spending", keep: true, amount, why: "talking about an agency or freelancer they pay or paid" };
  if (owner) return { tier: 2, badge: "owner", keep: true, amount, why: tool ? "a business owner naming the tools they run themselves" : "a business owner talking about their own business" };
  if (tool || jargon) return { tier: 1, badge: "asking", keep: true, amount, why: "a marketing question with a platform behind it, but no proof of a budget yet" };
  return { tier: 0, badge: "", keep: false, why: "no money signal, no owner signal — a general question, not a buyer" };
};

// Site-wide searches that find money rather than ideas.
V2.SEARCHES = [
  "\"spending\" \"per month\" ads no leads", "\"our agency\" not working", "fired our marketing agency",
  "agency quoted me", "looking for an agency recommendations", "\"ad spend\" wasted",
  "google ads not converting small business", "facebook ads stopped working", "meta ads cost per lead went up",
  "\"cost per lead\" doubled", "roas dropped", "google business profile suspended",
  "\"not showing up\" google maps business", "rankings dropped traffic", "need more customers my business",
  "how do i get more leads for my", "\"we spend\" \"$\" marketing", "marketing budget where to spend",
  "is it worth hiring a marketing agency", "paying \"$\" a month for seo",
  "my clinic marketing", "my restaurant not getting customers", "contractor leads dried up",
  "\"per month\" retainer marketing worth it", "who should i hire to run my ads", "tried running ads myself",
];

// ----------------------------------------------- answering in public (free)
// The highest-return thing on Reddit and the cheapest: a complete, specific,
// free answer under a question a buyer asked. It sells nothing, which is
// exactly why it works — it is read by everyone who finds that thread later,
// and the people who need the work done come to us.
V2.ANSWER_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string", description: "The public comment. Solves their problem completely. No pitch, no link, no DM ask." },
    specific: { type: "string", description: "The one concrete number, setting or step in the answer that proves it came from someone who has done this." },
    worth_it: { type: "string", description: "'yes' if this thread is worth the time, 'no' if the asker has no money or no business." },
    worth_reason: { type: "string", description: "One line of why." },
  },
  required: ["answer", "specific", "worth_it", "worth_reason"],
  additionalProperties: false,
};
V2.answerSystem = function (profile = {}) {
  return [
    "You write Reddit comments for " + (profile.name || "a small paid-ads and local-search team") + ".",
    "",
    "You are answering a stranger's question in public. You are not selling. Nothing in the comment may point anywhere.",
    "",
    "Rules:",
    "- Answer the actual question, fully, as if they will never pay you. Give away the real method.",
    "- One concrete specific: a number, a setting, a threshold, a menu path. Vague advice is worthless and reads as bait.",
    "- Name the trade-off or the thing that usually goes wrong. That is what makes it credible.",
    "- No links. No domain names. No 'DM me'. No 'we do this for clients'. No offer of any kind.",
    "- 60 to 220 words. Short paragraphs. Plain words.",
    "- You may end with a question back to them if something genuinely changes the answer.",
    "- If the asker is a student, a freelancer touting for work, or has no business behind the question, set worth_it to 'no'.",
  ].join("\n");
};
V2.answerUser = function (post, profile = {}) {
  return [
    "Room: r/" + (post.sub || ""),
    "Title: " + String(post.title || ""),
    "What they wrote: " + String(post.body || "").slice(0, 2400),
    profile.credit ? "\nTrue things about us, in our words, usable only if a line genuinely needs backing: " + profile.credit : "",
    "\nWrite the comment.",
  ].filter(Boolean).join("\n");
};
V2.answerChecks = function (a) {
  const text = String((a && a.answer) || "");
  const bad = [];
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words < 45) bad.push("the answer is too thin to be worth posting (" + words + " words)");
  if (words > 300) bad.push("the answer runs long (" + words + " words) — nobody reads past 250");
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|io|co|agency)\b/i.test(text)) bad.push("there is a link or domain in it");
  if (/\bdm me\b|\bpm me\b|\bcheck (your )?dm\b|\bhappy to help offline\b|\breach out\b/i.test(text)) bad.push("it points at a DM — a public answer must stand alone");
  if (/\bwe (offer|provide|specialise|specialize)\b|\bour (agency|team) (does|offers|handles)\b|\bhire\b.*\bus\b/i.test(text)) bad.push("it pitches");
  const tell = V2.AI_TELLS.find((w) => text.toLowerCase().includes(w));
  if (tell) bad.push('it contains "' + tell + '"');
  return bad;
};

// ----------------------------------------------------------- paid Reddit ads
// Kept as data so the board can show it as a working plan rather than a
// document nobody opens. Figures are starting points, not quotes — the ad
// account shows the real minimums and costs on the day you open it.
V2.ADS_PLAN = {
  idea: "On Reddit, ads that look like ads lose. The move is to post organically first, find the post that already earned upvotes and comments, and put money behind that exact post. You are paying to widen something the room has already approved.",
  stages: [
    { key: "seed", name: "Stage 1 — seed, weeks 1–4", spend: "$0",
      does: "Run the board. Post the value posts and the audit magnets by hand, answer in public daily.",
      out: "Three or four posts that earned real comments. Those are your ad creatives, already tested by the audience for free." },
    { key: "promote", name: "Stage 2 — promote the winners, weeks 5–6", spend: "about $20–30 a day",
      does: "Take the two organic posts with the best comment-to-view ratio and promote them to the subreddits they came from plus five neighbours. Objective: conversions if the pixel is live, otherwise traffic. Bid CPC, not CPM.",
      out: "A cost per comment and a cost per click you can compare against each other." },
    { key: "leadgen", name: "Stage 3 — lead form on the winner, weeks 7–8", spend: "about $30–50 a day",
      does: "Point the best-performing promoted post at a Reddit lead form offering the audit, not at a sales page. Three fields maximum: business name, city, what they sell.",
      out: "Leads at a measurable cost per lead. Anything under a quarter of a client's first-month value is working." },
    { key: "scale", name: "Stage 4 — widen, week 9 onward", spend: "raise 20% a week, never double",
      does: "Add interest targeting and lookalike-style expansion only after one subreddit set is profitable. Keep one untouched control.",
      out: "A channel you can leave running." },
  ],
  targeting: [
    { name: "Community targeting", how: "Name the subreddits directly — the owner rooms and the ad-spender rooms from the Targets tab. This is Reddit's real advantage over Meta: you are buying a room, not a guess about a person." },
    { name: "Interest targeting", how: "Broader, cheaper, worse. Use it only once a community set is already profitable, and keep it in its own campaign." },
    { name: "Keyword / conversation placement", how: "Places the ad inside threads about your terms. Strong for 'google ads not working' style intent. Test it as its own ad group so it can be judged alone." },
    { name: "Geography", how: "If the offer is local SEO, target the country or city you can actually serve. A cheap click from the wrong continent is still wasted." },
  ],
  formats: [
    { name: "Promoted organic post", note: "The one that works. Same text, same comment section, already proven." },
    { name: "Image post", note: "Use a screenshot of a real result — a ranking grid, a call volume chart. Stock imagery dies on Reddit." },
    { name: "Video", note: "A 30-second screen recording of an audit outperforms a polished brand film here." },
    { name: "Lead generation form", note: "For stage 3. Ask the minimum; every extra field costs you leads." },
  ],
  rules: [
    "Never turn comments off. A promoted post with a dead comment section reads as an ad and Reddit users punish it.",
    "Answer every comment on a promoted post within an hour. The comment section is the landing page.",
    "The account that promotes should be the account that has been answering questions for weeks. History is what makes the ad land.",
    "Judge on cost per booked call, never on clicks. Reddit clicks are cheap and curious.",
    "Install the Reddit pixel before spending a rupee, or you are buying blind.",
    "Kill an ad set at 3× your target cost per lead with no lead. Do not nurse it.",
  ],
  budget: { test: "$500 over the first four weeks of paid", verdict: "If four weeks and $500 have not produced one booked call, the offer is wrong, not the channel — change the offer before adding budget." },
};
