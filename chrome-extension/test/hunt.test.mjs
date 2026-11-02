// log 1.26.0: the SEO buyer hunter, pure parts - categories, lanes, score, gems, pool, picks, reading plan, Telegram text.
import * as H from '../src/hunt.js';
import { CATS } from '../src/hunt/cats.js';
let fails = 0;
const ok = (n, c, e) => { if (!c) fails++; console.log(`${c ? '  ok' : 'FAIL'}  ${n}${c || e === undefined ? '' : `  -> ${JSON.stringify(e).slice(0, 300)}`}`); };
const now = Date.parse('2026-11-02T10:00:00Z');
const mAgo = (m) => new Date(now - m * 60000).toISOString();
const R = (id, title, o = {}) => ({ threadId: String(id), url: `https://www.blackhatworld.com/seo/t.${id}/`, title, author: 'a', forum: o.forum ?? 'Black Hat SEO', forumNode: '28',
  startedAt: mAgo(o.m ?? 10), lastActivityAt: mAgo(o.m ?? 10), replyCount: o.rep ?? 0, sticky: !!o.sticky, locked: false, mine: !!o.mine });

// categories
const c = (t, f) => { const x = H.categorize(t, f); return `${x.cat}:${x.topic}`; };
ok('backlinks', c('Need 20 niche edits for a SaaS site') === 'seo:backlinks');
ok('guest posts', c('WTB guest posts on tech blogs DR 40+') === 'seo:guest');
ok('local seo', c('Looking for someone to rank my GMB in 3 cities') === 'seo:local');
ok('technical', c('Pages indexed but not ranking after core update') === 'seo:technical');
ok('LinkedIn Ads is its own platform', c('Need someone to run LinkedIn ads for B2B SaaS') === 'ads:linkedin');
ok('google ads', c('Looking for Google Ads manager') === 'ads:google');
ok('content', c('Hiring writer for 30 articles a month') === 'content:articles');
ok('specific beats broad: SEO articles are content', c('Hiring writer for 30 SEO articles a month') === 'content:articles' && c('Need SEO help for my site') === 'seo:seo');
ok('web', c('Need a WordPress developer') === 'web:wordpress');
ok('design', c('Logo needed for my brand') === 'design:design');
ok('board decides when the title does not', c('Quick question for everyone', 'Local SEO') === 'seo:seo');
ok('other', c('Best laptop for working from home', 'BlackHat Lounge') === 'other:other');
ok('UI categories match the module (ids, names, topics)', JSON.stringify(CATS.map((x) => [x.id, x.name, x.topics.map((t) => t[0])]))
  === JSON.stringify(H.ALL_CATEGORIES.map((x) => [x.id, x.name, x.topics.map((t) => t.id)])));

// lanes
const L = (t, f = 'Black Hat SEO') => H.laneOf({ title: t, forum: f });
ok('buyer words', L('Looking for a link builder') === 'buyer' && L('WTB local citations') === 'buyer' && L('Need help with SEO, budget $500') === 'buyer');
ok('Hire a Freelancer and Want to Buy are buyers by board', L('SEO for my dental site', 'Hire a Freelancer') === 'buyer' && L('Backlinks', 'Want to Buy') === 'buyer');
ok('questions are the expert lane', L('Why did my traffic drop after the update?') === 'expert' && L('How to get pages indexed faster') === 'expert');
ok('sellers never come in', L('⭐ Cheap backlinks 50% off ⭐') === 'skip' && L('[WTS] PBN links') === 'skip' && L('I will write SEO articles') === 'skip');
ok('hellos never come in', L('Hello everyone, new here') === 'skip');
ok('cloaking or getting round a ban never comes in', L('Looking for a cloaker for Google Ads') === 'skip' && L('How to bypass ad account ban') === 'skip' && L('Need help', 'Cloaking and Content Generators') === 'skip');
ok('plain chat is other', L('My SEO journey so far, month 3', 'White Hat SEO') === 'other');

