// SEO buyer hunter (log 1.26.0). Pure helpers only: what a thread is about (category + topic),
// whether it is a buyer or a question an expert can answer, how good it is (score), whether it is a
// gem worth a phone ping, the pool every read is folded into, the next 10 picks, and the reading
// plan that keeps BHW reads under a fixed hourly cap. The reads, Telegram and storage live in
// background.js; nothing here touches the network or chrome.*.

export const BHW = 'https://www.blackhatworld.com';
export const POSTS_URL = `${BHW}/whats-new/posts/`;
export const FORUM_LIST_URL = `${BHW}/forums/`;

export const HOUR = 3600000;
export const PAGES_PER_HOUR = 15;          // every BHW page this copy opens, HAF included, counts
export const MAX_PAGES_PER_UPDATE = 3;
export const MIN_NEW_PER_UPDATE = 10;
export const FAST_START_PAGES = 3;
export const POOL_MAX = 4000;
export const POOL_DAYS = 30;
export const GEMS_PER_DAY = 8;
export const PICKS = 10;

// ------------------------------------------------------------------ categories

const rx = (words) => new RegExp(`\\b(${words.join('|')})`, 'i');

/** Every thread lands in exactly one category; the first topic that matches inside it names the topic. */
export const CATEGORIES = [
  { id: 'seo', name: 'SEO', icon: '🔎', forum: /seo|link building|blogging|backlink|local/i, topics: [
    { id: 'backlinks', name: 'Backlinks', rx: rx(['backlink', 'link building', 'niche edit', 'pbn', 'dofollow', 'do-follow', 'links? for', 'link insertion', 'citation']) },
    { id: 'guest', name: 'Guest posts', rx: rx(['guest post', 'guest-post', 'outreach', 'sponsored post', 'blogger outreach']) },
    { id: 'local', name: 'Local SEO / GMB', rx: rx(['local seo', 'gmb', 'google my business', 'google business profile', 'gbp', 'map pack', 'maps rank', 'google maps']) },
    { id: 'technical', name: 'Technical / audit', rx: rx(['audit', 'index', 'deindex', 'crawl', 'core update', 'penalt', 'sitemap', 'schema', 'canonical', 'core web vitals', 'site speed', 'redirect']) },
    { id: 'rankings', name: 'Rankings / traffic', rx: rx(['rank', 'serp', 'traffic', 'keyword', 'organic', 'first page', 'top 10', 'top 3']) },
    { id: 'seo', name: 'SEO general', general: true, rx: rx(['seo', 'search engine', 'google update', 'domain authority', 'dr ?\\d', 'da ?\\d', 'expired domain']) }
  ] },
  { id: 'ads', name: 'Ads', icon: '📣', forum: /ppc|google ads|facebook ads|media buying|bing|adwords|cpa|tiktok/i, topics: [
    { id: 'linkedin', name: 'LinkedIn Ads', rx: rx(['linkedin ads?', 'linkedin campaign', 'linkedin lead gen', 'sponsored content', 'b2b ads']) },
    { id: 'google', name: 'Google Ads', rx: rx(['google ads', 'adwords', 'google ppc', 'search ads', 'pmax', 'performance max', 'shopping ads']) },
    { id: 'meta', name: 'Meta / Facebook', rx: rx(['facebook ads?', 'fb ads?', 'meta ads?', 'instagram ads?', 'ig ads?', 'ads manager']) },
    { id: 'tiktok', name: 'TikTok Ads', rx: rx(['tiktok ads?', 'tik tok ads?']) },
    { id: 'bing', name: 'Bing / Microsoft', rx: rx(['bing ads?', 'microsoft ads?']) },
    { id: 'youtube', name: 'YouTube Ads', rx: rx(['youtube ads?', 'video ads?']) },
    { id: 'media', name: 'Media buying', rx: rx(['media buy', 'ppc', 'native ads?', 'push ads?', 'pop ?ads?', 'ad spend', 'roas', 'cpc', 'cpm', 'ad campaign', 'ads? expert', 'ads? manager', 'paid ads']) }
  ] },
  { id: 'social', name: 'Social media', icon: '💬', forum: /social|instagram|youtube|twitter|reddit|tiktok|facebook|telegram|pinterest/i, topics: [
    { id: 'instagram', name: 'Instagram', rx: rx(['instagram', '\\big\\b', 'reels']) },
    { id: 'tiktok', name: 'TikTok', rx: rx(['tiktok', 'tik tok']) },
    { id: 'youtube', name: 'YouTube', rx: rx(['youtube', 'yt channel', 'shorts']) },
    { id: 'x', name: 'X / Twitter', rx: rx(['twitter', '\\bx\\.com', 'tweets?']) },
    { id: 'reddit', name: 'Reddit', rx: rx(['reddit', 'subreddit']) },
    { id: 'linkedin', name: 'LinkedIn', rx: rx(['linkedin']) },
    { id: 'social', name: 'Social general', general: true, rx: rx(['social media', 'smm', 'followers', 'facebook page', 'telegram channel', 'pinterest', 'community manag']) }
  ] },
  { id: 'content', name: 'Content & writing', icon: '✍️', forum: /copywriting|writing|content/i, topics: [
    { id: 'articles', name: 'Articles / blog', rx: rx(['article', 'blog post', 'blog content', 'content writ', 'writer', 'seo content', 'seo writ']) },
    { id: 'copy', name: 'Copywriting', rx: rx(['copywrit', 'sales page', 'landing page copy', 'email copy', 'ad copy', 'product description']) },
    { id: 'ai', name: 'AI content', rx: rx(['ai content', 'ai writ', 'chatgpt', 'gpt', 'claude', 'ai articles?']) },
    { id: 'content', name: 'Content general', general: true, rx: rx(['content', 'ghostwrit', 'ebook', 'proofread', 'translation']) }
  ] },
  { id: 'web', name: 'Web & dev', icon: '🖥', forum: /programming|web design|wordpress|coding|scripts|development/i, topics: [
    { id: 'wordpress', name: 'WordPress', rx: rx(['wordpress', '\\bwp\\b', 'elementor', 'woocommerce']) },
    { id: 'shop', name: 'Shopify / ecommerce', rx: rx(['shopify', 'ecommerce', 'e-commerce', 'online store', 'dropship']) },
    { id: 'apps', name: 'Apps / scripts / bots', rx: rx(['\\bapp\\b', 'script', '\\bbot\\b', 'automation', 'scraper', 'chrome extension', 'api']) },
    { id: 'web', name: 'Websites', rx: rx(['website', 'web site', 'landing page', 'web design', 'web develop', 'developer', 'coder', 'programmer', 'html', 'php', 'python', 'react']) }
  ] },
  { id: 'design', name: 'Design & video', icon: '🎨', forum: /graphic|design|video/i, topics: [
    { id: 'video', name: 'Video', rx: rx(['video edit', 'editor', 'ugc', 'animation', 'explainer', 'thumbnail']) },
    { id: 'design', name: 'Design', rx: rx(['logo', 'graphic', 'design', 'banner', 'mockup', 'ui/ux', 'figma', 'canva']) }
  ] }
];
export const OTHER = { id: 'other', name: 'Other', icon: '📦', topics: [{ id: 'other', name: 'Other' }] };
export const ALL_CATEGORIES = [...CATEGORIES, OTHER];

