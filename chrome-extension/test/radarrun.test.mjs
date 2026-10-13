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
    if (func.name === 'extractRadarSearch') {
      const term = decodeURIComponent((url.match(/keywords=([^&]+)/) || [])[1] || '');
      const d = (h) => new Date(now - h * 3600000).toISOString();
      const all = {
        casino: [{ threadId: '3001', url: 'https://www.blackhatworld.com/seo/casino-ads-on-tiktok.3001/', kind: 'thread', title: 'Casino ads on TikTok - anyone?', author: 'q1', at: d(5), replyCount: 2, forum: 'TikTok', snippet: 'Trying to run casino offers on TikTok, accounts keep dying' },
          { threadId: '3002', url: 'https://www.blackhatworld.com/seo/casino-seo-2026.3002/', kind: 'post', title: 'Casino SEO in 2026', author: 'p9', at: d(30), replyCount: 14, forum: 'Black Hat SEO', snippet: 'what works for casino keywords now' },
          { threadId: '3003', url: 'https://www.blackhatworld.com/seo/casino-links.3003/', kind: 'thread', title: '⭐ Casino backlinks $5 ⭐', author: 's', at: d(1), replyCount: 0, forum: 'SEO - Link building', snippet: 'buy now' },
          { threadId: '3004', url: 'https://www.blackhatworld.com/seo/need-casino-ads-guy.3004/', kind: 'thread', title: 'Need casino ads expert', author: 'b', at: d(1), replyCount: 9, forum: 'Hire a Freelancer', snippet: 'hiring' },
          { threadId: '1849411', url: 'https://www.blackhatworld.com/seo/x.1849411/', kind: 'post', title: 'Anyone still successfully running gambling niche ads on Meta?', author: 'z', at: d(50), replyCount: 11, forum: 'FaceBook', snippet: 'scan to clear' },
          { threadId: '3005', url: 'https://www.blackhatworld.com/seo/old-casino.3005/', kind: 'thread', title: 'Casino affiliate journey', author: 'o', at: d(400), replyCount: 3, forum: 'Making Money', snippet: 'old' }],
        gambling: [{ threadId: '3001', url: 'https://www.blackhatworld.com/seo/casino-ads-on-tiktok.3001/', kind: 'post', title: 'Casino ads on TikTok - anyone?', author: 'r', at: d(3), replyCount: 2, forum: 'TikTok', snippet: 'gambling creatives get flagged' },
          { threadId: '3006', url: 'https://www.blackhatworld.com/seo/gambling-push.3006/', kind: 'thread', title: 'Gambling offers on push traffic', author: 'g', at: d(20), replyCount: 4, forum: 'Media Buying', snippet: 'which push networks allow gambling' }],
        pbn: [{ threadId: '4001', url: 'https://www.blackhatworld.com/seo/pbn-2026.4001/', kind: 'thread', title: 'Is PBN still working in 2026?', author: 'n', at: d(8), replyCount: 6, forum: 'Black Hat SEO', snippet: 'deindexed twice' }],
        'expired domain': [{ threadId: '4002', url: 'https://www.blackhatworld.com/seo/expired.4002/', kind: 'thread', title: 'Where do you buy expired domains now?', author: 'e', at: d(12), replyCount: 3, forum: 'Black Hat SEO', snippet: 'auctions' }],
        cloaker: Array.from({ length: 10 }, (_, i) => ({ threadId: String(9100 + i), url: `https://www.blackhatworld.com/seo/c.${9100 + i}/`, kind: 'thread', title: i === 9 ? 'Cloaking my Instagram bio link?' : `Cloaker question ${i}: which one for ${['Meta', 'Google', 'TikTok', 'Bing', 'native', 'push', 'Snapchat', 'Taboola', 'Outbrain'][i]}?`, author: 'u', at: d(2 + i), replyCount: i === 0 ? 0 : i, forum: 'Cloaking', snippet: 'which cloaker' })),
        cloaking: [{ threadId: '9200', url: 'https://www.blackhatworld.com/seo/c.9200/', kind: 'post', title: 'Cloaking for Finance ads', author: 'q', at: d(1), replyCount: 6, forum: 'Cloaking', snippet: 'finance' }],
        'white page': []
      };
      return [{ result: { rows: all[term] || [], loggedIn: !globalThis.__signedOut, next: false } }];
    }
    if (func.name === 'extractForumList') return [{ result: { boards: [{ slug: 'white-hat-seo', id: '29', name: 'White Hat SEO' }, { slug: 'link-building', id: '48', name: 'Link Building' }, { slug: 'seo-link-building', id: '301', name: 'SEO - Link building' }, { slug: 'local-seo', id: '52', name: 'Local SEO' }, { slug: 'blogging', id: '16', name: 'Blogging' }], loggedIn: true } }];
    if (func.name === 'extractRadarListing' && /whats-new/.test(url)) {
      if (/whats-new\/threads/.test(url) && globalThis.__noThreadsPage) return [{ result: { rows: [], me: 'bargainbed', loggedIn: true } }];
      return [{ result: { rows: globalThis.__newRows || [], me: 'bargainbed', loggedIn: true } }];
    }
    if (func.name === 'extractRadarListing') { const id = (url.match(/forums\/(\d+)\//) || [])[1]; return [{ result: { rows: listings[id] || [], me: 'bargainbed', loggedIn: true } }]; }
    if (globalThis.__onThreadRead) { const f = globalThis.__onThreadRead; globalThis.__onThreadRead = null; await f(url); }
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
    const content = String(b.messages[0].content);
    if (/^NICHE: /.test(content)) {
      const ids = content.split('\n').slice(2).map((l) => l.split(' | ')[0].trim()).filter(Boolean);
      const scores = Object.fromEntries(ids.map((id) => [id, id === '9109' ? 2 : 9]));      // the Instagram bio-link one is off-niche
      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ scores }) }], usage: { input_tokens: 500, output_tokens: 80 }, stop_reason: 'end_turn' }) };
    }
    if (/^KEYWORD: /.test(content) && /expand one keyword/.test(b.system)) {
      const text = JSON.stringify({ terms: ['pbn', 'private blog network', 'expired domain', 'aged domain', 'deindexed'] });
      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text }], usage: { input_tokens: 100, output_tokens: 40 }, stop_reason: 'end_turn' }) };
    }
    if (/^KEYWORD: /.test(content)) {
      const ids = content.split('\n').slice(2).map((l) => l.split(' | ')[0].trim()).filter(Boolean);
      const half = Math.ceil(ids.length / 2);
      const text = JSON.stringify({ clusters: [{ name: 'Ads and accounts', why: 'Several asked this week', ids: ids.slice(0, half), asked: 'Starter asks about ad accounts dying.', need: 'What to check first and how to read the signals.' },
        ...(ids.length > half ? [{ name: 'SEO side', why: 'Quieter', ids: ids.slice(half), asked: 'What works for casino keywords.', need: 'Specifics, not generic tips.' }] : [])] });
      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text }], usage: { input_tokens: 600, output_tokens: 200 }, stop_reason: 'end_turn' }) };
    }
    const ids = [...content.matchAll(/THREAD (\d+):/g)].map((m) => m[1]);
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
const cards = tg.filter((m) => m.method === 'sendMessage' && m.reply_markup);
ok('the first cards of the day come after the list of words you can send', tg.filter((m) => m.method === 'sendMessage')[0]?.text.includes('what you can send') && tg.filter((m) => m.method === 'sendMessage' && /what you can send/.test(m.text)).length === 1, tg[0]?.text?.slice(0, 80));
ok('the run reads the 8 section pages and sends 3 cards', r.ok && r.sent === 3 && opened.filter((u) => /\/forums\/\d+\/$/.test(u)).length === 8, { r, n: opened.length });
ok('Hire a Freelancer and the Marketplace are never opened', !opened.some((u) => /hire-a-freelancer|forums\/76\/|marketplace|want-to-buy/i.test(u)), opened);
const kb = cards[0]?.reply_markup?.inline_keyboard || [];
ok('the batch is ONE message (1.14.1) with Open / I replied / Not relevant per thread', cards.length === 1 && r.sent === 3 && kb.length === 6 && kb[0][0].url && /^rr:\d+$/.test(kb[1][0].callback_data) && /^rx:\d+$/.test(kb[1][1].callback_data) && /I replied 3/.test(kb[5][0].text), kb);
ok('keyword ideas and the fixed code words close every message', /Try: next \w+ · next \w+/.test(cards[0].text) && cards[0].text.split('\n').pop() === 'Send: next &lt;word&gt; · new threads · mute &lt;word&gt; · radar · radar help', cards[0].text.split('\n').slice(-2));
ok('threads are numbered, the first is starred, and the day\'s count is on the message', /<b>1\. .+<\/b> ⭐/.test(cards[0].text) && /<b>3\. /.test(cards[0].text) && /Public replies today: <b>0 of 10<\/b>/.test(cards[0].text), cards[0]?.text);
ok('Claude was asked once for the whole batch, and its summary is in the message', claude.length === 1 && /Asked: What thread \d+ asked\./.test(cards[0].text) && /Already said: check the GEO is allowed \(3\)/.test(cards[0].text) && /Missing: Nobody named a network\./.test(cards[0].text), cards[0]?.text);
ok('a thread that already has your reply inside is dropped, not sent', !cards.some((c) => /which cloaking services/.test(c.text)) && !!bags.local.radar.replied['10'] && !bags.local.radar.queue['10']);
ok('a long thread is read on its first and last page only', opened.includes('https://www.blackhatworld.com/seo/t.20/') ? opened.includes('https://www.blackhatworld.com/seo/t.20/page-2') && !opened.some((u) => /t\.20\/page-[3-9]/.test(u)) : true, opened.filter((u) => /t\.20/.test(u)));
ok('nothing is written to HAF\'s leads', JSON.stringify(bags.local.recentLeads || null) === leadsBefore);
ok('the batch is remembered: shown once, time kept, not running any more', bags.local.radar.lastBatch.ids.length === r.sent && !bags.local.radar.running && Object.values(bags.local.radar.queue).filter((q) => q.shown === 1).length === r.sent);
const batchMsgId = 100 + tg.indexOf(cards[0]) + 1;
ok('the message is remembered with its threads, so a tap can redraw it', bags.local.radar.cards[String(batchMsgId)]?.ids.length === 3, Object.keys(bags.local.radar.cards));

