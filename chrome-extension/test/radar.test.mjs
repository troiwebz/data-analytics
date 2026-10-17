// Reply Radar (1.13.0): the word filter, tiers, queue, batch pick, count and the
// Telegram message. Titles are the real ones read off BHW on 6 Oct 2026.
import { filterSearch, iPosted, FAMILIES, mergeFamilies, familyRegex, pickNextFamily, nextTerms, familyCandidates, chooseFamilyItems, formatFamily, parseGate, gatePrompt, SALES_NARROW, DEFAULT_BLOCKS, resolveBoards, boardAllowed, pickBlock, formatBlock, blockOrder, formatAnswered, extractForumList, formatBatchMessage, pickNewThreads, formatNewThreads, RADAR_SECTIONS, NEVER, DEFAULT_WORDS, DEFAULT_RADAR_CFG, wordRegex, compileWords, classify, tierOf, foldSweep, pickBatch, markShown, markReplied, markHidden,
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
const bm = formatBatchMessage([item], { now, count: 1 });
ok('1.16.1: the title is the link and no raw URL line is shown', /<b>1\. <a href="https:\/\/www\.blackhatworld\.com\/seo\/t\.1849411\/">Anyone/.test(bm) && !/^https:\/\//m.test(bm), bm);
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

// --- 1.16: new threads from BHW's "what's new" page ------------------------------------------------
{
  const N = (id, title, o = {}) => ({ threadId: String(id), url: `https://www.blackhatworld.com/seo/t.${id}/`, title, author: 'starter', lastPoster: 'starter', forum: o.forum || 'Google Ads', forumNode: String(o.node ?? 83),
    startedAt: hAgo(o.start ?? 1), lastActivityAt: hAgo(o.last ?? 1), replyCount: o.rep ?? 0, views: 10, sticky: !!o.sticky, locked: false, mine: !!o.mine, lastMine: false });
  const rows = [
    N(1, 'How to lower high CPC on Google Ads?'),                                              // in a Radar section, no niche word: new, 0 replies -> yes
    N(2, 'Casino SEO in 2026, what works?', { forum: 'Black Hat SEO', node: 28 }),           // outside the sections, niche word -> yes
    N(3, 'My first week on BHW', { forum: 'Introductions', node: 24 }),                       // outside, no niche word -> no
    N(4, 'Need casino ads expert', { forum: 'Hire a Freelancer', node: 76 }),                 // HAF -> never
    N(5, '⭐ Casino backlinks $5 ⭐', { forum: 'SEO - Link building', node: 50 }),            // sales -> no
    N(6, 'Facebook ads performance dropped', { forum: 'Facebook', node: 219, start: 9 }),      // 9h old -> no (6h window)
    N(7, 'Which cloaker for Google Display?', { forum: 'Cloaking', node: 2, rep: 7 }),          // 7 replies already -> no
    N(8, 'Agency accounts for crypto', { forum: 'Facebook', node: 219, start: 0.5 }),           // yes
    N(9, 'Section rules', { sticky: true }),                                                   // no
    N(10, 'Anyone running gambling on TikTok?', { forum: 'TikTok', node: 279, mine: true }),    // yours -> no
    N(11, 'Casino affiliate journey', { forum: 'My Journey Discussions', node: 60 })            // journey board -> no
  ];
  const got = pickNewThreads(rows, { sent: { 8: 1 } }, rx, { now, muted: [], seen: {} });
  ok('new threads: in a Radar section (any title) or a niche word elsewhere; never HAF, sales, old, crowded, sticky, yours, journeys, or already sent', got.map((g) => g.threadId).sort().join() === '1,2', got.map((g) => `${g.threadId}:${g.title}`));
  ok('newest first, and the board name travels with it', pickNewThreads(rows, {}, rx, { now }).map((g) => g.threadId).join() === '8,1,2' && got.find((g) => g.threadId === '2').section === 'Black Hat SEO');
  ok('a thread seen on the page before is not offered again even if it was never sent', pickNewThreads(rows, {}, rx, { now, seen: { 1: 1 } }).every((g) => g.threadId !== '1'));
  ok('a muted word keeps it out', !pickNewThreads(rows, {}, rx, { now, muted: ['cpc'] }).some((g) => g.threadId === '1'));
  const msg = formatNewThreads(got, { now, count: 2, target: 10 });
  ok('the message: numbered titles, board, started, "first reply open" for 0 replies, links, count, code words', /🆕 <b>New threads<\/b> · \d\d:\d\d · 2 new/.test(msg) && /<b>1\. <a href="[^"]+">How to lower high CPC/.test(msg) && /Google Ads · started .* · 0 replies · first reply open/.test(msg) && /<a href="https:\/\/www\.blackhatworld\.com\/seo\/t\.2\/">Casino SEO/.test(msg) && !/^https:\/\//m.test(msg) && /Public replies today: <b>2 of 10<\/b>/.test(msg) && /new threads/.test(msg.split('\n').pop()), msg);
}

// --- 1.17: blocks ------------------------------------------------------------------------------------
{
  ok('two default blocks: Ads at :00 with 10 boards, SEO at :30 with 5; HAF and Marketplace in neither', DEFAULT_BLOCKS.length === 2 && DEFAULT_BLOCKS[0].minute === 0 && DEFAULT_BLOCKS[0].boards.length === 10 && DEFAULT_BLOCKS[1].minute === 30 && DEFAULT_BLOCKS[1].boards.length === 5
    && !DEFAULT_BLOCKS.flatMap((b) => b.boards).some((x) => String(x.id) === '76' || /hire|market|for-sale|seo-link/.test(String(x.slug || ''))));
  const list = [{ slug: 'white-hat-seo', id: '29', name: 'White Hat SEO' }, { slug: 'link-building', id: '48', name: 'Link Building' }, { slug: 'seo-link-building', id: '301', name: 'SEO - Link building' }, { slug: 'hire-a-freelancer', id: '76', name: 'Hire a Freelancer' }];
  const seo = resolveBoards(DEFAULT_BLOCKS[1].boards, list);
  ok('slugs are resolved to ids from the forum list, exact slug only (link-building, never seo-link-building)', seo.find((b) => b.slug === 'white-hat-seo').id === '29' && seo.find((b) => b.slug === 'link-building').id === '48' && seo.find((b) => b.slug === 'local-seo').id === null);
  ok('a board that could not be resolved is skipped; Hire a Freelancer and sales boards are refused even if typed in', !boardAllowed({ slug: 'local-seo', id: null }) && !boardAllowed({ id: 76, name: 'Hire a Freelancer' }) && !boardAllowed({ id: 301, name: 'SEO - Link building' }) && boardAllowed({ id: 28, name: 'Black Hat SEO' }));
  const B = (id, title, o = {}) => ({ threadId: String(id), url: `https://www.blackhatworld.com/seo/b.${id}/`, title, author: 'starter', lastPoster: o.lastPoster || 'other', startedAt: hAgo(o.start ?? 30), lastActivityAt: hAgo(o.last ?? 3), replyCount: o.rep ?? 3, views: 100, sticky: !!o.sticky, locked: !!o.locked, mine: !!o.mine, lastMine: !!o.lastMine });
  const fb = { id: 219, name: 'Facebook (PPC)' }, ga = { id: 83, name: 'Google Ads' }, tk = { id: 279, name: 'TikTok', filter: 'adwords' }, cr = { id: 218, name: 'CryptoCurrency', filter: 'niche' };
  const pages = [
    { board: fb, rows: [B(1, 'VCC for Facebook ads?', { rep: 0, start: 2, last: 2 }), B(2, 'Anyone still running gambling ads on Meta?', { rep: 11, last: 1 }), B(3, 'Scaling creatives in 2026', { rep: 2, start: 10, last: 5 }), B(4, 'Section rules', { sticky: true }), B(5, 'My own thread', { mine: true }), B(6, '⭐ BM accounts for sale $50', { rep: 0 }), B(7, 'Agency account went dark', { rep: 4, last: 8 })] },
    { board: ga, rows: [B(8, 'Google Ads suspended again', { rep: 30, start: 500, last: 2 }), B(9, 'Best whitepage hosting?', { rep: 1, start: 20, last: 6 }), B(10, 'I replied here earlier', { rep: 6, last: 1, lastPoster: 'buyer' })] },
    { board: tk, rows: [B(11, 'TikTok ads account banned for crypto', { rep: 0, start: 3, last: 3 }), B(12, 'Best TikTok dance trend?', { rep: 0, start: 1, last: 1 })] },
    { board: cr, rows: [B(13, 'How to market a token launch with ads?', { rep: 2, last: 4 }), B(14, 'SOL is going crazy', { rep: 15, last: 1 })] }
  ];
  const state = { sent: { 7: now - 86400000, 8: now - 86400000 }, seenActivity: { 7: now - 7 * 3600000, 8: now - 86400000 }, replied: { 10: { at: now - 5 * 3600000, title: 'I replied here earlier' } }, hidden: {} };
  const { items, back } = pickBlock(pages, state, rx, { now, muted: [] });
  const ids = items.map((q) => q.threadId);
  ok('new threads come in, HOT (0 replies) first; sticky, yours, sales, off-filter titles never', ids[0] === '1' && ids.includes('11') && !ids.includes('4') && !ids.includes('5') && !ids.includes('6') && !ids.includes('12') && !ids.includes('14'), ids);
  ok('a thread sent before returns only with a new reply since it was shown (8 yes, 7 no)', ids.includes('8') && items.find((q) => q.threadId === '8').newReply === true && !ids.includes('7'), ids);
  ok('a 30-reply old thread without a new reply is only a top-up, never ahead of new ones', ids.indexOf('8') > ids.indexOf('2'));
  ok('tags: HOT on 0 replies, early on 1-2', items.find((q) => q.threadId === '1').hot && items.find((q) => q.threadId === '9').early && !items.find((q) => q.threadId === '2').hot);
  ok('the TikTok filter takes ad titles only; the CryptoCurrency filter takes niche titles with an ads angle', ids.includes('11') && !ids.includes('12') && ids.includes('13') && !ids.includes('14'));
  ok('they answered you: a thread you replied in with a new post by someone else since', back.length === 1 && back[0].threadId === '10' && back[0].lastPoster === 'buyer', back);
  ok('no more than 8 in a block', items.length <= 8);
  const few = pickBlock([{ board: fb, rows: [B(21, 'Quiet one', { rep: 9, start: 100, last: 40 }), B(22, 'Quieter', { rep: 7, start: 90, last: 30 }), B(23, 'New Q', { rep: 0, start: 1, last: 1 })] }], { sent: {} }, rx, { now });
  ok('with fewer than 5 new, quiet page-1 threads top the block up (fewest replies first)', few.items.length === 3 && few.items[0].threadId === '23' && few.items[1].threadId === '22', few.items.map((q) => q.threadId));
  const names = [fb.name, ga.name, tk.name, cr.name];
  const msg = formatBlock('Ads block', items, names, { now, count: 2, traffic: '📈 BHW now: 1,820 members · High · today avg 1,210 · peak 2,015 at 13:30' });
  ok('the block message: header, boards as groups, HOT and early tags, new-reply wording, links as titles, traffic line, code words with brief', /📋 <b>Ads block<\/b> · \d\d:\d\d · 4 boards · \d threads/.test(msg) && /<b>Facebook \(PPC\)<\/b>\n1\. 🔥 HOT · <a href="[^"]+">VCC for Facebook ads\?<\/a>\n   0 replies · first reply open/.test(msg) && /⚡ early · /.test(msg) && /new reply \d+h ago/.test(msg) && !/^https:\/\//m.test(msg) && /📈 BHW now: 1,820/.test(msg) && /brief 3/.test(msg.split('\n').pop()), msg);
  ok('numbering in the message matches blockOrder, so button N is thread N', blockOrder(items, names).map((q) => q.threadId)[0] === '1' && blockOrder(items, names).length === items.length);
  ok('a board with nothing is listed on one line', /: nothing new/.test(formatBlock('Ads block', items.filter((q) => q.section !== 'Google Ads'), names, { now })));
  ok('the answered-you message names who posted and when', /📬 <b>They answered you<\/b>\n\n1\. <a href="[^"]+">I replied here earlier<\/a>\n   buyer posted \d+h ago · 6 replies · Google Ads/.test(formatAnswered(back, { now })), formatAnswered(back, { now }));
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<html data-logged-in="true"><body><a href="/forums/white-hat-seo.29/">White Hat SEO</a><a href="/forums/seo-link-building.301/">SEO - Link building</a><a href="/forums/link-building.48/">Link Building</a><a href="/forums/">All</a></body></html>', { url: 'https://www.blackhatworld.com/forums/' });
  globalThis.document = dom.window.document; const fl = extractForumList(); delete globalThis.document;
  ok('the forum list reader returns slug, id and name for every board link', fl.boards.length === 3 && fl.boards.find((b) => b.slug === 'link-building').id === '48');
}

// --- 1.18: families ---------------------------------------------------------------------------------
{
  ok('ten families, about 100 terms, three pinned, every term lowercase and short', FAMILIES.length === 10 && FAMILIES.flatMap((f) => f.terms).length >= 100 && FAMILIES.filter((f) => f.pinned).length === 3 && FAMILIES.flatMap((f) => f.terms).every((t) => t === t.toLowerCase() && t.length <= 30));
  ok('no family board is Hire a Freelancer or a sales board', !FAMILIES.flatMap((f) => f.boards).some((b) => b.id === 76 || /sale|market|hire/i.test(b.name)));
  const merged = mergeFamilies([{ id: 'cloaker', terms: ['cloaker', 'cloaking', 'mycloak'], pinned: false }, { id: 'solar', name: 'Solar', terms: ['solar leads'], boards: [] }, { id: 'adult', on: false }]);
  ok('saved edits override a built-in family, a new family is added, a switched-off one is gone', merged.find((f) => f.id === 'cloaker').terms.length === 3 && merged.find((f) => f.id === 'cloaker').pinned === false && merged.find((f) => f.id === 'cloaker').boards.length === 1 && !!merged.find((f) => f.id === 'solar') && !merged.some((f) => f.id === 'adult'));
  const runs = { cloaker: now - 70 * 60000, circumvent: now - 30 * 60000, casino: now - 50 * 60000, crypto: now - 5 * 3600000 };
  ok('a pinned family that waited an hour runs before the longest-waiting unpinned one', pickNextFamily(FAMILIES, runs, now).id === 'cloaker');
  ok('with no pinned family overdue, the longest-waiting runs (never run = infinite wait)', pickNextFamily(FAMILIES, { ...runs, cloaker: now - 10 * 60000 }, now).id !== 'cloaker' && !['circumvent', 'casino'].includes(pickNextFamily(FAMILIES, { ...runs, cloaker: now - 10 * 60000 }, now).id));
  const f = FAMILIES[0]; const t1 = nextTerms(f, 0, 3); const t2 = nextTerms(f, t1.idx, 3);
  ok('terms rotate three at a time through the whole list and wrap around', t1.terms.join() === f.terms.slice(0, 3).join() && t2.terms.join() === f.terms.slice(3, 6).join() && nextTerms(f, f.terms.length - 1, 3).terms.length === 3 && nextTerms(f, f.terms.length - 1, 3).terms[1] === f.terms[0]);
  ok('the narrowed sales filter keeps "Which cloaking service?" and drops prices, WTS and emoji stacks', !SALES_NARROW.test('which cloaking services would you reccomend?') && SALES_NARROW.test('⭐ Casino backlinks $5 ⭐') && SALES_NARROW.test('[WTS] aged BM accounts') && SALES_NARROW.test('⏩⭐ MEGA AUTHORITY links'));
  const SR = (id, title, o = {}) => ({ threadId: String(id), url: `https://www.blackhatworld.com/seo/s.${id}/`, kind: o.kind || 'thread', title, author: 'a', at: hAgo(o.h ?? 24), replyCount: o.rep ?? 3, forum: o.forum || 'Facebook', snippet: o.snippet || '' });
  const BR = (id, title, o = {}) => ({ threadId: String(id), url: `https://www.blackhatworld.com/seo/b.${id}/`, title, author: 'a', lastPoster: 'z', startedAt: hAgo(o.start ?? 48), lastActivityAt: hAgo(o.h ?? 10), replyCount: o.rep ?? 3, sticky: !!o.sticky, locked: false, mine: !!o.mine, lastMine: false });
  const cl = FAMILIES.find((x) => x.id === 'cloaker');
  const inp = { searchRows: [SR(1, 'Which cloaking service would you recommend?', { h: 5, rep: 3 }), SR(2, 'TrustCloaker or Cloaking House?', { h: 400, rep: 20 }), SR(3, '⭐ Cloaker for sale $20 ⭐', { h: 2, rep: 0 }), SR(4, 'Need a cloaker guy', { forum: 'Hire a Freelancer', h: 1, rep: 0 }), SR(5, 'Already sent one', { h: 3, rep: 4 }), SR(6, 'Replied one', { h: 3 }), SR(1, 'Which cloaking service would you recommend?', { h: 2, kind: 'post', rep: 4, snippet: 'JCI works' })],
    pages: [{ board: { id: 2, name: 'Cloaking' }, rows: [BR(7, 'Whats the longest payment processor cloaking worked for you?', { rep: 0, h: 100 }), BR(8, 'Section rules', { sticky: true }), BR(9, 'Mine', { mine: true }), BR(10, 'Stripe cloaking for peps', { rep: 2, h: 50 })] },
      { board: { id: 219, name: 'Facebook (PPC)', filter: 'family' }, rows: [BR(11, 'Best cloaker for replica products on Meta?', { rep: 26, h: 110 }), BR(12, 'How to lower CPC', { rep: 1, h: 2 })] }] };
  const state = { sent: { 5: now - 86400000 }, replied: { 6: { at: now } }, hidden: {} };
  const { fresh, seenBefore } = familyCandidates(cl, inp, state, { now, muted: [] });
  const ids = fresh.map((c) => c.threadId);
  ok('candidates: search + boards merged, one per thread, HOT first; window 14 days; no sales, HAF, replied, sticky, yours; family filter on the PPC board', ids[0] === '7' && ids.includes('1') && ids.includes('10') && ids.includes('11') && !ids.includes('2') && !ids.includes('3') && !ids.includes('4') && !ids.includes('6') && !ids.includes('8') && !ids.includes('9') && !ids.includes('12'), ids);
  ok('a thread found twice keeps the newest date and the snippet; the via tag says where it came from', fresh.find((c) => c.threadId === '1').snippet === 'JCI works' && fresh.find((c) => c.threadId === '1').via === 'search' && fresh.find((c) => c.threadId === '7').via === 'board');
  ok('no reply cap any more: the 26-reply thread is in', ids.includes('11'));
  ok('a thread sent before is the seen-before layer, not fresh', seenBefore.length === 1 && seenBefore[0].threadId === '5');
  const chosen = chooseFamilyItems(fresh.slice(0, 1), seenBefore);
  ok('fewer than 3 fresh: seen-before tops up, marked', chosen.length === 2 && chosen[1].seenBefore === true);
  ok('never more than 8', chooseFamilyItems(Array.from({ length: 12 }, (_, i) => ({ threadId: String(i) })), []).length === 8);
  const gp = gatePrompt(cl, fresh);
  ok('the gate prompt carries the niche meaning and each id with title, board and snippet', /^NICHE: Choosing, setting up/.test(gp) && /^1 \| Which cloaking service/m.test(gp) && /JCI works/.test(gp));
  ok('gate scores are read by id, clamped 0-10; a broken answer gives none', parseGate('{"scores":{"1":9,"7":"11","10":-2}}')['7'] === 10 && parseGate('{"scores":{"10":-2}}')['10'] === 0 && Object.keys(parseGate('nope')).length === 0);
  const msg = formatFamily(cl, chosen.map((c, i) => ({ ...c, score: i === 0 ? 9 : undefined })), { now, count: 1, traffic: '📈 BHW now: 900 members · Low', funnel: 'Found 4 · gated 0 · sent 2 · held 2' });
  ok('the family message: emoji + name, HOT, fit score, seen-before mark, funnel, count, traffic, code words with "more"', /^🛡 <b>Cloaker<\/b> · \d\d:\d\d · 2 threads/.test(msg) && /1\. 🔥 HOT · <a href="[^"]+">Whats the longest payment processor/.test(msg) && /fit 9\/10/.test(msg) && /seen before/.test(msg) && /Found 4 · gated 0 · sent 2 · held 2/.test(msg) && /📈 BHW now/.test(msg) && /more cloaker/.test(msg.split('\n').pop()), msg);
}

// --- 1.20: threads you already posted in (BHW's own list) --------------------------------------------
{
  const part = { participated: { 7: now, 11: now, 2001: now, 3001: now, 9: now } };
  ok('iPosted: your tap OR BHW\'s list', iPosted({ replied: { 1: {} } }, '1') && iPosted(part, '7') && !iPosted(part, '8') && !iPosted({}, '1'));
  const SRc = (id, title) => ({ threadId: String(id), url: `https://www.blackhatworld.com/seo/p.${id}/`, kind: 'thread', title, author: 'a', at: hAgo(5), replyCount: 3, forum: 'Cloaking', snippet: '' });
  const BRc = (id, title) => ({ threadId: String(id), url: `https://www.blackhatworld.com/seo/p.${id}/`, title, author: 'a', lastPoster: 'z', startedAt: hAgo(40), lastActivityAt: hAgo(3), replyCount: 3, sticky: false, locked: false, mine: false, lastMine: false });
  const cl = FAMILIES.find((x) => x.id === 'cloaker');
  const fc = familyCandidates(cl, { searchRows: [SRc(2001, 'Cloaker I replied to, someone answered after me'), SRc(2002, 'Cloaker nobody has answered')], pages: [{ board: { id: 2, name: 'Cloaking' }, rows: [BRc(7, 'Cloaking thread I answered by hand'), BRc(8, 'Cloaking thread I did not answer')] }] }, part, { now });
  ok('families: a thread you posted in is never suggested, wherever it came from (search or board), even if someone replied after you', fc.fresh.map((c) => c.threadId).sort().join() === '2002,8', fc.fresh.map((c) => c.threadId));
  const bl = pickBlock([{ board: { id: 219, name: 'Facebook (PPC)' }, rows: [BRc(9, 'Block thread I answered'), BRc(12, 'Block thread new to me')] }], part, rx, { now });
  ok('blocks: the same', bl.items.map((q) => q.threadId).join() === '12', bl.items.map((q) => q.threadId));
  const nt = pickNewThreads([{ ...BRc(11, 'New thread I already posted in'), forum: 'Facebook', forumNode: '219', startedAt: hAgo(1), replyCount: 0 }, { ...BRc(13, 'New thread, mine to take'), forum: 'Facebook', forumNode: '219', startedAt: hAgo(1), replyCount: 0 }], part, rx, { now });
  ok('new threads: the same', nt.map((q) => q.threadId).join() === '13', nt.map((q) => q.threadId));
  const fs = filterSearch([SRc(3001, 'Search hit I replied to'), SRc(3002, 'Search hit new to me')], part, { now });
  ok('next <word> search: the same', fs.map((q) => q.threadId).join() === '3002', fs.map((q) => q.threadId));
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
