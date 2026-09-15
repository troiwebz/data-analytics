// The daily counters. "I sent five PMs but it still says 1" was this: a PM
// marked sent never touched the counter, and only thread replies were shown.
const bags = { local: {} };
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
globalThis.chrome = {
  runtime: {
    onInstalled: { addListener: () => {} }, onStartup: { addListener: () => {} },
    onMessage: { addListener: (f) => { globalThis.__msg = f; } },
    getManifest: () => ({ version: '0.32.0' }), getURL: (p) => 'x/' + p, reload: () => {},
    sendMessage: async () => ({ ok: true })
  },
  action: { onClicked: { addListener: () => {} } },
  tabs: { onRemoved: { addListener: () => {} }, remove: async () => {} },
  windows: { update: () => {} },
  alarms: { onAlarm: { addListener: () => {} }, clear: async () => {}, create: () => {} },
  notifications: { create: () => {}, clear: () => {}, onClicked: { addListener: () => {} } },
  offscreen: { hasDocument: async () => true, createDocument: async () => {} },
  scripting: { executeScript: async () => [{ result: {} }] },
  storage: {
    local: {
      get: async (k) => { if (k == null) return clone(bags.local);
        const ks = Array.isArray(k) ? k : [k];
        return Object.fromEntries(ks.filter((x) => x in bags.local).map((x) => [x, clone(bags.local[x])])); },
      set: async (o) => Object.assign(bags.local, o),
      remove: async (k) => { for (const x of (Array.isArray(k) ? k : [k])) delete bags.local[x]; }
    },
    sync: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    onChanged: { addListener: () => {} }
  }
};
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });

await import('../src/background.js');
const { getRateState } = await import('../src/store.js');
const { getLeads } = await import('../src/store.js');

let fails = 0;
const ok = (n, c, e='') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + ' ' + e); } };
const send = (msg) => new Promise((r) => { globalThis.__msg(msg, {}, r); });

bags.local.recentLeads = ['a', 'b', 'c'].map((id) => ({ threadId: id, status: 'SENT', title: 't' + id, author: 'u' + id }));

// Five PMs marked sent: the counter has to move, five times.
for (const id of ['a', 'b', 'c']) await send({ cmd: 'mark-pm', threadId: id });
let r = await getRateState();
ok('three PMs count as three', r.dmCount === 3, JSON.stringify(r));
ok('and each lead is marked', (await getLeads()).filter((l) => l.pmSent).length === 3);

// Marking the same one twice must not count it twice.
await send({ cmd: 'mark-pm', threadId: 'a' });
ok('marking the same PM again counts once', (await getRateState()).dmCount === 3, String((await getRateState()).dmCount));

// Undo gives the slot back, or an undone PM still costs a slot for the day.
await send({ cmd: 'unmark-pm', threadId: 'a' });
r = await getRateState();
ok('undo returns the slot', r.dmCount === 2, JSON.stringify(r));
ok('and unmarks the lead', !(await getLeads()).find((l) => l.threadId === 'a').pmSent);
await send({ cmd: 'unmark-pm', threadId: 'a' });
ok('undoing twice does not go negative', (await getRateState()).dmCount === 2);

// Replies are a separate count, so a PM never inflates the posted number.
await send({ cmd: 'mark', threadId: 'b', status: 'POSTED' });
r = await getRateState();
ok('a posted reply counts as a reply', r.count === 1, JSON.stringify(r));
ok('and does not touch the PM count', r.dmCount === 2);
await send({ cmd: 'mark', threadId: 'b', status: 'POSTED' });
ok('marking the same reply again counts once', (await getRateState()).count === 1);
await send({ cmd: 'unmark', threadId: 'b' });
ok('undoing a reply returns its slot', (await getRateState()).count === 0);

// Skipping is not posting.
await send({ cmd: 'mark', threadId: 'c', status: 'SKIPPED' });
ok('skipping costs no slot', (await getRateState()).count === 0);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
