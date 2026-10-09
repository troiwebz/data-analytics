// BHW Traffic in the background (1.15.0): a reading every 30 minutes in a tab,
// the morning report, the Sunday grid, "online" / "traffic on|off", a wall, and
// that none of it touches HAF, Radar or the old bump samples.
const bags = { local: {}, sync: {} };
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const mk = (area) => ({
  get: async (k) => { const bag = bags[area]; if (k == null) return clone(bag); const ks = Array.isArray(k) ? k : [k]; return Object.fromEntries(ks.filter((x) => x in bag).map((x) => [x, clone(bag[x])])); },
  set: async (o) => Object.assign(bags[area], clone(o)), remove: async (k) => { for (const x of (Array.isArray(k) ? k : [k])) delete bags[area][x]; }
});
const opened = []; const upd = []; let tabN = 0; const tabUrl = {}; let blocked = false; let counts = { members: 312, guests: 2140, total: 2452 };
globalThis.chrome = {
  runtime: { onInstalled: { addListener: () => {} }, onStartup: { addListener: () => {} }, onMessage: { addListener: () => {} }, getManifest: () => ({ version: '1.15.0' }), getURL: (p) => 'chrome-extension://x/' + p, lastError: null, sendMessage: async () => ({}) },
  action: { onClicked: { addListener: () => {} } },
  tabs: { onRemoved: { addListener: () => {} }, onUpdated: { addListener: (f) => upd.push(f), removeListener: (f) => { const i = upd.indexOf(f); if (i >= 0) upd.splice(i, 1); } },
    create: async ({ url }) => { const id = ++tabN; tabUrl[id] = url; opened.push(url); setTimeout(() => upd.slice().forEach((f) => f(id, { status: 'complete' })), 1); return { id }; }, remove: async () => {} },
  alarms: { onAlarm: { addListener: () => {} }, clear: async () => {}, create: () => {} },
  notifications: { create: (id, o, cb) => cb && cb(id), clear: () => {}, onClicked: { addListener: () => {} }, onButtonClicked: { addListener: () => {} } },
  scripting: { executeScript: async ({ func }) => { if (func.name === 'extractOnline') return [{ result: blocked ? { blocked: 'BHW blocked the page: Just a moment...' } : counts }]; return [{ result: { rows: [] } }]; } },
  offscreen: { hasDocument: async () => true, createDocument: async () => {} },
  storage: { local: mk('local'), sync: mk('sync') }
};
let tg = [], updates = [];
globalThis.fetch = async (url, opts) => {
  const u = String(url); const b = JSON.parse(opts?.body || '{}');
  if (/api\.telegram\.org/.test(u)) {
    if (/getUpdates/.test(u)) { const r = updates; updates = []; return { ok: true, status: 200, json: async () => ({ ok: true, result: r }) }; }
    if (/getMyShortDescription/.test(u)) return { ok: true, status: 200, json: async () => ({ ok: true, result: { short_description: '' } }) };
    tg.push({ method: u.split('/').pop(), ...b }); return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 100 + tg.length } }) };
  }
  return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }), text: async () => '<html></html>' };
};
const { DEFAULT_CONFIG, CONFIG_VERSION } = await import('../src/config.js');
const bg = await import('../src/background.js');
let fails = 0;
const ok = (n, c, e) => { if (!c) fails++; console.log(`${c ? '  ok' : 'FAIL'}  ${n}${c || e === undefined ? '' : `  -> ${JSON.stringify(e).slice(0, 300)}`}`); };
bags.local.vault = { tgToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef', savedAt: 1 };
bags.local.config = { ...DEFAULT_CONFIG, configVersion: CONFIG_VERSION, enabled: true, telegramEnabled: true, telegramApprovals: true, telegramChatId: '999', timezone: 'Asia/Kolkata' };
const say = async (text) => { tg = []; updates = [{ update_id: Math.floor(Math.random() * 1e9), message: { message_id: 5, text, chat: { id: 999 }, from: { id: 1 } } }]; await bg.pollTaps(); return tg.filter((m) => m.method === 'sendMessage').map((m) => m.text).join(' ||| '); };

// --- a reading, in a tab, stored on its own key ---------------------------------------------
let r = await bg.pulseRead({ force: true });
ok('the online page is opened in a tab and the three counts are stored', r.ok && opened[0] === 'https://www.blackhatworld.com/online/' && bags.local.pulseSamples.length === 1 && bags.local.pulseSamples[0].members === 312 && bags.local.pulseSamples[0].guests === 2140, { r, s: bags.local.pulseSamples });
ok('nothing of HAF, Radar or the old bump samples is written', !bags.local.recentLeads && !bags.local.radar && !bags.local.trafficSamples);
r = await bg.pulseRead();
ok('a second reading inside 30 minutes is not taken', r.skipped === 'not due' && opened.length === 1, r);
blocked = true; r = await bg.pulseRead({ force: true });
ok('a Cloudflare wall is not stored as a reading, and the shared 30-minute pause is set', r.error && bags.local.pulseSamples.length === 1 && Number(bags.local.sourcesBackoffUntil) > Date.now(), r);
blocked = false; delete bags.local.sourcesBackoffUntil;

// --- "online", "traffic off / on" ------------------------------------------------------------
let out = await say('online');
ok('"online" answers with the live count and today so far, one message', /BHW now: 312 members · 2,140 guests/.test(out) && /Today so far|No readings yet today/.test(out) && !/\|\|\|/.test(out), out);
out = await say('online off');
ok('"online off" switches it off', bags.local.pulseCfg.on === false && /is OFF/.test(out));
out = await say('online on');
ok('"online on" switches it on', bags.local.pulseCfg.on === true && /is ON/.test(out));
out = await say('online now');
ok('"online now" takes a reading and answers', opened.length === 3 && /BHW now/.test(out), { n: opened.length });

// --- the morning report and the Sunday grid, through the minute tick --------------------------
// 28 days of readings, then a tick at 09:05 on a Sunday (IST).
const { partsOf } = await import('../src/pulse.js');
const T0 = Date.parse('2026-09-07T00:00:00Z');
let samples = [];
for (let i = 0; i < 28 * 48; i++) { const ts = T0 + i * 30 * 60000; const p = partsOf(ts, 'Asia/Kolkata'); samples.push({ ts, members: 600 + Math.round(1400 * Math.max(0, Math.sin(((p.hour - 8) / 16) * Math.PI))) + (i % 20), guests: 3000, total: 3600 }); }
bags.local.pulseSamples = samples; bags.local.pulseMeta = { lastReadAt: Date.now() };
const realNow = Date.now; const sunday = Date.parse('2026-10-04T03:35:00Z');   // 09:05 IST, Sunday
Date.now = () => sunday;
tg = [];
await bg.__pulseTickForTest();
const sent = tg.filter((m) => m.method === 'sendMessage').map((m) => m.text);
ok('after 09:00 the morning report goes out once, about yesterday', sent.length >= 1 && /BHW traffic, 2026-10-03/.test(sent[0]) && /Average online: <b>[\d,]+<\/b> members/.test(sent[0]) && /Peak: /.test(sent[0]), sent[0]);
ok('on Sunday the week grid follows it, with the best hours', sent.length === 2 && /BHW traffic, this week/.test(sent[1]) && /Best hours to post: /.test(sent[1]) && (sent[1].match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)  [HML·]{24}$/gm) || []).length === 7, sent[1]);
tg = []; await bg.__pulseTickForTest();
ok('a second tick the same day sends nothing more', !tg.some((m) => m.method === 'sendMessage'));
Date.now = () => sunday + 86400000; tg = []; await bg.__pulseTickForTest();
ok('Monday morning: the day report again, no grid', tg.filter((m) => m.method === 'sendMessage').length === 1 && /BHW traffic, 2026-10-04/.test(tg[0].text));
Date.now = realNow;
bags.local.pulseCfg = { on: false }; tg = []; bags.local.pulseMeta = {};
await bg.__pulseTickForTest();
ok('switched off: no reading and no message', !tg.length && opened.length === 3);
out = await say('traffic');
ok('"traffic" alone is still HAF\'s own bump-timing report, not this', !/BHW now|BHW traffic is/.test(out), out.slice(0, 80));

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
