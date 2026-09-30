// Thread Lab: what makes a service thread get replies, and copy for yours.
//
// You give it your own service thread. It reads it, reads the listing pages of
// the Free Review Copies forum and of your own section (up to five pages
// each), finds the threads that sell what you sell - by meaning, not by one
// shared word - ranks them by replies per day, opens the best, and has
// Claude pull out what works: the keywords, the irresistible offer, the pain
// angle, the hook. Then it writes your title and description against that
// competition. Nothing is posted; you copy what you want.
//
// Everything in this file is pure - no chrome API, no network - so the
// ranking can be proven with plain data. The run itself takes its readers and
// Claude as arguments for the same reason.

export const REVIEW_SECTION = 'https://www.blackhatworld.com/forums/service-reviews-beta-testers-help-wanted.165/';
export const REVIEW_COPIES = 'https://www.blackhatworld.com/forums/free-review-copies-for-marketplace-approvals.303/';

/**
 * The Service Reviews & Beta Testers section rules, as posted by BHW staff
 * (thread 1270545). The copy is written inside these and checked against them.
 */
export const SECTION_RULES = [
  'Review copies and beta places must be completely free - no fees, no paid tiers.',
  'No upselling or promoting other services ("free trial", "if you like this, try our other service").',
  'No links to off-site forms, email opt-ins or anything that collects user information.',
  'No convoluted descriptions, long feature lists or screenshots aimed at making sales.',
  'Do not ask for fake reviews, and do not offer incentives for reviews.',
  'Do not bump the thread, and do not ask reviewers to bump or like your main sales thread.',
  'Best practice: a [REVIEWERS] / [BETA TESTERS] / "Nx Free Review Copies" tag in the title.',
  'Best practice: state how many reviewers you want, and list criteria and what is required of them.'
];

const STOP = new Set(('a an the and or but if of to in on at by for with from as is are was were be been am i me my we our '
  + 'you your it its they them this that these those there here what which who how why when where can could would should '
  + 'will do does did have has had not no so than too very just also any some all more most much many only about into '
  + 'over up out new best top get got cheap cheapest fast quality high premium service services available offer offers '
  + 'free price prices per now today day days month months year years 2024 2025 2026 2027 best seller sale discount off '
  + 'guaranteed guarantee instant delivery real review copy copies reviews thread bhw one two three less old '
  + 'any reason direct fast professional full').split(/\s+/));

/** Words that carry meaning: lowercased, stopwords and noise out, crude plural folding. */
export function tokens(text) {
  const out = [];
  for (let w of String(text || '').toLowerCase().replace(/&[a-z]+;/g, ' ').split(/[^a-z0-9+#]+/)) {
    if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue;
    if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    out.push(w);
  }
  return out;
}

/**
 * TF-IDF vectors for a set of documents, and the cosine between any two.
 * Words a thread shares with yours count for more when few other threads use
 * them: "casino" in a sea of "backlinks" is the signal; "SEO" is not.
 */
export function vectorize(docs) {
  const df = new Map();
  const toks = docs.map((d) => tokens(d));
  for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) || 0) + 1);
  const n = docs.length;
  return toks.map((t) => {
    const tf = new Map();
    for (const w of t) tf.set(w, (tf.get(w) || 0) + 1);
    const v = new Map();
    let norm = 0;
    for (const [w, c] of tf) {
      const x = (1 + Math.log(c)) * Math.log(1 + n / (df.get(w) || 1));
      v.set(w, x); norm += x * x;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [w, x] of v) v.set(w, x / norm);
    return v;
  });
}

export function cosine(a, b) {
  let s = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const [w, x] of small) { const y = big.get(w); if (y) s += x * y; }
  return s;
}

/** Replies per day since the thread started - fair to new threads and old ones alike. */
export function repliesPerDay(row, now = Date.now()) {
  const start = new Date(row.startedAt || row.lastActivityAt || now).getTime();
  const days = Math.max(1, (now - start) / 86400000);
  return (Number(row.replyCount) || 0) / days;
}

/**
 * Rank listing rows against your thread. Relevance first (a thread selling
 * something else is not competition, however busy), then pull: the score is
 * similarity times log(1 + replies per day).
 */