// score
const sc = (row, o) => H.scoreOf({ ...row, lane: H.laneOf(row), ...H.categorize(row.title, row.forum) }, { now, ...o });
const freshBuyer = sc(R(1, 'Need 20 niche edits, budget $400', { m: 5, rep: 0 }));
const oldBuyer = sc(R(2, 'Need 20 niche edits', { m: 60 * 24 * 9, rep: 15 }));
const question = sc(R(3, 'Why is my site deindexed?', { m: 20, rep: 0 }));
ok('fresh buyer with budget scores highest', freshBuyer > question && question > oldBuyer, { freshBuyer, question, oldBuyer });
ok('focus categories rise', sc(R(4, 'Need a logo', { forum: 'Graphics' }), { focus: ['design'] }) > sc(R(4, 'Need a logo', { forum: 'Graphics' }), { focus: ['seo'] }));
ok('scores stay 0-100', [freshBuyer, question, oldBuyer].every((s) => s >= 0 && s <= 100));

// pool
let { pool, fresh } = H.mergeRows({}, [R(10, 'Need backlinks for SaaS', { m: 5 }), R(11, '⭐ Cheap links ⭐'), R(12, 'Why traffic dropped?', { m: 40 }), R(13, 'Sticky rules', { sticky: true }), R(14, 'mine', { mine: true })], { now, focus: ['seo'] });
ok('pool keeps buyers and questions, drops sellers, stickies, mine', fresh.join() === '10,12' && Object.keys(pool).length === 2, fresh);
ok('a pool item carries category, lane, score, day, empty status', pool['10'].cat === 'seo' && pool['10'].lane === 'buyer' && pool['10'].score > 0 && pool['10'].day === '2026-11-02' && pool['10'].status === '');
pool['10'].status = 'done';
({ pool, fresh } = H.mergeRows(pool, [R(10, 'Need backlinks for SaaS', { m: 5, rep: 6 })], { now: now + 60000 }));
ok('a known thread is not fresh again; replies refresh; status stays', !fresh.length && pool['10'].replyCount === 6 && pool['10'].status === 'done');
({ pool, fresh } = H.mergeRows(pool, [R(11, '⭐ Cheap links ⭐')], { now }));
ok('a dropped seller never comes back as fresh', !fresh.length && !pool['11']);
const big = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [String(i), { id: String(i), startedAt: mAgo(i < 5 ? 60 * 24 * 40 : 10), firstSeen: now - i }]));
const pr = H.prunePool(big, { now, max: 20 });
ok('prune: over 30 days goes, then the oldest beyond the cap', Object.keys(pr.pool).length === 20 && pr.dropped.length === 10 && !pr.pool['0'], pr.dropped);

// picks
const pp = H.mergeRows({}, [R(20, 'Need SEO audit, budget $300', { m: 5 }), R(21, 'How to fix crawl errors?', { m: 10 }), R(22, 'My SEO journey', { m: 10 }),
  R(23, 'Looking for guest posts', { m: 60 * 24 * 5 }), R(24, 'Looking for PBN links', { m: 30, rep: 12 })], { now, focus: ['seo'] }).pool;
let picks = H.nextPicks(pp, { now });
ok('picks: buyers and questions only, best first, not older than 3 days, under 10 replies', picks.map((i) => i.id).join() === '20,21', picks.map((i) => i.id));
picks = H.nextPicks(pp, { now, shown: { 20: now } });
ok('picks: shown ones make room for the next', picks.map((i) => i.id).join() === '21');
const cnt = H.countPool(pp, { now });
ok('counts by category and lane', cnt.all === 5 && cnt.cats.seo === 5 && cnt.buyers === 3 && cnt.experts === 1, cnt);

// gems
const G = (t, o, focus = ['seo']) => { const it = H.mergeRows({}, [R(30, t, o)], { now, focus }).pool['30']; return it ? H.gemOf(it, { now, focus }) : ''; };
ok('gem: buyer under 30 min with 0-4 replies', G('Looking for backlink builder', { m: 12, rep: 2 }) === 'fresh buyer');
ok('gem: buyer with budget up to 3 h', G('Need guest posts, $500 budget', { m: 120, rep: 5 }) === 'buyer with a budget');
ok('gem: unanswered question under an hour', G('Why did my site get deindexed?', { m: 30, rep: 0 }) === 'unanswered question');
ok('no gem: old or crowded', G('Looking for backlink builder', { m: 200, rep: 2 }) === '' && G('Looking for backlinks', { m: 10, rep: 9 }) === '');
ok('no gem outside her categories', G('Need a logo designer', { m: 5, forum: 'Graphics' }) === '');
ok('no gem once acted on', H.gemOf({ ...H.mergeRows({}, [R(31, 'Looking for links', { m: 5 })], { now }).pool['31'], status: 'skip' }, { now }) === '');

