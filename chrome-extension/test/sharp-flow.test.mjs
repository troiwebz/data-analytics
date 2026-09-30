// The sharp lane, end to end against a fake Chrome: it reads nothing until it
// is switched on, reads ONE page per tick when it is, never doubles up, and a
// BHW wall stands it down for two hours and says so on Telegram.
const store = {};
store.config = { readMode: 'tabs', sleepEnabled: false, telegramChatId: '777', enabled: true };
store.vault = { tgToken: '123:test-token', savedAt: 1 };   // a made-up bot token, so say() reaches the fake Telegram
const opened = [];          // every tab the extension opened
let page = () => ({ rows: [], loggedIn: true, me: 'me', next: false, title: 'Hire a Freelancer', url: '' });
const tg = [];
Math.random = () => 0;      // no jitter, the shortest "reading" pause

globalThis.chrome = {
  runtime: {
    onInstalled: { addListener: () => {} }, onStartup: { addListener: () => {} },
    onMessage: { addListener: () => {}, removeListener: () => {} },
    getManifest: () => ({ version: '1.10.2' }), getURL: (p) => 'chrome-extension://x/' + p, lastError: null,
    reload: () => {}, sendMessage: async () => ({})
  },
  action: { onClicked: { addListener: () => {} } },
  tabs: {
    onRemoved: { addListener: () => {} },
    // A tab "finishes loading" the moment anyone waits for it.
    onUpdated: { addListener: (f) => { setTimeout(() => f(opened.length, { status: 'complete' }), 5); }, removeListener: () => {} },
    query: async () => [], remove: async () => {},
    create: async (o) => { opened.push(o.url); return { id: opened.length }; }
  },
  alarms: { onAlarm: { addListener: () => {} }, clear: async () => {}, create: () => {}, get: async () => null },
  notifications: { create: (id, o, cb) => cb && cb(id), clear: () => {},
                   onClicked: { addListener: () => {} }, onButtonClicked: { addListener: () => {} } },
  offscreen: { hasDocument: async () => true, createDocument: async () => {} },
  scripting: { executeScript: async () => [{ result: page() }] },
  storage: { local: {
    get: async (k) => {
      if (k == null) return structuredClone(store);
      if (Array.isArray(k)) return Object.fromEntries(k.filter((x) => x in store).map((x) => [x, structuredClone(store[x])]));
      return k in store ? { [k]: structuredClone(store[k]) } : {};
    },
    set: async (o) => Object.assign(store, structuredClone(o)),
    remove: async (k) => { for (const x of (Array.isArray(k) ? k : [k])) delete store[x]; }
  },
  sync: { get: async () => ({}), set: async () => {}, remove: async () => {} } }
};
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('api.telegram.org')) { try { tg.push(JSON.parse(opts.body)); } catch { /* not json */ } }
  return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }), text: async () => '' };
};

const bg = await import('../src/background.js');
const { setConfig, getConfig } = await import('../src/config.js');

let fails = 0;
const ok = (name, cond, extra) => { if (!cond) fails++; console.log(`${cond ? '  ok' : 'FAIL'}  ${name}${cond || extra === undefined ? '' : `  -> ${JSON.stringify(extra).slice(0, 200)}`}`); };
const told = (rx) => tg.some((m) => rx.test(String(m.text || '')));

// --- off by default -------------------------------------------------------
{
  const r = await bg.sharpCheck();
  ok('auto mode off: the lane reads nothing', /auto mode is off/.test(r.skipped || ''), r);
  ok('and opens no tab', opened.length === 0, opened);
  await setConfig({ autoMode: true });
  const r2 = await bg.sharpCheck();
  ok('auto mode on but sharp never switched on: still nothing', /switched off/.test(r2.skipped || ''), r2);
  ok('and still no tab', opened.length === 0, opened);
}

// --- on: one page, once ---------------------------------------------------
{
  await setConfig({ sharpLane: true });
  const r = await bg.sharpCheck();
  ok('sharp on: the tick reads', !r.skipped, r);
  ok('exactly one page', opened.length === 1, opened);
  ok('and it is the Hire a Freelancer forum, nothing else', /hire-a-freelancer/i.test(opened[0] || ''), opened);
  ok('the read is remembered', (store.sharpLane || {}).lastAt > 0 && (store.sharpLane || {}).runs === 1, store.sharpLane);
  const r2 = await bg.sharpCheck();
  ok('a second tick straight after is not a second read', /moment ago/.test(r2.skipped || ''), r2);
  ok('so still one page', opened.length === 1, opened);
}

// --- asleep ---------------------------------------------------------------
{
  store.sharpLane = { ...store.sharpLane, lastAt: Date.now() - 80000 };
  const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  await setConfig({ sleepEnabled: true, timezone: '', sleepStart: hhmm(new Date(Date.now() - 3600000)), sleepEnd: hhmm(new Date(Date.now() + 3600000)) });
  const r = await bg.sharpCheck();
  ok('inside the sleep window it reads nothing', r.skipped === 'asleep' || opened.length === 1, r);
  await setConfig({ sleepEnabled: false });
}

// --- a wall ---------------------------------------------------------------
{
  store.sharpLane = { ...store.sharpLane, lastAt: Date.now() - 80000 };
  const before = opened.length;
  page = () => ({ blocked: 'BHW blocked the page: Just a moment...' });
  let threw = '';
  try { await bg.sharpCheck(); } catch (e) { threw = e.message; }
  ok('a wall is reported, not swallowed', /blocked/i.test(threw), threw);
  ok('it cost one page', opened.length === before + 1, opened.length - before);
  const left = ((store.sharpLane || {}).backoffUntil || 0) - Date.now();
  ok('the lane stands down for two hours', left > 119 * 60000 && left <= 120 * 60000, left);
  ok('every other BHW read is paused too (the shared 30 minutes)', (store.sourcesBackoffUntil || 0) > Date.now());
  ok('and Telegram is told', told(/Sharp lane is standing down for 2 hours/));
  page = () => ({ rows: [], loggedIn: true, me: 'me', next: false });
  const n = opened.length;
  store.sharpLane = { ...store.sharpLane, lastAt: Date.now() - 80000 };
  const r = await bg.sharpCheck();
  ok('the next tick reads nothing', /wall/.test(r.skipped || ''), r);
  ok('and opens nothing', opened.length === n);
  // the 30-minute pause ends first; the lane still waits out its own two hours
  delete store.sourcesBackoffUntil;
  const r2 = await bg.sharpCheck();
  ok('after the 30-minute pause the lane is still standing down', /standing down/.test(r2.skipped || ''), r2);
  ok('and still opens nothing', opened.length === n);
  const tgBefore = tg.length;
  store.sharpLane = { ...store.sharpLane, backoffUntil: Date.now() - 1 };
  const r3 = await bg.sharpCheck();
  ok('two hours later it reads again by itself', !r3.skipped && opened.length === n + 1, r3);
  ok('without another announcement', tg.length === tgBefore);
}

// --- auto off stops it ----------------------------------------------------
{
  await setConfig({ autoMode: false });
  store.sharpLane = { ...store.sharpLane, lastAt: Date.now() - 80000 };
  const n = opened.length;
  const r = await bg.sharpCheck();
  ok('auto mode off: the lane stops with it', /auto mode is off/.test(r.skipped || '') && opened.length === n, r);
  ok('the setting itself is kept for next time', (await getConfig()).sharpLane === true);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
