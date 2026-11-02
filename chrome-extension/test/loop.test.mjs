// Reproduce the render loop: a storage READ must never cause a storage WRITE.
let local = {}, sync = {}, writes = 0;
// chrome.storage serializes, so a get() hands back a COPY. A stub that
// returns live references silently makes mutate-the-result bugs pass.
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const mk = (bag, count) => ({
  get: async (k) => { if (k == null) return clone(bag);
    const ks = Array.isArray(k) ? k : [k];
    return Object.fromEntries(ks.filter((x) => x in bag).map((x) => [x, clone(bag[x])])); },
  set: async (o) => { if (count) writes++; Object.assign(bag, o); },
  remove: async (k) => { if (count) writes++; for (const x of (Array.isArray(k) ? k : [k])) delete bag[x]; }
});
globalThis.chrome = { storage: { local: mk(local, true), sync: mk(sync, true) } };
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) });

const C = await import('../src/claude.js');
let fails = 0;
const ok = (n, c, e='') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + ' ' + e); } };

// The exact state a v0.22 user upgrades from: the key inside the settings
// mirror in profile storage, nothing in the vault yet.
sync.aiSettings = { key: 'sk-ant-api03-FROMVERSION022X', model: 'claude-sonnet-5', budget: 0.5, enabled: true };
local.ai = { model: 'claude-sonnet-5', budget: 0.5, enabled: true, usage: { day: '2026-09-15', calls: 2, leads: 3, in: 800, cached: 300, out: 90 } };

await C.aiStatus();                       // first call: migration, writes expected
ok('the v0.22 key is migrated', (await C.revealKey()) === 'sk-ant-api03-FROMVERSION022X');
const afterMigration = writes;
ok('migration did write', afterMigration > 0, String(afterMigration));

// Everything after this is a plain read. The dashboard calls it on every
// render, and chrome.storage.onChanged triggers a render, so a write here is
// an infinite loop.
writes = 0;
for (let i = 0; i < 20; i++) await C.aiStatus();
ok('20 status reads cause no writes at all', writes === 0, `${writes} writes`);

ok('the stale key is gone from the settings mirror', !sync.aiSettings?.key, JSON.stringify(sync.aiSettings));

// Same for a v0.21 user, whose key sat in the local settings object.
local = Object.keys(local).forEach((k) => delete local[k]);
for (const k of Object.keys(sync)) delete sync[k];
globalThis.chrome.storage.local = mk(globalThis.__l = {}, true);
globalThis.chrome.storage.sync = mk(globalThis.__s = {}, true);
globalThis.__l.ai = { key: 'sk-ant-api03-FROMVERSION021X', model: 'claude-opus-5', budget: 1 };
await C.aiStatus();
writes = 0;
for (let i = 0; i < 20; i++) await C.aiStatus();
ok('v0.21 upgrade also settles to zero writes', writes === 0, `${writes} writes`);
ok('and its key still works', (await C.revealKey()) === 'sk-ant-api03-FROMVERSION021X');

// A steady state with nothing to migrate must also be write-free.
writes = 0;
for (let i = 0; i < 20; i++) { await C.aiStatus(); await C.getAi(); }
ok('steady state is write-free', writes === 0, `${writes} writes`);

// Saving the same key twice must not churn storage either.
const k = await C.revealKey();
writes = 0;
await C.saveKey(k);
ok('re-saving an identical key writes nothing', writes === 0, `${writes} writes`);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
