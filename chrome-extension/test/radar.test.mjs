// Reply Radar (1.13.0): the word filter, tiers, queue, batch pick, count and the
// Telegram message. Titles are the real ones read off BHW on 6 Oct 2026.
import { RADAR_SECTIONS, NEVER, DEFAULT_WORDS, DEFAULT_RADAR_CFG, wordRegex, compileWords, classify, tierOf, foldSweep, pickBatch, markShown, markReplied, markHidden,
  countToday, setCount, emptyState, briefPrompt, parseBriefs, formatCard, radarKeyboard, settledCard, BRIEF_SYSTEM, extractRadarListing } from '../src/radar.js';

let fails = 0;
const ok = (n, c, e) => { if (!c) fails++; console.log(`${c ? '  ok' : 'FAIL'}  ${n}${c || e === undefined ? '' : `  -> ${JSON.stringify(e).slice(0, 300)}`}`); };

const rx = compileWords(DEFAULT_WORDS);
const sec = (name) => RADAR_SECTIONS.find((s) => s.name === name);
const now = Date.parse('2026-10-06T02:00:00Z');
const hAgo = (h) => new Date(now - h * 3600000).toISOString();

// --- HAF and the Marketplace are never read ----------------------------------------------
ok('eight sections, none of them Hire a Freelancer or a sales section', RADAR_SECTIONS.length === 8 && !RADAR_SECTIONS.some((s) => NEVER.test(s.url) || /hire|market|sale|want to buy/i.test(s.name)), RADAR_SECTIONS.map((s) => s.url));
ok('the Hire a Freelancer forum (node 76) is refused by the guard', NEVER.test('https://www.blackhatworld.com/forums/hire-a-freelancer.76/') && NEVER.test('https://www.blackhatworld.com/forums/76/'));
ok('batch every 60 minutes, 3 threads, target 10, on by default', DEFAULT_RADAR_CFG.everyMinutes === 60 && DEFAULT_RADAR_CFG.perBatch === 3 && DEFAULT_RADAR_CFG.dailyTarget === 10 && DEFAULT_RADAR_CFG.on === true);

// --- words: whole words, endings only where asked ----------------------------------------
ok('"bet" never matches "better"', !wordRegex(['bet']).test('Which is better for a website') && wordRegex(['bet']).test('best bets this week'));
ok('gambl* takes gambling and gamblers', wordRegex(['gambl*']).test('Gambling ads') && wordRegex(['gambl*']).test('for gamblers'));
ok('"white page" takes whitepages and White Pages', wordRegex(['white page']).test('Best Places To Get Whitepages') && wordRegex(['white page']).test('White Pages - whats working'));
ok('an empty list is no regex', wordRegex([]) === null && wordRegex(['', ' ']) === null);

