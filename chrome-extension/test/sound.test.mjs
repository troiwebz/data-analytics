// The sound: one per check, the right one, and never at the cost of a lead.
const bags = { local: {} };
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
let played = [], created = 0, hasDoc = false, createFails = null;
globalThis.__banners = [];

globalThis.chrome = {
  runtime: {
    onInstalled: { addListener: () => {} }, onStartup: { addListener: () => {} },
    onMessage: { addListener: () => {} },
    getManifest: () => ({ version: '0.33.0' }), getURL: (p) => 'chrome-extension://x/' + p, lastError: null,
    sendMessage: async (m) => { if (m?.target === 'offscreen-audio') { played.push(m); return { ok: true }; } return {}; }
  },
  action: { onClicked: { addListener: () => {} } },
  tabs: { onRemoved: { addListener: () => {} } },
  alarms: { onAlarm: { addListener: () => {} }, clear: async () => {}, create: () => {} },
  notifications: {
    create: (id, opts, cb) => { globalThis.__banners.push({ id, opts }); cb && cb(id); },
    clear: () => {}, onClicked: { addListener: () => {} }, onButtonClicked: { addListener: () => {} }
  },
  scripting: { executeScript: async () => [{ result: {} }] },
  offscreen: {
    hasDocument: async () => hasDoc,
    createDocument: async () => { if (createFails) throw new Error(createFails); created++; hasDoc = true; }
  },
  storage: {
    local: {
      get: async (k) => { if (k == null) return clone(bags.local);
        const ks = Array.isArray(k) ? k : [k];
        return Object.fromEntries(ks.filter((x) => x in bags.local).map((x) => [x, clone(bags.local[x])])); },
      set: async (o) => Object.assign(bags.local, o), remove: async () => {}
    },
    sync: { get: async () => ({}), set: async () => {}, remove: async () => {} }
  }
};
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });

const bg = await import('../src/background.js');
let fails = 0;
const ok = (n, c, e='') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + ' ' + e); } };
const cfg = { soundEnabled: true, sound: 'chime', soundHot: 'alert', soundVolume: 0.5 };

await bg.playSound(cfg);
ok('plays the new-thread sound', played.length === 1 && played[0].sound === 'chime', JSON.stringify(played));
ok('an offscreen page was created', created === 1);
ok('volume is passed through', played[0].volume === 0.5);

await bg.playSound(cfg, cfg.soundHot);
ok('a hot lead gets its own sound', played[1].sound === 'alert');
ok('the page is reused, not recreated', created === 1, String(created));

played = [];
await bg.playSound({ ...cfg, soundEnabled: false });
ok('unticking the box silences it', played.length === 0);
await bg.playSound({ ...cfg, sound: 'none' });
ok('"Silent" plays nothing', played.length === 0);
await bg.playSound({ ...cfg, soundEnabled: false }, 'alert');
ok('off beats an explicit sound too', played.length === 0);

// A sound failure is logged and swallowed - a lead must never be lost to it.
hasDoc = false; createFails = 'no offscreen here';
const r = await bg.playSound(cfg);
ok('a failure returns instead of throwing', r.ok === false && /no offscreen/.test(r.error), JSON.stringify(r));
createFails = null; hasDoc = true;

// Two checks racing must not try to create two pages.
hasDoc = false; created = 0;
await Promise.all([bg.playSound(cfg), bg.playSound(cfg), bg.playSound(cfg)]);
ok('concurrent checks create one page', created === 1, String(created));

// Chrome too old for the offscreen API.
const realOffscreen = chrome.offscreen; delete chrome.offscreen;
ok('an old Chrome fails gracefully', (await bg.playSound(cfg)).ok === false);
chrome.offscreen = realOffscreen;

// The banner. macOS shows these itself, so all that can be checked here is
// that the right thing is handed to Chrome.
globalThis.__banners = [];
let r2 = await bg.notify('2 new HAF threads', 'Looking for Bulk GMB Listings');
ok('a banner is created', r2.ok && globalThis.__banners.length === 1, JSON.stringify(r2));
const b = globalThis.__banners[0].opts;
ok('it carries the title and the thread', b.title.includes('2 new') && b.message.includes('Bulk GMB'));
ok('it has an icon, or macOS shows nothing', /icon128\.png$/.test(b.iconUrl), b.iconUrl);
ok('it offers a way into the drafts', b.buttons?.[0]?.title === 'Open the drafts');
ok('an ordinary batch does not stick on screen', b.requireInteraction === false);

globalThis.__banners = [];
await bg.notify('🔥 1 new HAF thread · 14 pts', 'Bulk GMB', { hot: true });
const hotB = globalThis.__banners[0].opts;
ok('a hot lead stays until dismissed', hotB.requireInteraction === true);
ok('and is raised to top priority', hotB.priority === 2);

// Chrome refusing (macOS blocking it) must be reported, never thrown.
chrome.notifications.create = (id, opts, cb) => { chrome.runtime.lastError = { message: 'blocked by the system' }; cb(); chrome.runtime.lastError = null; };
const blocked = await bg.notify('x', 'y');
ok('a blocked banner is reported, not thrown', blocked.ok === false && /blocked/.test(blocked.error), JSON.stringify(blocked));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
