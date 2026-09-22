// The key must survive every wipe except pressing Remove.
let local = {}, sync = {};
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const mk = (bag) => ({
  get: async (k) => { if (k == null) return clone(bag);
    const ks = Array.isArray(k) ? k : [k];
    return Object.fromEntries(ks.filter((x) => x in bag).map((x) => [x, clone(bag[x])])); },
  set: async (o) => Object.assign(bag, o),
  remove: async (k) => { for (const x of (Array.isArray(k) ? k : [k])) delete bag[x]; }
});
globalThis.chrome = { storage: { local: mk(local), sync: mk(sync) } };
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) });

const C = await import('../src/claude.js');
const V = await import('../src/vault.js');
let fails = 0;
const ok = (n, c, e='') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + ' ' + e); } };
const wipeLocal = () => { for (const k of Object.keys(local)) delete local[k]; };

await C.saveKey('sk-ant-api03-VAULTTESTKEY01');
await C.setModel('claude-haiku-4-5');
await C.setBudget(1.25);

ok('key is NOT in the settings object', !('key' in (local.ai || {})), JSON.stringify(local.ai));
ok('key is in its own store', local.vault.key === 'sk-ant-api03-VAULTTESTKEY01');
ok('backed up to the Chrome profile', sync.vault.key === 'sk-ant-api03-VAULTTESTKEY01');
ok('settings mirror carries no key', !('key' in (sync.aiSettings || {})), JSON.stringify(sync.aiSettings));

// 1. Reset all settings.
await chrome.storage.local.remove('config');
ok('settings reset keeps the key', (await C.aiStatus()).configured);

// 2. Clearing the lead database.
await chrome.storage.local.remove(['recentLeads', 'seenThreads', 'log']);
ok('database clear keeps the key', (await C.aiStatus()).configured);

// 3. The explicit factory reset.
local.recentLeads = [1, 2]; local.config = { x: 1 }; local.ai = { model: 'claude-opus-5' };
const fr = await C.factoryReset();
ok('factory reset reports the key kept', fr.keyKept);
ok('factory reset cleared the database', !local.recentLeads && !local.config);
ok('factory reset left the key', (await C.aiStatus()).configured);

// 4. New extension id: local emptied entirely, profile intact.
wipeLocal();
let st = await C.aiStatus();
ok('reinstall restores the key', st.configured && st.hint === 'sk-ant-api0…EY01', JSON.stringify(st));
ok('says it was just restored', st.restored);
ok('and does not say so again', !(await C.aiStatus()).restored);

// 5. Upgrading from v0.21, where the key lived inside the settings object.
wipeLocal(); delete sync.vault; delete sync.aiSettings;
local.ai = { key: 'sk-ant-api03-OLDPLACEKEY99', model: 'claude-sonnet-5', budget: 0.5 };
st = await C.aiStatus();
ok('v0.21 key is migrated into the vault', local.vault?.key === 'sk-ant-api03-OLDPLACEKEY99', JSON.stringify(local.vault));
ok('and taken out of the settings object', !('key' in local.ai));
ok('and still works', st.configured && st.hint === 'sk-ant-api0…EY99');

// 6. Copying it back out.
ok('can be read back for a password manager', (await C.revealKey()) === 'sk-ant-api03-OLDPLACEKEY99');

// 7. Remove is the only thing that deletes it.
await C.clearKey();
ok('Remove clears the local copy', !local.vault);
ok('Remove clears the profile copy too', !sync.vault);
wipeLocal();
ok('and it does not come back', !(await C.aiStatus()).configured);

// 7.5 syncStatus: "would a new machine, signed in and synced, already have
// this" - answered without moving anything anywhere to find out.
{
  const wipeSync = () => { for (const k of Object.keys(sync)) delete sync[k]; };
  wipeSync();
  let st = await V.syncStatus();
  ok('nothing saved yet reads as available but empty', st.available === true && st.hasSecrets === false,
     JSON.stringify(st));

  await C.saveKey('sk-ant-api03-SYNCSTATUSCHK1');
  st = await V.syncStatus();
  ok('once a key is saved, sync reports it has one', st.hasSecrets === true, JSON.stringify(st));
  ok('with when it was saved', st.savedAt > 0, JSON.stringify(st));

  // The whole point: a SEPARATE machine reading only the sync copy (its own
  // local is empty) must see the same answer - that is what "arrives by
  // itself" actually means.
  wipeLocal();
  st = await V.syncStatus();
  ok('and that answer does not depend on anything being in THIS machine\'s local storage',
     st.hasSecrets === true, JSON.stringify(st));

  await C.clearKey();
  wipeSync();
}

// 8. Chrome sync unavailable: everything still works, just without the backup.
chrome.storage.sync.set = async () => { throw new Error('sync off'); };
chrome.storage.sync.get = async () => { throw new Error('sync off'); };
await C.saveKey('sk-ant-api03-NOSYNCHERE0001');
ok('saves with sync off', (await C.aiStatus()).configured);
ok('reports that there is no backup', !(await C.aiStatus()).mirrored);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
