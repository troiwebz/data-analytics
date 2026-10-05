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

export const DEFAULT_RADAR_CFG = { on: true, everyMinutes: 60, perBatch: 3, dailyTarget: 10, briefs: true, general: true, words: DEFAULT_WORDS };

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
export function foldSweep(state, pages, rx, { now = Date.now(), general = true } = {}) {
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
      const match = classify(r.title, section, rx);
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
  // Off the first page for a week, or simply too old now: gone.
  for (const [id, q] of Object.entries(s.queue)) if (now - ms(q.lastActivityAt) > 168 * HOUR) delete s.queue[id];
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
 * nothing new sends nothing.
 */
export function pickBatch(state, { n = 3, now = Date.now(), skip = null } = {}) {
  const today = dayKey(now);
  const perSection = {};
  for (const [id, d] of Object.entries(state.counted || {})) if (d === today) { const sec = state.replied?.[id]?.section; if (sec) perSection[sec] = (perSection[sec] || 0) + 1; }
  // A thread already sent comes back only when it has a new reply since, or once
  // more after six quiet hours. After that it stays on the Radar page: the same
  // card every hour is noise.
  const again = (q) => !q.shown || ms(q.lastActivityAt) > (q.shownAt || 0) || (q.shown < 2 && now - (q.shownAt || 0) >= 6 * HOUR);
  const pool = Object.values(state.queue || {}).filter((q) => (perSection[q.section] || 0) < 3 && again(q) && !(skip && skip.has(String(q.threadId))));
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
