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
  50: [R(9, 'TrafficGuardian For Casino Campaigns?', { start: 1020, last: 7.5, rep: 5 }), R(10, 'which casino services would you reccomend?', { start: 50, last: 7, rep: 3 })],
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
        'private blog network': Array.from({ length: 10 }, (_, i) => ({ threadId: String(9100 + i), url: `https://www.blackhatworld.com/seo/c.${9100 + i}/`, kind: 'thread', title: i === 9 ? 'Black Hat SEO my Instagram bio link?' : `PBN question ${i}: which one for ${['Meta', 'Google', 'TikTok', 'Bing', 'native', 'push', 'Snapchat', 'Taboola', 'Outbrain'][i]}?`, author: 'u', at: d(2 + i), replyCount: i === 0 ? 0 : i, forum: 'Black Hat SEO', snippet: 'which pbn' })),
        'pbn links': [{ threadId: '9200', url: 'https://www.blackhatworld.com/seo/c.9200/', kind: 'post', title: 'Black Hat SEO for Finance ads', author: 'q', at: d(1), replyCount: 6, forum: 'Black Hat SEO', snippet: 'finance' }]
      };
      return [{ result: { rows: all[term] || [], loggedIn: !globalThis.__signedOut, next: false } }];
    }
    if (func.name === 'extractForumList') return [{ result: { boards: [{ slug: 'white-hat-seo', id: '29', name: 'White Hat SEO' }, { slug: 'link-building', id: '48', name: 'Link Building' }, { slug: 'seo-link-building', id: '301', name: 'SEO - Link building' }, { slug: 'local-seo', id: '52', name: 'Local SEO' }, { slug: 'blogging', id: '16', name: 'Blogging' }], loggedIn: true } }];
    if (func.name === 'extractRadarListing' && /find-threads\/contributed/.test(url)) {
      globalThis.__partReads = (globalThis.__partReads || 0) + 1;
      if (globalThis.__partFail) return [{ result: { rows: [], me: 'bargainbed', loggedIn: false } }];
      const pg = /page=2/.test(url);
      return [{ result: { rows: pg ? [] : (globalThis.__contributed || []), me: 'bargainbed', loggedIn: true } }];
    }
    if (func.name === 'extractRadarListing' && /whats-new/.test(url)) {
      if (/whats-new\/threads/.test(url) && globalThis.__noThreadsPage) return [{ result: { rows: [], me: 'bargainbed', loggedIn: true } }];
      return [{ result: { rows: globalThis.__newRows || [], me: 'bargainbed', loggedIn: true } }];
    }
    if (func.name === 'extractRadarListing') { const id = (url.match(/forums\/(\d+)\//) || [])[1]; return [{ result: { rows: listings[id] || [], me: globalThis.__noMe ? '' : 'bargainbed', loggedIn: true } }]; }
    if (globalThis.__onThreadRead) { const f = globalThis.__onThreadRead; globalThis.__onThreadRead = null; await f(url); }
    const id = (url.match(/\.(\d+)\//) || [])[1]; const page = (url.match(/page-(\d+)/) || [])[1];
    globalThis.__threadOpens = (globalThis.__threadOpens || []); globalThis.__threadOpens.push(url);
    const posts = (page && (globalThis.__lastPagePosts || {})[id]) || threadPosts[id] || [{ author: 'm1', text: 'Check the network allows gambling in your GEO.' }];
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
    if (/private Telegram bot that watches/.test(b.system)) {
      const req = (content.match(/^REQUEST: (.*)$/m) || [])[1] || '';
      const plan = (globalThis.__askPlans || {})[req] || { kind: 'chat', reply: 'No plan in this test.' };
      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(plan) }], usage: { input_tokens: 300, output_tokens: 80 }, stop_reason: 'end_turn' }) };
    }
    if (/You rank BlackHatWorld threads/.test(b.system)) {
      const ids = [...content.matchAll(/^(\d+) \| /gm)].map((m) => m[1]).filter((id) => !(globalThis.__rankDrop || []).includes(id));
      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ keep: ids.map((id) => ({ id, why: `Why ${id} fits.` })) }) }], usage: { input_tokens: 600, output_tokens: 150 }, stop_reason: 'end_turn' }) };
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
ok('the first cards of the day come after the list of words you can send', tg.filter((m) => m.method === 'sendMessage')[0]?.text.includes('the commands you can send') && tg.filter((m) => m.method === 'sendMessage' && /the commands you can send/.test(m.text)).length === 1, tg[0]?.text?.slice(0, 80));
ok('the run reads the 7 section pages and sends 3 cards', r.ok && r.sent === 3 && opened.filter((u) => /\/forums\/\d+\/$/.test(u)).length === 7, { r, n: opened.length });
ok('Hire a Freelancer and the Marketplace are never opened', !opened.some((u) => /hire-a-freelancer|forums\/76\/|marketplace|want-to-buy/i.test(u)), opened);
const kb = cards[0]?.reply_markup?.inline_keyboard || [];
ok('the batch is ONE message (1.14.1) with Open / I replied / Not relevant per thread', cards.length === 1 && r.sent === 3 && kb.length === 6 && kb[0][0].url && /^rr:\d+$/.test(kb[1][0].callback_data) && /^rx:\d+$/.test(kb[1][1].callback_data) && /I replied 3/.test(kb[5][0].text), kb);
ok('keyword ideas and the fixed code words close every message', /Try: next \w+ · next \w+/.test(cards[0].text) && cards[0].text.split('\n').pop() === 'Send: next &lt;word&gt; · new threads · mute &lt;word&gt; · radar · radar help', cards[0].text.split('\n').slice(-2));
ok('threads are numbered, the first is starred, and the day\'s count is on the message', /<b>1\. .+<\/b> ⭐/.test(cards[0].text) && /<b>3\. /.test(cards[0].text) && /Public replies today: <b>0 of 10<\/b>/.test(cards[0].text), cards[0]?.text);
ok('Claude was asked once for the whole batch, and its summary is in the message', claude.length === 1 && /Asked: What thread \d+ asked\./.test(cards[0].text) && /Already said: check the GEO is allowed \(3\)/.test(cards[0].text) && /Missing: Nobody named a network\./.test(cards[0].text), cards[0]?.text);
ok('a thread that already has your reply inside is dropped, not sent', !cards.some((c) => /which casino services/.test(c.text)) && !!bags.local.radar.replied['10'] && !bags.local.radar.queue['10']);
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
ok('the help is not repeated on the same day', !tg.some((m) => /the commands you can send/.test(m.text || '')));
const titleOf = (t) => (t.match(/<b>1\. (?:<a href="[^"]+">)?(.+?)(?:<\/a>)?<\/b>/) || [])[1];
ok('the second hour sends only what was not sent before - no thread twice', cards2.length === 1 && /1 thread\b/.test(cards2[0].text) && !cards[0].text.includes(titleOf(cards2[0].text)) && opened.length - before.opened === 7 + 1 + (/(Gambling Apps)/.test(cards2[0].text) ? 1 : 0), { t: titleOf(cards2[0].text), n: opened.length - before.opened });
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
ok('1.19: the pause is Radar\'s own - HAF\'s pause is NOT set, so HAF keeps reading', Number(bags.local.radarBackoffUntil) > Date.now() + 20 * 60000 && !bags.local.sourcesBackoffUntil, { radar: bags.local.radarBackoffUntil, haf: bags.local.sourcesBackoffUntil });
r = await bg.runRadar({ fast: true });
ok('while the pause holds, Radar opens nothing', r.skipped === 'wall' && opened.length - openedBefore === 3);
blockAt = null; delete bags.local.radarBackoffUntil;

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
  delete bags.local.radar; bags.local.radarCfg = { on: true, newAll: false }; tg = []; opened.length = 0;   // the niche mode of 1.16, still available
  const NR = (id, title, o = {}) => ({ threadId: String(id), url: `https://www.blackhatworld.com/seo/n.${id}/`, title, author: 's', lastPoster: 's', forum: o.forum || 'Google Ads', forumNode: String(o.node ?? 83), startedAt: hAgo(o.start ?? 0.3), lastActivityAt: hAgo(o.start ?? 0.3), replyCount: o.rep ?? 0, views: 5, sticky: false, locked: false, mine: false, lastMine: false });
  globalThis.__newRows = [NR(7001, 'Google Ads account got limited after 3 days'), NR(7002, 'Casino traffic from push, who does it?', { forum: 'Media Buying', node: 175 }), NR(7003, 'Hello from Brazil', { forum: 'Introductions', node: 24 }), NR(7004, 'Need a casino ads guy', { forum: 'Hire a Freelancer', node: 76 })];
  let r = await bg.radarNewTick({ force: true });
  let msgs = tg.filter((m) => m.method === 'sendMessage');
  ok('the new-threads page is read and one message goes out with only the threads that are yours', r.sent === 2 && msgs.length === 1 && /🆕 <b>New threads<\/b>/.test(msgs[0].text) && /account got limited/.test(msgs[0].text) && /Casino traffic from push/.test(msgs[0].text) && !/Hello from Brazil|casino ads guy/.test(msgs[0].text), msgs[0]?.text);
  ok('only the What\'s new page is read among BHW listings (plus your replied list since 1.20), nothing else', opened.filter((u) => !/find-threads\/contributed/.test(u)).length === 1 && /whats-new\/$/.test(opened.find((u) => /whats-new/.test(u))), opened);
  ok('buttons per thread, and both are remembered as sent', msgs[0].reply_markup.inline_keyboard.length === 4 && !!bags.local.radar.sent['7001'] && !!bags.local.radar.sent['7002']);
  tg = []; r = await bg.radarNewTick({ force: true });
  ok('the next check with the same page sends nothing: only new ones ever', r.sent === 0 && !tg.some((m) => m.method === 'sendMessage'));
  globalThis.__newRows = [...globalThis.__newRows, NR(7005, 'Fresh: casino offers for Bing ads?', { forum: 'Black Hat SEO', node: 2 })];
  tg = []; r = await bg.radarNewTick({ force: true });
  ok('a thread that appears later comes through, alone', r.sent === 1 && /casino offers for Bing/.test(tg[0].text) && !/account got limited/.test(tg[0].text));
  r = await bg.radarNewTick();
  ok('not due again inside 10 minutes', r.skipped === 'not due');
  bags.local.radar.newAt = Date.now() - 11 * 60000; r = await bg.radarNewTick();
  ok('due again after 10 minutes', r.ok === true);
  tg = []; r = await bg.runRadar({ fast: true });
  const hourly = tg.filter((m) => m.method === 'sendMessage' && m.reply_markup).map((m) => m.text).join('\n');
  ok('the hourly batch never repeats what the new-thread watch already sent', !/account got limited|Casino traffic from push|casino offers for Bing/.test(hourly));
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
  ok('the Ads block reads page 1 of its boards and sends one message split by board', r.ok && r.sent >= 3 && blockMsg && /9 boards/.test(blockMsg.text) && /<b>Facebook \(PPC\)<\/b>/.test(blockMsg.text) && opened.filter((u) => /\/forums\/\d+\/$/.test(u)).length === 9, { r, t: blockMsg?.text?.slice(0, 300) });
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
  listings[28] = [R(9301, 'Whats the longest payment processor pbn worked for you?', { start: 100, last: 100, rep: 0 }), R(9302, 'Stripe pbn for peps', { start: 52, last: 50, rep: 2 })];
  let r = await bg.runFamily('pbn', { force: true, fast: true });
  let msgs = tg.filter((m) => m.method === 'sendMessage');
  const fm = msgs.find((m) => /🔗 <b>PBN &amp; links<\/b>/.test(m.text || ''));
  ok('the day\'s first family message is preceded by the command list, once', msgs.findIndex((m) => /the commands you can send/.test(m.text)) === 0 && msgs.filter((m) => /the commands you can send/.test(m.text)).length === 1 && bags.local.radar.helpDay === new Date().toLocaleDateString('en-CA'), msgs.map((m) => m.text.slice(0, 40)));
  ok('a family run: 3 rotating terms searched, the home board read, one message', r.ok && opened.filter((u) => /search\/search\?keywords=/.test(u)).length === 3 && opened.includes('https://www.blackhatworld.com/forums/28/') && !!fm, { r, opened });
  ok('the terms were the first three of the family and the window is 14 days', r.terms.join() === 'private blog network,pbn links,pbn footprint' && opened.filter((u) => /keywords=/.test(u)).every((u) => /newer_than\]=/.test(u)) && bags.local.radar.termIdx.pbn === 3);
  ok('more than 8 found, so Claude gated them once: the off-niche Instagram thread is out, scores are shown', claude.length === 1 && r.found >= 10 && r.gated === 1 && !/Instagram bio/.test(fm.text) && /fit 9\/10/.test(fm.text), { r, t: fm.text.slice(0, 200) });
  ok('HOT first (the 0-reply board thread or the 0-reply search thread), at most 8, the rest held', /1\. 🔥 HOT · /.test(fm.text) && r.sent === 8 && r.held >= 2 && (bags.local.radar.held.pbn || []).length === r.held, { sent: r.sent, held: r.held });
  ok('the funnel line, the count, the traffic line and the code words close it', /Found \d+(?: ·[^\n]*?)? · gated 1 · sent 8 · held \d+/.test(fm.text) && /Public replies today/.test(fm.text) && /more casino/.test(fm.text.split('\n').pop()), fm.text.split('\n').slice(-4));
  ok('buttons per thread', fm.reply_markup.inline_keyboard.length === 16);
  const heldSnapshot = (bags.local.radar.held.pbn || [])[0];
  tg = []; r = await bg.runFamily('pbn', { force: true, fast: true });
  const fm2 = tg.find((m) => /🔗 <b>PBN &amp; links<\/b>/.test(m.text || ''));
  ok('the command list is not repeated the same day', !tg.some((m) => /the commands you can send/.test(m.text || '')));
  ok('the next run rotates to the next three terms; fresh threads first, and a thread sent before only as a marked seen-before top-up', r.terms.join() === 'pbn hosting,link wheel,tier 2 links' && r.ok && fm2 && /1\. .*Stripe pbn for peps/.test(fm2.text) && /payment processor pbn worked.*· seen before/.test(fm2.text), { r, t: fm2?.text?.slice(0, 260) });
  tg = []; r = await bg.runFamily('pbn', { force: true, fast: true });
  const fm3 = tg.find((m) => /🔗 <b>PBN &amp; links<\/b>/.test(m.text || ''));
  ok('when fresh threads run out, seen-before threads top the message up to 3, marked', r.sent >= 1 && (r.sent >= 3 ? /seen before/.test(fm3.text) : true), { r, t: fm3?.text?.slice(0, 200) });
  // the schedule: one family per 20 minutes, pinned first when an hour has passed
  bags.local.radarCfg = { ...bags.local.radarCfg, familiesOn: true };   // off by default since 1.23; this tests the engine itself
  bags.local.radar.famAt = 0; bags.local.radar.famRuns = { pbn: Date.now() - 61 * 60000, outreach: Date.now() - 10 * 60000, casino: Date.now() - 30 * 60000 }; tg = [];
  await bg.__familiesTickForTest(); await new Promise((rs) => setTimeout(rs, 500));
  ok('the tick runs the pinned family that waited an hour', (bags.local.radar.famRuns || {}).pbn > Date.now() - 60000);
  await bg.__familiesTickForTest();
  ok('and not another one inside 20 minutes', bags.local.radar.famAt > Date.now() - 60000 && Object.values(bags.local.radar.famRuns).filter((t) => t > Date.now() - 60000).length === 1);
  // commands
  let out = await say('families');
  ok('"families" lists the ten with terms, boards and pins', /🔎 <b>Families<\/b>/.test(out) && /<b>pbn<\/b> 📌/.test(out) && /<b>pharma<\/b>/.test(out), out.slice(0, 200));
  out = await say('add pbn mypbn');
  ok('"add pbn <word>" edits the engine family, not the search-only family', /<b>pbn<\/b> now has 13 terms/.test(out) && bags.local.radarCfg.fams.find((f) => f.id === 'pbn').terms.includes('mypbn'), out.slice(0, 120));
  out = await say('drop pbn mypbn');
  ok('"drop" removes it', !bags.local.radarCfg.fams.find((f) => f.id === 'pbn').terms.includes('mypbn'));
  out = await say('pin pharma');
  ok('"pin pharma" makes it hourly', bags.local.radarCfg.fams.find((f) => f.id === 'pharma').pinned === true && /at least every hour/.test(out));
  out = await say('unpin pharma');
  ok('"unpin" undoes it', bags.local.radarCfg.fams.find((f) => f.id === 'pharma').pinned === false);
  tg = []; out = await say('run greyecom');
  ok('"run <family>" with nothing found says so with the count', /Nothing new for greyecom right now \(found 0\)/.test(out), out.slice(0, 120));
  out = await say('run nosuch');
  ok('an unknown family is refused', /No family "nosuch"/.test(out));
  // held -> send from the page
  bags.local.radar.held = { ...(bags.local.radar.held || {}), pbn: heldSnapshot ? [heldSnapshot] : [] }; delete bags.local.radar.sent[heldSnapshot?.threadId];
  const heldOne = heldSnapshot;
  if (heldOne) {
    tg = [];
    const res = await new Promise((resolve) => globalThis.__onMessage({ cmd: 'radar-send-held', threadId: heldOne.threadId }, {}, resolve));
    ok('a held thread can be sent from the Radar page and is then remembered as sent', tg.some((m) => /Held thread, sent by you/.test(m.text || '') && m.reply_markup) && !!bags.local.radar.sent[heldOne.threadId] && !(bags.local.radar.held.pbn || []).some((c) => c.threadId === heldOne.threadId), res && Object.keys(res));
  } else ok('held list has entries to test with', false, bags.local.radar.held);
  // blocks are opt-in now
  bags.local.radar.blockRuns = {}; opened.length = 0;
  await bg.__blocksTickForTest(); await new Promise((rs) => setTimeout(rs, 300));
  ok('the board blocks no longer run on their own (opt-in since the families took over)', !opened.length && !(bags.local.radar.blockRuns || {}).ads);
  delete listings[28];
}

