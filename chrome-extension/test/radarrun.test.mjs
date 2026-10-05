// Reply Radar, end to end in the background (1.13.0): the sweep, the briefs, the
// three cards, the two buttons and the "radar ..." words - and that none of it
// touches HAF's leads or reads Hire a Freelancer.
const bags = { local: {}, sync: {} };
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const mk = (area) => ({
  get: async (k) => { const bag = bags[area];
    if (k == null) return clone(bag);
    const ks = Array.isArray(k) ? k : [k];
    return Object.fromEntries(ks.filter((x) => x in bag).map((x) => [x, clone(bag[x])])); },
  set: async (o) => Object.assign(bags[area], clone(o)),
  remove: async (k) => { for (const x of (Array.isArray(k) ? k : [k])) delete bags[area][x]; }
});

const now = Date.now();
const hAgo = (h) => new Date(now - h * 3600000).toISOString();
const R = (id, title, o = {}) => ({ threadId: String(id), url: `https://www.blackhatworld.com/seo/t.${id}/`, title, author: 'starter', lastPoster: 'other',
  startedAt: hAgo(o.start ?? 48), lastActivityAt: hAgo(o.last ?? 6), replyCount: o.rep ?? 3, views: 100, sticky: false, locked: false, mine: !!o.mine, lastMine: false });
let listings = {
  219: [R(1, 'Anyone still successfully running gambling niche ads on Meta?', { start: 326, last: 51, rep: 11 }), R(2, 'Best virtual credit cards (VCC) for Facebook Ads?', { start: 9, last: 9, rep: 0 }), R(3, 'How to reduce high cpc in facebook ads', { start: 150, last: 10, rep: 5 })],
  2: [R(9, 'TrafficGuardian For Casino Campaigns?', { start: 1020, last: 7.5, rep: 5 }), R(10, 'which cloaking services would you reccomend?', { start: 50, last: 7, rep: 3 })],
  85: [R(20, 'Best Ad Networks for Promoting Gambling Apps?', { start: 1500, last: 6.6, rep: 25 })]
};
let threadPosts = { 10: [{ author: 'jak', text: 'JCI is good' }, { author: 'BargainBed', text: 'Check fingerprints and IP consistency.' }] };
let blockAt = null;
const opened = [];
const upd = [];
let tabN = 0; const tabUrl = {};
globalThis.chrome = {
  runtime: { onInstalled: { addListener: () => {} }, onStartup: { addListener: () => {} }, onMessage: { addListener: () => {} },
    getManifest: () => ({ version: '1.13.0' }), getURL: (p) => 'chrome-extension://x/' + p, lastError: null, sendMessage: async () => ({}) },
  action: { onClicked: { addListener: () => {} } },
  tabs: { onRemoved: { addListener: () => {} }, onUpdated: { addListener: (f) => upd.push(f), removeListener: (f) => { const i = upd.indexOf(f); if (i >= 0) upd.splice(i, 1); } },
    create: async ({ url }) => { const id = ++tabN; tabUrl[id] = url; opened.push(url); setTimeout(() => upd.slice().forEach((f) => f(id, { status: 'complete' })), 1); return { id }; },
    remove: async () => {} },
  alarms: { onAlarm: { addListener: () => {} }, clear: async () => {}, create: () => {} },
  notifications: { create: (id, o, cb) => cb && cb(id), clear: () => {}, onClicked: { addListener: () => {} }, onButtonClicked: { addListener: () => {} } },
  scripting: { executeScript: async ({ target, func }) => {
    const url = tabUrl[target.tabId];
    if (blockAt && url.includes(blockAt)) return [{ result: { blocked: 'BHW blocked the page: Just a moment...' } }];
    if (func.name === 'extractRadarListing') { const id = (url.match(/forums\/(\d+)\//) || [])[1]; return [{ result: { rows: listings[id] || [], me: 'bargainbed', loggedIn: true } }]; }
    const id = (url.match(/\.(\d+)\//) || [])[1]; const page = (url.match(/page-(\d+)/) || [])[1];
    const posts = threadPosts[id] || [{ author: 'm1', text: 'Check the network allows gambling in your GEO.' }];
    return [{ result: { page: Number(page) || 1, starter: 'starter', firstAuthor: page ? 'late' : 'starter', title: 't', body: page ? 'a late reply on the last page' : 'The opening question of the thread.', replies: posts } }];
  } },
  offscreen: { hasDocument: async () => true, createDocument: async () => {} },
  storage: { local: mk('local'), sync: mk('sync') }
};

let tg = [], updates = [], claude = [], claudeFail = false;
globalThis.fetch = async (url, opts) => {
  const u = String(url); const b = JSON.parse(opts?.body || '{}');
  if (/api\.telegram\.org/.test(u)) {
    if (/getUpdates/.test(u)) { const r = updates; updates = []; return { ok: true, status: 200, json: async () => ({ ok: true, result: r }) }; }
    if (/getMyShortDescription/.test(u)) return { ok: true, status: 200, json: async () => ({ ok: true, result: { short_description: '' } }) };
    tg.push({ method: u.split('/').pop(), ...b });
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 100 + tg.length, username: 'haf_bot' } }) };
  }
  if (/anthropic/.test(u)) {
    claude.push(b);
    if (claudeFail) return { ok: false, status: 401, json: async () => ({ error: { message: 'invalid x-api-key' } }) };
    const ids = [...String(b.messages[0].content).matchAll(/THREAD (\d+):/g)].map((m) => m[1]);
    const text = JSON.stringify({ threads: ids.map((id) => ({ id, asked: `What thread ${id} asked.`, said: [{ point: 'check the GEO is allowed', n: 3 }], back: '', gap: 'Nobody named a network.' })) });
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text }], usage: { input_tokens: 900, output_tokens: 200 }, stop_reason: 'end_turn' }) };
  }
  return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }), text: async () => '<html></html>' };
};
const { DEFAULT_CONFIG, CONFIG_VERSION } = await import('../src/config.js');
const bg = await import('../src/background.js');
let fails = 0;
const ok = (n, c, e) => { if (!c) fails++; console.log(`${c ? '  ok' : 'FAIL'}  ${n}${c || e === undefined ? '' : `  -> ${JSON.stringify(e).slice(0, 320)}`}`); };

