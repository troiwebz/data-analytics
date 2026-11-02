const bags = { local: {}, sync: {} };
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const mk = (area) => ({
  get: async (k) => { const bag = bags[area];
    if (k == null) return clone(bag);
    const ks = Array.isArray(k) ? k : [k];
    return Object.fromEntries(ks.filter((x) => x in bag).map((x) => [x, clone(bag[x])])); },
  set: async (o) => Object.assign(bags[area], o),
  remove: async (k) => { for (const x of (Array.isArray(k) ? k : [k])) delete bags[area][x]; }
});

globalThis.chrome = {
  runtime: {
    onInstalled: { addListener: () => {} }, onStartup: { addListener: () => {} },
    onMessage: { addListener: () => {} },
    getManifest: () => ({ version: '0.46.0' }), getURL: (p) => 'chrome-extension://x/' + p, lastError: null,
    sendMessage: async () => ({})
  },
  action: { onClicked: { addListener: () => {} } },
  tabs: { onRemoved: { addListener: () => {} }, onUpdated: { addListener: () => {}, removeListener: () => {} } },
  alarms: { onAlarm: { addListener: () => {} }, clear: async () => {}, create: () => {} },
  notifications: { create: (id, o, cb) => cb && cb(id), clear: () => {},
                   onClicked: { addListener: () => {} }, onButtonClicked: { addListener: () => {} } },
  scripting: { executeScript: async () => [{ result: {} }] },
  offscreen: { hasDocument: async () => true, createDocument: async () => {} },
  storage: { local: mk('local'), sync: mk('sync') }
};

// "PMS 8/8" on the server (1.12.4): the daily PM cap of 8 came back through the old
// settings file in the zip, the newest HAF threads waited, and Telegram never said so.
let sent = [], updates = [];
globalThis.fetch = async (url, opts) => {
  const u = String(url); const b = JSON.parse(opts?.body || '{}');
  if (/api\.telegram\.org/.test(u)) {
    if (/getUpdates/.test(u)) { const r = updates; updates = []; return { ok: true, status: 200, json: async () => ({ ok: true, result: r }) }; }
    if (/getMyShortDescription/.test(u)) return { ok: true, status: 200, json: async () => ({ ok: true, result: { short_description: '' } }) };
    if (b.text) sent.push(b.text);
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 7, username: 'haf_bot' } }) };
  }
  return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }), text: async () => '<html></html>' };
};
const { migrateConfig, getConfig, DEFAULT_CONFIG, CONFIG_VERSION } = await import('../src/config.js');
const bg = await import('../src/background.js');
let fails = 0;
const ok = (n, c, e) => { if (!c) fails++; console.log(`${c ? '  ok' : 'FAIL'}  ${n}${c || e === undefined ? '' : `  -> ${JSON.stringify(e).slice(0, 300)}`}`); };

// --- the update lifts the old cap of 8, whatever settings version saved it ----------
for (const v of [26, 34, 35]) {
  bags.local.config = { configVersion: v, maxDmsPerDay: 8 };
  await migrateConfig();
  ok(`settings version ${v} with the old cap of 8 becomes ${DEFAULT_CONFIG.maxDmsPerDay}`, bags.local.config.maxDmsPerDay === 30 && bags.local.config.configVersion === CONFIG_VERSION, bags.local.config.maxDmsPerDay);
}
bags.local.config = { configVersion: 35, maxDmsPerDay: 12 };
await migrateConfig();
ok('a cap you chose yourself (12) is kept', bags.local.config.maxDmsPerDay === 12);
bags.local.config = { configVersion: 35, maxDmsPerDay: 0 };
await migrateConfig();
ok('"no cap" stays no cap', bags.local.config.maxDmsPerDay === 0);

// --- "pm cap 30" from Telegram ----------------------------------------------------------
bags.local.vault = { tgToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef', savedAt: 1 };
bags.local.config = { ...DEFAULT_CONFIG, configVersion: CONFIG_VERSION, enabled: true, telegramEnabled: true, telegramChatId: '999', maxDmsPerDay: 8 };
const say = async (text) => { sent = []; updates = [{ update_id: Math.floor(Math.random() * 1e9), message: { message_id: 5, text, chat: { id: 999 }, from: { id: 1 } } }]; await bg.pollTaps(); return sent.join(' ||| '); };
let out = await say('pm cap 30');
ok('"pm cap 30" sets the limit to 30', (await getConfig()).maxDmsPerDay === 30, (await getConfig()).maxDmsPerDay);
ok('and confirms it on Telegram', /Daily PM limit is now 30/.test(out), out.slice(0, 160));
out = await say('pm cap');
ok('"pm cap" alone shows it without changing it', /Daily PM limit: 30/.test(out) && (await getConfig()).maxDmsPerDay === 30, out.slice(0, 160));
out = await say('pm cap off');
ok('"pm cap off" removes the limit', (await getConfig()).maxDmsPerDay === 0 && /OFF \(no limit\)/.test(out), out.slice(0, 160));
out = await say('dm limit 15');
ok('"dm limit 15" is understood too', (await getConfig()).maxDmsPerDay === 15);

// --- a PM held by the cap is said on Telegram, once a day ----------------------------------
bags.local.config = { ...(await getConfig()), autoMode: true, autoModeSince: new Date().toISOString(), maxDmsPerDay: 8, minSecondsBetweenDms: 0 };
const today = new Date().toLocaleDateString('en-CA');
bags.local.rateState = { day: today, count: 0, dmCount: 8, lastDmAt: Date.now() - 3600000 };
const lead = { threadId: '1851999', title: 'Need Expert SEO Vendor for Gambling Keywords', author: 'Miniyums', url: 'https://www.blackhatworld.com/seo/x.1851999/',
  postedAt: new Date(Date.now() - 3600000).toISOString(), foundAt: new Date().toISOString(), status: 'SENT', dm: 'Hi Miniyums, saw your thread.', dmTitle: 'Need Expert SEO Vendor',
  body: 'need seo vendor', aiSpecifics: { tips: ['We do this.', 'We do that.', 'We check it.'], pm: 'yes' }, autoRules: 4, autoSendAt: Date.now() - 1000, dmLint: { ok: true, errors: [] } };
bags.local.recentLeads = [lead];
sent = [];
const r1 = await bg.runAutoQueue();
const note = sent.find((t) => /Daily PM limit of 8 reached/.test(t)) || '';
ok('the cap holds the PM (nothing sent)', !bags.local.recentLeads[0].pmSent, r1);
ok('and Telegram is told it was NOT sent, with how to raise it', /have NOT been sent/.test(note) && /pm cap 30/.test(note), sent);
sent = [];
await bg.runAutoQueue();
ok('the notice is sent once, not every minute', !sent.some((t) => /Daily PM limit/.test(t)), sent);

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