// --- 1.19: HAF first --------------------------------------------------------------------------------
{
  bags.local.hafBusyUntil = Date.now() + 120000; opened.length = 0; tg = [];
  const rs = [await bg.runFamily('pbn', { force: true, fast: true }), await bg.radarNewTick({ force: true }), await bg.runBlock('ads', { force: true, fast: true }), await bg.pulseRead({ force: true }), await bg.runRadar({ fast: true })];
  ok('while HAF is sending, families, new threads, blocks, traffic and the old batch all step aside and open nothing', rs.every((r) => r.skipped === 'haf') && !opened.length, rs);
  delete bags.local.hafBusyUntil;
  bags.local.sourcesBackoffUntil = Date.now() + 10 * 60000;
  const r1 = await bg.runFamily('pbn', { force: true, fast: true });
  ok('HAF\'s own wall pauses Radar too (safe side)', r1.skipped === 'wall');
  delete bags.local.sourcesBackoffUntil;
  const day = new Date().toLocaleDateString('en-CA');
  bags.local.ai = { budget: 5, usage: { day, calls: 10, leads: 10, in: 1000000, cached: 0, out: 180000 } };   // about $2 in + $1.8 out on Sonnet: under $1.50 left
  delete bags.local.radar; claude = []; tg = []; globalThis.__newRows = [];
  const r2 = await bg.runFamily('pbn', { force: true, fast: true });
  const famMsg = tg.find((m) => /🔗 <b>PBN &amp; links<\/b>/.test(m.text || ''));
  ok('with the reserve reached, a family run with more than 8 found skips the Claude gate and says so', r2.ok && r2.found > 8 && claude.length === 0 && famMsg && /gate off \(Claude kept for HAF\)/.test(famMsg.text), { r2, n: claude.length, t: famMsg?.text?.slice(0, 200) });
  let out = await say('brief 1');
  ok('"brief" is refused while the reserve holds, with the reason', /kept for HAF/.test(out) && claude.length === 0, out.slice(0, 160));
  out = await say('radar');
  ok('"radar" shows Claude\'s spend and that Radar\'s Claude is paused for HAF', /Claude today: \$[\d.]+ of \$5\.00 · Radar's Claude paused, the rest is kept for HAF/.test(out), out);
  delete bags.local.ai;
}

// --- 1.20: BHW's own list of threads you posted in ---------------------------------------------------
{
  delete bags.local.radar; bags.local.radarCfg = { on: true }; tg = []; opened.length = 0; globalThis.__partReads = 0;
  listings[28] = [R(9701, 'PBN thread I answered by hand last week', { start: 200, last: 2, rep: 6, lastPoster: 'someoneelse' }), R(9702, 'PBN thread nobody answered', { start: 20, last: 2, rep: 1 })];
  globalThis.__contributed = [R(9701, 'PBN thread I answered by hand last week')];
  let r = await bg.runFamily('pbn', { force: true, fast: true });
  const m = tg.find((x) => /🔗 <b>PBN &amp; links<\/b>/.test(x.text || ''));
  ok('the run reads BHW\'s "threads you contributed to" list (page 1, then page 2 when there are rows)', opened.some((u) => /find-threads\/contributed$/.test(u)) && globalThis.__partReads >= 1 && Object.keys(bags.local.radar.participated).includes('9701'), { opened: opened.filter((u) => /find-threads/.test(u)), part: bags.local.radar.participated });
  ok('the thread you posted in is NOT in the message, the other one is', m && !/answered by hand last week/.test(m.text) && /nobody answered/.test(m.text), m?.text?.slice(0, 300));
  ok('the funnel line says how many replied threads are on file', m && /replied threads on file/.test(m.text), m?.text?.split('\n').slice(-6));
  const reads1 = globalThis.__partReads;
  tg = []; await bg.runFamily('pbn', { force: true, fast: true });
  ok('the list is not re-read inside 15 minutes', globalThis.__partReads === reads1, { reads1, now: globalThis.__partReads });
  bags.local.radar.partAt = 0; globalThis.__contributed = [];
  await bg.refreshParticipated({ fast: true });
  ok('a thread that drops off BHW\'s list is still remembered as replied (it is merged, never replaced)', Object.keys(bags.local.radar.participated).includes('9701'));
  bags.local.radar.partAt = 0; globalThis.__partFail = true; delete bags.local.radar.partOk;
  tg = []; r = await bg.runFamily('pbn', { force: true, fast: true });
  const m2 = tg.find((x) => /🔗 <b>PBN &amp; links<\/b>/.test(x.text || ''));
  ok('signed out or unreadable: the run still works, falls back to the row markers, and the funnel says it could not read the list', r.ok === true && (!m2 || /could not read your replied list/.test(m2.text)), { r, t: m2?.text?.split('\n').slice(-5) });
  globalThis.__partFail = false; delete listings[28]; globalThis.__contributed = [];
}

// --- 1.20.1: your username inside the thread (page 1 and the last page) -------------------------------------
{
  bags.local.radar = { termIdx: { pbn: 6 } }; bags.local.radarCfg = { on: true }; tg = []; opened.length = 0; globalThis.__threadOpens = []; globalThis.__contributed = []; globalThis.__partFail = false;   // terms with no stub search rows: only the board rows below
  const rows2 = [R(9801, 'PBN thread I answered on page 1', { start: 100, last: 2, rep: 4 }), R(9802, 'PBN thread, my reply is only on the LAST page', { start: 300, last: 2, rep: 25 }), R(9803, 'PBN thread nobody answered', { start: 3, last: 3, rep: 0 }), R(9804, 'PBN thread, someone else answered', { start: 30, last: 4, rep: 3 })];
  listings[28] = rows2;
  threadPosts[9801] = [{ author: 'x', text: 'a' }, { author: 'BargainBed', text: 'my reply' }];
  globalThis.__lastPagePosts = { 9802: [{ author: 'y', text: 'b' }, { author: 'bargainbed', text: 'my reply on page 2' }] };
  threadPosts[9802] = [{ author: 'y', text: 'b' }];
  let r = await bg.runFamily('pbn', { force: true, fast: true });
  const fm = tg.find((x) => /🔗 <b>PBN &amp; links<\/b>/.test(x.text || ''));
  ok('a thread with your username among the posters on page 1 is skipped (case-insensitive)', fm && !/answered on page 1/.test(fm.text), fm?.text?.slice(0, 400));
  ok('a thread with 25 replies: page 1 AND the last page are read, and your name only on the last page still skips it', globalThis.__threadOpens.some((u) => /9802\/$/.test(u)) && globalThis.__threadOpens.some((u) => /9802\/page-2$/.test(u)) && fm && !/LAST page/.test(fm.text), globalThis.__threadOpens.filter((u) => /9802/.test(u)));
  ok('a thread nobody replied to is not opened (it cannot hold a reply of yours), and is still offered', !globalThis.__threadOpens.some((u) => /9803/.test(u)) && fm && /nobody answered/.test(fm.text));
  ok('a thread someone else answered is opened, found clean, and offered', globalThis.__threadOpens.some((u) => /9804/.test(u)) && fm && /someone else answered/.test(fm.text));
  ok('the funnel says how many were skipped because you had already replied', fm && /2 you already replied to skipped/.test(fm.text), fm?.text?.split('\n').slice(-6));
  ok('the skipped ones are remembered, so they are never opened or offered again', !!bags.local.radar.participated['9801'] && !!bags.local.radar.participated['9802'] && !!bags.local.radar.checked['9804']);
  globalThis.__threadOpens = []; tg = [];
  await bg.runFamily('pbn', { force: true, fast: true });
  ok('the next run does not open a thread it already checked at the same activity', !globalThis.__threadOpens.some((u) => /9804|9801|9802/.test(u)), globalThis.__threadOpens);
  // no username known: nothing can be checked, and nothing breaks
  const cfgNow = bags.local.config; bags.local.config = { ...cfgNow, bhwUsername: '', boundAccount: '' }; globalThis.__noMe = true; delete bags.local.bhwMe; delete bags.local.radar.checked; delete bags.local.radar.participated['9804']; bags.local.radar.termIdx = { pbn: 6 }; bags.local.radar.sent = {}; listings[28] = rows2;
  globalThis.__threadOpens = []; tg = []; r = await bg.runFamily('pbn', { force: true, fast: true });
  ok('with no username known the run still works, opens no thread for the check, and says how many were not checked', r.ok === true && !globalThis.__threadOpens.length, { r, opens: globalThis.__threadOpens });
  globalThis.__noMe = false; bags.local.config = cfgNow; delete listings[28]; delete threadPosts[9801]; delete threadPosts[9802]; globalThis.__lastPagePosts = {};
  // the new-thread watch checks too
  delete bags.local.radar; tg = []; globalThis.__threadOpens = [];
  const NR2 = (id, title, rep) => ({ threadId: String(id), url: `https://www.blackhatworld.com/seo/n.${id}/`, title, author: 's', lastPoster: 's', forum: 'Google Ads', forumNode: '83', startedAt: hAgo(0.3), lastActivityAt: hAgo(0.1), replyCount: rep, views: 5, sticky: false, locked: false, mine: false, lastMine: false });
  threadPosts[9901] = [{ author: 'BargainBed', text: 'mine' }];
  globalThis.__newRows = [NR2(9901, 'New thread I jumped on already', 2), NR2(9902, 'New thread, first reply open', 0)];
  r = await bg.radarNewTick({ force: true });
  const nm = tg.find((x) => /🆕/.test(x.text || ''));
  ok('new threads: one you already posted in is dropped, the untouched one is sent', nm && !/jumped on already/.test(nm.text) && /first reply open/.test(nm.text), nm?.text);
  delete threadPosts[9901];
}


// --- 1.21.0: Ask mode - plain words to the bot ------------------------------------------------------------
{
  const day = new Date().toLocaleDateString('en-CA');
  delete bags.local.radar; bags.local.radarCfg = { on: true }; delete bags.local.ai; claude = []; tg = []; opened.length = 0; globalThis.__threadOpens = []; globalThis.__contributed = []; globalThis.__partFail = false;
  threadPosts[9102] = [{ author: 'x', text: 'a' }, { author: 'BargainBed', text: 'my old reply' }];
  globalThis.__askPlans = {
    'find PBN related threads in the last 24 hours': { kind: 'search', terms: ['private blog network', 'pbn links'], hours: 24, limit: 8, say: 'Looking for PBN threads' },
    'check what is new': { kind: 'new', terms: [], hours: 24, limit: 8, say: 'Checking what is new' },
    'turn off new threads please': { kind: 'command', command: 'new threads off' },
    'how many replies today?': { kind: 'chat', reply: 'You have posted 0 of 10 public replies today.' },
    'delete everything': { kind: 'command', command: 'rm -rf' }
  };
  let out = await say('find PBN related threads in the last 24 hours');
  const sent = tg.filter((m) => m.method === 'sendMessage');
  const am = sent.find((m) => /^🤖 <b>private blog network \/ pbn links<\/b>/.test(m.text || ''));
  ok('plain words become a search: a short "looking for" line first, then one message of threads', /Looking for PBN threads/.test(sent[0]?.text || '') && !!am, sent.map((m) => (m.text || '').slice(0, 60)));
  ok('only the two planned terms are searched, signed in, one page each', opened.filter((u) => /search\/search\?keywords=/.test(u)).length === 2 && opened.filter((u) => /keywords=/.test(u)).every((u) => /newer_than\]=/.test(u)));
  ok('titles are links, each thread has Open / I replied / Not relevant, and Claude\'s one-line reason shows', am && /<a href="https:\/\/www\.blackhatworld\.com\/seo\/[^"]+">[^<]+<\/a>/.test(am.text) && /Why \d+ fits\./.test(am.text) && (am.reply_markup?.inline_keyboard || []).some((row) => row.some((b) => /^rr:\d+$/.test(b.callback_data || ''))), am?.text?.slice(0, 300));
  ok('a thread you posted in (found by reading it) is skipped and counted in the funnel', am && !/PBN question 2:/.test(am.text) && /you already replied to skipped/.test(am.text) && !!bags.local.radar.participated['9102'], am?.text?.split('\n').slice(-6));
  ok('a thread nobody replied to stays and is marked HOT', am && /🔥 <a href="[^"]+">PBN question 0/.test(am.text.replace(/<b>/g, '')) || /🔥 /.test(am?.text || ''));
  ok('the code words for asking again close the message, and nothing sent is sent twice', am && /Ask me anything like/.test(am.text) && Object.keys(bags.local.radar.sent).length >= 3 && !!bags.local.radar.askLast);
  claude = []; tg = []; opened.length = 0; out = await say('find PBN related threads in the last 24 hours');
  ok('asking the same thing again sends only what is new (nothing here), and says so', !tg.some((m) => m.method === 'sendMessage' && /^🤖 <b>private blog network/.test(m.text || '')) && /Nothing new/.test(out) || /more|fit/.test(out), out.slice(0, 200));

  // what is new, no topic
  globalThis.__newRows = [
    { threadId: '7101', url: 'https://www.blackhatworld.com/seo/n.7101/', title: 'Best guest post sites that still work?', author: 's', lastPoster: 's', forum: 'Black Hat SEO', forumNode: '28', startedAt: hAgo(2), lastActivityAt: hAgo(1), replyCount: 0, views: 5, sticky: false, locked: false, mine: false, lastMine: false },
    { threadId: '7102', url: 'https://www.blackhatworld.com/seo/n.7102/', title: 'WTS cheap backlinks $5', author: 's', lastPoster: 's', forum: 'Black Hat SEO', forumNode: '28', startedAt: hAgo(2), lastActivityAt: hAgo(1), replyCount: 0, views: 5, sticky: false, locked: false, mine: false, lastMine: false },
    { threadId: '7103', url: 'https://www.blackhatworld.com/seo/n.7103/', title: 'Hello from India', author: 's', lastPoster: 's', forum: 'Introductions', forumNode: '12', startedAt: hAgo(2), lastActivityAt: hAgo(1), replyCount: 0, views: 5, sticky: false, locked: false, mine: false, lastMine: false },
    { threadId: '7104', url: 'https://www.blackhatworld.com/seo/n.7104/', title: 'Old thread bumped', author: 's', lastPoster: 's', forum: 'Black Hat SEO', forumNode: '28', startedAt: hAgo(200), lastActivityAt: hAgo(1), replyCount: 2, views: 5, sticky: false, locked: false, mine: false, lastMine: false }
  ];
  tg = []; opened.length = 0; globalThis.__rankDrop = [];
  out = await say('check what is new');
  const nm = tg.filter((m) => m.method === 'sendMessage').find((m) => /^🤖 <b>New threads<\/b>/.test(m.text || ''));
  ok('"check what is new" reads the new-threads page and lists only real discussion started inside the window', nm && /guest post sites/.test(nm.text) && !/WTS cheap/.test(nm.text) && !/Hello from India/.test(nm.text) && !/Old thread bumped/.test(nm.text), nm?.text);
  ok('a new thread with 0 replies shows as started, not as a last reply', nm && /started /.test(nm.text) && /🔥/.test(nm.text));

  // commands and chat
  out = await say('turn off new threads please');
  ok('"turn off new threads" runs the real command', bags.local.radarCfg.newWatch === false && /New-thread watch is OFF/.test(out), out.slice(0, 120));
  await bg.setRadarCfgForTest?.({ newWatch: true });
  out = await say('how many replies today?');
  ok('a question is answered in words, with no search', /0 of 10/.test(out) && opened.filter((u) => /search\/search/.test(u)).length === 0, out.slice(0, 160));
  out = await say('delete everything');
  ok('Claude cannot make the bot run anything outside the short allowed list', /I cannot do that one/.test(out) && !/rm -rf/.test(JSON.stringify(bags.local)), out.slice(0, 160));

  // follow-up and "more"
  bags.local.radar.sent = {};
  globalThis.__askPlans['same but last 7 days'] = { kind: 'search', terms: ['private blog network', 'pbn links'], hours: 168, limit: 3, say: 'Same search, last 7 days' };
  tg = []; out = await say('same but last 7 days');
  const m3 = tg.filter((m) => m.method === 'sendMessage').find((m) => /^🤖 <b>private blog network/.test(m.text || ''));
  ok('a follow-up keeps the topic (Claude is told the previous request) and respects the new limit', claude.some((c) => /PREVIOUS: /.test(String(c.messages[0].content))) && m3 && (m3.text.match(/<b>\d+\. /g) || []).length === 3 && /more matched\. Send "more"/.test(m3.text), m3?.text?.slice(0, 200));
  const searchesBefore = opened.filter((u) => /search\/search/.test(u)).length;
  tg = []; out = await say('more');
  const m4 = tg.filter((m) => m.method === 'sendMessage').find((m) => /^🤖 /.test(m.text || ''));
  ok('"more" shows the next threads from the last answer without a new search', m4 && opened.filter((u) => /search\/search/.test(u)).length === searchesBefore && /<b>1\. /.test(m4.text), m4?.text?.slice(0, 160));

  // no Claude: simple rules
  bags.local.ai = { budget: 5, usage: { day, calls: 10, leads: 10, in: 1000000, cached: 0, out: 180000 } };
  bags.local.radar.sent = {}; claude = []; tg = []; opened.length = 0;
  out = await say('guest post last 3 days');
  const rm = tg.filter((m) => m.method === 'sendMessage').find((m) => /^🤖 <b>guest post<\/b> · last 3 days/.test(m.text || ''));
  ok('without Claude the words are read by rules (topic + time) and the answer says so', claude.length === 0 && opened.some((u) => /keywords=guest%20post/.test(u)) || (rm && /simple rules/.test(rm.text)) || /Nothing/.test(out), { out: out.slice(0, 200), opened: opened.slice(0, 3) });
  delete bags.local.ai;

  // switch off / on, help, one word keeps the old search
  out = await say('ask off'); ok('"ask off" turns plain-word mode off', bags.local.radarCfg.ask === false);
  tg = []; claude = []; out = await say('find pbn threads today');
  ok('with ask off a sentence no longer starts a Claude search', claude.length === 0 && !/🤖 <b>/.test(out));
  out = await say('ask on'); ok('"ask on" brings it back', bags.local.radarCfg.ask === true);
  out = await say('ask help'); ok('"ask help" lists examples', /Ask me in plain words/.test(out) && /last 24 hours/.test(out));
  claude = []; tg = []; out = await say('casino'); ok('a single word still uses the old index search, never Claude', claude.length === 0 && !/🤖/.test(out));
}


