import { looseJson } from './lab.js';
// Reply Radar - threads worth a public reply, handed to you in small batches (1.13.0).
//
// Deliberately separate from HAF: its own storage keys (radar, radarCfg), its
// own page, its own alarm. It reads the first page of eight discussion
// sections, never Hire a Freelancer or the Marketplace, writes nothing to the
// lead list and never posts or types anything on BHW. You write every reply.
//
// The method (worked out on the live forum first, in chat):
//   1. A section's first page holds 3-4 days of threads, ordered by last reply.
//      Eight page loads an hour see everything; the homepage and search add nothing.
//   2. Any reply puts the thread back on the homepage with your name on it, so a
//      late reply on a live niche thread is as visible as a first reply.
//   3. Niche words decide what is yours; tiers decide how fresh the chance is.
//   4. One batch an hour: the best thread and two backups, each with what was
//      asked, what was already said and what nobody has said yet.
//   5. The count of today's public replies rides on every batch. The limit is
//      yours to keep (10 a day is the safe zone for an 8-year account at 1 a day).

/** First page of each, once per sweep. `ad` sections also take the account words. */
export const RADAR_SECTIONS = [
  { id: 219, name: 'Facebook ads', ad: true },
  { id: 83, name: 'Google Ads', ad: true },
  { id: 175, name: 'Media Buying', ad: true },
  { id: 125, name: 'General PPC', ad: true },
  { id: 85, name: 'Other PPC', ad: true },
  { id: 2, name: 'Cloaking', ad: true },
  { id: 218, name: 'CryptoCurrency', ad: false, needsAdWord: true },
  { id: 50, name: 'CPA', ad: false }
].map((s) => ({ ...s, url: `https://www.blackhatworld.com/forums/${s.id}/` }));

/** Sections Radar must never read, whatever ends up in the list. */
export const NEVER = /hire-a-freelancer|\.76\/|\/76\/|want-to-buy|marketplace|sellers|for-sale|link-building|seo-packages/i;

/** A trailing * takes any ending (gambl* = gambling, gamblers). Plain words also take a plural s. */
export const DEFAULT_WORDS = {
  casino: ['casino', 'gambl*', 'igaming', 'i-gaming', 'betting', 'bet', 'sportsbook', 'slot', 'poker', 'lottery', 'bookmaker', 'aviator'],
  crypto: ['crypto*', 'web3', 'forex', 'memecoin', 'presale', 'airdrop', 'nft', 'exchange'],
  cryptoLoose: ['token', 'trading'],
  cloak: ['cloak*', 'whitepage', 'white page', 'safe page', 'money page', 'bot filter', 'trustcloaker', 'trafficguardian', 'cloaking house'],
  restricted: ['nutra', 'peptide', 'adult', 'onlyfans', 'blackhat offer', 'black hat offer', 'bh offer'],
  setup: ['agency account', 'bm', 'bm5', 'business manager', 'vcc', 'virtual card', 'virtual credit card', 'warmup', 'warm-up', 'rent*'],
  trouble: ['suspend*', 'banned', 'ban', 'disabled', 'reject*', 'restrict*', 'flagged', 'disapprov*', 'circumvent*', 'blocked', 'blocking']
};

export const GROUP_LABELS = {
  casino: 'Casino', crypto: 'Crypto', cryptoLoose: 'Crypto, loose (CryptoCurrency section only)', cloak: 'Cloakers',
  restricted: 'Restricted niches', setup: 'Account setup (ad sections only)', trouble: 'Account trouble (ad sections only)'
};

export const DEFAULT_RADAR_CFG = { on: true, everyMinutes: 60, perBatch: 3, dailyTarget: 10, briefs: true, general: false, words: DEFAULT_WORDS, muted: [], families: {} };

const AD_WORD = /\b(ads?|advertis\w*|campaigns?|traffic|media buy\w*|ppc|promot\w*|marketing)\b/i;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One whole-word regex for a list of words; null when the list is empty. */
export function wordRegex(list) {
  const parts = [];
  for (const raw of list || []) {
    const w = String(raw || '').trim().toLowerCase();
    if (!w) continue;
    const wild = w.endsWith('*');
    const core = esc(wild ? w.slice(0, -1) : w).replace(/\s+/g, '[\\s-]?');
    if (core.length < 2) continue;
    parts.push(wild ? `${core}\\w*` : `${core}s?`);
  }
  return parts.length ? new RegExp(`\\b(${parts.join('|')})\\b`, 'i') : null;
}

/** The compiled lists, with a missing group falling back to the default. */
export function compileWords(words) {
  const w = { ...DEFAULT_WORDS, ...(words || {}) };
  return Object.fromEntries(Object.keys(DEFAULT_WORDS).map((k) => [k, wordRegex(w[k])]));
}

/**
 * Is this thread yours? 'strict' = niche words (casino, crypto, cloakers,
 * restricted niches), 'wide' = account setup or trouble in an ad section,
 * null = neither. Titles only: the page is already loaded, nothing is opened.
 */