bags.local.vault = { tgToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef', key: 'sk-ant-test-key-000', savedAt: 1 };
bags.sync.vault = { key: 'sk-ant-test-key-000', savedAt: 1 };
bags.local.config = { ...DEFAULT_CONFIG, configVersion: CONFIG_VERSION, enabled: true, telegramEnabled: true, telegramApprovals: true, telegramChatId: '999', bhwUsername: 'bargainbed' };
const leadsBefore = JSON.stringify(bags.local.recentLeads || null);

// --- one run: 8 sections, 3 cards -------------------------------------------------------------
let r = await bg.runRadar({ fast: true });
const cards = tg.filter((m) => m.method === 'sendMessage');
ok('the run reads the 8 section pages and sends 3 cards', r.ok && r.sent === 3 && opened.filter((u) => /\/forums\/\d+\/$/.test(u)).length === 8, { r, n: opened.length });
ok('Hire a Freelancer and the Marketplace are never opened', !opened.some((u) => /hire-a-freelancer|forums\/76\/|marketplace|want-to-buy/i.test(u)), opened);
ok('each card is its own message with Open / I replied / Not relevant', cards.length === r.sent && cards.every((c) => c.reply_markup?.inline_keyboard?.[0]?.[0]?.url && /^rr:\d+$/.test(c.reply_markup.inline_keyboard[1][0].callback_data) && /^rx:\d+$/.test(c.reply_markup.inline_keyboard[1][1].callback_data)), cards.map((c) => c.reply_markup));
ok('the first card is the best pick and every card carries the day\'s count', /1 of \d · ⭐ best pick/.test(cards[0].text) && cards.every((c) => /Public replies today: <b>0 of 10<\/b>/.test(c.text)), cards[0]?.text);
ok('Claude was asked once for the whole batch, and its summary is on the cards', claude.length === 1 && cards.some((c) => /<b>Asked:<\/b> What thread \d+ asked\./.test(c.text) && /Already said:<\/b> check the GEO is allowed \(3\)/.test(c.text) && /Missing:<\/b> Nobody named a network\./.test(c.text)), cards[0]?.text);
ok('a thread that already has your reply inside is dropped, not sent', !cards.some((c) => /which cloaking services/.test(c.text)) && !!bags.local.radar.replied['10'] && !bags.local.radar.queue['10']);
ok('a long thread is read on its first and last page only', opened.includes('https://www.blackhatworld.com/seo/t.20/') ? opened.includes('https://www.blackhatworld.com/seo/t.20/page-2') && !opened.some((u) => /t\.20\/page-[3-9]/.test(u)) : true, opened.filter((u) => /t\.20/.test(u)));
ok('nothing is written to HAF\'s leads', JSON.stringify(bags.local.recentLeads || null) === leadsBefore);
ok('the batch is remembered: shown once, time kept, not running any more', bags.local.radar.lastBatch.ids.length === r.sent && !bags.local.radar.running && Object.values(bags.local.radar.queue).filter((q) => q.shown === 1).length === r.sent);

// --- the second hour: no thread opened twice when nothing changed, new threads first ------------
const before = { opened: opened.length, claude: claude.length };
tg = [];
r = await bg.runRadar({ fast: true });
const cards2 = tg.filter((m) => m.method === 'sendMessage');
ok('the second hour sends only what was not sent before - no card twice in a row', cards2.length === 1 && !cards.some((x) => x.text.split('\n')[2] === cards2[0].text.split('\n')[2]) && opened.length - before.opened === 8 + 1 + (/(Gambling Apps)/.test(cards2[0].text) ? 1 : 0), { t: cards2.map((c) => c.text.split('\n')[2]), n: opened.length - before.opened });
tg = []; r = await bg.runRadar({ fast: true });
ok('a third hour with nothing new sends nothing at all', r.sent === 0 && !tg.some((m) => m.method === 'sendMessage'), r);

// --- the buttons ---------------------------------------------------------------------------------
const firstId = cards[0].reply_markup.inline_keyboard[1][0].callback_data.split(':')[1];
const tap = async (data, messageId = 101) => { tg = []; updates = [{ update_id: Math.floor(Math.random() * 1e9), callback_query: { id: 'cb' + Math.random(), data, from: { id: 1 }, message: { message_id: messageId, chat: { id: 999 }, text: 'x' } } }]; await bg.pollTaps(); return tg; };
let out = await tap(`rr:${firstId}`);
ok('"I replied": the thread leaves the queue and today\'s count is 1', !bags.local.radar.queue[firstId] && !!bags.local.radar.replied[firstId] && Object.keys(bags.local.radar.counted).length === 1, bags.local.radar.counted);
ok('the card is rewritten in place with the new count, buttons gone', out.some((m) => m.method === 'editMessageText' && /Marked as replied · public replies today: <b>1 of 10<\/b>/.test(m.text) && m.reply_markup.inline_keyboard.length === 0), out);
ok('the tap is answered with a toast', out.some((m) => m.method === 'answerCallbackQuery' && /Today: 1 of 10/.test(m.text)), out.map((m) => m.method));
out = await tap(`rr:${firstId}`);
ok('tapping it twice does not count twice', Object.keys(bags.local.radar.counted).length === 1);
const otherId = Object.keys(bags.local.radar.queue)[0];
out = await tap(`rx:${otherId}`);
ok('"Not relevant": hidden for good, not counted', !bags.local.radar.queue[otherId] && !!bags.local.radar.hidden[otherId] && Object.keys(bags.local.radar.counted).length === 1 && out.some((m) => m.method === 'editMessageText' && /will not be shown again/.test(m.text)));
ok('Radar\'s buttons never reach the lead code (no "Did not recognise" or lead errors)', !out.some((m) => /recognise|lead/i.test(m.text || '')), out.map((m) => m.text));

// --- the words -----------------------------------------------------------------------------------
const say = async (text) => { tg = []; updates = [{ update_id: Math.floor(Math.random() * 1e9), message: { message_id: 5, text, chat: { id: 999 }, from: { id: 1 } } }]; await bg.pollTaps(); return tg.filter((m) => m.method === 'sendMessage').map((m) => m.text).join(' ||| '); };
out = await say('radar');
ok('"radar" says on/off, today\'s count and how many are waiting - one message', /Reply radar is ON · public replies today: 1 of 10/.test(out) && !/\|\|\|/.test(out), out);
out = await say('radar off');
ok('"radar off" switches it off', bags.local.radarCfg.on === false && /is OFF/.test(out), out);
out = await say('radar on');
ok('"radar on" switches it back on', bags.local.radarCfg.on === true && /is ON/.test(out));
out = await say('radar count 4');
ok('"radar count 4" corrects the day\'s number', /set to 4 of 10/.test(out), out);
out = await say('casino');
ok('HAF\'s own words still work: a plain word is still a search, not Radar', !/Reply radar/.test(out), out.slice(0, 120));

// --- Claude down: the cards still go, without the summary ------------------------------------------
bags.local.radar = undefined; delete bags.local.radar; claudeFail = true; tg = []; threadPosts = {};
r = await bg.runRadar({ fast: true });
const plain = tg.filter((m) => m.method === 'sendMessage');
ok('with Claude unavailable the cards are still sent, just without the summary', r.sent >= 2 && plain.length === r.sent && !plain.some((c) => /Asked:/.test(c.text)) && plain.every((c) => /Public replies today/.test(c.text)), { r, t: plain[0]?.text });
claudeFail = false;

// --- a wall: stop at once, send nothing, pause every reader ------------------------------------------
delete bags.local.radar; tg = []; blockAt = '/forums/175/';
const openedBefore = opened.length;
r = await bg.runRadar({ fast: true });
ok('a Cloudflare wall stops the sweep at that page and sends no cards', /blocked/i.test(r.error || '') && !tg.some((m) => m.method === 'sendMessage' && /Reply radar/.test(m.text || '')) && opened.length - openedBefore === 3, { r, n: opened.length - openedBefore });
ok('and the 30-minute pause HAF uses is set, so nothing keeps knocking', Number(bags.local.sourcesBackoffUntil) > Date.now() + 20 * 60000);
r = await bg.runRadar({ fast: true });
ok('while the pause holds, Radar opens nothing', r.skipped === 'wall' && opened.length - openedBefore === 3);
blockAt = null; delete bags.local.sourcesBackoffUntil;

// --- "Check BHW now" on the page reads and queues but sends nothing ---------------------------------
delete bags.local.radar; tg = [];
r = await bg.runRadar({ send: false, fast: true });
ok('send:false fills the queue and sends no card', r.ok && r.queued >= 3 && !tg.some((m) => m.method === 'sendMessage') && !bags.local.radar.lastBatch, r);

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