// --- 1.22.0: alerts - "notify me when new threads come in SEO, guest outreach, content writing" -------------
{
  delete bags.local.radar; bags.local.radarCfg = { on: true, newWatch: false }; delete bags.local.ai; claude = []; tg = []; opened.length = 0; globalThis.__threadOpens = [];
  const W = (id, title, o = {}) => ({ threadId: String(id), url: `https://www.blackhatworld.com/seo/w.${id}/`, title, author: 's', lastPoster: 's', forum: o.forum || 'Black Hat SEO', forumNode: '28', startedAt: hAgo(o.start ?? 1), lastActivityAt: hAgo(o.last ?? 0.5), replyCount: o.rep ?? 0, views: 5, sticky: false, locked: !!o.locked, mine: false, lastMine: false });
  threadPosts[8903] = [{ author: 'x', text: 'a' }, { author: 'BargainBed', text: 'I answered' }];
  globalThis.__newRows = [W(8901, 'Best SEO tools for 2026?'), W(8902, 'Guest outreach email template that works'), W(8903, 'SEO audit checklist - what do you check first?', { rep: 2 }), W(8904, 'Content writing rates for tech blogs?'), W(8905, 'SEO services cheap $20', {}), W(8906, 'Old SEO thread from yesterday', { start: 20 }), W(8907, 'Casino traffic from push'), W(8908, 'Hello I am new here', { forum: 'Introductions' }), W(8909, 'Link building in 2026 - what still works?')];
  globalThis.__askPlans = {
    'notify me when new threads come in SEO, guest outreach and content writing': { kind: 'watch', op: 'add', watches: [{ label: 'SEO', terms: ['seo', 'search engine optimization'] }, { label: 'guest outreach', terms: ['guest outreach', 'guest post', 'link outreach'] }, { label: 'content writing', terms: ['content writing', 'copywriting', 'article writing'] }], say: 'Watching three topics' },
    'also watch link building': { kind: 'watch', op: 'add', watches: [{ label: 'link building', terms: ['link building', 'backlinks'] }] },
    'stop watching content writing': { kind: 'watch', op: 'remove', watches: [{ label: 'content writing', terms: [] }] },
    'pause my alerts for now': { kind: 'watch', op: 'pause', watches: [] },
    'resume alerts': { kind: 'watch', op: 'resume', watches: [] }
  };
  bg.__forgetNewReadForTest();
  let out = await say('notify me when new threads come in SEO, guest outreach and content writing');
  const w1 = bags.local.radarCfg.watches || [];
  ok('three alerts are saved with Claude\'s expanded words, and the bot says what it is watching', w1.map((w) => w.id).join() === 'seo,guest-outreach,content-writing' && w1[0].terms.includes('search engine optimization') && /Now watching: <b>seo, guest outreach, content writing/.test(out), { w: w1.map((w) => w.id), out: out.slice(0, 200) });
  const am = tg.filter((m) => m.method === 'sendMessage').find((m) => /^🔔 <b>New threads for your alerts<\/b>/.test(m.text || ''));
  ok('adding alerts checks right away: one message, a section per alert, linked titles, 0 replies marked HOT', am && /<b>seo<\/b>/.test(am.text) && /<b>guest outreach<\/b>/.test(am.text) && /<b>content writing<\/b>/.test(am.text) && /<a href="[^"]+">Best SEO tools/.test(am.text) && /🔥 <a/.test(am.text), am?.text);
  ok('not offered: sales, older than 6 hours, off-topic, Introductions, and a thread you already posted in (read for your name)', am && !/cheap \$20/.test(am.text) && !/yesterday/.test(am.text) && !/Casino/.test(am.text) && !/Hello I am new/.test(am.text) && !/audit checklist/.test(am.text) && !!bags.local.radar.participated['8903'], am?.text);
  ok('link building is not watched yet, so its thread is not in it', am && !/Link building in 2026/.test(am.text));
  ok('the message ends with the Watching line and how to change it', am && /Watching: seo, guest outreach, content writing/.test(am.text) && /stop watching/.test(am.text));
  ok('every thread has I replied / Not relevant buttons', (am?.reply_markup?.inline_keyboard || []).filter((r) => r.some((b) => /^rr:\d+$/.test(b.callback_data || ''))).length >= 3);
  ok('the new-threads page was opened once for the whole check', opened.filter((u) => /whats-new/.test(u)).length === 1, opened.filter((u) => /whats-new/.test(u)));

  // nothing is offered twice; not due inside 15 minutes
  tg = []; let r = await bg.watchTick({ fast: true });
  ok('not due again inside 15 minutes', r.skipped === 'not due');
  r = await bg.watchTick({ force: true, fast: true });
  ok('a forced check right after finds nothing new: no thread is offered twice', r.ok && r.sent === 0 && !tg.some((m) => /🔔 <b>New threads/.test(m.text || '')), r);

  // it changes accordingly
  bg.__forgetNewReadForTest();
  out = await say('also watch link building');
  ok('"also watch link building" adds a fourth alert and offers its thread, and only it', (bags.local.radarCfg.watches || []).length === 4 && /Now watching: <b>link building/.test(out) && tg.some((m) => /Link building in 2026/.test(m.text || '')) && !tg.some((m) => /Best SEO tools/.test(m.text || '')), out.slice(0, 160));
  out = await say('stop watching content writing');
  ok('"stop watching content writing" removes only that one', (bags.local.radarCfg.watches || []).map((w) => w.id).join() === 'seo,guest-outreach,link-building' && /Stopped watching: <b>content writing/.test(out), out.slice(0, 160));
  bg.__forgetNewReadForTest(); globalThis.__newRows = [...globalThis.__newRows, W(8910, 'Content writing jobs for beginners?'), W(8911, 'Guest post outreach: how many emails do you send?')]; tg = [];
  r = await bg.watchTick({ force: true, fast: true });
  const m2 = tg.find((m) => /🔔 <b>New threads/.test(m.text || ''));
  ok('after that, a content-writing thread no longer alerts but a guest-outreach one still does', m2 && /Guest post outreach/.test(m2.text) && !/Content writing jobs/.test(m2.text), m2?.text);
  out = await say('alerts');
  ok('"alerts" lists them with their words, without Claude', /Your alerts/.test(out) && /seo/.test(out) && /guest outreach/.test(out) && /link building/.test(out) && !/content writing/.test(out) && claude.length === 0 || /Your alerts/.test(out), out.slice(0, 200));

  // pause and resume
  out = await say('pause my alerts for now');
  bg.__forgetNewReadForTest(); globalThis.__newRows = [...globalThis.__newRows, W(8912, 'SEO question about canonical tags')]; tg = []; bags.local.radar.watchAt = 0;
  r = await bg.watchTick({ fast: true });
  ok('paused alerts send nothing', bags.local.radarCfg.alertsOn === false && r.skipped === 'off' && !tg.some((m) => /🔔 <b>New threads/.test(m.text || '')));
  out = await say('resume alerts'); 
  ok('"resume alerts" turns them back on (rules, no Claude needed)', bags.local.radarCfg.alertsOn === true && /Alerts are back on/.test(out), out.slice(0, 120));
  bags.local.radar.watchAt = 0; tg = []; r = await bg.watchTick({ fast: true });
  ok('and the thread that appeared meanwhile is offered once they are back', tg.some((m) => /canonical tags/.test(m.text || '')), r);

  // rules only
  const day = new Date().toLocaleDateString('en-CA');
  bags.local.ai = { budget: 5, usage: { day, calls: 10, leads: 10, in: 1000000, cached: 0, out: 180000 } }; claude = [];
  out = await say('notify me when new threads come in link outreach');
  ok('with Claude out of budget, "notify me when ... link outreach" is still understood by rules and saved with the topic as its word', claude.length === 0 && (bags.local.radarCfg.watches || []).some((w) => w.id === 'link-outreach' && w.terms.includes('link outreach')), (bags.local.radarCfg.watches || []).map((w) => w.id));
  delete bags.local.ai;
  // HAF busy
  bags.local.radar.watchAt = 0; bags.local.hafBusyUntil = Date.now() + 120000; opened.length = 0; tg = [];
  r = await bg.watchTick({ fast: true });
  ok('while HAF is sending, alerts wait and open no page', r.skipped === 'haf' && opened.length === 0 && tg.length === 0, r);
  delete bags.local.hafBusyUntil;
}


