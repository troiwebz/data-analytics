import { looseJson } from './lab.js';
// Thread Studio - research a niche on BHW's discussion sections and draft a
// 4-week plan of discussion threads that bring buyers to you (1.12.0).
//
// Deliberately separate from HAF: its own storage keys (studioRun,
// studioRuns), its own page, nothing written to the lead list, nothing sent,
// nothing posted. It reads BHW only when you press Run, in real tabs at the
// usual human pace, one run at a time.
//
// The method (worked out by hand first, in chat):
//   1. Start from your niche AND your service: every thread must fit what you sell.
//   2. Discussion sections only - never Hire a Freelancer, Marketplace or Want to Buy.
//      In buyer sections replies are sellers pitching; here replies are real interest.
//   3. Recent threads (by start date) show today's pains; the all-time most-replied
//      threads show the formats that go viral.
//   4. Every thread: ask -> share what you see on real accounts ("I" / "you") ->
//      ask again. Mixed types: question, quick tip, either/or, story, update.
//   5. BHW rules (help/terms): no selling or DM solicitation (3.6), no list-building
//      (3.12), no links or contact details in posts (3.15), no filler replies (3.5),
//      no giveaways (3.9). The signature carries who you are.

/** The general (discussion) sections, never the commercial ones. */
export const STUDIO_SECTIONS = [
  { name: 'Google Ads', url: 'https://www.blackhatworld.com/forums/google-ads.83/' },
  { name: 'FaceBook', url: 'https://www.blackhatworld.com/forums/facebook.86/' },
  { name: 'TikTok', url: 'https://www.blackhatworld.com/forums/tiktok.279/' },
  { name: 'Media Buying', url: 'https://www.blackhatworld.com/forums/media-buying.175/' },
  { name: 'General PPC', url: 'https://www.blackhatworld.com/forums/general-ppc-discussion.125/' },
  { name: 'Other PPC', url: 'https://www.blackhatworld.com/forums/other-ppc-networks.85/' },
  { name: 'Affiliate Programs', url: 'https://www.blackhatworld.com/forums/affiliate-programs.15/' },
  { name: 'CPA', url: 'https://www.blackhatworld.com/forums/cpa.50/' },
  { name: 'Making Money', url: 'https://www.blackhatworld.com/forums/making-money.12/' },
  { name: 'Black Hat SEO', url: 'https://www.blackhatworld.com/forums/black-hat-seo.28/' },
  { name: 'CryptoCurrency', url: 'https://www.blackhatworld.com/forums/cryptocurrency.218/' }
];

/** Keyword families: a niche word pulls in the words people actually use for it. */
const FAMILIES = [
  { k: /casino|gambl|igaming|i-gaming|betting|sportsbook|slot|poker/i, words: ['casinos?', 'gambl\\w*', 'igaming', 'i-gaming', 'betting', 'bets?', 'sportsbooks?', 'slots?', 'poker', 'bookmakers?', 'ftds?', 'roulette'] },
  { k: /crypto|bitcoin|web3|token|defi|nft|coin|exchange|wallet/i, words: ['crypto\\w*', 'bitcoin', 'btc', 'web3', 'defi', 'nfts?', 'memecoins?', 'presales?', 'airdrops?', 'blockchain', 'altcoins?', 'binance', 'solana', 'ethereum'] },
  { k: /nutra|supplement|health|keto|weight|diet/i, words: ['nutra', 'supplements?', 'health', 'keto', 'weight loss', 'diet', 'skincare'] },
  { k: /adult|dating|onlyfans|\bof\b|nsfw/i, words: ['adult', 'dating', 'onlyfans', 'nsfw', 'cam'] },
  { k: /forex|trading|trader|prop/i, words: ['forex', 'trading', 'trader', 'prop firm', 'signals'] },
  { k: /ecom|shopify|dropship|store/i, words: ['ecom', 'e-commerce', 'shopify', 'dropship', 'store'] },
  { k: /pharma|cbd|peptide/i, words: ['pharma', 'cbd', 'peptides?'] },
  { k: /loan|finance|insurance|credit/i, words: ['loans?', 'finance', 'insurance', 'credit'] }
];