/** { cat, topic } for a title (and the board it sits in). Title words win over the board. */
export function categorize(title, forum = '') {
  const t = String(title || '');
  // specific topics first in every category, then the broad ones ("SEO articles" is content, not SEO general)
  for (const c of CATEGORIES) for (const tp of c.topics) if (!tp.general && tp.rx.test(t)) return { cat: c.id, topic: tp.id };
  for (const c of CATEGORIES) for (const tp of c.topics) if (tp.general && tp.rx.test(t)) return { cat: c.id, topic: tp.id };
  for (const c of CATEGORIES) if (c.forum.test(String(forum || ''))) return { cat: c.id, topic: c.topics[c.topics.length - 1].id };
  return { cat: 'other', topic: 'other' };
}
export const catName = (id) => (ALL_CATEGORIES.find((c) => c.id === id) || OTHER).name;
export const topicName = (cat, topic) => ((ALL_CATEGORIES.find((c) => c.id === cat) || OTHER).topics.find((t) => t.id === topic) || {}).name || '';

// ------------------------------------------------------------------ lanes and score

/** Never in the pool: sellers' ads, hellos, and anything about hiding from or getting round a platform. */
export const SELLER = /\b(wts|for sale|selling|sell my|i will|i'll (do|make|write|build|provide)|we (offer|provide|will)|offering|my services?|our services?|cheap(est)?|discount|% ?off|lifetime deal|group buy|giveaway|review cop(y|ies)|free trial|promo code|coupon)\b|[⭐✅⚡❌⏩💥🔥🚀💯]/iu;
export const OFF_LIMITS = /\b(cloak\w*|bypass\w*|circumvent\w*|evad\w*|spoof\w*|unban\w*|carding|cc dumps?|stolen|fake (reviews?|docs?|ids?|documents?)|ban evasion)\b/i;
export const HELLO = /^\s*(hello|hi|hey|hola|greetings|welcome|good (morning|evening|afternoon|day)|new (here|member|to (bhw|the forum|blackhatworld))|newbie|i'?m new|just joined|introduc\w*|nice to meet)\b/i;
const DENY_FORUM = /introduc|lounge|journey|dispute|marketplace|for sale|seller|selling|renting|bhw mods|announcements|giveaway|contest/i;

export const BUYER = /\b(wtb|want to buy|looking for|look(ing)? to (hire|buy)|need(ed|s|ing)?\b|hiring|hire (a|an|someone|some)|seeking|in search of|who can|anyone (can|who|here|able)|recommend (a|an|me|someone|good)|budget|paying|will pay|pay (for|someone)|quote|request for|rfq|outsourc\w*)/i;
export const MONEY = /\$\s?\d|\d+\s?(\$|usd|dollars?)\b|\bbudget\b|\b\d+\s?k\s?\/\s?mo|\bper (month|article|link|post)\b/i;
export const EXPERT = /\?\s*$|\b(how (to|do|can|should|much|long)|why|help|issue|problem|dropp?(ed|ing)?|drop|penalt\w*|deindex\w*|not (ranking|indexing|indexed|showing)|stuck|advice|suggest\w*|what('?s| is| are) (the )?best|lost|tanked|down|suspend\w*|disapprov\w*|any (idea|tips?)|tips?|worth it|should i|is it (safe|possible|worth))\b/i;
const HAF_FORUM = /hire a freelancer|want to buy/i;

const t0 = (iso) => { const x = new Date(iso || 0).getTime(); return isFinite(x) && x > 0 ? x : 0; };

/** 'skip' (never shown), 'buyer', 'expert' or 'other'. */
export function laneOf(row) {
  const title = String(row?.title || ''), forum = String(row?.forum || '');
  if (!title || HELLO.test(title) || OFF_LIMITS.test(title) || /cloak/i.test(forum) || DENY_FORUM.test(forum)) return 'skip';
  const haf = HAF_FORUM.test(forum);
  if (SELLER.test(title) && !haf) return 'skip';
  if (haf || BUYER.test(title)) return 'buyer';
  if (EXPERT.test(title)) return 'expert';
  return 'other';
}

/** 0-100. Buyers start high; questions start in the middle; fewer replies and fresher threads rise. */
export function scoreOf(row, { now = Date.now(), focus = [] } = {}) {
  const lane = row.lane || laneOf(row);
  if (lane === 'skip') return 0;
  const rep = Number(row.replyCount) || 0;
  const age = now - (t0(row.startedAt) || now);
  let s = lane === 'buyer' ? 60 : lane === 'expert' ? 35 : 10;
  if (lane === 'buyer' && MONEY.test(String(row.title || ''))) s += 15;
  if (HAF_FORUM.test(String(row.forum || ''))) s += 8;
  if (rep === 0) s += 12; else if (rep <= 2) s += 8; else if (rep <= 4) s += 4; else s -= Math.min(20, (rep - 4) * 2);
  if (age < 30 * 60000) s += 10; else if (age < 2 * HOUR) s += 6; else if (age < 24 * HOUR) s += 2; else if (age > 7 * 24 * HOUR) s -= 15;
  if (focus.includes(row.cat)) s += 10;
  return Math.max(0, Math.min(100, s));
}

/** A gem is worth a phone ping straight away. Returns a short reason, or ''. */
export function gemOf(item, { now = Date.now(), focus = [] } = {}) {
  if (!item || item.status || isHaf(item.forum)) return '';
  const rep = Number(item.replyCount) || 0;
  const age = now - (t0(item.startedAt) || 0);
  const mine = !focus.length || focus.includes(item.cat);
  if (!mine) return '';
  if (item.lane === 'buyer' && age <= 30 * 60000 && rep <= 4) return 'fresh buyer';
  if (item.lane === 'buyer' && MONEY.test(item.title) && age <= 3 * HOUR && rep <= 6) return 'buyer with a budget';
  if (item.lane === 'expert' && rep === 0 && age <= HOUR) return 'unanswered question';
  return '';
}

// ------------------------------------------------------------------ the pool

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Fold rows read from BHW into the pool. Returns { pool, fresh }: fresh = ids never seen before
 * (sellers, hellos and off-limits threads are dropped and never come back). Known threads only get
 * their reply count and last activity refreshed; what the operator did with them stays.
 */
export function mergeRows(pool, rows, { now = Date.now(), focus = [], source = 'new' } = {}) {
  const next = { ...(pool || {}) };
  const fresh = [];
  for (const r of rows || []) {
    if (!r || !r.threadId || !r.title || r.sticky || r.locked || r.mine) continue;
    const id = String(r.threadId);
    const was = next[id];
    if (was) {
      const upd = { ...was, replyCount: r.replyCount ?? was.replyCount, lastActivityAt: r.lastActivityAt || was.lastActivityAt, seenAt: now };
      upd.score = scoreOf(upd, { now, focus });
      next[id] = upd;
      continue;
    }
    const lane = laneOf(r);
    if (lane === 'skip') continue;
    const { cat, topic } = categorize(r.title, r.forum);
    const item = {
      id, url: r.url, title: r.title, author: r.author || '', forum: r.forum || '', forumNode: String(r.forumNode || ''),
      startedAt: r.startedAt || null, lastActivityAt: r.lastActivityAt || null, replyCount: r.replyCount ?? null,
      cat, topic, lane, budget: lane === 'buyer' && MONEY.test(r.title), firstSeen: now, seenAt: now, day: dayOf(now), source, status: ''
    };
    item.score = scoreOf(item, { now, focus });
    next[id] = item;
    fresh.push(id);
  }
  return { pool: next, fresh };
}

/** Older than POOL_DAYS (by start, else first seen) goes; then the oldest beyond POOL_MAX. Returns { pool, dropped }. */
export function prunePool(pool, { now = Date.now(), days = POOL_DAYS, max = POOL_MAX } = {}) {
  const cut = now - days * 24 * HOUR;
  let items = Object.values(pool || {});
  const dropped = [];
  items = items.filter((i) => { const keep = (t0(i.startedAt) || i.firstSeen || 0) >= cut; if (!keep) dropped.push(i.id); return keep; });
  if (items.length > max) {
    items.sort((a, b) => (b.firstSeen || 0) - (a.firstSeen || 0));
    for (const i of items.slice(max)) dropped.push(i.id);
    items = items.slice(0, max);
  }
  return { pool: Object.fromEntries(items.map((i) => [i.id, i])), dropped };
}

/** HAF's own record of a thread, in one word: 'dm' (a PM went, auto or by hand), 'posted' (our public reply is up), 'queued' (HAF has it, not done), or ''. */
export function hafMark(lead) {
  if (!lead) return '';
  if (lead.pmSent) return 'dm';
  if (lead.status === 'POSTED') return 'posted';
  if (lead.kind !== 'thread' && !['SKIPPED', 'EXPIRED', 'BACKFILL'].includes(lead.status)) return 'queued';
  return '';
}
export const HAF_LABEL = { dm: '🤖 DM sent by our system', posted: '✅ Replied by our system', queued: '⏳ In HAF queue' };

/** The next picks: best score first among buyers and questions not acted on, not already shown in a pick round. */
export function nextPicks(pool, { n = PICKS, shown = {}, now = Date.now(), maxReplies = 10, maxAgeH = 72 } = {}) {
  return Object.values(pool || {})
    .filter((i) => !i.status && !shown[i.id] && i.haf !== 'dm' && i.haf !== 'posted' && (i.lane === 'buyer' || i.lane === 'expert'))
    .filter((i) => (Number(i.replyCount) || 0) < maxReplies && now - (t0(i.startedAt) || i.firstSeen) < maxAgeH * HOUR)
    .sort((a, b) => b.score - a.score || (t0(b.startedAt) - t0(a.startedAt)))
    .slice(0, n);
}

/** Counts for the tabs and chips. */
export function countPool(pool, { now = Date.now() } = {}) {
  const day = 24 * HOUR;
  const out = { all: 0, today: 0, buyers: 0, experts: 0, cats: {}, topics: {} };
  for (const i of Object.values(pool || {})) {
    out.all++;
    if (now - (i.firstSeen || 0) < day) out.today++;
    if (i.lane === 'buyer') out.buyers++;
    if (i.lane === 'expert') out.experts++;
    out.cats[i.cat] = (out.cats[i.cat] || 0) + 1;
    out.topics[`${i.cat}:${i.topic}`] = (out.topics[`${i.cat}:${i.topic}`] || 0) + 1;
  }
  return out;
}

// ------------------------------------------------------------------ reading plan

/** Reads in the last hour, from the read log (an array of timestamps). */
export const readsLastHour = (log, now = Date.now()) => (log || []).filter((t) => now - t < HOUR).length;
export const pagesLeft = (log, now = Date.now(), cap = PAGES_PER_HOUR) => Math.max(0, cap - readsLastHour(log, now));

/** Page n of a what's-new list, from the address page 1 ended on (BHW gives each list its own number). */
export function pageUrl(firstUrl, n) {
  if (n <= 1) return POSTS_URL;
  const m = String(firstUrl || '').match(/^(https:\/\/www\.blackhatworld\.com\/whats-new\/posts\/\d+\/)/);
  return m ? `${m[1]}page-${n}` : '';
}

/** Boards read once each (pages 1-2) to fill the first 7 days. Ids where known; slugs are looked up on the forum list. */
export const HISTORY_BOARDS = [
  { id: 76, name: 'Hire a Freelancer' }, { id: 92, name: 'Want to Buy' }, { id: 28, name: 'Black Hat SEO' },
  { slug: 'white-hat-seo', name: 'White Hat SEO' }, { slug: 'local-seo', name: 'Local SEO' }, { slug: 'blogging', name: 'Blogging' },
  { id: 83, name: 'Google Ads' }, { id: 219, name: 'Facebook Ads' }, { id: 125, name: 'General PPC' }
];
export const boardPage = (b, n) => (b && b.id ? `${BHW}/forums/${b.id}/${n > 1 ? `page-${n}` : ''}` : '');

/** The history list: page 1 of every board first, then page 2 of every board. */
export function historyQueue(boards) {
  const ok = (boards || []).filter((b) => b && b.id);
  return [...ok.map((b) => ({ url: boardPage(b, 1), board: b.name })), ...ok.map((b) => ({ url: boardPage(b, 2), board: b.name }))];
}

/** Minutes until the next update: 10-15 by day, 30 at night. `rand` in [0,1). */
export const nextGapMin = (quiet, rand = Math.random()) => (quiet ? 30 : 10 + Math.floor(rand * 6));

/** Whether a history page may be read now: one every few minutes, and never into the pages the next update needs. */
export function historyDue(st, log, now = Date.now()) {
  if (!st?.history || st.history.done || !(st.history.queue || []).length) return false;
  if (now - (st.history.lastAt || 0) < 3 * 60000) return false;
  return pagesLeft(log, now) > MAX_PAGES_PER_UPDATE;
}

// ------------------------------------------------------------------ Telegram text

const h = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function ago(iso, now = Date.now()) {
  const t = t0(iso); if (!t) return '';
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60); if (hr < 48) return `${hr} h ago`;
  return `${Math.round(hr / 24)} days ago`;
}
const LANE = { buyer: '💰 Buyer', expert: '🎓 Expert question', other: 'Thread' };

export function formatGem(i, reason, { now = Date.now() } = {}) {
  const rep = Number(i.replyCount) || 0;
  return [`💎 <b>Gem</b> · ${LANE[i.lane] || ''} · ${h(catName(i.cat))} › ${h(topicName(i.cat, i.topic))}`, '',
    `<b><a href="${h(i.url)}">${h(i.title)}</a></b>`,
    `${h(i.forum)} · ${rep} repl${rep === 1 ? 'y' : 'ies'} · ${ago(i.startedAt, now) || 'just found'}`, `Why: ${h(reason)}`].join('\n');
}
export const gemKeyboard = (i) => ({ inline_keyboard: [[{ text: '🔗 Open thread', url: i.url }]] });

/** Hire a Freelancer and Want to Buy: HAF reads, screens and messages these (WTB since log 1.26.0), so Hunt's Telegram leaves them out. */
export const isHaf = (forum) => /hire a freelancer|want to buy/i.test(String(forum || ''));
export const isWtb = (forum) => /want to buy/i.test(String(forum || ''));

// ------------------------------------------------------------------ Want to Buy -> HAF (log 1.26.0)
// Only service requests in her lines go to HAF's DM path. Buying a THING (accounts, proxies, cards, domains,
// followers, upvotes, software) is not a job for her, and fake engagement is never one.
export const WTB_GOODS = /\b(accounts?|pvas?|aged|vccs?|virtual (credit )?cards?|cards?|proxies|proxy|ips?|domains?|websites? for sale|buy (a |an )?(site|website|blog)|followers|likes|views|subscribers|upvotes?|downvotes?|karma|bms?|business managers?|agency accounts?|gmails?|sims?|phone numbers?|numbers|software|licen[cs]es?|keys?|bank|paypal|stripe|crypto|usdt|btc|tokens?|reviews?|ratings|traffic bot|bot traffic|scripts?|templates?|themes?|plugins?|ebooks?|courses?|database|leads list|email list)\b/i;
export const WTB_SERVICE = /\b(seo|rank\w*|backlinks?|links?|link building|guest posts?|outreach|niche edits?|citations?|gmb|local seo|audit|on-?page|technical seo|content|articles?|writ\w+|ads|ppc|google ads|adwords|facebook ads|meta ads|tiktok ads|linkedin ads|bing ads|campaigns?|media buy\w*|reddit|subreddit|marketing|promotion|promote|posting|manage\w*|setup|set up|expert|agency|freelancer|someone|service|help)\b/i;
export const WTB_CATS = ['seo', 'ads', 'social:reddit', 'content:articles'];

/** Should this Want to Buy thread go to HAF's DM path? { ok, why }. */
export function wtbTarget(item, { cats = WTB_CATS, now = Date.now(), maxAgeH = 24, maxReplies = 10 } = {}) {
  if (!item || !isWtb(item.forum)) return { ok: false, why: 'not Want to Buy' };
  const title = String(item.title || '');
  if (item.lane !== 'buyer') return { ok: false, why: 'not a buyer' };
  if (OFF_LIMITS.test(title)) return { ok: false, why: 'off limits' };
  const inCat = cats.some((c) => (c.includes(':') ? c === `${item.cat}:${item.topic}` : c === item.cat));
  if (!inCat) return { ok: false, why: `not her line (${item.cat})` };
  const goods = WTB_GOODS.test(title), service = WTB_SERVICE.test(title);
  if (goods && !/\b(seo|backlinks?|guest posts?|niche edits?|citations?|outreach|articles?|content|campaigns?|management|manager|setup|set up|run|expert|agency|service)\b/i.test(title)) return { ok: false, why: 'buying a thing, not a service' };
  if (!service) return { ok: false, why: 'no service named' };
  if ((Number(item.replyCount) || 0) >= maxReplies) return { ok: false, why: 'too many replies' };
  const t = new Date(item.startedAt || 0).getTime();
  if (!t || now - t > maxAgeH * HOUR) return { ok: false, why: 'older than 24 h' };
  return { ok: true, why: `${item.cat}${item.topic ? ` › ${item.topic}` : ''}` };
}
export const FEED_PER_MESSAGE = 15;
const LANE_ICON = { buyer: '💰', expert: '🎓', other: '🆕' };

/**
 * The live feed: every new thread since the last message, newest first, each with its category and a tap-to-open
 * title. Sent once 10 or more are waiting; more than 15 go out as several messages. Returns an array of messages.
 */
export function formatFeed(items, { now = Date.now(), per = FEED_PER_MESSAGE } = {}) {
  const list = items.filter((i) => !isHaf(i.forum)).sort((a, b) => (t0(b.startedAt) || b.firstSeen || 0) - (t0(a.startedAt) || a.firstSeen || 0));
  if (!list.length) return [];
  const buyers = list.filter((i) => i.lane === 'buyer').length, experts = list.filter((i) => i.lane === 'expert').length;
  const by = {};
  for (const i of list) by[i.cat] = (by[i.cat] || 0) + 1;
  const cats = ALL_CATEGORIES.filter((c) => by[c.id]).map((c) => `${c.icon} ${c.name} ${by[c.id]}`).join(' · ');
  const out = [];
  for (let k = 0; k < list.length; k += per) {
    const part = list.slice(k, k + per);
    const lines = k === 0
      ? [`🧲 <b>Live feed · ${list.length} new thread${list.length === 1 ? '' : 's'}</b> · 💰 ${buyers} buyers · 🎓 ${experts} questions`, cats, '']
      : [`🧲 <b>Live feed, continued</b> (${k + 1}-${k + part.length} of ${list.length})`, ''];
    part.forEach((i, n) => {
      const rep = Number(i.replyCount) || 0, c = ALL_CATEGORIES.find((x) => x.id === i.cat) || OTHER;
      lines.push(`<b>${k + n + 1}. ${LANE_ICON[i.lane] || '🆕'} <a href="${h(i.url)}">${h(i.title)}</a></b>${rep === 0 ? ' 🔥' : ''}`,
        `${c.icon} ${h(c.name)} › ${h(topicName(i.cat, i.topic))} · ${h(i.forum)} · ${rep} repl${rep === 1 ? 'y' : 'ies'} · ${ago(i.startedAt, now) || 'just now'}`, '');
    });
    if (k + per >= list.length) lines.push('💰 buyer · 🎓 question · 🆕 thread · 🔥 no replies yet. Hire a Freelancer stays with HAF.');
    out.push(lines.join('\n').slice(0, 3900));
  }
  return out;
}
