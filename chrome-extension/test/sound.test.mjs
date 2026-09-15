// The sound: one per check, the right one, and never at the cost of a lead.
const bags = { local: {} };
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
let played = [], created = 0, hasDoc = false, createFails = null;

globalThis.chrome = {
  runtime: {
    onInstalled: { addListener: () => {} }, onStartup: { addListener: () => {} },
    onMessage: { addListener: () => {} },
    getManifest: () => ({ version: '0.30.0' }), getURL: (p) => 'chrome-extension://x/' + p,
    sendMessage: async (m) => { if (m?.target === 'offscreen-audio') { played.push(m); return { ok: true }; } return {}; }
  },
  action: { onClicked: { addListener: () => {} } },
  tabs: { onRemoved: { addListener: () => {} } },
  alarms: { onAlarm: { addListener: () => {} }, clear: async () => {}, create: () => {} },
  notifications: { create: () => {} },
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

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