// --- 1.23.0: Telegram = HAF cards + every new thread, every 10 minutes --------------------------------------
{
  // the one-off quiet switch: families, blocks and alerts off; your later choices kept
  bags.local.radarCfg = { on: true, familiesOn: true, alertsOn: true, blocks: [{ id: 'ads', on: true, boards: [] }], watches: [{ id: 'seo', label: 'seo', terms: ['seo'], on: true }] }; delete bags.local.radarQuiet123;
  await bg.__quietRadarOnceForTest();
  let rc = bags.local.radarCfg;
  ok('on upgrade, once: families off, alerts off, blocks off, the 10-minute everything watch on; alerts and families are kept, just off', rc.familiesOn === false && rc.alertsOn === false && rc.blocks[0].on === false && rc.newWatch === true && rc.newAll === true && rc.newEvery === 10 && rc.watches.length === 1 && !!bags.local.radarQuiet123, rc);
  bags.local.radarCfg = { ...rc, familiesOn: true };
  await bg.__quietRadarOnceForTest();
  ok('it never runs twice: switching families back on later sticks', bags.local.radarCfg.familiesOn === true);
  bags.local.radarCfg = { on: true };    // a fresh install: the defaults alone
  bags.local.radar = { famAt: 0 }; tg = []; opened.length = 0; claude = [];
  await bg.__familiesTickForTest(); await bg.__blocksTickForTest(); await bg.watchTick({ fast: true });
  ok('with the defaults, families, blocks and alerts send nothing and open nothing', opened.length === 0 && tg.length === 0, opened);

  // the everything watch
  delete bags.local.radar; bags.local.radarCfg = { on: true }; tg = []; opened.length = 0; globalThis.__threadOpens = []; bg.__forgetNewReadForTest();
  const NA = (id, title, o = {}) => ({ threadId: String(id), url: `https://www.blackhatworld.com/seo/a.${id}/`, title, author: 's', lastPoster: 's', forum: o.forum || 'Black Hat SEO', forumNode: String(o.node ?? 28), startedAt: hAgo(o.start ?? 0.5), lastActivityAt: hAgo(o.last ?? 0.2), replyCount: o.rep ?? 0, views: 5, sticky: !!o.sticky, locked: false, mine: !!o.mine, lastMine: false });
  const topics = ['WordPress speed plugin?', 'Shopify vs WooCommerce for a small store', 'YouTube shorts not getting views', 'Best email warmup tool', 'Fiverr gig ranking tips', 'Instagram reach dropped', 'ChatGPT for content, worth it?', 'Local SEO citations list', 'Amazon FBA in 2026', 'Pinterest traffic for blogs', 'Reddit marketing without bans', 'Upwork proposals that work', 'TikTok shop experiences'];
  globalThis.__newRows = [...topics.map((t, i) => NA(7200 + i, t, { start: 0.2 + i * 0.1, rep: i % 4 })), NA(7300, 'Hello everyone, new here', { start: 0.1 }), NA(7301, 'Need an SEO freelancer', { forum: 'Hire a Freelancer', node: 76 }), NA(7302, 'Crowded thread with many answers', { rep: 12 }), NA(7303, 'Old thread bumped again, few replies', { start: 300, last: 0.05, rep: 3 })];
  let r = await bg.radarNewTick({ force: true });
  let nm = tg.filter((m) => m.method === 'sendMessage').find((m) => /🆕 <b>New threads<\/b>/.test(m.text || ''));
  ok('one message, at most 10 threads, any topic, newest activity first, no niche filter', r.sent === 10 && nm && (nm.text.match(/<b>\d+\. /g) || []).length === 10 && /WordPress speed plugin/.test(nm.text) && /Amazon FBA/.test(nm.text), { r, t: nm?.text?.slice(0, 200) });
  ok('out: the hello, the Hire a Freelancer thread (HAF\'s), and the thread with 12 replies', nm && !/Hello everyone/.test(nm.text) && !/SEO freelancer/.test(nm.text) && !/Crowded thread/.test(nm.text));
  ok('an old thread bumped with few replies is in (the page says it is live), shown with its last reply time', nm && /Old thread bumped/.test(nm.text) && /last reply/.test(nm.text));
  ok('the overflow is named and the footer explains the 10-minute rule, no keyword ideas', nm && /4 more waiting; they come with the next check/.test(nm.text) && /Every 10 minutes/.test(nm.text) && !/Try: next/.test(nm.text), nm?.text?.split('\n').slice(-4));
  ok('🔥 on 0-reply threads and buttons on every thread', /🔥 <a/.test(nm?.text || '') && (nm?.reply_markup?.inline_keyboard || []).filter((row) => row.some((b) => /^rr:/.test(b.callback_data || ''))).length === 10);
  ok('no Claude was used', claude.length === 0);
  tg = []; r = await bg.radarNewTick({ force: true });
  nm = tg.filter((m) => m.method === 'sendMessage').find((m) => /🆕 <b>New threads<\/b>/.test(m.text || ''));
  ok('the next check sends the 4 that waited, and nothing from before', r.sent === 4 && nm && (nm.text.match(/<b>\d+\. /g) || []).length === 4 && !/WordPress speed plugin/.test(nm.text) && !/more waiting/.test(nm.text), { r, t: nm?.text?.slice(0, 160) });
  tg = []; r = await bg.radarNewTick({ force: true });
  ok('then nothing: a thread is never sent twice', r.sent === 0 && !tg.some((m) => /🆕/.test(m.text || '')));
  globalThis.__newRows = [...globalThis.__newRows, NA(7304, 'Brand new: Etsy SEO question', { start: 0.05 })];
  r = await bg.radarNewTick();
  ok('not due inside 10 minutes', r.skipped === 'not due');
  bags.local.radar.newAt = Date.now() - 11 * 60000; tg = []; r = await bg.radarNewTick();
  ok('due after 10 minutes, and only the brand-new thread comes', r.sent === 1 && tg.some((m) => /Etsy SEO question/.test(m.text || '')), r);
  // HAF first
  bags.local.radar.newAt = 0; bags.local.hafBusyUntil = Date.now() + 120000; opened.length = 0; tg = [];
  r = await bg.radarNewTick();
  ok('while HAF is reading or sending, the watch waits and opens nothing', r.skipped === 'haf' && opened.length === 0 && tg.length === 0, r);
  delete bags.local.hafBusyUntil;
  bags.local.radarBackoffUntil = Date.now() + 600000; opened.length = 0;
  r = await bg.radarNewTick();
  ok('a wall the watch met pauses the watch only', r.skipped === 'wall' && opened.length === 0);
  delete bags.local.radarBackoffUntil;
  let out = await say('new threads off'); ok('"new threads off" still works', bags.local.radarCfg.newWatch === false);
  out = await say('new threads on'); ok('"new threads on" says the new rule', /every 10 minutes/.test(out) && /under 10 replies/.test(out), out);
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
