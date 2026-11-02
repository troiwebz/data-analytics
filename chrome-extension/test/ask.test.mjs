// Ask mode (1.21.0): the pure parts. The end-to-end flow is in radarrun.test.mjs.
import { hoursFrom, ruleAsk, parseAsk, pickAsk, titleHasTerm, parseRank, formatAsk, askPrompt, ASK_DENY, ASK_COMMANDS, ruleWatch, topicsFrom, applyWatch, matchWatches, formatWatch, formatWatchList, slug } from '../src/ask.js';
import { SALES_TITLE, isMuted, iPosted, FAMILIES, mergeFamilies, RETIRED_FAMILIES, boardAllowed, DEFAULT_WORDS, RADAR_SECTIONS } from '../src/radar.js';
let fails = 0;
const ok = (n, c, e) => { if (!c) fails++; console.log(`${c ? '  ok' : 'FAIL'}  ${n}${c || e === undefined ? '' : `  -> ${JSON.stringify(e).slice(0, 300)}`}`); };
const now = Date.parse('2026-10-18T12:00:00Z');
const hAgo = (h) => new Date(now - h * 3600000).toISOString();

// time words
ok('"last 24 hours" = 24', hoursFrom('find pbn in the last 24 hours') === 24);
ok('"last 7 days" = 168, "3 days" = 72, "2 weeks" = 336, "a month" = 720', hoursFrom('last 7 days') === 168 && hoursFrom('past 3 days') === 72 && hoursFrom('in 2 weeks') === 336 && hoursFrom('a month') === 720);
ok('"today" = 24, "yesterday" = 48, "this week" = 168, no time = null', hoursFrom('new threads today') === 24 && hoursFrom('yesterday') === 48 && hoursFrom('this week') === 168 && hoursFrom('pbn threads') === null);
ok('never above 30 days', hoursFrom('last 90 days') === 720);

// the reader that needs no Claude
let p = ruleAsk('Find PBN related threads in last 24 hours');
ok('rules: topic + window', p && p.kind === 'search' && p.terms[0] === 'pbn' && p.hours === 24, p);
p = ruleAsk('guest outreach last 7 days');
ok('rules: two-word topic', p && p.terms[0] === 'guest outreach' && p.hours === 168, p);
p = ruleAsk('check whats new');
ok('rules: "what\'s new" is the new-threads page, 24h', p && p.kind === 'new' && !p.terms.length && p.hours === 24, p);
p = ruleAsk('new threads about link building today');
ok('rules: new + topic', p && p.kind === 'new' && p.terms[0] === 'link building' && p.hours === 24, p);
p = ruleAsk('pbn only unanswered');
ok('rules: "unanswered" sets zero-replies', p && p.zero === true && p.terms[0] === 'pbn', p);
p = ruleAsk('turn off new threads');
ok('rules: switching the watch off is the command', p && p.kind === 'command' && p.command === 'new threads off', p);
ok('rules: thanks is not a search', ruleAsk('ok thanks').kind === 'chat');
ok('rules: nothing to search for gives null', ruleAsk('can you please find me the') === null);

// Claude's plan
p = parseAsk('{"kind":"search","terms":["PBN","private blog network","pbn"],"hours":24,"limit":50,"say":"x"}');
ok('plan: terms cleaned, de-duplicated, limit capped at 10', p && p.terms.join() === 'pbn,private blog network' && p.limit === 10 && p.hours === 24, p);
ok('plan: JSON inside prose is found', parseAsk('Here you go: {"kind":"new","terms":[],"hours":6}').hours === 6);
ok('plan: a search with no terms is refused', parseAsk('{"kind":"search","terms":[]}') === null);
ok('plan: garbage is refused', parseAsk('nope') === null && parseAsk('{"kind":"delete"}') === null);
p = parseAsk('{"kind":"command","command":"rm -rf /"}');
ok('plan: a command outside the allowed list becomes a plain refusal, never a command', p.kind === 'chat' && p.command === '' && /cannot do that/.test(p.reply), p);
ok('plan: the allowed commands are only radar-ish ones', ['radar', 'radar help', 'families', 'new threads', 'new threads on', 'new threads off', 'online', 'online now'].every((c) => ASK_COMMANDS.test(c)) && !ASK_COMMANDS.test('auto on') && !ASK_COMMANDS.test('pm cap 500') && !ASK_COMMANDS.test('exclude 5'));
ok('plan: hours default 168 for a search, 24 for new, max 720', parseAsk('{"kind":"search","terms":["a b"]}').hours === 168 && parseAsk('{"kind":"new"}').hours === 24 && parseAsk('{"kind":"new","hours":99999}').hours === 720);
ok('the prompt carries today, the status and the previous request', /TODAY: 2026-10-18/.test(askPrompt('x', { now, status: 's1', previous: { text: 'pbn', plan: { kind: 'search', terms: ['pbn'], hours: 24 } } })) && /STATUS: s1/.test(askPrompt('x', { now, status: 's1' })) && /PREVIOUS: .*pbn/.test(askPrompt('x', { now, previous: { text: 'pbn', plan: { kind: 'search', terms: ['pbn'], hours: 24 } } })));