export function rankCompetitors(mine, rows, { now = Date.now(), minSim = 0.1, top = 8 } = {}) {
  const myText = `${mine.title || ''} ${mine.title || ''} ${String(mine.body || '').slice(0, 1500)}`;
  const seen = new Set([String(mine.threadId || '')]);
  const pool = [];
  for (const r of rows || []) {
    const id = String(r.threadId || '');
    if (!id || seen.has(id) || r.sticky) continue;
    seen.add(id);
    pool.push(r);
  }
  const vecs = vectorize([myText, ...pool.map((r) => r.title)]);
  const me = vecs[0];
  const scored = pool.map((r, i) => {
    const sim = cosine(me, vecs[i + 1]);
    const rpd = repliesPerDay(r, now);
    const shared = [...vecs[i + 1].keys()].filter((w) => me.has(w));
    // Relevance squared: a close match with a few replies beats a loose one
    // that is merely busy - being in the same niche is the point.
    return { ...r, sim: Math.round(sim * 1000) / 1000, rpd: Math.round(rpd * 100) / 100, shared,
             score: sim * sim * Math.log1p(rpd) };
  });
  // One shared word is a coincidence; two, or a strong match, is competition.
  const relevant = scored.filter((r) => r.sim >= minSim && (r.shared.length >= 2 || r.sim >= 0.18)).sort((a, b) => b.score - a.score);
  return { relevant, top: relevant.slice(0, top), scanned: pool.length };
}

/**
 * Group the relevant threads into clusters of near-identical offers, so the
 * report can say "your thread sits among the casino SEO sellers" rather than
 * list forty titles. Greedy: a thread joins the first cluster it is close to.
 */
export function cluster(rows, { threshold = 0.35 } = {}) {
  const vecs = vectorize(rows.map((r) => r.title));
  const groups = [];
  rows.forEach((r, i) => {
    const g = groups.find((x) => cosine(vecs[x.lead], vecs[i]) >= threshold);
    if (g) g.members.push(i); else groups.push({ lead: i, members: [i] });
  });
  return groups.map((g) => {
    const counts = new Map();
    for (const i of g.members) for (const w of new Set(tokens(rows[i].title))) counts.set(w, (counts.get(w) || 0) + 1);
    const label = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w).join(' + ');
    const threads = g.members.map((i) => rows[i]);
    return { label, size: threads.length, replies: threads.reduce((s, t) => s + (Number(t.replyCount) || 0), 0), threads };
  }).sort((a, b) => b.replies - a.replies);
}

/**
 * What a title does, as features that can be counted. Measured over the whole
 * section, so the formula says "8 of the top 10 put the count first" instead
 * of guessing.
 */
// Markets and niches a title can target. A title that names both - "for
// Indonesia Casino iGaming SEO" - ranks for a long-tail search and tells the
// right buyer it is for them.
export const COUNTRIES = ['indonesia', 'indonesian', 'indo', 'thailand', 'thai', 'korea', 'korean', 'malaysia', 'malay', 'vietnam', 'viet',
  'philippines', 'india', 'indian', 'bangladesh', 'pakistan', 'brazil', 'brazilian', 'mexico', 'latam', 'spain', 'spanish', 'germany', 'german',
  'france', 'french', 'italy', 'italian', 'uk', 'usa', 'us', 'canada', 'australia', 'japan', 'japanese', 'turkey', 'turkish', 'nigeria', 'africa',
  'europe', 'eu', 'asia', 'arab', 'arabic', 'uae', 'dubai', 'saudi', 'russia', 'russian', 'poland', 'netherlands', 'nordic', 'global', 'worldwide'];
export const NICHES = ['casino', 'igaming', 'gambling', 'betting', 'sportsbook', 'slot', 'slots', 'poker', 'crypto', 'forex', 'adult', 'dating',
  'nutra', 'pharma', 'cbd', 'sweeps', 'sweepstakes', 'onlyfans', 'ofm', 'loan', 'finance', 'fintech', 'ecommerce', 'saas', 'local', 'real estate',
  'health', 'vpn', 'gaming', 'esports', 'nft', 'web3', 'peptides'];
const hasAny = (t, list) => { const x = ` ${String(t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')} `; return list.filter((w) => x.includes(` ${w} `)); };
export const marketsIn = (t) => hasAny(t, COUNTRIES);
export const nichesIn = (t) => hasAny(t, NICHES);