// --- the real titles -----------------------------------------------------------------------
const strict = [
  ['Anyone still successfully running gambling niche ads on Meta?', 'Facebook ads'], ['Best Ad Networks for Promoting Gambling Apps?', 'Other PPC'],
  ['TrafficGuardian For Casino Campaigns?', 'Cloaking'], ['which cloaking services would you reccomend?', 'Cloaking'],
  ['Google DISPLAY Ads campaign - TrustCloaker', 'Cloaking'], ['Is it a good idea to run a casino using Snapchat?', 'Other PPC'],
  ['I want to run forex trading ads on Taboola?', 'Other PPC'], ['Is facebook ads getting harder for BH offers recently?', 'Facebook ads'],
  ['Best Places To Get Whitepages', 'Google Ads'], ['Seriously, what\'s the truth with meta and peptide ads?', 'Facebook ads'],
  ['Meta ads for onlyfans', 'Facebook ads'], ['HOW TO CLOAK FACEBOOK AD CREATIVES ( IMAGES & VIDEOS)', 'Facebook ads'],
  ['Do you guys have any recommendations for low budget testing to optimize creatives then scale? crypto education niche.', 'Facebook ads'],
  ['Anyone here successfully scaling SMS/Email traffic in gambling?', 'CPA']
];
const missS = strict.filter(([t, s]) => classify(t, sec(s), rx) !== 'strict');
ok('every niche thread from the live run is a strict match', missS.length === 0, missS);
const wide = [
  ['Best virtual credit cards (VCC) for Facebook Ads?', 'Facebook ads'], ['Google has started massively blocking accounts', 'Google Ads'],
  ['Frequent suspension for circumventing systems', 'Google Ads'], ['buying BM5 account vs Agency renting', 'Facebook ads'],
  ['Google ads account got suspended for unacceptable business practices, any solutions for creating new accounts', 'Media Buying'],
  ['SnapChat business manager and ad account verification problem solution', 'General PPC']
];
const missW = wide.filter(([t, s]) => classify(t, sec(s), rx) !== 'wide');
ok('account setup and trouble threads in ad sections are wide matches', missW.length === 0, missW);
const none = [
  ['How to lower high CPC on Google Ads?', 'Google Ads'], ['Fb ads performance dropped suddenly this week', 'Facebook ads'],
  ['Outbrain ads experience in 2026?', 'Other PPC'], ['Cheap clicks vs expensive quality traffic', 'General PPC'],
  ['Which is better: Auto Ads or Manual Ads?', 'Google Ads'], ['working with BMs via System User Tokens', 'Facebook ads'].slice(0, 0).length ? [] : ['Should I open the search Network for google shopping campaign', 'Google Ads']
];
const hitN = none.filter(([t, s]) => classify(t, sec(s), rx) !== null);
ok('general ads questions match no word', hitN.length === 0, hitN);
ok('account words do not count outside ad sections', classify('My account got banned', sec('CPA'), rx) === null && classify('My account got banned', sec('CryptoCurrency'), rx) === null);
ok('in the CryptoCurrency section a crypto title must also be about advertising', classify('Which crypto exchange is safest?', sec('CryptoCurrency'), rx) === null
  && classify('How do you run crypto ads on Google?', sec('CryptoCurrency'), rx) === 'strict' && classify('Token launch marketing ideas', sec('CryptoCurrency'), rx) === 'strict');
ok('"token" is loose: it does not count in the ad sections', classify('working with BMs via System User Tokens', sec('Facebook ads'), rx) === 'wide' && classify('System User Tokens explained', sec('Facebook ads'), rx) === null);
ok('your own word list replaces a group', classify('Solar leads on Meta', sec('Facebook ads'), compileWords({ casino: ['solar'] })) === 'strict' && classify('Casino on Meta', sec('Facebook ads'), compileWords({ casino: ['solar'] })) === null);

// --- tiers ---------------------------------------------------------------------------------
const row = (o) => ({ startedAt: hAgo(o.start), lastActivityAt: hAgo(o.last), replyCount: o.rep, adSection: o.ad !== false });
ok('A: started under 24h ago, 5 replies or fewer', tierOf(row({ start: 9, last: 9, rep: 0 }), 'wide', now) === 'A');
ok('B: last reply under 12h ago', tierOf(row({ start: 1500, last: 6.6, rep: 10 }), 'strict', now) === 'B');
ok('C: a niche thread quiet for 2 days counts at any reply count (the gambling-on-Meta thread, 11 replies)', tierOf(row({ start: 326, last: 51, rep: 11 }), 'strict', now) === 'C');
ok('C for account words needs 5 replies or fewer', tierOf(row({ start: 165, last: 65, rep: 5 }), 'wide', now) === 'C' && tierOf(row({ start: 2400, last: 65, rep: 41 }), 'wide', now) === null);
ok('nothing older than 7 days since the last reply (stale-thread replies draw 3.5 warnings)', tierOf(row({ start: 5000, last: 293, rep: 15 }), 'strict', now) === null);
ok('G: an unmatched brand-new ads question with 0-2 replies', tierOf(row({ start: 9, last: 9, rep: 0 }), null, now) === 'G' && tierOf(row({ start: 9, last: 9, rep: 4 }), null, now) === null
  && tierOf(row({ start: 9, last: 9, rep: 0, ad: false }), null, now) === null);