export function classify(title, section, rx) {
  const t = String(title || '');
  const hit = (k) => !!(rx[k] && rx[k].test(t));
  if (hit('casino') || hit('cloak') || hit('restricted')) return 'strict';
  // The CryptoCurrency section is all crypto: there the title must also be about advertising.
  if (section.needsAdWord) { if ((hit('crypto') || hit('cryptoLoose')) && AD_WORD.test(t)) return 'strict'; }
  else if (hit('crypto')) return 'strict';
  if (section.ad && (hit('setup') || hit('trouble'))) return 'wide';
  return null;
}

const HOUR = 3600000;
const ms = (iso) => { const n = new Date(iso || 0).getTime(); return isFinite(n) ? n : 0; };

/**
 * A = started in the last 24h with 5 replies or fewer (first-reply chance),
 * B = last reply under 12h ago (live), C = last reply within 7 days and either a
 * niche match or 5 replies or fewer (quiet, worth reviving), G = a brand-new
 * general ads question with 0-2 replies. Older than 7 days: never (a reply on a
 * stale thread is post-count inflation in the mods' eyes).
 */
export function tierOf(row, match, now = Date.now()) {
  const startH = (now - ms(row.startedAt)) / HOUR;
  const lastH = (now - ms(row.lastActivityAt)) / HOUR;
  const rep = Number(row.replyCount) || 0;
  if (!ms(row.lastActivityAt) || lastH > 168) return null;
  if (!match) return row.adSection && ms(row.startedAt) && startH < 24 && rep <= 2 ? 'G' : null;
  if (ms(row.startedAt) && startH < 24 && rep <= 5) return 'A';
  if (lastH < 12) return 'B';
  if (match === 'strict' || rep <= 5) return 'C';
  return null;
}

/**
 * Thread rows off a section page, with the two things HAF's reader does not
 * carry: locked, and whether you have posted in the thread (XenForo puts your
 * small avatar on the row). Runs inside the page: no closure, data only.
 */