export function titleFeatures(title) {
  const t = String(title || '');
  const emoji = (t.match(/[☀-➿⬀-⯿]|[\uD83C-\uD83E][\uDC00-\uDFFF]|[⎝⎠【】★⭐✅❤♥⚡]/g) || []).length;
  return {
    countFirst: /^\s*[\[(【]?\s*\d+\s*x?\b/i.test(t),
    countAnywhere: /\b\d+\s*x\b|\b\d+\s+(?:free|review|copies|spots|members|testers|founders)/i.test(t),
    reviewTag: /free\s*revi?e?w|review cop|\breviewers?\b|beta\s*testers?/i.test(t),
    bracketTag: /^\s*[\[(【]/.test(t),
    brand: /\b[A-Z][a-z]+'s\b|[:\-–|]\s*[A-Z][A-Za-z0-9]+/.test(t),
    worth: /worth\s*\$?\d|\$\d+/i.test(t),
    market: marketsIn(t).length > 0,
    niche: nichesIn(t).length > 0,
    emojiHeavy: emoji >= 3,
    length: t.length
  };
}

/** Top vs the rest: how often each feature appears, so the formula rests on numbers. */
export function titleFormula(rows, { now = Date.now(), top = 10 } = {}) {
  const ranked = rows.filter((r) => !r.sticky).map((r) => ({ ...r, rpd: repliesPerDay(r, now), f: titleFeatures(r.title) }))
    .sort((a, b) => b.rpd - a.rpd);
  const head = ranked.slice(0, top), rest = ranked.slice(top);
  const share = (list, k) => (list.length ? Math.round(100 * list.filter((r) => r.f[k]).length / list.length) : 0);
  const avg = (list) => (list.length ? Math.round(list.reduce((s, r) => s + r.f.length, 0) / list.length) : 0);
  const keys = ['countFirst', 'countAnywhere', 'reviewTag', 'bracketTag', 'brand', 'worth', 'market', 'niche', 'emojiHeavy'];
  const LABEL = { countFirst: 'puts the number of copies first', countAnywhere: 'states how many copies', reviewTag: 'says Free Review Copies / Reviewers / Beta Testers',
                  bracketTag: 'opens with a [bracket] tag', brand: 'names the brand', worth: 'states what the copy is worth',
                  market: 'targets a country or market', niche: 'names a niche (casino, crypto, adult…)', emojiHeavy: 'uses 3+ emoji or symbols' };
  const features = keys.map((k) => ({ key: k, label: LABEL[k], top: share(head, k), rest: share(rest, k) }));
  return { features, topLength: avg(head), restLength: avg(rest), top: head, sample: ranked.length };
}

/**
 * Viral = pulling at least twice the section's median replies per day, and at
 * least one a day. The top three by pull always qualify, so a quiet week still
 * has something to learn from. Sorted by pull.
 */
export function viralOnly(rows, { now = Date.now() } = {}) {
  const ranked = rows.filter((r) => !r.sticky).map((r) => ({ ...r, rpd: Math.round(repliesPerDay(r, now) * 100) / 100 }))
    .sort((a, b) => b.rpd - a.rpd);
  const sorted = ranked.map((r) => r.rpd).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const bar = Math.max(1, 2 * median);
  const out = ranked.filter((r, i) => r.rpd >= bar || i < 3).map((r) => ({ ...r, viral: r.rpd >= bar }));
  out.bar = Math.round(bar * 100) / 100; out.median = median;
  return out;
}

/**
 * Long-tail phrases the viral titles are built on: runs of 2-4 meaningful
 * words that include a niche, a market or a service noun, counted across the
 * titles. "casino pbn backlinks", "indonesia casino seo", "edu guest posts".
 */
export function longTails(rows, { top = 12 } = {}) {
  const SERVICE = /^(seo|backlink|link|pbn|guest|post|edu|domain|expired|aged|ads|ad|google|facebook|meta|tiktok|instagram|traffic|proxy|proxies|account|review|removal|audit|citation|indexing|campaign|management|setup|smm|panel|email|content|article|video|ugc)$/;
  const counts = new Map();
  for (const r of rows) {
    const w = String(r.title || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
      .filter((x) => x.length > 1 && !/^\d+x?$/.test(x) && !['free', 'review', 'copies', 'copy', 'reviews', 'the', 'for', 'and', 'of', 'to', 'with', 'our', 'your', 'a', 'in', 'on', 'x'].includes(x));
    const seen = new Set();
    for (let n = 2; n <= 4; n++) for (let i = 0; i + n <= w.length; i++) {
      const g = w.slice(i, i + n);
      const strong = g.some((x) => NICHES.includes(x) || COUNTRIES.includes(x)) || g.filter((x) => SERVICE.test(x)).length >= 1;
      if (!strong) continue;
      const k = g.join(' ');
      if (seen.has(k)) continue; seen.add(k);
      counts.set(k, (counts.get(k) || 0) + 1 + Math.log1p(r.rpd || 0) / 3);
    }
  }
  return [...counts.entries()].filter(([k]) => k.split(' ').length >= 2)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, top).map(([k, s]) => ({ phrase: k, weight: Math.round(s * 10) / 10 }));
}

/** Read your main thread and propose the form: what reviewers get, main features, requirements, delivery. */
export const FILL_SYSTEM = [
  'You read a BlackHatWorld service thread and pull out, in the seller\'s own terms, what a free review copy of it',
  'should contain. Only use what the thread says. Where the thread does not say, leave the field empty.',
  'Return ONLY JSON:',
  '{ "gets": [3-5 short lines, what ONE reviewer receives - a small but real sample of the service],',
  '  "features": [3-6 short lines, the main features / selling points of the service as the thread states them],',
  '  "requirements": "one line: review timing, reviewer criteria, niches not accepted - only if stated or standard",',
  '  "delivery": "delivery time as stated, e.g. 3-5 days, or empty",',
  '  "targets": "the niches and countries/markets the service is for, as stated, e.g. Indonesia, Thailand; casino, iGaming, crypto",',
  '  "keywords": [4-6 long-tail phrases a buyer of THIS service would search on BHW, each 3-6 words, niche + service (+ market),',
  '                 e.g. "indonesia casino google ads", "crypto meta ads account management"] }'
].join('\n');

export function parseFill(text) {
  const o = looseJson(text) || {};
  const lines = (v, n) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, n) : []);
  return { gets: lines(o.gets, 5), features: lines(o.features, 6), requirements: String(o.requirements || '').trim(), delivery: String(o.delivery || '').trim(),
           targets: String(o.targets || '').trim(), keywords: lines(o.keywords, 6) };
}

/** The prompt, and the shape of the answer asked for. */
export const LAB_SYSTEM = [
  'You analyse service threads on BlackHatWorld (BHW), a forum marketplace for SEO, ads, social media and',
  'marketing services. You are given the operator\'s OWN service thread and the competing threads that get',
  'the most replies. Work out what makes the competitors pull replies, then write better copy for the operator.',
  '',
  'Be concrete. Quote the competitors\' actual words where it helps. No generic marketing advice.',
  'Write the new copy in the plain, direct register BHW sellers use. No hype words, no emoji walls,',
  'no guarantees the operator has not stated, and do not invent results, numbers or reviews.',
  '',
  'Return ONLY one JSON object:',
  '{',
  '  "keywords": { "winning": [words and phrases the top threads use, max 12],',
  '                "missing": [of those, the ones the operator\'s thread lacks, max 8] },',
  '  "competitors": [ { "id": "thread id", "offer": "their offer in one line", "hook": "their opening hook",',
  '                     "pain": "the pain they press on", "why": "why it gets replies, one line" } ],',
  '  "irresistibleOffer": "the one offer structure that wins in this niche, and how the operator should frame theirs",',
  '  "painAngles": [3 pain angles, each one sentence, strongest first],',
  '  "hooks": [5 opening hooks for the operator, each under 20 words],',
  '  "titles": [3 thread titles for the operator, 70-110 characters, each built on one long-tail keyword: Brand - Service for',
  '             Market + Niche + Keyword, e.g. "Domain Coasters - Aged Expired Domains for Indonesia Casino iGaming SEO"],',
  '  "description": "the opening post for the operator\'s thread, 150-300 words, BBCode-free plain text with line breaks",',
  '  "reviewCopy": "a review-copy offer line for the Free Review Copies forum, 1-2 sentences",',
  '  "gaps": [3 things the operator\'s current thread is missing compared to the winners]',
  '}'
].join('\n');

export const REVIEW_SYSTEM = [
  'You write review-copy threads for the BlackHatWorld (BHW) section "Service Reviews & Beta Testers Help Wanted".',
  'You are given: the operator\'s main sales thread, the operator\'s offer (how many copies, what each reviewer',
  'gets, requirements), the section rules, measured title statistics, and the posts of the threads in this',
  'section that get the most replies per day.',
  '',
  'First work out the SUCCESS FORMULA from the evidence: the title pattern and the post structure the top',
  'threads share, each point backed by what you saw (quote titles, give numbers). Then write the operator\'s',
  'thread in EXACTLY that pattern - same title shape, same post skeleton, same length and register.',
  '',
  'Hard rules for the copy:',
  '- Every section rule given below must be obeyed. No upsell, no incentive, no bump requests, no off-site links.',
  '- The description MUST contain the operator\'s main thread link, verbatim, on a line after "Thread Link:".',
  '- The title and the description MUST state the number of free review copies exactly as given.',
  '- Plain text with line breaks and short section headings like the winners use. No BBCode, no emoji walls.',
  '- KEYWORD TARGETING. Every title must carry ONE long-tail keyword built from the operator\'s service + niche',
  '  (+ market/country when the operator targets one), placed after the count tag and brand, e.g.',
  '  "[ 10x Free Review Copies ] - Domain Coasters: Aged Expired Domains for Indonesia Casino iGaming SEO".',
  '  Use the operator\'s targets and keywords first, then the long-tail phrases the viral titles share.',
  '  Titles should be 70-110 characters - long enough to hold the keyword, not a bare "Free Review Copies - Brand".',
  '- The first line of the post and the "What You\'ll Get" lines must use the same long-tail keywords naturally.',
  '- Keep "What You\'ll Get" to 3-5 short lines. Do not invent specs, numbers or results the operator did not give;',
  '  where a detail is needed but unknown, write it as [fill in: ...] so the operator can complete it.',
  '',
  'Return ONLY one JSON object:',
  '{',
  '  "formula": [ { "rule": "one point of the success formula", "evidence": "what in the data shows it" } ],',
  '  "titlePattern": "the title template, e.g. [ {N}x Free Review Copies ] - {Brand}: {Service} for {Market} {Niche} {Keyword}",',
  '  "keywordTargets": [ { "phrase": "long-tail keyword", "why": "who searches it / which viral title uses it" } ],',
  '  "postSkeleton": ["the post sections in order, e.g. Greeting", "Looking for N honest reviewers", "Thread Link", ...],',
  '  "titles": [3 titles for the operator in that pattern, each under 90 characters],',
  '  "description": "the full post for the operator, in the skeleton, 80-200 words",',
  '  "rulesCheck": [ { "rule": "section rule", "ok": true or false, "note": "why" } ],',
  '  "keywords": { "winning": [phrases the top titles and posts share, max 10], "missing": [those the operator lacks, max 6] },',
  '  "irresistibleOffer": "what makes the top offers easy to say yes to, and how the operator should frame theirs",',
  '  "hooks": [3 opening lines in the winners\' register],',
  '  "gaps": [3 things the operator\'s current main thread or offer is missing compared to the winners]',
  '}'
].join('\n');

export function reviewPrompt(mine, offer, formula, winners) {
  const cut = (x, n) => String(x || '').replace(/[ \t]+/g, ' ').slice(0, n);
  const lines = [
    'OPERATOR\'S MAIN SALES THREAD',
    `link: ${mine.url}`, `title: ${cut(mine.title, 200)}`, `post:\n${cut(mine.body, 2200) || '(could not be read)'}`,
    '', 'OPERATOR\'S OFFER',
    `free review copies: ${offer.copies}`,
    `each reviewer gets: ${offer.gets || '(not given - infer from the main thread, mark unknowns as [fill in: ...])'}`,
    `main features of the service: ${offer.features || '(not given - take them from the main thread)'}`,
    `target niches / markets: ${offer.targets || '(not given - take them from the main thread)'}`,
    `keywords buyers search: ${offer.keywords || '(not given - derive from the thread and the viral titles)'}`,
    `requirements / not accepted: ${offer.requirements || '(not given)'}`,
    `delivery time: ${offer.delivery || '(not given)'}`,
    '', 'SECTION RULES', ...SECTION_RULES.map((r) => `- ${r}`),
    '', `TITLE STATISTICS (top 10 by replies/day vs the other ${Math.max(0, formula.sample - 10)} threads)`,
    ...formula.features.map((f) => `- ${f.label}: top ${f.top}% vs rest ${f.rest}%`),
    '', 'LONG-TAIL PHRASES IN THE VIRAL TITLES (weighted by use and pull)',
    ...(formula.longTails || []).map((k) => `- ${k.phrase} (${k.weight})`),
    `- average title length: top ${formula.topLength} chars vs rest ${formula.restLength}`,
    '', `TOP THREADS IN THE SECTION (${winners.length}, most replies per day first)`
  ];
  for (const w of winners) {
    lines.push('---', `title: ${cut(w.title, 200)}`, `replies: ${w.replyCount} · replies/day: ${w.rpd}`, `post:\n${cut(w.body, 1500) || '(title only)'}`);
  }
  return lines.join('\n');
}

/** Checks the copy against what must be in it and what the section forbids. Returns problems, [] when clean. */
export function checkReviewCopy(result, { url, copies, targets = [] }) {
  const out = [];
  const d = String(result.description || ''), titles = result.titles || [];
  const n = String(copies);
  if (!d.includes(url)) out.push('the description does not contain your main thread link');
  if (!new RegExp(`\\b${n}\\s*x?\\b`, 'i').test(d)) out.push(`the description does not say ${n} copies`);
  titles.forEach((t, i) => { if (!new RegExp(`\\b${n}\\s*x?\\b`, 'i').test(t)) out.push(`title ${i + 1} does not state ${n}`); });
  // Keyword targeting: a title must name at least one niche or market you target.
  if (targets.length) titles.forEach((t, i) => {
    const hit = [...nichesIn(t), ...marketsIn(t)].filter((w) => targets.includes(w));
    if (!hit.length) out.push(`title ${i + 1} names none of your niches or markets (${targets.slice(0, 5).join(', ')}) - no long-tail keyword`);
  });
  const text = `${titles.join('\n')}\n${d}`;
  const bad = [
    [/\bbump\b/i, 'mentions bumping'], [/\blike (?:my|our|the) (?:main )?thread/i, 'asks for likes'],
    [/\b(?:discount|coupon|promo code|% off|special price|upgrade to)\b/i, 'reads as an upsell'],
    [/\bin exchange for (?:a )?(?:positive|5.?star|good)\b|\bpositive review\b/i, 'asks for a positive review'],
    [/https?:\/\/(?!(?:www\.)?blackhatworld\.com)/i, 'links off BHW']
  ];
  for (const [rx, why] of bad) if (rx.test(text)) out.push(`the copy ${why} - against the section rules`);
  return out;
}

/** Put the must-haves in when Claude left them out, rather than handing over copy that breaks the brief. */
export function repairReviewCopy(result, { url, copies }) {
  let d = String(result.description || '');
  if (!d.includes(url)) d = d.replace(/(Thread Link:?\s*)(\S*)/i, (m, a) => `${a}${url}`) ;
  if (!d.includes(url)) d = `${d.trim()}\n\nThread Link:\n${url}`;
  return { ...result, description: d };
}

export function labPrompt(mine, competitors) {
  const cut = (s, n) => String(s || '').replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').slice(0, n);
  const lines = [
    'OPERATOR\'S THREAD',
    `title: ${cut(mine.title, 200)}`,
    `section: ${mine.section || mine.forum || 'unknown'}`,
    `post:\n${cut(mine.body, 2500) || '(could not be read)'}`,
    '',
    `COMPETING THREADS (${competitors.length}, most replies per day first)`
  ];
  for (const c of competitors) {
    lines.push('---',
      `id: ${c.threadId}`,
      `title: ${cut(c.title, 200)}`,
      `forum: ${c.forum || ''} · replies: ${c.replyCount ?? '?'} · replies/day: ${c.rpd}`,
      `post:\n${cut(c.body, 1400) || '(title only)'}`);
  }
  return lines.join('\n');
}

/** The model may wrap JSON in prose or a fence; take the outermost object, and fill what is missing. */
/** JSON the way models actually return it: in a fence, with smart quotes or a trailing comma, or cut off. */
export function looseJson(text) {
  const s = String(text || '');
  const a = s.indexOf('{');
  if (a === -1) return null;
  let body = s.slice(a).replace(/```[\s\S]*$/, '');
  const tries = [];
  const b = body.lastIndexOf('}');
  if (b > 0) tries.push(body.slice(0, b + 1));
  // Cut off mid-answer: close what is open.
  let inStr = false, esc = false; const stack = [];
  for (const ch of body) {
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === '{' || ch === '[') stack.push(ch); else if (ch === '}' || ch === ']') stack.pop();
  }
  let closed = body + (inStr ? '"' : '');
  closed = closed.replace(/,\s*$/, '').replace(/,\s*"[^"]*"\s*:?\s*$/, '');
  closed += stack.reverse().map((c) => (c === '{' ? '}' : ']')).join('');
  tries.push(closed);
  for (const t of tries) {
    for (const v of [t, t.replace(/[“”]/g, '"').replace(/,\s*([}\]])/g, '$1')]) {
      try { return JSON.parse(v); } catch { /* next */ }
    }
  }
  return null;
}

export function parseLab(text) {
  const o = looseJson(text) || {};
  const arr = (v, n) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x.trim() : x)).filter(Boolean).slice(0, n) : []);
  return {
    keywords: { winning: arr(o.keywords?.winning, 12), missing: arr(o.keywords?.missing, 8) },
    competitors: arr(o.competitors, 10).filter((c) => c && typeof c === 'object'),
    irresistibleOffer: String(o.irresistibleOffer || '').trim(),
    painAngles: arr(o.painAngles, 3),
    hooks: arr(o.hooks, 5),
    titles: arr(o.titles, 3),
    description: String(o.description || '').trim(),
    reviewCopy: String(o.reviewCopy || '').trim(),
    gaps: arr(o.gaps, 3),
    formula: arr(o.formula, 8).filter((f) => f && typeof f === 'object'),
    keywordTargets: arr(o.keywordTargets, 8).filter((k) => k && typeof k === 'object'),
    titlePattern: String(o.titlePattern || '').trim(),
    postSkeleton: arr(o.postSkeleton, 10),
    rulesCheck: arr(o.rulesCheck, 12).filter((r) => r && typeof r === 'object'),
    ok: !!(o.titles && o.description)
  };
}

/**
 * The run, with its readers passed in:
 *   readThread(url)            -> { title, body, forum, forumUrl, forumNode, section, replies }
 *   readListing(url, pages)    -> { [threadId]: row }
 *   ask(system, user)          -> { text, cost } or throws
 *   step(message)              -> progress for the page
 */
export async function runLab({ url, pages = 5, reviewCopies = true, ownSection = true, open = 6 }, deps) {
  const { readThread, readListing, ask, step = () => {}, now = Date.now() } = deps;
  const id = (String(url).match(/\.(\d+)\/?(?:[?#].*)?$/) || String(url).match(/\/threads\/[^/]*\.(\d+)/) || [])[1] || '';
  if (!/blackhatworld\.com\//i.test(url) || !id) throw new Error('That is not a BlackHatWorld thread link.');
  const p = Math.min(5, Math.max(1, Number(pages) || 5));

  await step('Reading your thread…');
  const mine = { ...(await readThread(url)), threadId: id, url };
  if (!mine.title && !mine.body) throw new Error('Your thread could not be read - check the link and that you are logged in.');

  const sources = [];
  if (reviewCopies) sources.push({ label: 'Free Review Copies', url: REVIEW_COPIES });
  if (ownSection && mine.forumUrl && !/free-review-copies/.test(mine.forumUrl)) sources.push({ label: mine.forum || 'your section', url: mine.forumUrl });
  if (!sources.length) throw new Error('Pick at least one place to look for competitors.');

  const rows = [];
  for (const s of sources) {
    await step(`Reading ${p} page(s) of ${s.label}…`);
    const got = await readListing(s.url, p);
    for (const r of Object.values(got || {})) rows.push({ ...r, forum: r.forum || s.label, source: s.label });
  }

  await step(`Matching ${rows.length} threads against yours…`);
  const ranked = rankCompetitors(mine, rows, { now, top: Math.max(3, Math.min(10, open)) });
  if (!ranked.top.length) throw new Error(`None of the ${ranked.scanned} threads read looks like what you sell. Try your own section only, or a thread whose post says more about the service.`);
  const clusters = cluster(ranked.relevant.slice(0, 40));

  const opened = [];
  for (const [i, c] of ranked.top.entries()) {
    await step(`Opening competitor ${i + 1} of ${ranked.top.length}: ${String(c.title).slice(0, 60)}…`);
    const got = await readThread(c.url).catch(() => ({}));
    opened.push({ ...c, body: got.body || '', replyCount: c.replyCount });
  }

  await step('Asking Claude what wins, and writing your copy…');
  const answer = await ask(LAB_SYSTEM, labPrompt(mine, opened));
  const result = parseLab(answer.text);
  if (!result.ok) throw new Error('Claude answered, but not with usable copy. Run it again.');

  return {
    at: new Date(now).toISOString(), url, mine: { title: mine.title, forum: mine.forum, section: mine.section, bodyChars: String(mine.body || '').length },
    scanned: ranked.scanned, relevant: ranked.relevant.length,
    sources: sources.map((s) => s.label), pages: p,
    competitors: opened.map((c) => ({ threadId: c.threadId, title: c.title, url: c.url, forum: c.forum, replies: c.replyCount, rpd: c.rpd, sim: c.sim, shared: c.shared.slice(0, 6) })),
    clusters: clusters.slice(0, 6).map((g) => ({ label: g.label, size: g.size, replies: g.replies })),
    cost: answer.cost || 0,
    keywords: result.keywords, irresistibleOffer: result.irresistibleOffer, painAngles: result.painAngles,
    hooks: result.hooks, titles: result.titles, description: result.description, reviewCopy: result.reviewCopy, gaps: result.gaps,
    teardown: result.competitors      // Claude's per-competitor reading, keyed by thread id
  };
}


/**
 * The review-copy run. Studies the Service Reviews & Beta Testers section as
 * a whole - the format is what wins there, whatever the niche - and writes
 * your review-copy thread in that format, with your main thread link and your
 * number of copies, inside the section rules.
 */
export async function runReviewLab({ url, copies = 10, gets = '', features = '', targets = '', keywords = '', requirements = '', delivery = '', pages = 3, open = 6, alsoFrc = false }, deps) {
  const { readThread, readListing, ask, step = () => {}, now = Date.now() } = deps;
  const id = (String(url).match(/\.(\d+)\/?(?:[?#].*)?$/) || [])[1] || '';
  if (!/blackhatworld\.com\//i.test(url) || !id) throw new Error('That is not a BlackHatWorld thread link.');
  const n = Math.min(100, Math.round(Number(copies) || 0));
  if (!(n >= 1)) throw new Error('Say how many free review copies you will give.');
  const p = Math.min(5, Math.max(1, Number(pages) || 3));

  await step('Reading your main sales thread…');
  const mine = { ...(await readThread(url)), threadId: id, url };
  if (!mine.title && !mine.body) throw new Error('Your thread could not be read - check the link and that you are logged in.');

  const sources = [{ label: 'Service Reviews & Beta Testers', url: REVIEW_SECTION }];
  if (alsoFrc) sources.push({ label: 'Free Review Copies', url: REVIEW_COPIES });
  const rows = [];
  for (const s of sources) {
    await step(`Reading ${p} page(s) of ${s.label}…`);
    for (const r of Object.values((await readListing(s.url, p)) || {})) rows.push({ ...r, source: s.label });
  }
  const live = rows.filter((r) => !r.sticky && String(r.threadId) !== id);
  if (live.length < 5) throw new Error(`Only ${live.length} thread(s) were read from the section - try again in a few minutes.`);

  await step(`Measuring what the ${live.length} titles do…`);
  const formula = titleFormula(live, { now });
  // Only viral threads are studied: the formula comes from what is working,
  // never from a thread that merely sounds like yours.
  const viral = viralOnly(live, { now });
  const pick = viral.slice(0, Math.max(3, Number(open) || 6));
  formula.longTails = longTails(viral);

  const opened = [];
  for (const [i, c] of pick.entries()) {
    await step(`Opening ${i + 1} of ${pick.length}: ${String(c.title).slice(0, 60)}…`);
    const got = await readThread(c.url).catch(() => ({}));
    opened.push({ ...c, rpd: Math.round(repliesPerDay(c, now) * 100) / 100, body: got.body || '' });
  }

  await step('Working out the success formula and writing your thread…');
  const user = reviewPrompt(mine, { copies: n, gets, features, targets, keywords, requirements, delivery }, formula, opened);
  let answer = await ask(REVIEW_SYSTEM, user);
  let result = parseLab(answer.text);
  let cost = answer.cost || 0;
  if (!result.ok) {
    await step(answer.stop === 'max_tokens' ? 'The answer was cut off - asking again for a tighter one…' : 'The answer was not in the expected shape - asking again…');
    answer = await ask(REVIEW_SYSTEM, `${user}\n\nIMPORTANT: return ONLY the JSON object, compact, no prose. Keep each formula evidence and rulesCheck note under 20 words.`);
    cost += answer.cost || 0;
    result = parseLab(answer.text);
  }
  if (!result.ok) {
    const why = answer.stop === 'max_tokens' ? 'its answer was cut off at the length limit'
      : !String(answer.text || '').includes('{') ? `it replied in prose instead of JSON: "${String(answer.text || '').slice(0, 140)}"`
      : 'its JSON had no titles or post in it';
    const e = new Error(`Claude answered twice, but ${why}. Nothing was charged beyond the two calls ($${cost.toFixed(3)}).`);
    e.raw = String(answer.text || '').slice(0, 3000);
    throw e;
  }
  answer = { ...answer, cost };
  result = repairReviewCopy(result, { url, copies: n });
  const want = [...new Set([...nichesIn(`${targets} ${keywords} ${mine.title}`), ...marketsIn(`${targets} ${keywords}`)])];
  const problems = checkReviewCopy(result, { url, copies: n, targets: want });

  return {
    mode: 'review', at: new Date(now).toISOString(), url, copies: n,
    mine: { title: mine.title, forum: mine.forum, section: mine.section, bodyChars: String(mine.body || '').length },
    scanned: live.length, sources: sources.map((s) => s.label), pages: p, cost: answer.cost || 0,
    measured: { features: formula.features, topLength: formula.topLength, restLength: formula.restLength },
    competitors: opened.map((c) => ({ threadId: c.threadId, title: c.title, url: c.url, forum: c.forum, replies: c.replyCount, rpd: c.rpd, sim: c.sim || 0, shared: (c.shared || []).slice(0, 6), viral: !!c.viral })),
    viralBar: viral.bar, median: viral.median, longTails: formula.longTails, targets: want, keywordTargets: result.keywordTargets,
    formula: result.formula, titlePattern: result.titlePattern, postSkeleton: result.postSkeleton,
    titles: result.titles, description: result.description, rulesCheck: result.rulesCheck,
    keywords: result.keywords, irresistibleOffer: result.irresistibleOffer, hooks: result.hooks, gaps: result.gaps,
    problems
  };
}
