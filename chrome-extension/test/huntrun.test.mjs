// log 1.26.0: the hunter end to end in the background - fast start, history, updates, caps, walls, gems, central database.
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


const realST = setTimeout;
globalThis.setTimeout = (f, ms, ...a) => realST(f, Math.min(Number(ms) || 0, 3), ...a);   // the human pauses, made instant
const now = Date.now();
const mAgo = (m) => new Date(now - m * 60000).toISOString();
let seq = 1000;
const R = (title, o = {}) => { const id = String(o.id ?? ++seq); return { threadId: id, url: `https://www.blackhatworld.com/seo/t.${id}/`, title, author: 'starter', lastPoster: 'x',
  forum: o.forum ?? 'Black Hat SEO', forumNode: '28', startedAt: mAgo(o.m ?? 20), lastActivityAt: mAgo(o.m ?? 20), replyCount: o.rep ?? 1, sticky: false, locked: false, mine: false, lastMine: false }; };
const page = (n, mk) => Array.from({ length: n }, (_, i) => mk(i));
let whatsNew = {};     // url -> rows
let blockAt = null;
const opened = [];
const upd = [];
let tabN = 0; const tabUrl = {};
globalThis.chrome = {
  runtime: { onInstalled: { addListener: () => {} }, onStartup: { addListener: () => {} }, onMessage: { addListener: () => {} },
    getManifest: () => ({ version: '1.26.0' }), getURL: (p) => 'chrome-extension://x/' + p, lastError: null, sendMessage: async () => ({}), getPlatformInfo: async () => ({ os: 'win' }) },
  action: { onClicked: { addListener: () => {} } },
  tabs: { onRemoved: { addListener: () => {} }, onUpdated: { addListener: (f) => upd.push(f), removeListener: (f) => { const i = upd.indexOf(f); if (i >= 0) upd.splice(i, 1); } },
    create: async ({ url }) => { const id = ++tabN; tabUrl[id] = url; opened.push(url); realST(() => upd.slice().forEach((f) => f(id, { status: 'complete' })), 1); return { id }; },
    remove: async () => {} },
  alarms: { onAlarm: { addListener: () => {} }, clear: async () => {}, create: () => {}, get: async () => null },
  notifications: { create: (id, o, cb) => cb && cb(id), clear: () => {}, onClicked: { addListener: () => {} }, onButtonClicked: { addListener: () => {} } },
  scripting: { executeScript: async ({ target, func }) => {
    const url = tabUrl[target.tabId];
    if (func.name === 'isChallengePage') return [{ result: false }];
    if (blockAt && url.includes(blockAt)) return [{ result: { blocked: 'BHW blocked the page: Just a moment...' } }];
    if (func.name === 'extractForumList') return [{ result: { boards: [{ slug: 'white-hat-seo', id: '29', name: 'White Hat SEO' }, { slug: 'local-seo', id: '52', name: 'Local SEO' }, { slug: 'blogging', id: '16', name: 'Blogging' }], loggedIn: true } }];
    if (func.name === 'extractRadarSearch') return [{ result: { rows: [R('Looking for local SEO expert', { id: 7001, forum: 'Hire a Freelancer' }), R('How to rank GMB in 2026?', { id: 7002 })], loggedIn: true } }];
    if (func.name === 'extractRadarListing') {
      if (/whats-new\/posts\/$/.test(url)) return [{ result: { rows: whatsNew[1] || [], me: 'Thermometer', loggedIn: true, url: 'https://www.blackhatworld.com/whats-new/posts/555/' } }];
      const pg = (url.match(/whats-new\/posts\/555\/page-(\d+)/) || [])[1];
      if (pg) return [{ result: { rows: whatsNew[pg] || [], me: 'Thermometer', loggedIn: true, url } }];
      const b = (url.match(/forums\/(\d+)\/(page-2)?/) || []);
      if (b[1]) return [{ result: { rows: page(5, (i) => R(i % 2 ? `Need help with board ${b[1]} SEO ${i}` : `Why is board ${b[1]} slow ${i}?`, { m: 60 * 24 * 2 })), me: 'Thermometer', loggedIn: true, url } }];
      return [{ result: { rows: [], me: 'Thermometer', loggedIn: true, url } }];
    }
    return [{ result: { rows: [] } }];
  } },
  offscreen: { hasDocument: async () => true, createDocument: async () => {} },
  storage: { local: mk('local'), sync: mk('sync'), onChanged: { addListener: () => {} } }
};
let tg = [], pushes = [];
globalThis.fetch = async (url, opts) => {
  const u = String(url); const b = JSON.parse(opts?.body || '{}');
  if (/api\.telegram\.org/.test(u)) {
    if (/getUpdates/.test(u)) return { ok: true, status: 200, json: async () => ({ ok: true, result: [] }) };
    tg.push({ method: u.split('/').pop(), ...b });
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 100 + tg.length } }) };
  }
  if (/haf-mobile\.vercel\.app\/api\/pool/.test(u)) { pushes.push(b); return { ok: true, status: 200, json: async () => ({ ok: true, items: (b.items || []).length }) }; }
  if (/haf-mobile\.vercel\.app/.test(u)) return { ok: true, status: 200, json: async () => ({ ok: true, bytes: 1 }) };
  return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }), text: async () => '<html></html>' };
};
const { DEFAULT_CONFIG, CONFIG_VERSION, migrateConfig } = await import('../src/config.js');
const bg = await import('../src/background.js');
let fails = 0;
const ok = (n, c, e) => { if (!c) fails++; console.log(`${c ? '  ok' : 'FAIL'}  ${n}${c || e === undefined ? '' : `  -> ${JSON.stringify(e).slice(0, 400)}`}`); };
const msgs = () => tg.filter((m) => m.method === 'sendMessage');
const bhwReads = () => opened.filter((u) => /blackhatworld/.test(u));