// --- one sweep into the queue ---------------------------------------------------------------
const R = (id, title, o = {}) => ({ threadId: String(id), url: `https://www.blackhatworld.com/seo/t.${id}/`, title, author: 'someone', lastPoster: o.lastPoster || 'other',
  startedAt: hAgo(o.start ?? 48), lastActivityAt: hAgo(o.last ?? 6), replyCount: o.rep ?? 3, views: 100, sticky: !!o.sticky, locked: !!o.locked, mine: !!o.mine, lastMine: !!o.lastMine });
const pages = [
  { section: sec('Facebook ads'), rows: [R(1, 'Anyone still successfully running gambling niche ads on Meta?', { start: 326, last: 51, rep: 11 }), R(2, 'Best virtual credit cards (VCC) for Facebook Ads?', { start: 9, last: 9, rep: 0 }),
    R(3, 'Fb ads performance dropped suddenly this week', { start: 9, last: 9, rep: 0 }), R(4, 'Casino rules - read first', { sticky: true }), R(5, 'Casino ads closed thread', { locked: true }),
    R(6, 'Meta ads for onlyfans', { start: 5900, last: 97, rep: 82 }), R(7, 'How to reduce high cpc in facebook ads for USA', { start: 150, last: 10, rep: 5 })] },
  { section: sec('Cloaking'), rows: [R(8, 'which cloaking services would you reccomend?', { start: 50, last: 7, rep: 3, mine: true }), R(9, 'TrafficGuardian For Casino Campaigns?', { start: 1020, last: 7.5, rep: 5 }),
    R(10, 'Google DISPLAY Ads campaign - TrustCloaker', { start: 38, last: 2.8, rep: 3 }), R(11, 'keywords to use while cloaking', { start: 900, last: 288, rep: 7 })] },
  { section: { id: 76, name: 'Hire a Freelancer', url: 'https://www.blackhatworld.com/forums/hire-a-freelancer.76/', ad: true }, rows: [R(99, 'Looking for casino ads expert', { start: 1, last: 1, rep: 2 })] }
];
let st = foldSweep(emptyState(), pages, rx, { now, general: true });
ok('niche, account and general threads are queued with their tier', st.queue[1]?.tier === 'C' && st.queue[2]?.tier === 'A' && st.queue[2]?.match === 'wide' && st.queue[3]?.tier === 'G' && st.queue[9]?.tier === 'B' && st.queue[6]?.tier === 'C', st.queue);
ok('sticky and locked threads never enter', !st.queue[4] && !st.queue[5]);
ok('a thread you already replied in is left out and remembered', !st.queue[8] && !!st.replied[8]);
ok('a thread quiet for more than 7 days is left out', !st.queue[11]);
ok('a thread that has slipped off page 1 leaves the queue on the next sweep (1.14.1)', !foldSweep(st, [{ section: sec('Facebook ads'), rows: pages[0].rows.filter((r) => r.threadId !== '1') }, pages[1]], rx, { now: now + 3600000, general: true }).queue[1] && !!foldSweep(st, pages, rx, { now: now + 3600000, general: true }).queue[1]);
ok('a thread that came from a search stays until it ages out', !!foldSweep({ ...st, queue: { ...st.queue, s1: { threadId: 's1', title: 'x', match: 'search', tier: 'S', lastActivityAt: hAgo(10) } } }, pages, rx, { now, general: true }).queue.s1);
ok('a Hire a Freelancer page handed in by mistake is ignored whole', !st.queue[99] && !st.unmatched.some((u) => /casino ads expert/.test(u.title)));
ok('unmatched titles are kept for the "Not matched" list', st.unmatched.some((u) => /high cpc/.test(u.title)) && !st.unmatched.some((u) => /gambling/.test(u.title)), st.unmatched);
ok('an old reply of yours found on the first sweep is not counted as today\'s', countToday(st, now) === 0, st.counted);
ok('with the general line off (the default now), general questions are not queued', !foldSweep(emptyState(), pages, rx, { now, general: false }).queue[3] && DEFAULT_RADAR_CFG.general === false);
ok('a muted word keeps a thread out of the queue at sweep time', !foldSweep(emptyState(), pages, rx, { now, muted: ['onlyfans'] }).queue[6]);