// what our own system already did
ok('HAF marks: DM sent, reply posted, still queued, nothing', H.hafMark({ pmSent: true }) === 'dm' && H.hafMark({ status: 'POSTED' }) === 'posted' && H.hafMark({ kind: 'haf', status: 'SENT' }) === 'queued' && H.hafMark({ kind: 'haf', status: 'SKIPPED' }) === '' && H.hafMark(null) === '');
const withHaf = { ...pp, 20: { ...pp['20'], haf: 'dm' } };
ok('picks skip a thread our system already messaged', !H.nextPicks(withHaf, { now }).some((i) => i.id === '20'));

// Want to Buy -> HAF: only service requests in her lines
const W2 = (t) => { const it = H.mergeRows({}, [R(600, t, { forum: 'Want to Buy', m: 30, rep: 1 })], { now }).pool['600']; return it ? H.wtbTarget(it, { now, all: true }) : { ok: false }; };
const W = (t, o = {}) => { const it = H.mergeRows({}, [R(500, t, { forum: 'Want to Buy', m: o.m ?? 60, rep: o.rep ?? 2 })], { now }).pool['500']; return it ? H.wtbTarget(it, { now }) : { ok: false, why: 'dropped' }; };
ok('WTB: SEO, guest posts, local SEO, Google/LinkedIn ads, Reddit marketing, SEO articles go to HAF',
  ['WTB high DR guest posts for SaaS', 'Need niche edits for a finance site', 'Looking for local SEO for a dentist', 'WTB Google Ads campaign setup', 'Need someone to run LinkedIn ads', 'Looking for Reddit marketing for my app', 'WTB SEO articles, 20 a month']
    .every((t) => W(t).ok), ['WTB high DR guest posts for SaaS', 'Need niche edits for a finance site', 'Looking for local SEO for a dentist', 'WTB Google Ads campaign setup', 'Need someone to run LinkedIn ads', 'Looking for Reddit marketing for my app', 'WTB SEO articles, 20 a month'].map((t) => [t, W(t)]));
ok('WTB: buying things never goes (accounts, proxies, VCC, domains, upvotes, followers, reviews)',
  ['WTB aged Reddit accounts', 'Looking for residential proxies', 'WTB VCC for ads', 'Need expired domains with DR 30', 'Buying Reddit upvotes', 'WTB Instagram followers', 'Need Google reviews for my business', 'WTB agency ad account']
    .every((t) => !W(t).ok), ['WTB aged Reddit accounts', 'Looking for residential proxies', 'WTB VCC for ads', 'Need expired domains with DR 30', 'Buying Reddit upvotes', 'WTB Instagram followers', 'Need Google reviews for my business', 'WTB agency ad account'].map((t) => [t, W(t)]));
ok('WTB: other lines never go (logo, video, WordPress, Instagram growth)', ['Need a logo', 'WTB video editing', 'Need WordPress developer', 'Looking for Instagram growth'].every((t) => !W(t).ok));
ok('WTB: older than 24 h or 10+ replies stays out', !W('Need guest posts', { m: 60 * 30 }).ok && !W('Need guest posts', { rep: 12 }).ok);
ok('WTB is HAF\'s now: not in the Hunt feed, no gem', H.formatFeed([H.mergeRows({}, [R(501, 'Need guest posts', { forum: 'Want to Buy', m: 5 })], { now }).pool['501']], { now }).length === 0
  && H.gemOf(H.mergeRows({}, [R(502, 'Need guest posts', { forum: 'Want to Buy', m: 5, rep: 0 })], { now }).pool['502'], { now }) === '');

ok('WTB send-all mode: any service a buyer wants goes, cloaker never', W2('Need a logo').ok && !W2('Looking for a cloaker').ok);
ok('log 1.27.1: buying a THING never goes, in either mode', !W2('[WTB] Google ads account that ran call ads in past').ok && !W2('WTB aged Reddit accounts').ok && W2('Need someone to manage my Google Ads account').ok);