bags.local.vault = { tgToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef', key: 'sk-ant-test-key-000', savedAt: 1 };
bags.local.config = { ...DEFAULT_CONFIG, configVersion: CONFIG_VERSION, enabled: true, telegramEnabled: true, telegramChatId: '999', bhwUsername: 'Thermometer', sleepEnabled: false, quietStart: '00:00', quietEnd: '00:00' };
bags.local.mobileKey = 'k'.repeat(32);

// ---- migration: her old copy (watching the ads forums) moves to the hunter
bags.local.config = { ...bags.local.config, configVersion: 38, huntOn: undefined, otherSourcesOn: undefined, huntFocus: undefined };
await migrateConfig();
ok('migration: hunter on, ads-forum list off, focus SEO + content', bags.local.config.huntOn === true && bags.local.config.otherSourcesOn === false && bags.local.config.huntFocus.join() === 'seo,content', bags.local.config);

// ---- 1. fast first start: 3 pages straight away, a Ready message, gems for fresh buyers
whatsNew = {
  1: [R('Looking for backlink builder for SaaS', { m: 8, rep: 1 }), R('Why did my site get deindexed?', { m: 20, rep: 0 }), R('⭐ Cheap links 50% off ⭐'), R('Hello everyone, new here'),
    R('Need guest posts on tech blogs, $500 budget', { m: 90, rep: 3 }), ...page(5, (i) => R(`Best keyword tool ${i}?`, { m: 100 + i, rep: 4 }))],
  2: page(10, (i) => R(`Need local SEO for clinic ${i}`, { m: 200 + i, rep: 5 })),
  3: page(10, (i) => R(`My SEO journey week ${i}`, { m: 300 + i, rep: 2, forum: 'White Hat SEO' }))
};
let r = await bg.huntTick();
ok('fast start reads the 3 pages straight away', r.ok && r.pages === 3 && bhwReads().length === 3 && bhwReads()[1].endsWith('/whats-new/posts/555/page-2'), { r, reads: bhwReads() });
const pool = bags.local.huntPool;
ok('sellers and hellos never enter the pool', !Object.values(pool).some((i) => /Cheap|Hello/.test(i.title)) && Object.keys(pool).length === 28, Object.keys(pool).length);
ok('gems: the fresh buyer and the unanswered question (8 a day cap untouched)', msgs().filter((m) => /💎/.test(m.text)).length === 3, msgs().map((m) => m.text.slice(0, 80)));
ok('gem message has only an Open-thread button', msgs().filter((m) => /💎/.test(m.text)).every((m) => m.reply_markup.inline_keyboard.flat().every((b) => b.url && !b.callback_data)));
ok('a Ready message after the first start', msgs().some((m) => /Hunt is ready: 28 threads/.test(m.text)), msgs().map((m) => m.text.slice(0, 60)));
ok('the pool went to the central database with the phone code', pushes.length >= 1 && pushes[0].k === 'k'.repeat(32) && pushes.flatMap((p) => p.items).length >= 28 && pushes[0].items.every((i) => i.day && i.cat && i.lane && !('author_email' in i)));
ok('an update is booked 10-15 minutes ahead', bags.local.hunt.nextAt - Date.now() >= 9 * 60000 && bags.local.hunt.nextAt - Date.now() <= 15 * 60000 + 5000);

// ---- 2. history: forum list once, then one board page per step, never closer than 3 minutes
tg = []; opened.length = 0;
r = await bg.huntTick();
ok('history first resolves the boards from the forum list (one page)', r.history === 'boards found' && bhwReads().length === 1 && bhwReads()[0].endsWith('/forums/'), { r, o: bhwReads() });
r = await bg.huntTick();
ok('history waits 3 minutes between pages', r.skipped === 'not due', r);
bags.local.hunt.history.lastAt -= 4 * 60000;
r = await bg.huntTick();
ok('then one board page', r.ok && r.history === 'Hire a Freelancer' && bhwReads().length === 2 && /forums\/76\/$/.test(bhwReads()[1]), { r, o: bhwReads() });
ok('history never pings gems for old threads', !msgs().some((m) => /💎/.test(m.text)));

// ---- 3. regular update: stops at 10 new; the summary goes when 10+ are waiting
opened.length = 0; tg = [];
bags.local.hunt.nextAt = Date.now() - 1;
whatsNew = { 1: page(12, (i) => R(`Looking for SEO help ${i}`, { m: 200 + i, rep: 6 })), 2: page(5, (i) => R(`More ${i}?`)) };
r = await bg.huntTick();
ok('update: page 1 had 12 new, so page 2 is not read', r.ok && r.pages === 1 && r.fresh === 12 && bhwReads().length === 1, { r, o: bhwReads() });
ok('one live-feed message with the 12 new threads', msgs().filter((m) => /🧲 <b>Live feed · 12 new threads/.test(m.text)).length === 1, msgs().map((m) => m.text.slice(0, 60)));
opened.length = 0; tg = [];
bags.local.hunt.nextAt = Date.now() - 1;
whatsNew = { 1: page(3, (i) => R(`Looking for links A${i}`, { m: 400 })), 2: page(3, (i) => R(`Looking for links B${i}`, { m: 400 })), 3: page(2, (i) => R(`Looking for links C${i}`, { m: 400 })) };
r = await bg.huntTick();
ok('under 10 new: reads on to page 3 at most', r.pages === 3 && r.fresh === 8 && bhwReads().length === 3, { r, o: bhwReads() });
ok('8 new are held for the next feed message, not sent half', !msgs().some((m) => /🧲/.test(m.text)) && bags.local.hunt.pending.length === 8);

// ---- 3b. Hire a Freelancer never reaches Hunt's Telegram (HAF already handles it)
opened.length = 0; tg = [];
bags.local.hunt.pending = [];
bags.local.hunt.nextAt = Date.now() - 1;
whatsNew = { 1: [...page(10, (i) => R(`Need SEO for shop ${i}`, { m: 2, rep: 0, forum: 'Hire a Freelancer' })), ...page(10, (i) => R(`Looking for outreach ${i}`, { m: 300, rep: 6, forum: 'Black Hat SEO' }))] };
r = await bg.huntTick();
const feedMsg = msgs().find((m) => /Live feed/.test(m.text))?.text || '';
ok('feed holds the 10 forum threads and none of the 10 HAF ones; no gem for HAF', /Live feed · 10 new threads/.test(feedMsg) && !/Need SEO for shop/.test(feedMsg) && !msgs().some((m) => /💎/.test(m.text) && /shop/.test(m.text)), msgs().map((m) => m.text.slice(0, 80)));

// ---- 4. the hourly cap: 15 BHW pages, HAF reads included
opened.length = 0;
bags.local.bhwReadLog = Array.from({ length: 14 }, (_, i) => Date.now() - i * 60000);
bags.local.hunt.nextAt = Date.now() - 1;
whatsNew = { 1: page(3, (i) => R(`Looking for links D${i}`)), 2: page(3, (i) => R(`Looking for links E${i}`)) };
r = await bg.huntTick();
ok('14 pages already this hour: one more, then stop', r.pages === 1 && bhwReads().length === 1, { r, o: bhwReads() });
opened.length = 0;
bags.local.bhwReadLog = Array.from({ length: 15 }, (_, i) => Date.now() - i * 60000);
bags.local.hunt.nextAt = Date.now() - 1;
r = await bg.huntTick();
ok('15 pages this hour: nothing is read', r.pages === 0 && bhwReads().length === 0, r);
bags.local.bhwReadLog = [];

// ---- 5. a wall: stop at once, pause, nothing solved
opened.length = 0;
bags.local.hunt.nextAt = Date.now() - 1;
blockAt = 'whats-new';
r = await bg.huntTick();
ok('a check page stops the update and pauses the hunter', r.wall === true && r.pages === 0 && bags.local.radarBackoffUntil > Date.now(), r);
r = await bg.huntTick({ force: true });
ok('while paused nothing is read, even on Update now', r.skipped === 'wall' && bhwReads().length === 1, r);
blockAt = null; delete bags.local.radarBackoffUntil;

// ---- 6. the gem cap: 8 a day
tg = [];
bags.local.hunt.gemsSent = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`g${i}`, Date.now()]));
bags.local.hunt.gemDay = new Date().toISOString().slice(0, 10);
bags.local.hunt.nextAt = Date.now() - 1;
whatsNew = { 1: page(4, (i) => R(`Looking for backlinks now ${i}`, { m: 3, rep: 0 })) };
await bg.huntTick();
ok('only 1 more gem today after 7', msgs().filter((m) => /💎/.test(m.text)).length === 1, msgs().length);