// --- the batch -------------------------------------------------------------------------------
let batch = pickBatch(st, { n: 3, now });
ok('three threads, the freshest niche chance first, general questions last', batch.length === 3 && batch[0].tier !== 'G' && !batch.some((b) => b.tier === 'G') , batch.map((b) => `${b.threadId}:${b.tier}:${b.match}`));
ok('at most two from one section in a batch', Math.max(...Object.values(batch.reduce((m, b) => ({ ...m, [b.section]: (m[b.section] || 0) + 1 }), {}))) <= 2);
st = markShown(st, batch.map((b) => b.threadId), now);
const second = pickBatch(st, { n: 3, now });
ok('the next batch brings only threads not sent yet', second.length > 0 && second.every((b) => b.shown === 0), second.map((b) => `${b.threadId}:${b.shown}`));
const only = (state, id, patch = {}) => ({ ...state, queue: { [id]: { ...state.queue[id], ...patch } } });
const b0 = batch[0].threadId;
ok('a sent thread is never sent again - not next hour, not after a new reply, not days later (1.14)', pickBatch(only(st, b0), { n: 3, now: now + 3600000 }).length === 0
  && pickBatch(only(st, b0, { lastActivityAt: new Date(now + 60000).toISOString() }), { n: 3, now: now + 120000 }).length === 0 && pickBatch(only(st, b0), { n: 3, now: now + 30 * 3600000 }).length === 0);
ok('a thread that reached you through "next" is not sent by the hour either', pickBatch({ ...only(st, '9'), queue: { 9: { ...st.queue[9], shown: 0 } }, sent: { 9: now } }, { n: 3, now }).length === 0);
ok('a muted word keeps a thread out of the batch', pickBatch({ ...st, queue: { 9: { ...st.queue[9], shown: 0 } } }, { n: 3, now, muted: ['trafficguardian'] }).length === 0);
ok('a skipped thread stays in the queue for a later batch', batch.every((b) => st.queue[b.threadId] && st.queue[b.threadId].shown === 1));

// --- replied, hidden, the count --------------------------------------------------------------
st = markReplied(st, batch[0].threadId, now);
ok('"radar done 1": out of the queue and counted today', !st.queue[batch[0].threadId] && countToday(st, now) === 1);
ok('it never comes back on a later sweep', !foldSweep(st, pages, rx, { now: now + 3600000, general: true }).queue[batch[0].threadId]);
st = markHidden(st, '6', now);
ok('"radar skip": hidden for good, not counted', !st.queue[6] && !foldSweep(st, pages, rx, { now: now + 3600000, general: true }).queue[6] && countToday(st, now) === 1);
// a reply made without Radar: the thread was on the page last sweep without you, now it carries you
const later = JSON.parse(JSON.stringify(pages)); later[1].rows[1].mine = true; later[1].rows[1].lastMine = true; later[1].rows[1].lastActivityAt = new Date(now + 1800000).toISOString();
const st2 = foldSweep(st, later, rx, { now: now + 3600000, general: true });
ok('a reply you made on your own is seen on the next sweep and counted', countToday(st2, now + 3600000) === 2 && !st2.queue[9], st2.counted);
ok('"radar count 5" sets the day\'s number', countToday(setCount(st2, 5, now + 3600000), now + 3600000) === 5);
ok('the count starts again the next day', countToday(foldSweep(st2, pages, rx, { now: now + 30 * 3600000, general: true }), now + 30 * 3600000) === 0);
ok('three replies in one section today: that section is passed over', (() => { let s = foldSweep(emptyState(), pages, rx, { now, general: true }); for (const id of ['1', '2', '7']) s = markReplied({ ...s, queue: { ...s.queue, [id]: s.queue[id] || { threadId: id, section: 'Facebook ads' } } }, id, now); return pickBatch(s, { n: 3, now }).every((b) => b.section !== 'Facebook ads'); })());

// --- briefs ----------------------------------------------------------------------------------
const th = { threadId: '1849411', title: 'Anyone still successfully running gambling niche ads on Meta?', starter: 'poundermindi', body: 'Been having a hard time running ads like usual. ' + 'x'.repeat(2000),
  replies: [{ author: 'alaemen', text: 'Rotate landing page URLs' }, { author: 'poundermindi', text: 'Could you clarify what you mean by offer + geo approved?' }, ...Array.from({ length: 30 }, (_, i) => ({ author: `m${i}`, text: 'y'.repeat(900) }))] };