// reading plan
const log = Array.from({ length: 13 }, (_, i) => now - i * 60000);
ok('hourly cap counts the last hour only', H.readsLastHour([...log, now - 2 * 3600000], now) === 13 && H.pagesLeft(log, now) === 2);
ok('page 2 of what\'s-new comes from the address page 1 ended on', H.pageUrl('https://www.blackhatworld.com/whats-new/posts/98765/', 2) === 'https://www.blackhatworld.com/whats-new/posts/98765/page-2' && H.pageUrl('https://www.blackhatworld.com/whats-new/posts/', 2) === '');
ok('history: page 1 of every board, then page 2; boards without an id are skipped', (() => { const q = H.historyQueue([{ id: 76, name: 'HAF' }, { slug: 'x', name: 'X' }, { id: 28, name: 'BHS' }]); return q.length === 4 && q[0].url.endsWith('/forums/76/') && q[2].url.endsWith('/forums/76/page-2'); })());
ok('history waits 3 minutes between pages and never eats the next update\'s pages', !H.historyDue({ history: { queue: [1], lastAt: now - 60000 } }, [], now)
  && H.historyDue({ history: { queue: [1], lastAt: now - 4 * 60000 } }, [], now) && !H.historyDue({ history: { queue: [1], lastAt: 0 } }, log, now));
ok('update gap: 10-15 min by day, 30 at night', H.nextGapMin(false, 0) === 10 && H.nextGapMin(false, 0.99) === 15 && H.nextGapMin(true, 0.5) === 30);
ok('caps: 15 pages an hour, 3 per update, 10 new per summary, 8 gems a day', H.PAGES_PER_HOUR === 15 && H.MAX_PAGES_PER_UPDATE === 3 && H.MIN_NEW_PER_UPDATE === 10 && H.GEMS_PER_DAY === 8);

// Telegram text
const items = Object.values(H.mergeRows({}, Array.from({ length: 12 }, (_, i) => R(40 + i, i % 3 ? `Looking for backlinks pack ${i}` : `How to fix indexing ${i}?`, { m: 5 + i })), { now, focus: ['seo'] }).pool);
const feedItems = [...items, ...Object.values(H.mergeRows({}, [R(90, 'Need SEO for my clinic', { m: 2, forum: 'Hire a Freelancer' }), R(91, 'My SEO journey day 3', { m: 4, forum: 'White Hat SEO' })], { now }).pool)];
const feed = H.formatFeed(feedItems, { now });
const sum = feed.join('\n');
ok('feed: every new thread listed, newest first, Hire a Freelancer left out', feed.length === 1 && /Live feed · 13 new threads/.test(sum) && !/clinic/.test(sum) && (sum.match(/<a href=/g) || []).length === 13 && sum.indexOf('journey day 3') < sum.indexOf('backlinks pack 1'), sum);
ok('feed: lane icon, category › topic, replies, age; plain threads come too', /🆕 <a href=[^>]+>My SEO journey day 3/.test(sum) && /🔎 SEO › /.test(sum) && /💰 9 buyers/.test(sum) === false && /💰 8 buyers/.test(sum), sum.slice(0, 400));
const many = Object.values(H.mergeRows({}, Array.from({ length: 32 }, (_, i) => R(200 + i, `Looking for links ${i}`, { m: 1 + i })), { now }).pool);
ok('feed: more than 15 go out as several messages, numbered on', (() => { const f = H.formatFeed(many, { now }); return f.length === 3 && /continued<\/b> \(16-30 of 32\)/.test(f[1]) && /<b>32\. /.test(f[2]); })());
ok('no gem for Hire a Freelancer (HAF has it)', H.gemOf({ ...H.mergeRows({}, [R(92, 'Looking for backlinks', { m: 3, forum: 'Hire a Freelancer' })], { now }).pool['92'] }, { now, focus: ['seo'] }) === '');
const gem = H.formatGem(items[0], 'fresh buyer', { now });
ok('gem message: lane, category › topic, link, why', /💎/.test(gem) && /SEO › /.test(gem) && /<a href="https:\/\/www\.blackhatworld\.com/.test(gem) && /Why: fresh buyer/.test(gem), gem);
ok('gem button opens the thread only (nothing is posted)', JSON.stringify(H.gemKeyboard(items[0])) === JSON.stringify({ inline_keyboard: [[{ text: '🔗 Open thread', url: items[0].url }]] }));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