// picking
const R = (id, title, o = {}) => ({ threadId: String(id), url: `https://www.blackhatworld.com/seo/t.${id}/`, title, forum: o.forum || 'Black Hat SEO', replyCount: o.rep ?? 3, lastActivityAt: hAgo(o.last ?? 5), startedAt: o.start != null ? hAgo(o.start) : '', sticky: !!o.sticky, locked: !!o.locked, mine: !!o.mine, snippet: o.snippet || '' });
const state = { replied: { 3: 1 }, participated: { 4: 1 }, hidden: { 5: 1 }, sent: { 6: 1 } };
const ctx = { now, muted: ['affiliate'], deny: ASK_DENY, sales: SALES_TITLE, iPosted, isMuted };
const rows = [R(1, 'PBN footprints in 2026'), R(2, 'PBN question', { rep: 0 }), R(3, 'replied by tap'), R(4, 'posted in already'), R(5, 'hidden one'), R(6, 'sent before'), R(7, 'WTS PBN links $20'), R(8, 'PBN affiliate link idea'), R(9, 'PBN old thread', { last: 400 }), R(10, 'PBN in market', { forum: 'Marketplace' }), R(11, 'sticky rules', { sticky: true }), R(12, 'locked pbn', { locked: true }), R(13, 'PBN yours', { mine: true }), R(1, 'PBN footprints in 2026', { snippet: 'a longer snippet here' })];
let got = pickAsk(rows, { kind: 'search', hours: 24 }, state, ctx);
ok('picked: only 1 and 2 survive (replied, posted-in, hidden, sent, sales, muted, old, marketplace, sticky, locked, mine all out)', got.map((x) => x.threadId).sort().join() === '1,2', got.map((x) => x.threadId));
ok('picked: a thread found twice is one thread with the longer snippet', got.find((x) => x.threadId === '1').snippet === 'a longer snippet here' && got.find((x) => x.threadId === '1').hits === 2);
ok('picked: newest activity first', pickAsk([R(1, 'a pbn', { last: 9 }), R(2, 'b pbn', { last: 2 })], { kind: 'search', hours: 24 }, {}, ctx)[0].threadId === '2');
ok('"again" brings back threads already sent, but never ones you replied to', pickAsk(rows, { kind: 'search', hours: 24, again: true }, state, ctx).map((x) => x.threadId).sort().join() === '1,2,6');
ok('"only unanswered" keeps 0-reply threads', pickAsk(rows, { kind: 'search', hours: 24, zero: true }, state, ctx).map((x) => x.threadId).join() === '2');
ok('a "new" request goes by when the thread STARTED, not its last reply', pickAsk([R(1, 'a', { start: 30, last: 1 }), R(2, 'b', { start: 3, last: 1 })], { kind: 'new', hours: 24 }, {}, ctx).map((x) => x.threadId).join() === '2');
ok('Black Hat SEO and Link Building boards are allowed, the marketplace is not', !ASK_DENY.test('Black Hat SEO') && !ASK_DENY.test('Link Building') && ASK_DENY.test('Marketplace') && ASK_DENY.test('Hire a Freelancer'));
ok('titles match a topic as whole words or phrases', titleHasTerm('Is PBN still working?', ['pbn']) && titleHasTerm('Guest-post sites', ['guest post']) && !titleHasTerm('Pbnx thing', ['pbn']));

// Claude's keep-list
const kept = parseRank('{"keep":[{"id":"2","why":"Open question"},{"id":"99","why":"unknown"},{"id":"1","why":"Active"},{"id":"2","why":"dup"}]}', got);
ok('rank: Claude\'s order and reasons, unknown and repeated ids ignored', kept && kept.map((x) => x.threadId).join() === '2,1' && kept[0].why === 'Open question');
ok('rank: not JSON gives null (the caller falls back to newest first)', parseRank('sorry', got) === null);