/** One regex for the niche: its family words plus the user's own words. */
export function nicheRegex(niche) {
  const n = String(niche || '').trim();
  if (!n) return null;
  const words = new Set();
  for (const f of FAMILIES) if (f.k.test(n)) f.words.forEach((w) => words.add(w));
  for (const w of n.toLowerCase().split(/[^a-z0-9-]+/)) if (w.length >= 3 && !['ads', 'the', 'and', 'for'].includes(w)) words.add(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\w*');
  if (!words.size) return null;
  // Whole words only: "bet" must not match "better", "token" must not match "tokens" unless listed so.
  return new RegExp(`\\b(${[...words].join('|')})\\b`, 'i');
}

/** Titles that are sales, not discussion. */
const PROMO = /\b(wts|for sale|selling|cheap|discount|% off|buy now|services?|lifetime deal|group buy|hiring|hire)\b|\$\s?\d/i;

/** The threads worth studying: on-niche, not promotional, newest pains and biggest formats. */
export function pickThreads(rows, rx, { days = 90, now = Date.now() } = {}) {
  const cutoff = now - days * 86400000;
  const on = (rows || []).filter((r) => r && r.title && rx.test(r.title) && !PROMO.test(r.title));
  const seen = new Set();
  const uniq = on.filter((r) => { const k = String(r.threadId || r.url); if (seen.has(k)) return false; seen.add(k); return true; });
  const at = (r) => new Date(r.startedAt || r.lastActivityAt || 0).getTime();
  const recent = uniq.filter((r) => at(r) >= cutoff).sort((a, b) => (b.replyCount || 0) - (a.replyCount || 0));
  const viral = uniq.filter((r) => at(r) < cutoff).sort((a, b) => (b.replyCount || 0) - (a.replyCount || 0)).slice(0, 12);
  return { recent, viral };
}

export const STUDIO_SYSTEM = [
  'You plan BlackHatWorld (BHW) discussion threads for a member who sells a service. The goal: buyers read the threads,',
  'see that the member really does this work, and contact them through their signature. You get the member\'s service and',
  'research from BHW\'s discussion sections: recent on-niche threads (with replies, views, dates and opening posts) and the',
  'all-time most-replied ones.',
  '',
  'STEP 1 - pains. Group the recent threads into the 3-6 pains people actually have, in their words, and say which ones',
  'the member\'s service fits. Ignore pains the service does not fix.',
  '',
  'STEP 2 - 8 threads over 4 weeks, 2 a week, mixed types: Question, Quick tip, Either/or, Story, Update (use each at',
  'least once; Question at most 3 times). Never two in the same section in one week. Use only these sections:',
  'Google Ads, FaceBook, TikTok, Media Buying, General PPC, Other PPC, Affiliate Programs, CPA, Making Money,',
  'Black Hat SEO, CryptoCurrency. Base each thread on a real pain or a viral format from the research.',
  '',
  'EVERY thread body: open with a question or a situation the reader recognises; share what "I" see on real accounts,',
  'talking to "you"; a short numbered list of 3-5 concrete points; one quick check the reader can do today; end with ONE',
  'easy question (either/or, "your number", "what was it for you", or "am I wrong?"). Plain friendly English, short',
  'sentences, 100-170 words. No em dashes, no brackets around links, no hype words (squarely, delve, seamless, leverage,',
  'game changer, unlock).',
  '',
  'BHW RULES - break none of them, ever: no links, URLs, emails, Telegram or any contact detail in the body (3.15); no',
  '"DM me", "PM me", "reply X and I will send" or any list-building (3.6, 3.12); no prices, offers, discounts or "hire',
  'us" (3.6); no giveaways (3.9). Never promise the reader a result - say what you or your clients saw. Never teach how',
  'to get around platform review (no cloaking instructions); stay on compliance, settings, tracking and strategy.',
  'If the member sells a tool, never ask "what is the best tool" and never name it; talk about what the work reveals.',
  'Do not invent specific numbers of accounts or results; keep claims general unless the service text gives them.',
  '',
  'For each thread also write 2 short example replies (under 25 words) from other members and the member\'s answer to each',
  '(under 35 words): one new point, then a question. Never just "agreed". If someone asks "do you do this?", one line: they do it day to day, details in the',
  'signature.',
  '',
  'Return ONLY JSON:',
  '{"pains":[{"pain":"...","threads":n,"replies":n,"fit":"strong|medium|none","evidence":["thread title", ...]}],',
  ' "threads":[{"week":1,"type":"Question","section":"Google Ads","title":"...","body":["paragraph",["point","point"],"paragraph"],',
  '   "question":"...","basedOn":["source thread title"],"replies":[{"who":"member","text":"..."},{"you":true,"text":"..."}]}]}'
].join('\n');

/** The research, as Claude reads it - trimmed so a run stays cheap. */
export function studioPrompt({ niche, service, recent, viral, ops }) {
  const line = (r) => `- ${String(r.title).slice(0, 140)} | ${r.forum || ''} | started ${String(r.startedAt || '').slice(0, 10)} | ${r.replyCount ?? '?'} replies | ${r.views ?? '?'} views`;
  return [
    `NICHE: ${String(niche).slice(0, 80)}`,
    `MEMBER'S SERVICE: ${String(service || '(not given - keep threads general to the niche)').slice(0, 600)}`,
    '',
    `RECENT ON-NICHE DISCUSSION THREADS (${recent.length}):`,
    ...recent.slice(0, 40).map(line),
    '',
    `ALL-TIME MOST-REPLIED ON-NICHE THREADS (${viral.length}):`,
    ...viral.slice(0, 12).map(line),
    '',
    'OPENING POSTS OF THE MAIN ONES:',
    ...(ops || []).slice(0, 12).map((o) => `* ${String(o.title).slice(0, 100)}: ${String(o.body || '').replace(/\s+/g, ' ').slice(0, 420)}`)
  ].join('\n');
}

/** BHW-rule check on a drafted body. Each entry: rule, what it checks, pass. */
export function ruleCheck(text) {
  const t = String(text || '');
  const checks = [
    ['3.15', 'No links or contact details in the post', !/(https?:\/\/|www\.|\.com\b|t\.me|telegram|whatsapp|skype|discord|@\w+\.\w+)/i.test(t)],
    ['3.6 / 3.12', 'No "DM me", "PM me" or "reply X and I will send"', !/\b(dm|pm|message|inbox) me\b|reply (with|\w+) and i('| wi)ll|comment \w+ (to|and)/i.test(t)],
    ['3.6', 'No prices, offers or "hire us"', !/\$\s?\d|\b\d+\s?(usd|eur)\b|discount|% off|hire (us|me)|our (service|offer|package)|pricing|special offer/i.test(t)],
    ['3.9', 'No giveaways or contests', !/giveaway|first \d+ (people|replies)|free (copy|copies|access|trial)/i.test(t)],
    ['Tone', 'No hype words', !/squarely|delve|seamless|leverage|game[- ]?changer|\bunlock/i.test(t)],
    ['Form', 'Ends with a question', /\?\s*$/.test(t.trim())]
  ];
  return checks.map(([rule, what, pass]) => ({ rule, what, pass }));
}

/** The body as plain text for copying: numbered points, the question last. */
export function plainBody(th) {
  const out = [];
  for (const b of th.body || []) out.push(Array.isArray(b) ? b.map((x, i) => `${i + 1}. ${x}`).join('\n') : String(b));
  if (th.question) out.push(th.question);
  return out.join('\n\n').replace(/[—–]/g, ',');
}

/** Claude's answer, cleaned and checked; a broken answer is an error, never a half plan. */
export function parseStudio(text) {
  const o = looseJson(text);
  if (!o) throw new Error(String(text || '').includes('{') ? 'Claude\'s plan was cut off or malformed - run it again' : 'Claude did not return a plan - run it again');
  const threads = (Array.isArray(o.threads) ? o.threads : []).filter((t) => t && t.title && Array.isArray(t.body)).slice(0, 8)
    .map((t, n) => {
      const th = { id: n + 1, week: Math.min(4, Math.max(1, Number(t.week) || Math.floor(n / 2) + 1)), type: String(t.type || 'Question'),
        section: String(t.section || 'General PPC'), title: String(t.title).replace(/[—–]/g, ',').trim(),
        body: t.body.map((b) => (Array.isArray(b) ? b.map((x) => String(x).replace(/[—–]/g, ',')) : String(b).replace(/[—–]/g, ','))),
        question: String(t.question || '').trim(), basedOn: (t.basedOn || []).map(String).slice(0, 3),
        replies: (t.replies || []).slice(0, 4).map((r) => ({ who: r.you ? '' : String(r.who || 'member'), you: !!r.you, text: String(r.text || '') })) };
      // The closing question belongs on its own line: when the last paragraph repeats it, take it out there.
      const lastI = th.body.length - 1;
      if (th.question && typeof th.body[lastI] === 'string' && th.body[lastI].trim().endsWith(th.question)) {
        const rest = th.body[lastI].trim().slice(0, -th.question.length).trim();
        if (rest) th.body[lastI] = rest; else th.body.pop();
      }
      th.checks = ruleCheck(plainBody(th));
      return th;
    });
  if (threads.length < 4) throw new Error('Claude returned too few threads - run it again');
  const pains = (Array.isArray(o.pains) ? o.pains : []).slice(0, 6).map((p) => ({ pain: String(p.pain || ''), threads: Number(p.threads) || 0,
    replies: Number(p.replies) || 0, fit: String(p.fit || ''), evidence: (p.evidence || []).map(String).slice(0, 4) }));
  return { threads, pains };
}

/**
 * Saved plans: every run is kept as its own plan (id, name, niche, the service
 * text given, the research and the threads), newest first, never replaced by a
 * later run for the same niche. The oldest drop off past `max`.
 */
export function addPlan(plans, result, { name = '', max = 60, now = Date.now() } = {}) {
  const id = `p${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const plan = { ...result, id, name: String(name || '').trim().slice(0, 80) || `${result.niche} · ${String(result.at || new Date(now).toISOString()).slice(0, 10)}` };
  const list = [plan, ...Object.values(plans || {}).map((p, i) => ({ ...p, id: p.id || `old${i}`, name: p.name || `${p.niche} · ${String(p.at || '').slice(0, 10)}` }))]
    .sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, max);
  return { plans: Object.fromEntries(list.map((p) => [p.id, p])), id };
}