export function extractRadarListing() {
  const t = String(document.title || '');
  const body = String((document.body && document.body.innerText) || '').slice(0, 3000);
  if (/just a moment|access denied|attention required|rate limited|error 429|too many requests/i.test(t)
      || /you have been rate limited|access denied|has been blocked|verify you are human/i.test(body)) {
    return { blocked: `BHW blocked the page: ${t.slice(0, 80)}` };
  }
  const iso = (el) => { const v = el && el.getAttribute('data-timestamp'); const n = v ? parseInt(v, 10) * 1000 : NaN; return isFinite(n) && n > 0 ? new Date(n).toISOString() : null; };
  const num = (s) => { const m = String(s || '').replace(/,/g, '').match(/([\d.]+)\s*([KkMm])?/); if (!m) return null; return Math.round(parseFloat(m[1]) * (/k/i.test(m[2] || '') ? 1000 : /m/i.test(m[2] || '') ? 1e6 : 1)); };
  const meEl = document.querySelector('.p-navgroup-link--user .p-navgroup-linkText');
  const me = meEl ? (meEl.textContent || '').trim() : '';
  const rows = [];
  for (const el of document.querySelectorAll('.structItem--thread')) {
    const m = String(el.className).match(/js-threadListItem-(\d+)/);
    const links = [...el.querySelectorAll('.structItem-title a')].filter((x) => !/labelLink/.test(String(x.className)));
    const a = links[links.length - 1];
    if (!a) continue;
    const href = new URL(a.getAttribute('href'), location.href).href;
    const c = href.match(/^(https?:\/\/[^?#]*?\.(\d+))(?=\/|$|[?#])/);
    const id = m ? m[1] : (c ? c[2] : '');
    if (!id) continue;
    let replies = null, views = null;
    for (const dl of el.querySelectorAll('.structItem-cell--meta dl')) {
      const dd = dl.querySelector('dd');
      if (replies == null && /repl/i.test(dl.textContent || '')) replies = num(dd && dd.textContent);
      else if (views == null && /view/i.test(dl.textContent || '')) views = num(dd && dd.textContent);
    }
    const lastEl = el.querySelector('.structItem-cell--latest .username');
    const lastPoster = lastEl ? (lastEl.textContent || '').trim() : '';
    const author = el.getAttribute('data-author') || '';
    rows.push({
      threadId: id, url: c ? `${c[1]}/` : href, title: (a.textContent || '').trim(), author, lastPoster,
      startedAt: iso(el.querySelector('.structItem-startDate time')),
      lastActivityAt: iso(el.querySelector('.structItem-latestDate time') || el.querySelector('.structItem-cell--latest time')),
      replyCount: replies, views,
      sticky: /structItem--sticky/.test(String(el.className)) || !!el.closest('.structItemContainer-group--sticky') || !!el.querySelector('.structItem-status--sticky'),
      locked: !!el.querySelector('.structItem-status--locked'),
      lastMine: !!me && lastPoster.toLowerCase() === me.toLowerCase(),
      mine: !!el.querySelector('.structItem-secondaryIcon') || (!!me && (lastPoster.toLowerCase() === me.toLowerCase() || author.toLowerCase() === me.toLowerCase()))
    });
  }
  return { rows, me, loggedIn: document.documentElement.getAttribute('data-logged-in') === 'true', title: t, url: location.href };
}

export const emptyState = () => ({ queue: {}, replied: {}, hidden: {}, unmatched: [], lastBatch: null, batches: 0, sweptAt: 0, counted: {}, seen: [] });

/** The local calendar day, so "today" is the day on the machine's clock. */
const dayKey = (now) => { const d = new Date(now); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/**
 * Fold one sweep into the state. `pages` = [{ section, rows, me }]. Threads you
 * have posted in leave the queue. One counts as a public reply today when the
 * last post on it is yours and dated today, or when it was on the page last
 * sweep without you and now carries you (so replies made without Radar are
 * counted too, and an old reply of yours is not). Returns the new state - the
 * old one is not touched.
 */
export function foldSweep(state, pages, rx, { now = Date.now(), general = true, muted = [] } = {}) {
  const s = { ...emptyState(), ...state, queue: { ...(state?.queue || {}) }, replied: { ...(state?.replied || {}) }, counted: { ...(state?.counted || {}) } };
  const today = dayKey(now);
  const unmatched = [];
  const seen = new Set();
  const before = new Set((state?.seen || []).map(String));
  for (const p of pages || []) {
    const section = p.section;
    if (NEVER.test(section.url || '') || NEVER.test(section.name || '')) continue;      // belt and braces
    for (const r of p.rows || []) {
      if (!r || !r.threadId || r.sticky || r.locked) continue;
      const id = String(r.threadId);
      seen.add(id);
      if (r.mine) {
        const fresh = !s.replied[id] && ((r.lastMine && dayKey(ms(r.lastActivityAt)) === today) || before.has(id));
        if (!s.replied[id]) s.replied[id] = { at: now, title: r.title, section: section.name, url: r.url };
        if (fresh && !s.counted[id]) s.counted[id] = today;
        delete s.queue[id];
        continue;
      }
      if (s.replied[id] || s.hidden?.[id]) { delete s.queue[id]; continue; }
      const match = isMuted(r.title, muted) ? null : classify(r.title, section, rx);
      const tier = tierOf({ ...r, adSection: section.ad && section.name !== 'Cloaking' }, match, now);
      if (!tier || (tier === 'G' && !general)) {
        delete s.queue[id];
        if (!match) unmatched.push({ title: r.title, section: section.name, url: r.url, replies: r.replyCount, lastActivityAt: r.lastActivityAt });
        continue;
      }
      const old = s.queue[id] || {};
      s.queue[id] = { threadId: id, url: r.url, title: r.title, section: section.name, author: r.author, startedAt: r.startedAt, lastActivityAt: r.lastActivityAt,
        replyCount: r.replyCount, views: r.views, match: match || 'general', tier, shown: old.shown || 0, shownAt: old.shownAt || 0,
        brief: old.brief && old.briefAt === r.lastActivityAt ? old.brief : null, briefAt: old.briefAt && old.briefAt === r.lastActivityAt ? old.briefAt : null, firstSeen: old.firstSeen || now };
    }
  }
  // Only what is on page 1 right now (1.14.1): a thread that slipped to page 2 is gone from the queue.
  // Threads that came through "next <keyword>" are kept until they age out, they were never on a page.
  for (const [id, q] of Object.entries(s.queue)) if ((q.match !== 'search' && !seen.has(id)) || now - ms(q.lastActivityAt) > 168 * HOUR) delete s.queue[id];
  // Keep the day's count only.
  for (const [id, d] of Object.entries(s.counted)) if (d !== today) delete s.counted[id];
  s.unmatched = unmatched.slice(0, 160);
  s.seen = [...seen].slice(0, 400);
  s.sweptAt = now;
  return s;
}

const TIER_RANK = { A: 0, B: 1, C: 2, G: 3 };

/**
 * The next batch: the best `n` threads not yet answered. Niche threads before
 * general ads questions, never-shown first, then freshest chance (A, B, C),
 * niche words before account words, most
 * recently active first. A section you have already replied in three times
 * today is passed over, so the day's replies stay spread out. An hour with
 * nothing new sends nothing; "next <keyword>" searches the whole forum instead.
 */
export function pickBatch(state, { n = 3, now = Date.now(), skip = null, muted = [] } = {}) {
  const today = dayKey(now);
  const perSection = {};
  for (const [id, d] of Object.entries(state.counted || {})) if (d === today) { const sec = state.replied?.[id]?.section; if (sec) perSection[sec] = (perSection[sec] || 0) + 1; }
  // A thread sent once is never sent again (1.14): the hourly batch and "next"
  // share one memory of what reached you. Skipped threads stay on the Radar page.
  const again = (q) => !q.shown && !(state.sent || {})[String(q.threadId)];
  const pool = Object.values(state.queue || {}).filter((q) => (perSection[q.section] || 0) < 3 && again(q) && !(skip && skip.has(String(q.threadId))) && !isMuted(q.title, muted));
  pool.sort((a, b) => ((a.tier === 'G') - (b.tier === 'G')) || (a.shown - b.shown) || (TIER_RANK[a.tier] - TIER_RANK[b.tier]) || ((a.match === 'strict' ? 0 : a.match === 'wide' ? 1 : 2) - (b.match === 'strict' ? 0 : b.match === 'wide' ? 1 : 2))
    || (ms(b.lastActivityAt) - ms(a.lastActivityAt)));
  const out = [], used = {};
  for (const q of pool) {                       // at most two from one section in a batch
    if ((used[q.section] || 0) >= 2) continue;
    used[q.section] = (used[q.section] || 0) + 1;
    out.push(q);
    if (out.length >= n) break;
  }
  return out;
}

/** Mark a batch as shown; returns the new state. */
export function markShown(state, ids, now = Date.now()) {
  const queue = { ...(state.queue || {}) };
  for (const id of ids) if (queue[id]) queue[id] = { ...queue[id], shown: (queue[id].shown || 0) + 1, shownAt: now };
  return { ...state, queue, lastBatch: { at: now, ids: ids.map(String) }, batches: (state.batches || 0) + 1 };
}

/** You replied (or said so): out of the queue, counted today. */
export function markReplied(state, id, now = Date.now()) {
  const q = state.queue?.[id];
  const queue = { ...(state.queue || {}) }; delete queue[id];
  return { ...state, queue, replied: { ...(state.replied || {}), [id]: { at: now, title: q?.title || '', section: q?.section || '', url: q?.url || '' } },
    counted: { ...(state.counted || {}), [id]: dayKey(now) } };
}

/** Not relevant: hidden for good, never counted. */
export function markHidden(state, id, now = Date.now()) {
  const queue = { ...(state.queue || {}) }; delete queue[id];
  return { ...state, queue, hidden: { ...(state.hidden || {}), [id]: now } };
}

/** Public replies counted today. */
export const countToday = (state, now = Date.now()) => Math.max(0, Object.values(state.counted || {}).filter((d) => d === dayKey(now)).length + (state.manual?.day === dayKey(now) ? Number(state.manual.n) || 0 : 0));

/** "radar count 4": the day's number set by hand (a correction on top of what was seen). */
export function setCount(state, n, now = Date.now()) {
  const auto = Object.values(state.counted || {}).filter((d) => d === dayKey(now)).length;
  return { ...state, manual: { day: dayKey(now), n: Math.max(0, Number(n) || 0) - auto } };
}

// ------------------------------------------------------------------ briefs

export const BRIEF_SYSTEM = [
  'You read BlackHatWorld discussion threads for a member who will write their own public reply. For each thread you get',
  'the opening post and the replies so far. Say what is already there so the member can add something new. You never',
  'write the reply itself.',
  '',
  'For each thread return:',
  '  asked  - what the thread starter asked, one plain sentence (max 30 words).',
  '  said   - the answers already given, grouped: each a short phrase (max 14 words) and how many replies said it.',
  '           Most common first, at most 4 groups. One-line filler ("thanks", "following") is one group called "filler".',
  '  back   - anything the thread starter asked or said in a LATER post that nobody has answered (max 30 words), or "".',
  '  gap    - what no reply has covered yet, one sentence (max 28 words). If the thread is saturated, say so.',
  '',
  'Plain English, short. No hype words, no em dashes. Report what people wrote; do not add advice of your own, and do not',
  'add detail on getting around platform review beyond naming that a reply mentioned it.',
  '',
  'Return ONLY JSON: {"threads":[{"id":"<thread id>","asked":"...","said":[{"point":"...","n":2}],"back":"...","gap":"..."}]}'
].join('\n');

/** The threads as Claude reads them - trimmed so three threads stay one small call. */
export function briefPrompt(threads) {
  const out = [];
  for (const t of threads) {
    out.push(`THREAD ${t.threadId}: ${String(t.title).slice(0, 140)}`);
    out.push(`STARTER (${t.starter || t.author || 'starter'}): ${String(t.body || '').replace(/\s+/g, ' ').slice(0, 700)}`);
    const reps = (t.replies || []).slice(-16);
    if (!reps.length) out.push('NO REPLIES YET');
    for (const r of reps) out.push(`- ${r.author}${r.author && (r.author === t.starter || r.author === t.author) ? ' (STARTER)' : ''}: ${String(r.text || '').replace(/\s+/g, ' ').slice(0, 260)}`);
    out.push('');
  }
  return out.join('\n');
}

const tidy = (s, max) => String(s || '').replace(/[—–]/g, ',').replace(/\s+/g, ' ').trim().slice(0, max);

/** Claude's answer as { [threadId]: brief }; a broken answer is {} - the batch still goes out without briefs. */
export function parseBriefs(text) {
  const o = looseJson(text);
  const out = {};
  for (const t of (o && Array.isArray(o.threads) ? o.threads : [])) {
    if (!t || t.id == null) continue;
    out[String(t.id)] = { asked: tidy(t.asked, 260), back: tidy(t.back, 260), gap: tidy(t.gap, 260),
      said: (Array.isArray(t.said) ? t.said : []).slice(0, 4).map((x) => ({ point: tidy(x && x.point, 120), n: Math.max(1, Number(x && x.n) || 1) })).filter((x) => x.point) };
  }
  return out;
}

// ----------------------------------------------------------------- message

const h = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** "5 Oct, 9h ago" / "22 Sep, 14 days ago". */
export function ago(iso, now = Date.now()) {
  const t = ms(iso); if (!t) return '';
  const hrs = (now - t) / HOUR;
  const d = new Date(t);
  const date = `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`;
  return `${date}, ${hrs < 1 ? 'under 1h' : hrs < 48 ? `${Math.round(hrs)}h` : `${Math.round(hrs / 24)} days`} ago`;
}
const last = (iso, now) => { const hrs = (now - ms(iso)) / HOUR; return hrs < 1 ? 'under 1h ago' : hrs < 48 ? `${Math.round(hrs)}h ago` : `${Math.round(hrs / 24)} days ago`; };
export const KIND = { A: 'New, few replies', B: 'Live now', C: 'Quiet, worth reviving', G: 'General ads question' };

/**
 * One thread as a Telegram card (HTML), the way HAF sends a lead: its own
 * message with its own buttons. `i` of `of` in this batch; the first is the pick.
 * Kept plain on purpose: Telegram carries HAF cards and these, nothing else.
 */
export function formatCard(q, { now = Date.now(), i = 1, of = 1, count = 0, target = 10 } = {}) {
  const rep = Number(q.replyCount) || 0;
  const lines = [`📡 <b>Reply radar</b> · ${i} of ${of}${i === 1 && of > 1 ? ' · ⭐ best pick' : ''}`, '',
    `<b>${h(q.title)}</b>`,
    `${h(q.section)} · started ${ago(q.startedAt, now)} · ${rep} repl${rep === 1 ? 'y' : 'ies'}${rep ? ` · last ${last(q.lastActivityAt, now)}` : ''}`];
  const b = q.brief;
  if (b) {
    lines.push('');
    if (b.asked) lines.push(`<b>Asked:</b> ${h(b.asked)}`);
    if (b.said && b.said.length) lines.push(`<b>Already said:</b> ${b.said.map((x) => `${h(x.point)} (${x.n})`).join('; ')}`);
    else if (!rep) lines.push('<b>Already said:</b> nothing yet');
    if (b.back) lines.push(`<b>Starter asked again:</b> ${h(b.back)}`);
    if (b.gap) lines.push(`<b>Missing:</b> ${h(b.gap)}`);
  }
  const c = Number(count) || 0;
  lines.push('', `Public replies today: <b>${c} of ${target}</b>${c >= target ? ' (limit reached)' : ''}`);
  return lines.join('\n');
}

/** The card's buttons: open the thread, say you replied, or drop it. Nothing here posts. */
export function radarKeyboard(q) {
  return { inline_keyboard: [[{ text: '🔗 Open thread', url: q.url }], [{ text: '✅ I replied', callback_data: `rr:${q.threadId}` }, { text: '⏭ Not relevant', callback_data: `rx:${q.threadId}` }]] };
}

/** The card after a tap: the same thread, one line saying what happened, no buttons left to press twice. */
export function settledCard(q, what, { count = 0, target = 10 } = {}) {
  return [`📡 <b>Reply radar</b>`, '', `<b>${h(q.title || 'Thread')}</b>`, q.url ? h(q.url) : '', '',
    what === 'replied' ? `✅ Marked as replied · public replies today: <b>${count} of ${target}</b>${count >= target ? ' (limit reached)' : ''}` : '⏭ Not relevant - it will not be shown again'].filter((l) => l !== null).join('\n');
}

// ------------------------------------------------- 1.14: "next <keyword>", families, mute

/** Families Radar already knows; any other keyword is expanded by Claude once and saved. */
export const KNOWN_FAMILIES = {
  casino: ['casino', 'gambling', 'igaming', 'betting', 'sportsbook', 'slots', 'gambling offers', 'casino seo', 'casino backlinks', 'poker'],
  crypto: ['crypto', 'crypto ads', 'web3 marketing', 'token launch', 'presale', 'memecoin', 'forex', 'crypto seo', 'defi', 'airdrop'],
  cloaker: ['cloaker', 'cloaking', 'white page', 'safe page', 'money page', 'bot filter', 'trafficguardian', 'justcloakit', 'cloaking house', 'trustcloaker'],
  pbn: ['pbn', 'private blog network', 'expired domain', 'aged domain', 'auction domain', 'dropped domain', 'deindexed', 'footprint', 'niche edit', 'tier 2 links', 'pbn hosting']
};

export const FAMILY_SYSTEM = [
  'You expand one keyword into the words BlackHatWorld members actually use for that topic, for searching the forum.',
  'Return 8-12 short search terms (1-3 words each), most common first: synonyms, the tools and services named in that space,',
  'the problems people post about. Plain words only, lowercase, no explanations.',
  'Return ONLY JSON: {"terms":["...","..."]}'
].join('\n');
export const familyPrompt = (keyword) => `KEYWORD: ${String(keyword).slice(0, 60)}`;
export function parseFamily(text, keyword) {
  const o = looseJson(text);
  const terms = (o && Array.isArray(o.terms) ? o.terms : []).map((t) => String(t || '').toLowerCase().replace(/[^a-z0-9 .+-]/g, ' ').replace(/\s+/g, ' ').trim()).filter((t) => t.length >= 2 && t.length <= 40);
  const k = String(keyword || '').toLowerCase().trim();
  const out = [...new Set([k, ...terms].filter(Boolean))].slice(0, 12);
  return out.length >= 2 ? out : null;
}

/** The family for a keyword: saved, known, or null (ask Claude). */
export function familyFor(keyword, saved) {
  const k = String(keyword || '').toLowerCase().trim().replace(/s$/, '');
  return (saved && (saved[k] || saved[k + 's'])) || KNOWN_FAMILIES[k] || KNOWN_FAMILIES[k + 's'] || null;
}

/** BHW's signed-in search: posts and threads, newest first, since `days` ago. */
export function searchUrl(term, { days = 7, now = Date.now() } = {}) {
  const since = new Date(now - days * 86400000).toISOString().slice(0, 10);
  return `https://www.blackhatworld.com/search/search?keywords=${encodeURIComponent(term)}&c[newer_than]=${since}&o=date`;
}

/**
 * A BHW search results page, thread AND post rows (a post row is the thread it
 * sits in). Runs inside the page: no closure, data only.
 */
export function extractRadarSearch() {
  const t = String(document.title || '');
  const body = String((document.body && document.body.innerText) || '').slice(0, 3000);
  if (/just a moment|access denied|attention required|rate limited|error 429|too many requests/i.test(t)
      || /you have been rate limited|access denied|has been blocked|verify you are human/i.test(body)) {
    return { blocked: `BHW blocked the page: ${t.slice(0, 80)}` };
  }
  const rows = [];
  for (const c of document.querySelectorAll('.contentRow')) {
    const a = c.querySelector('.contentRow-title a');
    const minor = c.querySelector('.contentRow-minor');
    if (!a || !minor) continue;
    const txt = [...minor.querySelectorAll('li')].map((l) => String(l.textContent || '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ');
    const kind = /\bThread\b/.test(txt) ? 'thread' : /\bPost\b/.test(txt) ? 'post' : '';
    if (!kind) continue;
    const tm = minor.querySelector('time[data-timestamp]');
    const ms = tm ? parseInt(tm.getAttribute('data-timestamp'), 10) * 1000 : NaN;
    const href = new URL(a.getAttribute('href'), location.href).href;
    const m = href.match(/^(https?:\/\/[^?#]*?\.(\d+))(?=\/|$|[?#])/);
    if (!m) continue;
    rows.push({ threadId: m[2], url: `${m[1]}/`, kind, title: (a.textContent || '').trim().replace(/^Re:\s*/i, ''),
      author: ((minor.querySelector('.username') || {}).textContent || '').trim(),
      at: isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null,
      replyCount: parseInt(String((txt.match(/Replies:\s*([\d,]+)/) || [])[1] || '').replace(/,/g, ''), 10) || 0,
      forum: String((txt.match(/Forum:\s*(.+?)\s*$/) || [])[1] || '').trim(),
      snippet: String((c.querySelector('.contentRow-snippet') || {}).textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400) });
  }
  return { rows, loggedIn: document.documentElement.getAttribute('data-logged-in') === 'true', next: !!document.querySelector('a.pageNav-jump--next'), title: t, url: location.href };
}

/** Boards whose threads are never a public-reply target (buyers' boards, sales boards, housekeeping). */
export const FORUM_DENY = /hire a freelancer|want to buy|marketplace|for sale|selling|renting|link building|seo - |packages|\bmisc\b|hosting|proxies|content \/|copywriting|ebooks|web design|programming|panels|freebies|giveaways|introductions|dispute|suggestions|news|lounge|journey/i;
/** Titles that are sales, not discussion. */
export const SALES_TITLE = /\b(wts|for sale|selling|cheap|discount|% off|buy now|services?|lifetime deal|group buy|hiring|hire|dm me|pm me)\b|\$\s?\d|⭐|✅|⚡|❌|⏩/i;

export const isMuted = (title, muted) => { const rx = wordRegex(muted || []); return !!(rx && rx.test(String(title || ''))); };

/**
 * Search rows -> candidate threads: discussion boards only, alive in the last
 * `days`, not sales, not muted, not replied / hidden / sent before. One entry
 * per thread, keeping the newest post date and the longest snippet.
 */
export function filterSearch(rows, state, { now = Date.now(), days = 7, muted = [] } = {}) {
  const by = {};
  for (const r of rows || []) {
    if (!r || !r.threadId || !r.title) continue;
    if (FORUM_DENY.test(r.forum || '') || SALES_TITLE.test(r.title) || isMuted(r.title, muted)) continue;
    if (state?.replied?.[r.threadId] || state?.hidden?.[r.threadId] || state?.sent?.[r.threadId]) continue;
    const at = ms(r.at);
    if (!at || now - at > days * 86400000) continue;
    const cur = by[r.threadId];
    if (!cur) by[r.threadId] = { threadId: r.threadId, url: r.url, title: r.title, forum: r.forum, replyCount: r.replyCount || 0, lastActivityAt: r.at, author: r.kind === 'thread' ? r.author : '', snippet: r.snippet || '', hits: 1 };
    else { cur.hits++; if (at > ms(cur.lastActivityAt)) cur.lastActivityAt = r.at; if ((r.snippet || '').length > cur.snippet.length) cur.snippet = r.snippet; if (r.kind === 'thread') cur.author = r.author; cur.replyCount = Math.max(cur.replyCount, r.replyCount || 0); }
  }
  return Object.values(by).sort((a, b) => ms(b.lastActivityAt) - ms(a.lastActivityAt));
}

export const CLUSTER_SYSTEM = [
  'You sort BlackHatWorld discussion threads found for one keyword into topic clusters, for a member who will write public',
  'replies. Each thread has a title, board, replies, date and a snippet. Make 2-5 clusters by what people are actually asking',
  'about. In each cluster put the best thread to answer FIRST: an open question, few replies, recent, not a sales pitch.',
  'For each cluster give a 2-6 word name and one short line on why it is live now. For the first thread of each cluster say',
  'in one sentence what the starter asked (from the snippet) and in one sentence what a good reply would need to cover',
  '(no advice on getting around platform review). Plain English, no hype, no em dashes.',
  'Return ONLY JSON: {"clusters":[{"name":"...","why":"...","ids":["threadId",...],"asked":"...","need":"..."}]}'
].join('\n');
export function clusterPrompt(keyword, rows) {
  return [`KEYWORD: ${keyword}`, '', ...rows.slice(0, 40).map((r) => `${r.threadId} | ${String(r.title).slice(0, 110)} | ${r.forum} | ${r.replyCount} replies | ${String(r.lastActivityAt || '').slice(0, 10)} | ${String(r.snippet || '').slice(0, 220)}`)].join('\n');
}
/** Claude's clusters, with ids checked against the rows. A broken answer gives one cluster per board instead. */
export function parseClusters(text, rows) {
  const have = new Map(rows.map((r) => [String(r.threadId), r]));
  const o = looseJson(text);
  const out = [];
  for (const c of (o && Array.isArray(o.clusters) ? o.clusters : [])) {
    const ids = [...new Set((Array.isArray(c?.ids) ? c.ids : []).map(String).filter((id) => have.has(id)))];
    if (!ids.length) continue;
    out.push({ name: tidy(c.name, 60) || 'Threads', why: tidy(c.why, 160), asked: tidy(c.asked, 220), need: tidy(c.need, 220), ids });
  }
  if (out.length) return out;
  const byForum = {};
  for (const r of rows) (byForum[r.forum || 'Other'] ||= []).push(String(r.threadId));
  return Object.entries(byForum).map(([name, ids]) => ({ name, why: '', asked: '', need: '', ids }));
}

/** One cluster as a Telegram card: the best thread with its buttons, two more as links. */
export function formatClusterCard(cluster, rows, { now = Date.now(), i = 1, of = 1, keyword = '', count = 0, target = 10 } = {}) {
  const by = new Map(rows.map((r) => [String(r.threadId), r]));
  const best = by.get(cluster.ids[0]);
  const more = cluster.ids.slice(1, 3).map((id) => by.get(id)).filter(Boolean);
  const rep = Number(best.replyCount) || 0;
  const lines = [`🔎 <b>${h(keyword)}</b> · cluster ${i} of ${of}: <b>${h(cluster.name)}</b> · ${cluster.ids.length} thread${cluster.ids.length === 1 ? '' : 's'}`];
  if (cluster.why) lines.push(h(cluster.why));
  lines.push('', `<b>${h(best.title)}</b>`, `${h(best.forum)} · ${rep} repl${rep === 1 ? 'y' : 'ies'} · last ${last(best.lastActivityAt, now)}`);
  if (cluster.asked) lines.push(`<b>Asked:</b> ${h(cluster.asked)}`);
  if (cluster.need) lines.push(`<b>A good reply covers:</b> ${h(cluster.need)}`);
  lines.push(h(best.url));
  if (more.length) { lines.push('', 'Also in this cluster:'); for (const m of more) lines.push(`• ${h(m.title)} (${m.replyCount || 0}) ${h(m.url)}`); }
  lines.push('', `Public replies today: <b>${count} of ${target}</b>`);
  return lines.join('\n');
}

/** Everything sent to you is remembered, so no thread comes twice. */
export function markSent(state, ids, now = Date.now()) {
  const sent = { ...(state.sent || {}) };
  for (const id of ids) sent[String(id)] = now;
  const keep = Object.entries(sent).sort((a, b) => b[1] - a[1]).slice(0, 2000);
  return { ...state, sent: Object.fromEntries(keep) };
}

/** The Telegram help, shown with the first batch of the day and on "radar help". */
export const RADAR_HELP = [
  '📡 <b>Reply radar - what you can send</b>',
  '',
  '<b>next casino</b> - live search of the whole forum for that keyword and its family, grouped into topic clusters, best thread per cluster. Never repeats a thread.',
  '<b>next casino 5</b> - up to 5 clusters',
  '<b>family pbn</b> - the words a keyword searches as · <b>add pbn aged domain</b> / <b>drop pbn footprint</b> - edit them',
  '<b>mute affiliate link</b> / <b>unmute …</b> - threads with that word are never shown',
  '<b>radar</b> - status · <b>radar on</b> / <b>radar off</b> · <b>radar now</b> - run the hourly check now',
  '<b>radar count 4</b> - correct today\'s number of public replies',
  '<b>radar help</b> - this list',
  '',
  'On every card: 🔗 Open thread · ✅ I replied (counted, never shown again) · ⏭ Not relevant (hidden for good).',
  'Hourly cards and search results both skip anything sent before, anything you replied to, and anything older than 7 days.'
].join('\n');

// ------------------------------------------- 1.14.1: one message per batch, keyword ideas on every message

/** "next cloaker · next vcc": what to search next, drawn from the words the threads matched and the families you have. */
export function keywordIdeas(items, { families = {}, exclude = '' } = {}) {
  const ideas = [];
  const titles = (items || []).map((q) => String(q.title || '')).join(' ');
  const rx = compileWords(DEFAULT_WORDS);
  for (const [k, hint] of [['casino', 'casino'], ['cloak', 'cloaker'], ['crypto', 'crypto'], ['restricted', 'nutra'], ['setup', 'agency account'], ['trouble', 'suspended']]) if (rx[k] && rx[k].test(titles)) ideas.push(hint);
  for (const k of [...Object.keys(families || {}), ...Object.keys(KNOWN_FAMILIES)]) ideas.push(k);
  const out = [...new Set(ideas)].filter((k) => k !== String(exclude).toLowerCase()).slice(0, 4);
  return out.length ? `Try: ${out.map((k) => `next ${k}`).join(' · ')} · radar help` : 'Try: next casino · radar help';
}

const doneLine = (done, id) => (done?.[id] === 'replied' ? ' ✅ replied' : done?.[id] === 'hidden' ? ' ⏭ hidden' : '');

/** The whole hourly batch as ONE message (1.14.1): numbered threads, briefs, the count, keyword ideas. */
export function formatBatchMessage(items, { now = Date.now(), count = 0, target = 10, done = {}, families = {} } = {}) {
  const d = new Date(now);
  const lines = [`📡 <b>Reply radar</b> · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} · ${items.length} thread${items.length === 1 ? '' : 's'}`, ''];
  items.forEach((q, i) => {
    const rep = Number(q.replyCount) || 0;
    lines.push(`<b>${i + 1}. ${h(q.title)}</b>${i === 0 ? ' ⭐' : ''}${doneLine(done, String(q.threadId))}`);
    lines.push(`${h(q.section)} · started ${ago(q.startedAt, now)} · ${rep} repl${rep === 1 ? 'y' : 'ies'}${rep ? ` · last ${last(q.lastActivityAt, now)}` : ''}`);
    const b = q.brief;
    if (b && !done?.[String(q.threadId)]) {
      if (b.asked) lines.push(`Asked: ${h(b.asked)}`);
      if (b.said && b.said.length) lines.push(`Already said: ${b.said.map((x) => `${h(x.point)} (${x.n})`).join('; ')}`);
      else if (!rep) lines.push('Already said: nothing yet');
      if (b.back) lines.push(`Starter asked again: ${h(b.back)}`);
      if (b.gap) lines.push(`Missing: ${h(b.gap)}`);
    }
    lines.push(h(q.url), '');
  });
  lines.push(`Public replies today: <b>${count} of ${target}</b>${count >= target ? ' (limit reached)' : ''}`, keywordIdeas(items, { families }));
  return lines.join('\n').slice(0, 3900);
}

/** Buttons for a multi-thread message: per thread, Open / I replied / Not relevant, numbered; a done thread keeps only its link. */
export function batchKeyboard(items, done = {}) {
  const rows = [];
  items.forEach((q, i) => {
    const id = String(q.threadId);
    rows.push([{ text: `🔗 Open ${i + 1}`, url: q.url }]);
    if (!done?.[id]) rows.push([{ text: `✅ I replied ${i + 1}`, callback_data: `rr:${id}` }, { text: `⏭ Not relevant ${i + 1}`, callback_data: `rx:${id}` }]);
  });
  return { inline_keyboard: rows };
}

/** All clusters of one search as ONE message (1.14.1). */
export function formatClusterMessage(clusters, rows, { now = Date.now(), keyword = '', count = 0, target = 10, done = {}, families = {} } = {}) {
  const by = new Map(rows.map((r) => [String(r.threadId), r]));
  const lines = [`🔎 <b>next ${h(keyword)}</b> · ${clusters.length} cluster${clusters.length === 1 ? '' : 's'}, ${clusters.reduce((n, c) => n + c.ids.length, 0)} threads this week`, ''];
  clusters.forEach((c, i) => {
    const best = by.get(c.ids[0]);
    const more = c.ids.slice(1, 3).map((id) => by.get(id)).filter(Boolean);
    const rep = Number(best.replyCount) || 0;
    lines.push(`<b>${i + 1}. ${h(c.name)}</b> · ${c.ids.length} thread${c.ids.length === 1 ? '' : 's'}${c.why ? ` · ${h(c.why)}` : ''}`);
    lines.push(`${h(best.title)}${doneLine(done, String(best.threadId))}`, `${h(best.forum)} · ${rep} repl${rep === 1 ? 'y' : 'ies'} · last ${last(best.lastActivityAt, now)}`);
    if (c.asked && !done?.[String(best.threadId)]) lines.push(`Asked: ${h(c.asked)}`);
    if (c.need && !done?.[String(best.threadId)]) lines.push(`A good reply covers: ${h(c.need)}`);
    lines.push(h(best.url));
    for (const m of more) lines.push(`• ${h(m.title)} (${m.replyCount || 0}) ${h(m.url)}`);
    lines.push('');
  });
  lines.push(`Public replies today: <b>${count} of ${target}</b>`, keywordIdeas(rows, { families, exclude: keyword }));
  return lines.join('\n').slice(0, 3900);
}
