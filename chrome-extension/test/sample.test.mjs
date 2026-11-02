// Settings → Telegram → "Send a sample lead".
//
// The point of that button is to answer "is the whole thing actually working?"
// before a real lead arrives, so the sample has to go through the real matcher,
// the real templates and the real closes - and both halves have to land: the
// PM you paste into the inbox, and the public reply. Losing the PM half is the
// exact bug the button exists to catch, so it is checked here on the very
// object the button sends (src/sample.js), not a lookalike.
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

// Telegram's API, captured. Nothing else is meant to go out.
let sent = [];
globalThis.fetch = async (url, opts) => {
  sent.push({ url: String(url), body: JSON.parse(opts.body) });
  return { ok: true, status: 200, json: async () => ({ ok: true, result: { username: 'haf_bot' } }) };
};

const { sampleThread, unscored } = await import('../src/sample.js');
const { matchLead } = await import('../src/matcher.js');
const bg = await import('../src/background.js');
const T = await import('../src/telegram.js');
const { DEFAULT_CONFIG } = await import('../src/config.js');

let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + ' ' + e); } };

const cfg = { ...DEFAULT_CONFIG, telegramEnabled: true, telegramChatId: '881266', telegramSend: 'both' };

// Exactly what the button builds, minus Claude (which needs a key).
const s = sampleThread();
const m = matchLead(s, cfg) || unscored(s);
const lead = bg.enrich(m, cfg, 'SENT', null);

ok('the sample carries a PM to paste', typeof lead.dm === 'string' && lead.dm.trim().length > 80, JSON.stringify(lead.dm || '').slice(0, 60));
ok('and a subject line for it', !!lead.dmTitle, lead.dmTitle);
ok('and a public reply', typeof lead.draft === 'string' && lead.draft.trim().length > 40, JSON.stringify(lead.draft || '').slice(0, 60));
ok('and a link straight to the inbox composer', /direct-messages/.test(lead.dmUrl || ''), lead.dmUrl);
ok('the PM names the buyer, not a placeholder', lead.dm.includes(s.author), lead.dm.slice(0, 60));
ok('no unreplaced template slot leaks through', !/\{\{|\}\}|undefined|\[object/.test(lead.dm + lead.draft),
   (lead.dm + lead.draft).match(/\{\{.*?\}\}|undefined|\[object \w+/)?.[0] || '');

await T.setToken('1234567890:AAsampletoken');
sent = [];
const halves = [];
await T.sendLead(lead, cfg, { onPart: (n, e) => !e && halves.push(n) });

ok('both halves go out', halves.length === 2, halves.join(' + '));
ok('the PM is one of them', halves.includes('PM'), halves.join(' + '));
ok('the public reply is the other', halves.includes('public reply'), halves.join(' + '));
ok('two Telegram messages, no more', sent.length === 2, String(sent.length));
ok('both to the configured chat', sent.every((x) => x.body.chat_id === '881266'));

const pm = sent.find((x) => /PM|inbox/i.test(x.body.text));
ok('the PM message carries the body you paste', !!pm && pm.body.text.includes(lead.dm.split('\n')[0].trim()),
   (pm?.body.text || '').slice(0, 80));
ok('and the inbox link to paste it into', !!pm && pm.body.text.includes('direct-messages'), (pm?.body.text || '').slice(0, 80));

// Nothing but Telegram should be contacted by a sample.
ok('nothing is posted to the forum', sent.every((x) => x.url.startsWith('https://api.telegram.org/')),
   sent.map((x) => x.url).join(' '));

// A thread the matcher declines still has to produce something sendable.
const bare = bg.enrich(unscored(sampleThread()), cfg, 'SENT', null);
ok('an unscored sample still has both halves', !!bare.dm?.trim() && !!bare.draft?.trim());

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
