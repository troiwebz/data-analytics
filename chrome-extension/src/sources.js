// Where threads come from, beyond Hire a Freelancer.
//
// Three kinds of source feed one queue:
//   haf    the Hire a Freelancer forum - untouched, still scored and drafted
//   forum  any BHW forum you add by URL; every new thread there is a lead
//   site   the site-wide new-threads feed (what "What's new" shows), kept
//          only where a watch word hits
//
// Pure functions only. No chrome API, no network, so the rules can be read
// and tested as plain data.

export const SITE_FEED = 'https://www.blackhatworld.com/forums/-/index.rss';
export const SITE_KEY = 'site';
export const HAF_NODE = '76';                 // hire-a-freelancer.76

/** "https://www.blackhatworld.com/forums/google-ads.83/?order=..." -> the canonical forum URL, or ''. */
export function normalizeForumUrl(raw) {
  const m = String(raw || '').trim().match(/^(?:https?:\/\/)?(?:www\.)?blackhatworld\.com\/forums\/([a-z0-9-]+)\.(\d+)\/?/i);
  if (!m) return '';
  return `https://www.blackhatworld.com/forums/${m[1].toLowerCase()}.${m[2]}/`;
}

export const forumNodeOf = (url) => (String(url || '').match(/\.(\d+)\/?(?:[?#].*)?$/) || [])[1] || '';

/** "google-ads" -> "Google Ads" */
export function labelFromUrl(url) {
  const slug = (String(url || '').match(/\/forums\/([a-z0-9-]+)\.\d+/i) || [])[1] || '';
  return slug.split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/** The forum sources you have configured, plus the site-wide feed. */
export function sourcesOf(cfg) {
  const out = [];
  for (const f of cfg?.watchForums || []) {
    const url = normalizeForumUrl(f.url);
    if (!url) continue;
    const node = forumNodeOf(url);
    if (node === HAF_NODE) continue;                       // that one is source 1
    out.push({
      key: `forum:${node}`, kind: 'forum', node, url,
      label: String(f.label || '').trim() || labelFromUrl(url),
      feedUrl: `${url}index.rss`,
      enabled: f.enabled !== false,
      bumpAlerts: !!f.bumpAlerts
    });
  }
  out.push({
    key: SITE_KEY, kind: 'site', label: 'Site-wide', feedUrl: cfg?.siteFeedUrl || SITE_FEED,
    enabled: cfg?.siteWideEnabled !== false, bumpAlerts: false
  });
  return out;
}

const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Watch words as regexes. A word may be a phrase; matching is whole-word, case-insensitive. */
export function watchWordsOf(cfg) {
  return (cfg?.watchWords || [])
    .map((w) => ({ word: String(w.word || '').trim(), enabled: w.enabled !== false, bumpAlerts: !!w.bumpAlerts }))
    .filter((w) => w.word)
    .map((w) => ({ ...w, rx: new RegExp(`(^|[^a-z0-9])${escapeRx(w.word).replace(/\s+/g, '\\s+')}(?=$|[^a-z0-9])`, 'i') }));
}

/** Which enabled watch words hit this text. */
export function wordHits(text, words) {
  const t = String(text || '');
  return (words || []).filter((w) => w.enabled && w.rx.test(t));
}

/**
 * Does this title look like a marketplace or sales thread rather than a
 * person you could answer? Emoji walls, SELLING, price-per-unit, "instant
 * delivery" - the site-wide feed is mostly these, bumped by their sellers.
 */
const SALES_RX = new RegExp([
  '\\bselling\\b', '\\bwts\\b', '\\bfor sale\\b', '\\bwholesale\\b', '\\bprice ?list\\b',
  '\\binstant delivery\\b', '\\bfree trial\\b', '\\bstarting (?:from|at)\\b', '\\b\\d+% ?off\\b',
  '\\$\\s?\\d+(?:\\.\\d+)?\\s?(?:\\/|per)\\s?(?:gb|k|1000|each|month|mo|day|pc|piece|unit)\\b',
  '^\\s*\\[\\s*(?:selling|sell|wts|service|offer|promo|sale)\\b', '\\bcheapest\\b', '\\bbulk stock\\b',
  '\\baccept(?:ing)? (?:all|crypto|paypal)\\b', '\\b(?:aged|old) (?:gmail|accounts?|youtube)\\b', '\\bagency (?:account|recruitment)\\b'
].join('|'), 'i');
const EMOJI_RX = /[☀-➿⬀-⯿️]|[\uD83C-\uD83E][\uDC00-\uDFFF]|[【】⎝⎠▒▓█░]/g;

export function isSalesThread(title) {
  const t = String(title || '');
  if (SALES_RX.test(t)) return true;
  return (t.match(EMOJI_RX) || []).length >= 2;
}

/** Sections of BHW that are shops, not conversations - known only once the thread page is read. */
const MARKET_RX = /marketplace|classified|for sale|services? (?:offered|for sale)|affiliate programs - cpa|social media - panels|seo - (?:packages|link building|other)|freebies/i;
/** `section` is the breadcrumb path when known ("The Marketplace › Hosting"); `forum` the forum name alone. */
export function isMarketForum(section, forum = '') {
  const f = String(forum || '');
  if (/want to buy/i.test(f) || /want to buy/i.test(String(section || ''))) return false;   // buyers, exactly who you want
  return MARKET_RX.test(String(section || '')) || MARKET_RX.test(f);
}

/**
 * What kind of thread is this, for the card's tag: a BUYER you can pitch, a
 * QUESTION you can answer (pure help - your signature does the selling), or
 * INFO (someone sharing, nothing asked).
 */
const BUYER_RX = /\b(looking for|need(?:ed|ing)? (?:a|an|some|someone|help|help with)|hir(?:e|ing)|who can|can (?:anyone|someone|any one)|anyone (?:who|that|know|offer|provid|sell|do|does)|recommend(?:ation)?s?\b|want(?:ed|ing)? to buy|\bwtb\b|budget|seeking|required|require|any (?:good|reliable|trusted)|where (?:can|do) i (?:buy|get|find)|is there (?:anyone|any service|a service))/i;
const QUESTION_RX = /\?|^\s*(?:how|why|what|which|when|where|is|are|can|could|does|do|did|should|would|will|any|anyone|help|advice|question|thoughts|opinion)\b/i;

export function intentOf(text) {
  const t = String(text || '');
  if (BUYER_RX.test(t)) return 'BUYER';
  if (QUESTION_RX.test(t)) return 'QUESTION';
  return 'INFO';
}