// ---- 7. search on a tap, and marks
const s = await bg.__huntForTest.search('local seo');
ok('Search BHW: one page, results in the pool', s.ok && s.ids.length === 2 && bags.local.huntPool['7001'].lane === 'buyer', s);
await bg.__huntForTest.mark('7001', 'done');
ok('Done marks the thread and queues it for the central database', bags.local.huntPool['7001'].status === 'done' && bags.local.hunt.pushQ.includes('7001'));
const v = await bg.__huntForTest.view();
ok('the Hunt page view: counts, picks, pages this hour, history progress', v.counts.all > 30 && v.picks.length === 10 && v.pagesCap === 15 && v.history.total === 18 && !v.picks.includes('7001'), { all: v.counts.all, p: v.picks.length, h: v.history });

// ---- 7b. what our system already did shows on the Hunt page and keeps picks and gems clean
const LK = (await import('../src/store.js')).LEADS_KEY || 'recentLeads';
const someId = v.picks[0];
bags.local[LK] = [{ threadId: someId, kind: 'haf', status: 'SENT', pmSent: true, title: 'x' }];
const v2 = await bg.__huntForTest.view();
ok('a thread HAF already messaged is marked and leaves the picks', v2.pool[someId].haf === 'dm' && !v2.picks.includes(someId), { haf: v2.pool[someId].haf });
delete bags.local[LK];

// ---- 8. HAF is untouched, and the old readers stand aside
ok('nothing written to HAF\'s leads', !bags.local.recentLeads || !Object.values(bags.local.recentLeads).some((l) => /Looking for links/.test(l.title || '')));
const rn = await bg.radarNewTick();
ok('the old new-threads watch steps aside while the hunter runs', rn.skipped === 'hunt', rn);
bags.local.config.huntOn = false;
r = await bg.huntTick();
ok('Hunt off: nothing runs', r.skipped === 'off');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