const bp = briefPrompt([th]);
ok('the prompt is trimmed: opening post 700 chars, last 16 replies at 260', bp.length < 700 + 16 * 300 + 400, bp.length);
ok('the starter\'s later posts are marked', /m29/.test(bp) && !/alaemen/.test(bp) || /\(STARTER\)/.test(briefPrompt([{ ...th, replies: th.replies.slice(0, 2) }])));
ok('the system prompt forbids writing the reply and adding evasion detail', /never\s+write the reply/i.test(BRIEF_SYSTEM.replace(/\n/g, ' ')) && /getting around platform review/i.test(BRIEF_SYSTEM));
const briefs = parseBriefs('Sure: ' + JSON.stringify({ threads: [{ id: 1849411, asked: 'Is anyone still running gambling on Meta — and how?', said: [{ point: 'Fix offer and geo compliance first', n: 3 }, { point: 'filler', n: 2 }, { point: '', n: 1 }], back: 'What does scan to clear mean?', gap: 'Nobody answered the follow-up.' }] }));
ok('briefs are read by thread id, dashes removed, empty points dropped', briefs['1849411'] && briefs['1849411'].said.length === 2 && !/—/.test(briefs['1849411'].asked), briefs);
ok('a broken answer gives no briefs, never an error', Object.keys(parseBriefs('sorry, cannot')).length === 0 && Object.keys(parseBriefs('{"threads":"x"}')).length === 0);

// --- the Telegram card ------------------------------------------------------------------------
const item = { ...R(1849411, 'Anyone <b>still</b> running gambling ads on Meta?', { start: 326, last: 51, rep: 11 }), section: 'Facebook ads', tier: 'C', match: 'strict', brief: briefs['1849411'] };
const msg = formatCard(item, { now, i: 1, of: 3, count: 4, target: 10 });
ok('the card names the thread, when it started, replies and last reply', /Reply radar<\/b> · 1 of 3 · ⭐ best pick/.test(msg) && /started 22 Sep, 14 days ago/.test(msg) && /11 replies · last 2 days ago/.test(msg), msg);
ok('the brief lines are there: asked, already said with counts, starter asked again, missing', /<b>Asked:<\/b> /.test(msg) && /Already said:<\/b> Fix offer and geo compliance first \(3\)/.test(msg) && /Starter asked again:<\/b> /.test(msg) && /Missing:<\/b> /.test(msg));
const msg0 = formatCard({ ...R(2, 'Best virtual credit cards (VCC) for Facebook Ads?', { start: 9, last: 9, rep: 0 }), section: 'Facebook ads', tier: 'A', match: 'wide', brief: { asked: 'Which VCC works?', said: [], back: '', gap: 'First reply is open.' } }, { now, i: 2, of: 3 });
ok('a thread with no replies says so, and only the first card is the pick', /0 replies\n\n<b>Asked:<\/b> Which VCC works\?\n<b>Already said:<\/b> nothing yet/.test(msg0) && !/best pick/.test(msg0), msg0);
ok('titles are escaped for Telegram', /&lt;b&gt;still&lt;\/b&gt;/.test(msg));
ok('the day\'s count closes every card', msg.trim().split('\n').pop() === 'Public replies today: <b>4 of 10</b>' && /limit reached/.test(formatCard(item, { now, count: 10, target: 10 })) && msg.length < 1200, msg.length);
const kb = radarKeyboard(item).inline_keyboard;
ok('buttons: open the thread (a link), I replied, not relevant - and none that posts', kb[0][0].url === item.url && kb[1][0].callback_data === 'rr:1849411' && kb[1][1].callback_data === 'rx:1849411' && kb.flat().length === 3);
ok('callback data stays inside Telegram\'s 64 bytes', kb.flat().every((b) => !b.callback_data || b.callback_data.length <= 64));
ok('a tapped card says what happened and carries the count', /Marked as replied · public replies today: <b>5 of 10<\/b>/.test(settledCard(item, 'replied', { count: 5 })) && /will not be shown again/.test(settledCard(item, 'hidden')));