// the message
const msg = formatAsk([{ ...got[0], why: 'Active <b>' }, got[1]], { kind: 'search', terms: ['pbn', 'private blog network'], hours: 24 }, { now, count: 2, target: 10, more: 3, funnel: 'Read 14 · 2 fit' });
ok('message: header with topic + window, linked titles, reasons escaped, HOT on 0 replies, more line, funnel, count, how to ask', /^🤖 <b>pbn \/ private blog network<\/b> · last 24 hours · 2 threads/.test(msg) && /<a href="https:\/\/www\.blackhatworld\.com\/seo\/t\.\d+\/">/.test(msg) && /Active &lt;b&gt;/.test(msg) && /🔥 <a/.test(msg) && /3 more matched\. Send "more"/.test(msg) && /Read 14 · 2 fit/.test(msg) && /Public replies today: <b>2 of 10<\/b>/.test(msg) && /Ask me anything like/.test(msg), msg);
ok('message: 48+ hours is shown in days, and "new" says started', /last 7 days/.test(formatAsk([got[0]], { kind: 'search', terms: ['x'], hours: 168 }, { now })) && /started/.test(formatAsk([{ ...got[0], startedAt: hAgo(3) }], { kind: 'new', terms: [], hours: 24 }, { now })));
ok('message: never longer than Telegram allows', formatAsk(Array.from({ length: 10 }, (_, i) => R(i + 1, 'x'.repeat(200))), { kind: 'search', terms: ['x'], hours: 24 }, { now }).length <= 3900);

// 1.21.0: cloaker and circumvent are gone for good
ok('families: cloaker and circumvent are not built in; PBN and outreach are', !FAMILIES.some((f) => ['cloaker', 'circumvent'].includes(f.id)) && FAMILIES.some((f) => f.id === 'pbn') && FAMILIES.some((f) => f.id === 'outreach') && FAMILIES.length === 10);
ok('families: an old saved copy of a retired family does not bring it back', !mergeFamilies([{ id: 'cloaker', terms: ['x'] }, { id: 'circumvent', terms: ['y'] }]).some((f) => RETIRED_FAMILIES.includes(f.id)));
ok('the cloaking board (2) and the cloak word group are gone', !boardAllowed({ id: 2, name: 'Anything' }) && !RADAR_SECTIONS.some((s) => s.id === 2) && !('cloak' in DEFAULT_WORDS) && !JSON.stringify(DEFAULT_WORDS).includes('circumvent'));


// --- alerts (1.22.0) -------------------------------------------------------------------------------------
ok('topics: commas, "and", "or" split the list; filler words go', topicsFrom('notify me when new threads come in SEO, guest outreach and content writing').join('|') === 'seo|guest outreach|content writing', topicsFrom('notify me when new threads come in SEO, guest outreach and content writing'));
p = ruleWatch('Notify me when new threads come in SEO, guest outreach, content writing');
ok('rules: three topics become three alerts, each with its own words', p && p.kind === 'watch' && p.op === 'add' && p.watches.map((w) => w.label).join() === 'seo,guest outreach,content writing' && p.watches[1].terms[0] === 'guest outreach', p);
ok('rules: "also watch link building" adds, "stop watching content writing" removes', ruleWatch('also watch link building').op === 'add' && ruleWatch('also watch link building').watches[0].label === 'link building' && ruleWatch('stop watching content writing').op === 'remove' && ruleWatch('stop watching content writing').watches[0].label === 'content writing');
ok('rules: alerts / pause / resume / list', ruleWatch('alerts').op === 'list' && ruleWatch('what am i watching').op === 'list' && ruleWatch('pause alerts').op === 'pause' && ruleWatch('resume alerts').op === 'resume' && ruleWatch('alerts off').op === 'pause' && ruleWatch('alerts on').op === 'resume');
ok('rules: a normal search is not an alert', ruleWatch('find pbn threads in the last 24 hours') === null && ruleAsk('find pbn threads in the last 24 hours').kind === 'search');
ok('rules: an alert request reaches ruleAsk first', ruleAsk('notify me when new threads come in seo').kind === 'watch');
p = parseAsk('{"kind":"watch","op":"add","watches":[{"label":"SEO","terms":["seo","search engine optimization"]},{"label":"Guest outreach"}]}');
ok('plan: watch entries are cleaned; an entry with no terms uses its label', p && p.kind === 'watch' && p.watches[0].label === 'seo' && p.watches[1].terms.join() === 'guest outreach', p);
ok('plan: add or remove with nothing named, or an unknown op, is refused', parseAsk('{"kind":"watch","op":"add","watches":[]}') === null && parseAsk('{"kind":"watch","op":"explode","watches":[{"label":"x"}]}') === null && parseAsk('{"kind":"watch","op":"list"}').op === 'list');
let list = [];
let r = applyWatch(list, { op: 'add', watches: [{ label: 'seo', terms: ['seo'] }, { label: 'guest outreach', terms: ['guest outreach', 'guest post'] }] }, now);
ok('apply: add makes alerts with ids, words, on, and a time', r.list.length === 2 && r.list[1].id === 'guest-outreach' && r.list[1].terms.length === 2 && r.list[0].on === true && r.list[0].addedAt === now && r.added.join() === 'seo,guest outreach');
list = r.list;
r = applyWatch(list, { op: 'add', watches: [{ label: 'seo', terms: ['seo', 'technical seo'] }] }, now);
ok('apply: adding a topic you already watch adds words instead of duplicating it', r.list.length === 2 && r.list[0].terms.includes('technical seo') && r.extended.join() === 'seo');
r = applyWatch(list, { op: 'remove', watches: [{ label: 'guest outreach', terms: [] }, { label: 'blogging', terms: [] }] }, now);
ok('apply: remove drops the named alert and reports one you were not watching', r.list.map((w) => w.id).join() === 'seo' && r.removed.join() === 'guest outreach' && r.missing.join() === 'blogging');
ok('apply: slugs are stable', slug('Guest Outreach!') === 'guest-outreach');