// --- the second hour: no thread opened twice when nothing changed, new threads first ------------
const before = { opened: opened.length, claude: claude.length };
tg = [];
r = await bg.runRadar({ fast: true });
const cards2 = tg.filter((m) => m.method === 'sendMessage' && m.reply_markup);
ok('the help is not repeated on the same day', !tg.some((m) => /what you can send/.test(m.text || '')));
const titleOf = (t) => (t.match(/<b>1\. (?:<a href="[^"]+">)?(.+?)(?:<\/a>)?<\/b>/) || [])[1];
ok('the second hour sends only what was not sent before - no thread twice', cards2.length === 1 && /1 thread\b/.test(cards2[0].text) && !cards[0].text.includes(titleOf(cards2[0].text)) && opened.length - before.opened === 8 + 1 + (/(Gambling Apps)/.test(cards2[0].text) ? 1 : 0), { t: titleOf(cards2[0].text), n: opened.length - before.opened });
tg = []; r = await bg.runRadar({ fast: true });
ok('a third hour with nothing new sends nothing at all', r.sent === 0 && !tg.some((m) => m.method === 'sendMessage'), r);

// --- the buttons ---------------------------------------------------------------------------------
const firstId = cards[0].reply_markup.inline_keyboard[1][0].callback_data.split(':')[1];
const tap = async (data, messageId = batchMsgId) => { tg = []; updates = [{ update_id: Math.floor(Math.random() * 1e9), callback_query: { id: 'cb' + Math.random(), data, from: { id: 1 }, message: { message_id: messageId, chat: { id: 999 }, text: 'x' } } }]; await bg.pollTaps(); return tg; };
let out = await tap(`rr:${firstId}`);
ok('"I replied": the thread leaves the queue and today\'s count is 1', !bags.local.radar.queue[firstId] && !!bags.local.radar.replied[firstId] && Object.keys(bags.local.radar.counted).length === 1, bags.local.radar.counted);
ok('the message is redrawn in place: that thread marked ✅ replied, its two buttons gone, count 1 of 10, the other two threads untouched', out.some((m) => m.method === 'editMessageText' && /✅ replied/.test(m.text) && /Public replies today: <b>1 of 10<\/b>/.test(m.text) && m.reply_markup.inline_keyboard.length === 5 && /<b>2\. /.test(m.text)), out.find((m) => m.method === 'editMessageText'));
ok('the tap is answered with a toast', out.some((m) => m.method === 'answerCallbackQuery' && /Today: 1 of 10/.test(m.text)), out.map((m) => m.method));
out = await tap(`rr:${firstId}`);
ok('tapping it twice does not count twice', Object.keys(bags.local.radar.counted).length === 1);
const otherId = bags.local.radar.cards[String(batchMsgId)].ids[1];
out = await tap(`rx:${otherId}`);
ok('"Not relevant": hidden for good, not counted, and the message keeps all 3 threads with that one marked ⏭ hidden', !bags.local.radar.queue[otherId] && !!bags.local.radar.hidden[otherId] && Object.keys(bags.local.radar.counted).length === 1 && out.some((m) => m.method === 'editMessageText' && /⏭ hidden/.test(m.text) && /3 threads/.test(m.text) && /✅ replied/.test(m.text) && m.reply_markup.inline_keyboard.length === 4), out.find((m) => m.method === 'editMessageText')?.text);
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

// --- 1.14 GROW: a tap during a running sweep was lost ------------------------------------------
// The run held its copy of the queue for minutes; "I replied" wrote to storage in between; the
// run then wrote the stale copy back and the thread came in the next batch.
{
  delete bags.local.radar; tg = []; threadPosts = { 10: [{ author: 'BargainBed', text: 'mine' }] };
  let tapped = '';
  globalThis.__onThreadRead = async () => {                 // while the run is reading its first thread page...
    const st0 = bags.local.radar; const pick = Object.values(st0.queue).find((q) => q.threadId === '20') ? '20' : Object.keys(st0.queue)[0];
    tapped = pick;
    updates = [{ update_id: 77, callback_query: { id: 'cb77', data: `rr:${pick}`, from: { id: 1 }, message: { message_id: 500, chat: { id: 999 }, text: 'x' } } }];
    await bg.pollTaps();                                      // ...you tap "I replied" on one of the queued threads
  };
  r = await bg.runRadar({ fast: true });
  const sentText = tg.filter((m) => m.method === 'sendMessage' && m.reply_markup).map((m) => m.text).join('\n');
  ok('a thread marked replied during the sweep is not sent in that batch', tapped && !sentText.includes(bags.local.radar.replied[tapped]?.title || '@@'), { tapped, replied: Object.keys(bags.local.radar.replied) });
  ok('and it stays replied and counted after the run has written its state', !!bags.local.radar.replied[tapped] && !bags.local.radar.queue[tapped] && Object.keys(bags.local.radar.counted).includes(tapped), bags.local.radar.counted);
  tg = []; r = await bg.runRadar({ fast: true });
  ok('the next sweep does not bring it back either', !bags.local.radar.queue[tapped] && !tg.some((m) => m.method === 'sendMessage' && m.text.includes(bags.local.radar.replied[tapped].title)));
  threadPosts = {};
}

// --- Claude down: the cards still go, without the summary ------------------------------------------
bags.local.radar = undefined; delete bags.local.radar; claudeFail = true; tg = []; threadPosts = {};
r = await bg.runRadar({ fast: true });
const plain = tg.filter((m) => m.method === 'sendMessage' && m.reply_markup);
ok('with Claude unavailable the message still goes, just without the summary', r.sent >= 2 && plain.length === 1 && !/Asked:/.test(plain[0].text) && /Public replies today/.test(plain[0].text), { r, t: plain[0]?.text });
claudeFail = false;

// --- a wall: stop at once, send nothing, pause every reader ------------------------------------------
delete bags.local.radar; tg = []; blockAt = '/forums/175/';
const openedBefore = opened.length;
r = await bg.runRadar({ fast: true });
ok('a Cloudflare wall stops the sweep at that page and sends no cards', /blocked/i.test(r.error || '') && !tg.some((m) => m.method === 'sendMessage' && m.reply_markup) && opened.length - openedBefore === 3, { r, n: opened.length - openedBefore });
ok('and the 30-minute pause HAF uses is set, so nothing keeps knocking', Number(bags.local.sourcesBackoffUntil) > Date.now() + 20 * 60000);
r = await bg.runRadar({ fast: true });
ok('while the pause holds, Radar opens nothing', r.skipped === 'wall' && opened.length - openedBefore === 3);
blockAt = null; delete bags.local.sourcesBackoffUntil;

// --- "Check BHW now" on the page reads and queues but sends nothing ---------------------------------
delete bags.local.radar; tg = [];
r = await bg.runRadar({ send: false, fast: true });
ok('send:false fills the queue and sends no card', r.ok && r.queued >= 3 && !tg.some((m) => m.method === 'sendMessage') && !bags.local.radar.lastBatch, r);

// --- 1.14: "next casino" - live search, clusters, never twice -------------------------------------
{
  delete bags.local.radar; bags.local.radarCfg = { on: true }; tg = []; claude = []; opened.length = 0;
  let out = await say('next casino');
  const cards = tg.filter((m) => m.method === 'sendMessage' && m.reply_markup);
  ok('"next casino" searches the family terms on BHW and sends ONE message with the clusters', cards.length === 1 && /🔎 <b>next casino<\/b> · 2 clusters/.test(cards[0].text) && /<b>1\. Ads and accounts<\/b>/.test(cards[0].text) && /<b>2\. SEO side<\/b>/.test(cards[0].text), { n: cards.length, first: cards[0]?.text });
  ok('the known casino family is used without a Claude call for it', !claude.some((c) => /expand one keyword/.test(c.system)) && opened.filter((u) => /search\/search\?keywords=/.test(u)).length === 5, opened.filter((u) => /keywords=/.test(u)).map((u) => decodeURIComponent(u.match(/keywords=([^&]+)/)[1])));
  ok('search is limited to the last 7 days', opened.every((u) => !/keywords=/.test(u) || /c\[newer_than\]=\d{4}-\d{2}-\d{2}/.test(u)));
  const txt = cards.map((c) => c.text).join('\n');
  ok('Hire a Freelancer and sales rows are left out, a thread 400 days old is left out', !/casino ads expert/.test(txt) && !/Casino backlinks \$5/.test(txt) && !/affiliate journey/.test(txt));
  ok('a thread found by two terms appears once', (txt.match(/Casino ads on TikTok/g) || []).length === 1, txt);
  ok('each cluster: name, why, best thread with asked / covers, more links; buttons per cluster; count and keyword ideas at the end', /Several asked this week/.test(cards[0].text) && /Asked: /.test(cards[0].text) && /A good reply covers: /.test(cards[0].text) && /Public replies today/.test(cards[0].text) && /Try: next /.test(cards[0].text) && !/next casino ·/.test(cards[0].text.split('\n').slice(-2)[0]) && /^Send: next/.test(cards[0].text.split('\n').pop()) && cards[0].reply_markup.inline_keyboard.length === 4, cards[0].text);
  const sentIds = Object.keys(bags.local.radar.sent || {});
  ok('every thread shown is remembered as sent', sentIds.includes('3001') && sentIds.includes('3002') && sentIds.includes('3006'), sentIds);
  tg = []; out = await say('next casino');
  ok('"next casino" again never repeats: nothing new is left, and it says so', !tg.some((m) => m.reply_markup) && /Nothing new for <b>casino<\/b>/.test(out), out.slice(0, 160));
  tg = []; claude = []; out = await say('next linkwheel 2');
  ok('an unknown keyword gets a family from Claude once, shown to you, then searched', claude.some((c) => /expand one keyword/.test(c.system)) && /Searching <b>linkwheel<\/b> as: linkwheel, pbn, private blog network, expired domain/.test(out) && bags.local.radarCfg.families.linkwheel.includes('aged domain'), out.slice(0, 200));
  ok('and the PBN message comes', tg.filter((m) => m.reply_markup).length === 1 && tg.some((m) => /Is PBN still working/.test(m.text)));
  out = await say('family linkwheel');
  ok('"family linkwheel" shows the saved family', /<b>linkwheel<\/b> searches as: linkwheel, pbn, private blog network/.test(out), out);
  out = await say('add linkwheel domain authority');
  ok('"add" extends it', bags.local.radarCfg.families.linkwheel.includes('domain authority') && /domain authority/.test(out));
  out = await say('drop linkwheel deindexed');
  ok('"drop" removes a term', !bags.local.radarCfg.families.linkwheel.includes('deindexed'));
  out = await say('mute affiliate journey');
  ok('"mute" saves the word', bags.local.radarCfg.muted.includes('affiliate journey') && /Muted words: affiliate journey/.test(out));
  out = await say('unmute affiliate journey');
  ok('"unmute" removes it', !bags.local.radarCfg.muted.length);
  tg = []; out = await say('next 5');
  ok('"next 5" is still HAF\'s own command, not a Radar search', !/🔎/.test(out) && !tg.some((m) => m.reply_markup && /cluster/.test(m.text)), out.slice(0, 100));
  tg = []; out = await say('next reset');
  ok('"next reset" is still HAF\'s too', !/🔎/.test(out));
  out = await say('radar help');
  ok('"radar help" lists every word you can send', /next casino/.test(out) && /mute/.test(out) && /radar count/.test(out) && /I replied/.test(out));
  for (let i = 0; i < 9; i++) bags.local.radar.searchLog = [...(bags.local.radar.searchLog || []), Date.now()];
  out = await say('next crypto');
  ok('the 11th live search in an hour is refused', /Ten live searches already this hour/.test(out), out.slice(0, 100));
  bags.local.radar.searchLog = []; globalThis.__signedOut = true; tg = [];
  out = await say('next casino');
  ok('signed out of BHW: says so and falls back to the hourly sweep\'s matches instead of failing', /not signed in to BHW/.test(out), out.slice(0, 200));
  globalThis.__signedOut = false;
}

// --- 1.16: the 15-minute new-thread watch --------------------------------------------------------
{
  delete bags.local.radar; bags.local.radarCfg = { on: true }; tg = []; opened.length = 0;
  const NR = (id, title, o = {}) => ({ threadId: String(id), url: `https://www.blackhatworld.com/seo/n.${id}/`, title, author: 's', lastPoster: 's', forum: o.forum || 'Google Ads', forumNode: String(o.node ?? 83), startedAt: hAgo(o.start ?? 0.3), lastActivityAt: hAgo(o.start ?? 0.3), replyCount: o.rep ?? 0, views: 5, sticky: false, locked: false, mine: false, lastMine: false });
  globalThis.__newRows = [NR(7001, 'Google Ads account got limited after 3 days'), NR(7002, 'Casino traffic from push, who does it?', { forum: 'Media Buying', node: 175 }), NR(7003, 'Hello from Brazil', { forum: 'Introductions', node: 24 }), NR(7004, 'Need a casino ads guy', { forum: 'Hire a Freelancer', node: 76 })];
  let r = await bg.radarNewTick({ force: true });
  let msgs = tg.filter((m) => m.method === 'sendMessage');
  ok('the new-threads page is read and one message goes out with only the threads that are yours', r.sent === 2 && msgs.length === 1 && /🆕 <b>New threads<\/b>/.test(msgs[0].text) && /account got limited/.test(msgs[0].text) && /Casino traffic from push/.test(msgs[0].text) && !/Hello from Brazil|casino ads guy/.test(msgs[0].text), msgs[0]?.text);
  ok('only the What\'s new page is read, nothing else', opened.length === 1 && /whats-new\/$/.test(opened[0]), opened);
  ok('buttons per thread, and both are remembered as sent', msgs[0].reply_markup.inline_keyboard.length === 4 && !!bags.local.radar.sent['7001'] && !!bags.local.radar.sent['7002']);
  tg = []; r = await bg.radarNewTick({ force: true });
  ok('the next check with the same page sends nothing: only new ones ever', r.sent === 0 && !tg.some((m) => m.method === 'sendMessage'));
  globalThis.__newRows = [...globalThis.__newRows, NR(7005, 'Fresh: cloaker for Bing ads?', { forum: 'Cloaking', node: 2 })];
  tg = []; r = await bg.radarNewTick({ force: true });
  ok('a thread that appears later comes through, alone', r.sent === 1 && /cloaker for Bing/.test(tg[0].text) && !/account got limited/.test(tg[0].text));
  r = await bg.radarNewTick();
  ok('not due again inside 15 minutes', r.skipped === 'not due');
  bags.local.radar.newAt = Date.now() - 16 * 60000; r = await bg.radarNewTick();
  ok('due again after 15 minutes', r.ok === true);
  tg = []; r = await bg.runRadar({ fast: true });
  const hourly = tg.filter((m) => m.method === 'sendMessage' && m.reply_markup).map((m) => m.text).join('\n');
  ok('the hourly batch never repeats what the new-thread watch already sent', !/account got limited|Casino traffic from push|cloaker for Bing/.test(hourly));
  globalThis.__newRows = [NR(7006, 'VCC for Google Ads in 2026?')]; tg = []; opened.length = 0;
  r = await bg.radarNewTick({ force: true });
  ok('titles are tap-to-open links; no raw URL in the message', r.sent === 1 && /<a href="https:\/\/www\.blackhatworld\.com\/seo\/n\.7006\/">VCC for Google Ads/.test(tg[0].text) && !/^https:\/\//m.test(tg[0].text), tg[0]?.text);
  let out = await say('new threads off');
  ok('"new threads off" switches the watch off', bags.local.radarCfg.newWatch === false && /is OFF/.test(out));
  r = await bg.radarNewTick();
  ok('and the tick then does nothing', r.skipped === 'off');
  out = await say('new threads on');
  ok('"new threads on" switches it back', bags.local.radarCfg.newWatch === true);
  out = await say('new threads');
  ok('"new threads" alone checks right now and says when there is nothing new', /Nothing new since the last check/.test(out), out);
}

// --- 1.17: blocks, they answered you, brief N, the traffic line ----------------------------------
{
  delete bags.local.radar; bags.local.radarCfg = { on: true }; tg = []; claude = []; opened.length = 0;
  bags.local.pulseSamples = [{ ts: Date.now() - 60000, members: 1820, guests: 9100, total: 10920 }];
  listings[28] = [R(8001, 'Is PBN still working in 2026?', { start: 5, last: 1, rep: 0 }), R(8002, 'Expired domain checklist', { start: 300, last: 2, rep: 4 })];
  listings[29] = [R(8003, 'Core update recovery stories', { start: 30, last: 3, rep: 12 })];
  listings[219] = [...listings[219], { ...R(8004, 'I replied here and the buyer came back', { start: 50, last: 0.5, rep: 7 }), lastPoster: 'buyerx' }];
  bags.local.radar = { replied: { 8004: { at: Date.now() - 3 * 3600000, title: 'I replied here and the buyer came back', url: 'https://www.blackhatworld.com/seo/t.8004/', section: 'Facebook (PPC)' } }, counted: { 8004: new Date().toLocaleDateString('en-CA') } };
  let r = await bg.runBlock('ads', { force: true, fast: true });
  let msgs = tg.filter((m) => m.method === 'sendMessage');
  const blockMsg = msgs.find((m) => /📋 <b>Ads block<\/b>/.test(m.text));
  ok('the Ads block reads page 1 of its boards and sends one message split by board', r.ok && r.sent >= 3 && blockMsg && /10 boards/.test(blockMsg.text) && /<b>Facebook \(PPC\)<\/b>/.test(blockMsg.text) && opened.filter((u) => /\/forums\/\d+\/$/.test(u)).length === 10, { r, t: blockMsg?.text?.slice(0, 300) });
  ok('HOT tag on the 0-reply thread, titles are links, no raw URL', /🔥 HOT · <a href="[^"]+">Best virtual credit cards/.test(blockMsg.text) && !/^https:\/\//m.test(blockMsg.text), blockMsg.text);
  ok('the traffic line closes the message, and brief is in the code words', /📈 BHW now: 1,820 members/.test(blockMsg.text) && /brief 3/.test(blockMsg.text.split('\n').pop()), blockMsg.text.split('\n').slice(-3));
  ok('a thread you replied in that got a new post comes as a separate "They answered you" message', r.back >= 1 && msgs.some((m) => /📬 <b>They answered you<\/b>/.test(m.text) && /buyerx posted/.test(m.text)), msgs.map((m) => m.text.slice(0, 40)));
  ok('buttons per thread in message order', blockMsg.reply_markup.inline_keyboard.length === r.sent * 2);
  const ids1 = bags.local.radar.cards[String(bags.local.radar.lastMessageId)].ids;
  tg = []; r = await bg.runBlock('ads', { force: true, fast: true });
  ok('run again with the same pages: nothing repeats, no message', r.sent === 0 && !tg.some((m) => /📋/.test(m.text || '')), r);
  listings[219][1] = { ...listings[219][1], lastActivityAt: new Date().toISOString(), lastPoster: 'someone', replyCount: 1 };
  tg = []; r = await bg.runBlock('ads', { force: true, fast: true });
  ok('a shown thread with a new reply since comes back once, marked "new reply"', r.sent === 1 && /new reply/.test(tg.find((m) => /📋/.test(m.text)).text), tg[0]?.text);
  tg = []; opened.length = 0; r = await bg.runBlock('seo', { force: true, fast: true });
  const seoMsg = tg.find((m) => /📋 <b>SEO block<\/b>/.test(m.text || ''));
  ok('the SEO block resolves its slugs from BHW\'s forum list once, then reads those boards', r.ok && opened[0] === 'https://www.blackhatworld.com/forums/' && opened.includes('https://www.blackhatworld.com/forums/29/') && opened.includes('https://www.blackhatworld.com/forums/48/') && !opened.includes('https://www.blackhatworld.com/forums/301/') && bags.local.radarCfg.forumList.length === 5 && opened.includes('https://www.blackhatworld.com/forums/16/'), opened);
  ok('and sends its own message with the PBN thread HOT', seoMsg && /🔥 HOT · <a href="[^"]+">Is PBN still working/.test(seoMsg.text) && /5 boards/.test(seoMsg.text), seoMsg?.text?.slice(0, 200));
  tg = []; opened.length = 0; r = await bg.runBlock('seo', { force: true, fast: true });
  ok('the forum list is not read again', !opened.includes('https://www.blackhatworld.com/forums/'));
  // brief N on the last message
  const lastIds = bags.local.radar.cards[String(bags.local.radar.lastMessageId)]?.ids || ids1;
  tg = []; claude = [];
  let out = await say('brief 1');
  ok('"brief 1" reads that thread, asks Claude once and answers with asked / already said / missing and an Open button', claude.length === 1 && /📝 <b>/.test(out) && /Asked: /.test(out) && /Already said: /.test(out) && tg.some((m) => m.reply_markup && m.reply_markup.inline_keyboard[0][0].url), out.slice(0, 200));
  out = await say('brief 9');
  ok('a number past the message says so', /No thread 9 in the last message/.test(out));
  // the schedule: blocks run once an hour from their minute; the old hourly batch is no longer scheduled
  bags.local.radar.blockRuns = {}; tg = []; opened.length = 0;
  bags.local.radarCfg = { ...bags.local.radarCfg, blocks: [{ id: 'ads', name: 'Ads block', minute: 0, on: true, boards: [{ id: 219, name: 'Facebook (PPC)' }] }, { id: 'seo', name: 'SEO block', minute: 30, on: true, boards: [{ id: 28, name: 'Black Hat SEO' }] }] };   // opt-in since 1.18
  const realNow = Date.now; const at = (min) => { const d = new Date(); d.setMinutes(min, 0, 0); return d.getTime(); };
  Date.now = () => at(2);
  await bg.__blocksTickForTest(); await new Promise((r) => setTimeout(r, 300));
  ok('at :02 the Ads block starts (its minute is :00) and the SEO block waits for :30', (bags.local.radar.blockRuns || {}).ads && !(bags.local.radar.blockRuns || {}).seo);
  await bg.__blocksTickForTest(); await new Promise((r) => setTimeout(r, 200));
  ok('a second tick in the same hour does not run it again', Math.floor(((bags.local.radar.blockRuns || {}).ads || 0) / 3600000) === Math.floor(Date.now() / 3600000) && !(bags.local.radar.blockRuns || {}).seo && opened.filter((u) => /forums\/219\//.test(u)).length === 1, opened.length);
  Date.now = () => at(31);
  await bg.__blocksTickForTest(); await new Promise((r) => setTimeout(r, 300));
  ok('at :31 the SEO block runs', !!(bags.local.radar.blockRuns || {}).seo);
  Date.now = realNow;
  delete bags.local.radarCfg.blocks;
  out = await say('block ads');
  ok('"block ads" runs it now (or says nothing new)', /Nothing new in that block|📋/.test(out) || tg.some((m) => /📋/.test(m.text || '')), out.slice(0, 80));
  out = await say('radar now');
  ok('"radar now" runs the Ads block, not the old batch', /Ads block/.test(out) || tg.some((m) => /📋 <b>Ads block/.test(m.text || '')), out.slice(0, 80));
  delete listings[28]; delete listings[29]; listings[219].pop();
}

// --- 1.18: families ---------------------------------------------------------------------------------
{
  delete bags.local.radar; bags.local.radarCfg = { on: true }; tg = []; claude = []; opened.length = 0;
  listings[2] = [R(9301, 'Whats the longest payment processor cloaking worked for you?', { start: 100, last: 100, rep: 0 }), R(9302, 'Stripe cloaking for peps', { start: 52, last: 50, rep: 2 })];
  let r = await bg.runFamily('cloaker', { force: true, fast: true });
  let msgs = tg.filter((m) => m.method === 'sendMessage');
  const fm = msgs.find((m) => /🛡 <b>Cloaker<\/b>/.test(m.text || ''));
  ok('a family run: 3 rotating terms searched, the home board read, one message', r.ok && opened.filter((u) => /search\/search\?keywords=/.test(u)).length === 3 && opened.includes('https://www.blackhatworld.com/forums/2/') && !!fm, { r, opened });
  ok('the terms were the first three of the family and the window is 14 days', r.terms.join() === 'cloaker,cloaking,white page' && opened.filter((u) => /keywords=/.test(u)).every((u) => /newer_than\]=/.test(u)) && bags.local.radar.termIdx.cloaker === 3);
  ok('more than 8 found, so Claude gated them once: the off-niche Instagram thread is out, scores are shown', claude.length === 1 && r.found >= 10 && r.gated === 1 && !/Instagram bio/.test(fm.text) && /fit 9\/10/.test(fm.text), { r, t: fm.text.slice(0, 200) });
  ok('HOT first (the 0-reply board thread or the 0-reply search thread), at most 8, the rest held', /1\. 🔥 HOT · /.test(fm.text) && r.sent === 8 && r.held >= 2 && (bags.local.radar.held.cloaker || []).length === r.held, { sent: r.sent, held: r.held });
  ok('the funnel line, the count, the traffic line and the code words close it', /Found \d+ · gated 1 · sent 8 · held \d+/.test(fm.text) && /Public replies today/.test(fm.text) && /more cloaker/.test(fm.text.split('\n').pop()), fm.text.split('\n').slice(-4));
  ok('buttons per thread', fm.reply_markup.inline_keyboard.length === 16);
  const heldSnapshot = (bags.local.radar.held.cloaker || [])[0];
  tg = []; r = await bg.runFamily('cloaker', { force: true, fast: true });
  const fm2 = tg.find((m) => /🛡 <b>Cloaker<\/b>/.test(m.text || ''));
  ok('the next run rotates to the next three terms; fresh threads first, and a thread sent before only as a marked seen-before top-up', r.terms.join() === 'safe page,money page,bot filter' && r.ok && fm2 && /1\. .*Stripe cloaking for peps/.test(fm2.text) && /payment processor cloaking worked.*· seen before/.test(fm2.text), { r, t: fm2?.text?.slice(0, 260) });
  tg = []; r = await bg.runFamily('cloaker', { force: true, fast: true });
  const fm3 = tg.find((m) => /🛡 <b>Cloaker<\/b>/.test(m.text || ''));
  ok('when fresh threads run out, seen-before threads top the message up to 3, marked', r.sent >= 1 && (r.sent >= 3 ? /seen before/.test(fm3.text) : true), { r, t: fm3?.text?.slice(0, 200) });
  // the schedule: one family per 20 minutes, pinned first when an hour has passed
  bags.local.radar.famAt = 0; bags.local.radar.famRuns = { cloaker: Date.now() - 61 * 60000, circumvent: Date.now() - 10 * 60000, casino: Date.now() - 30 * 60000 }; tg = [];
  await bg.__familiesTickForTest(); await new Promise((rs) => setTimeout(rs, 500));
  ok('the tick runs the pinned family that waited an hour', (bags.local.radar.famRuns || {}).cloaker > Date.now() - 60000);
  await bg.__familiesTickForTest();
  ok('and not another one inside 20 minutes', bags.local.radar.famAt > Date.now() - 60000 && Object.values(bags.local.radar.famRuns).filter((t) => t > Date.now() - 60000).length === 1);
  // commands
  let out = await say('families');
  ok('"families" lists the ten with terms, boards and pins', /🔎 <b>Families<\/b>/.test(out) && /<b>cloaker<\/b> 📌/.test(out) && /<b>pharma<\/b>/.test(out), out.slice(0, 200));
  out = await say('add cloaker mycloaker');
  ok('"add cloaker <word>" edits the engine family, not the search-only family', /<b>cloaker<\/b> now has 16 terms/.test(out) && bags.local.radarCfg.fams.find((f) => f.id === 'cloaker').terms.includes('mycloaker'), out.slice(0, 120));
  out = await say('drop cloaker mycloaker');
  ok('"drop" removes it', !bags.local.radarCfg.fams.find((f) => f.id === 'cloaker').terms.includes('mycloaker'));
  out = await say('pin pharma');
  ok('"pin pharma" makes it hourly', bags.local.radarCfg.fams.find((f) => f.id === 'pharma').pinned === true && /at least every hour/.test(out));
  out = await say('unpin pharma');
  ok('"unpin" undoes it', bags.local.radarCfg.fams.find((f) => f.id === 'pharma').pinned === false);
  tg = []; out = await say('run greyecom');
  ok('"run <family>" with nothing found says so with the count', /Nothing new for greyecom right now \(found 0\)/.test(out), out.slice(0, 120));
  out = await say('run nosuch');
  ok('an unknown family is refused', /No family "nosuch"/.test(out));
  // held -> send from the page
  bags.local.radar.held = { ...(bags.local.radar.held || {}), cloaker: heldSnapshot ? [heldSnapshot] : [] }; delete bags.local.radar.sent[heldSnapshot?.threadId];
  const heldOne = heldSnapshot;
  if (heldOne) {
    tg = [];
    const res = await new Promise((resolve) => globalThis.__onMessage({ cmd: 'radar-send-held', threadId: heldOne.threadId }, {}, resolve));
    ok('a held thread can be sent from the Radar page and is then remembered as sent', tg.some((m) => /Held thread, sent by you/.test(m.text || '') && m.reply_markup) && !!bags.local.radar.sent[heldOne.threadId] && !(bags.local.radar.held.cloaker || []).some((c) => c.threadId === heldOne.threadId), res && Object.keys(res));
  } else ok('held list has entries to test with', false, bags.local.radar.held);
  // blocks are opt-in now
  bags.local.radar.blockRuns = {}; opened.length = 0;
  await bg.__blocksTickForTest(); await new Promise((rs) => setTimeout(rs, 300));
  ok('the board blocks no longer run on their own (opt-in since the families took over)', !opened.length && !(bags.local.radar.blockRuns || {}).ads);
  delete listings[2];
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