// --- the section-page reader, on a page as XenForo renders it ---------------------------------
{
  const { JSDOM } = await import('jsdom');
  const item2 = (id, title, o = {}) => `<div class="structItem structItem--thread js-inlineModContainer js-threadListItem-${id}" data-author="${o.author || 'op'}">
    <div class="structItem-cell structItem-cell--icon"><div class="structItem-iconContainer"><a class="avatar"></a>${o.posted ? '<a class="avatar avatar--separated structItem-secondaryIcon"></a>' : ''}</div></div>
    <div class="structItem-cell structItem-cell--main">${o.locked ? '<ul class="structItem-statuses"><li><i class="structItem-status structItem-status--locked"></i></li></ul>' : ''}
      <div class="structItem-title">${o.prefix ? '<a href="/forums/x.1/?prefix_id=2" class="labelLink">Guide</a> ' : ''}<a href="/seo/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.${id}/unread">${title}</a></div>
      <div class="structItem-minor"><ul class="structItem-parts"><li><a class="username">op</a></li><li class="structItem-startDate"><a><time data-timestamp="${o.start || 1791000000}"></time></a></li></ul></div></div>
    <div class="structItem-cell structItem-cell--meta"><dl class="pairs pairs--justified"><dt>Replies</dt><dd>${o.rep ?? 3}</dd></dl><dl class="pairs pairs--justified structItem-minor"><dt>Views</dt><dd>${o.views || '1K'}</dd></dl></div>
    <div class="structItem-cell structItem-cell--latest"><a><time class="structItem-latestDate" data-timestamp="${o.last || 1791200000}"></time></a><div class="structItem-minor"><a class="username">${o.lastPoster || 'other'}</a></div></div></div>`;
  const html = `<html data-logged-in="true"><body><a class="p-navgroup-link p-navgroup-link--user"><span class="p-navgroup-linkText">bargainbed</span></a>
    <div class="structItemContainer"><div class="structItemContainer-group structItemContainer-group--sticky">${item2(1, 'Section rules')}</div>
    <div class="structItemContainer-group js-threadList">${item2(1849411, 'Anyone still successfully running gambling niche ads on Meta?', { rep: 11, prefix: true })}
    ${item2(1851904, 'which cloaking services would you reccomend?', { posted: true })}${item2(3, 'Closed one', { locked: true })}${item2(4, 'My last word', { lastPoster: 'BargainBed' })}</div></div></body></html>`;
  const dom = new JSDOM(html, { url: 'https://www.blackhatworld.com/forums/facebook.219/' });
  globalThis.document = dom.window.document; globalThis.location = dom.window.location; globalThis.URL = dom.window.URL;
  const r = extractRadarListing();
  const by = Object.fromEntries(r.rows.map((x) => [x.threadId, x]));
  ok('rows are read: title (not the prefix label), page-1 link, replies, views, dates', by[1849411]?.title.startsWith('Anyone still') && by[1849411].url === 'https://www.blackhatworld.com/seo/anyone-still-successfully-running-gambling-niche-ads-on-meta.1849411/' && by[1849411].replyCount === 11 && by[1849411].views === 1000 && by[1849411].startedAt.startsWith('2026'), by[1849411]);
  ok('sticky and locked are flagged', by[1].sticky === true && by[3].locked === true && by[1849411].sticky === false && by[1849411].locked === false);
  ok('a thread you posted in is flagged by your avatar on the row, or by your name as last poster', by[1851904].mine === true && by[4].mine === true && by[4].lastMine === true && by[1849411].mine === false);
  ok('who is signed in comes back with the page', r.me === 'bargainbed' && r.loggedIn === true);
  const wall = new JSDOM('<html><head><title>Just a moment...</title></head><body></body></html>', { url: 'https://www.blackhatworld.com/forums/219/' });
  globalThis.document = wall.window.document; globalThis.location = wall.window.location;
  ok('a Cloudflare wall is reported, not read as an empty section', /blocked/.test(extractRadarListing().blocked || ''));
  delete globalThis.document; delete globalThis.location;
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
