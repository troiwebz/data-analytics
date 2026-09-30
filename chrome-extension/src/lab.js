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

export const REVIEW_COPIES = 'https://www.blackhatworld.com/forums/free-review-copies-for-marketplace-approvals.303/';

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
  '  "titles": [3 thread titles for the operator, each under 90 characters],',
  '  "description": "the opening post for the operator\'s thread, 150-300 words, BBCode-free plain text with line breaks",',
  '  "reviewCopy": "a review-copy offer line for the Free Review Copies forum, 1-2 sentences",',
  '  "gaps": [3 things the operator\'s current thread is missing compared to the winners]',
  '}'
].join('\n');

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
export function parseLab(text) {
  const s = String(text || '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  let o = {};
  if (a !== -1 && b > a) { try { o = JSON.parse(s.slice(a, b + 1)); } catch { o = {}; } }
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