const W = (id, title, o = {}) => ({ threadId: String(id), url: `https://www.blackhatworld.com/seo/w.${id}/`, title, forum: o.forum || 'Black Hat SEO', replyCount: o.rep ?? 0, startedAt: hAgo(o.start ?? 1), lastActivityAt: hAgo(0.5), sticky: !!o.sticky, locked: !!o.locked, mine: !!o.mine });
const watches = [{ id: 'seo', label: 'seo', terms: ['seo'], on: true, addedAt: now - 24 * 3600000 }, { id: 'guest-outreach', label: 'guest outreach', terms: ['guest outreach', 'guest post'], on: true, addedAt: now - 24 * 3600000 }, { id: 'off', label: 'off', terms: ['casino'], on: false, addedAt: 0 }];
const wrows = [W(1, 'Best SEO tools?'), W(2, 'Guest post outreach tips'), W(3, 'SEO and guest post combo'), W(4, 'SEO crowded thread', { rep: 9 }), W(5, 'SEO from yesterday', { start: 20 }), W(6, 'seo cheap services $5'), W(7, 'SEO in Introductions', { forum: 'Introductions' }), W(8, 'casino stuff'), W(9, 'SEO seen already'), W(10, 'SEO replied by tap'), W(11, 'SEO sent before'), W(12, 'SEO sticky', { sticky: true }), W(13, 'Newest SEO question', { start: 0.2 })];
let g = matchWatches(wrows, watches, { replied: { 10: 1 }, sent: { 11: 1 } }, { now, seen: { 9: now }, sales: SALES_TITLE, iPosted, isMuted });
ok('alerts: matches by words in the title, once per thread (first alert wins), newest first', g.map((x) => x.watch.id).join() === 'seo,guest-outreach' && g[0].items.map((x) => x.threadId).join() === '13,1,3' && g[1].items.map((x) => x.threadId).join() === '2', g.map((x) => x.items.map((y) => y.threadId)));
ok('alerts: dropped - more than 5 replies, older than 6h, sales, Introductions, seen, replied, sent before, sticky, off-topic, switched-off alert', !g.flatMap((x) => x.items).some((q) => [4, 5, 6, 7, 8, 9, 10, 11, 12].includes(Number(q.threadId))));
g = matchWatches([W(1, 'SEO new alert thread', { start: 5 })], [{ id: 'seo', label: 'seo', terms: ['seo'], on: true, addedAt: now }], {}, { now, sales: SALES_TITLE });
ok('alerts: a thread that started more than 3 hours before the alert was made is not dumped on you', g.length === 0);
g = matchWatches([W(1, 'SEO new alert thread', { start: 2 })], [{ id: 'seo', label: 'seo', terms: ['seo'], on: true, addedAt: now }], {}, { now, sales: SALES_TITLE });
ok('alerts: but one from the last 3 hours is (a new alert answers straight away)', g.length === 1);
g = matchWatches(wrows, watches, {}, { now, seen: {}, sales: SALES_TITLE, iPosted, isMuted });
const fw = formatWatch(g, { now, count: 1, target: 10, watches, max: 3 });
ok('message: one message, a section per alert, 3 shown of more, the rest named, count, Watching line with how to change it', /^🔔 <b>New threads for your alerts<\/b> · \d\d:\d\d · 3 new/.test(fw.text) && /<b>seo<\/b>/.test(fw.text) && fw.shown.length === 3 && /more waiting/.test(fw.text) && /Public replies today: <b>1 of 10<\/b>/.test(fw.text) && /Watching: seo, guest outreach/.test(fw.text) && /stop watching/.test(fw.text) && !/casino/.test(fw.text.split('Watching:')[1] || ''), fw.text);
ok('message: titles are links and 0 replies are HOT', /🔥 <a href="https:\/\/www\.blackhatworld\.com\/seo\/w\.\d+\/">/.test(fw.text));
ok('list: shows words, marks switched-off alerts, says when paused, and how to change them', /Your alerts/.test(formatWatchList(watches)) && /⏸ <b>off<\/b>/.test(formatWatchList(watches)) && /PAUSED/.test(formatWatchList(watches, { paused: true })) && /not watching anything/.test(formatWatchList([])));

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
