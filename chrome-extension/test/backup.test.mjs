// Settings that survive the machine.
//
// Only the two secrets were mirrored before. Everything else lived in
// chrome.storage.local, which is per-install: move to a new machine and the
// extension comes up looking configured - the vault has the keys - with every
// setting silently back to default.
//
// chrome.storage.sync allows 102,400 bytes in total but only 8,192 per item,
// and the config is ~12KB in one piece. Storing it whole would be rejected in
// a callback nobody reads, so it goes one key per setting.
const local = {}, sync = {};
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const area = (bag, cap) => ({
  get: async (k) => { if (k == null) return clone(bag);
    if (Array.isArray(k)) return Object.fromEntries(k.filter((x) => x in bag).map((x) => [x, clone(bag[x])]));
    return k in bag ? { [k]: clone(bag[k]) } : {}; },
  set: async (o) => {
    // Real quota behaviour: sync rejects the whole write if any item is over.
    if (cap) for (const [k, v] of Object.entries(o)) {
      if (JSON.stringify(v ?? null).length > cap) throw new Error(`QUOTA_BYTES_PER_ITEM quota exceeded (${k})`);
    }
    Object.assign(bag, o);
  },
  remove: async (k) => { for (const x of (Array.isArray(k) ? k : [k])) delete bag[x]; }
});
globalThis.chrome = {
  runtime: { getManifest: () => ({ version: '0.65.0' }) },
  storage: { local: area(local), sync: area(sync, 8192) }
};

const B = await import('../src/backup.js');
const { DEFAULT_CONFIG } = await import('../src/config.js');

let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + '  ' + e); } };

const mine = { ...DEFAULT_CONFIG, telegramChatId: '8812664414', telegramApprovals: true,
               maxDmsPerDay: 20, timezone: 'Asia/Kolkata', brief: 'Six person agency in Chennai.' };

// --- mirroring to sync ------------------------------------------------------
const pushed = await B.pushConfig(mine);
ok('the settings mirror to sync', pushed.ok === true, JSON.stringify(pushed));
ok('and nothing was too big for it', !pushed.tooBig.length, JSON.stringify(pushed.tooBig));
ok('stored one key per setting, not one big blob',
   Object.keys(sync).filter((k) => k.startsWith('c:')).length > 20,
   String(Object.keys(sync).filter((k) => k.startsWith('c:')).length));
ok('every item is inside the 8KB per-item limit',
   Object.values(sync).every((v) => JSON.stringify(v ?? null).length <= 8192));
ok('and the whole lot is inside the 102KB total',
   JSON.stringify(sync).length < 102400, String(JSON.stringify(sync).length));

const read = await B.readSynced();
ok('it reads back', !!read && read.at > 0, JSON.stringify(read?.at));
ok('with the chat id that was so hard to set', read.cfg.telegramChatId === '8812664414', read.cfg.telegramChatId);
ok('and your own limits, not the defaults', read.cfg.maxDmsPerDay === 20, String(read.cfg.maxDmsPerDay));
ok('and your brief', /Chennai/.test(read.cfg.brief || ''), read.cfg.brief);

// A setting too big for one sync item is left behind and NAMED, rather than
// failing the whole backup in a callback nobody reads.
const huge = { ...mine, specifics: { x: 'y'.repeat(9000) } };
const r2 = await B.pushConfig(huge);
ok('an oversized setting does not sink the whole backup', r2.ok === true, JSON.stringify(r2));
ok('and it is named so the hole is not silent', r2.tooBig.includes('specifics'), JSON.stringify(r2.tooBig));

// --- a fresh install --------------------------------------------------------
delete local.config;
let back = await B.restoreIfEmpty();
ok('a new machine gets its settings back', back.restored === true, JSON.stringify(back));
ok('including the chat id', local.config.telegramChatId === '8812664414', local.config.telegramChatId);
ok('and the approval buttons stay switched on', local.config.telegramApprovals === true);

// A machine that is already set up keeps what it has. Silently replacing it
// with whatever another machine last wrote loses an afternoon's tuning.
local.config = { ...DEFAULT_CONFIG, telegramChatId: 'LOCAL', maxDmsPerDay: 3, brief: 'mine' };
back = await B.restoreIfEmpty();
ok('a machine already set up is left alone', back.restored === false, JSON.stringify(back));
ok('and keeps its own settings', local.config.telegramChatId === 'LOCAL', local.config.telegramChatId);

// --- the file ---------------------------------------------------------------
const plain = await B.exportAll();
ok('the file carries the settings', plain.config.telegramChatId === 'LOCAL', JSON.stringify(plain.config?.telegramChatId));
ok('and says what it is', plain.kind === 'haf-watcher-settings');
ok('secrets are NOT in it by default', !plain.secrets, JSON.stringify(plain.secrets));

// Importing something else must refuse rather than wipe your settings.
const bad = await B.importAll({ kind: 'something-else', config: { telegramChatId: 'X' } });
ok('a file from another program is refused', !!bad.error, JSON.stringify(bad));
ok('and changes nothing', local.config.telegramChatId === 'LOCAL', local.config.telegramChatId);
ok('an empty file is refused too', !!(await B.importAll({ kind: 'haf-watcher-settings', config: {} })).error);

const good = await B.importAll({ kind: 'haf-watcher-settings', version: '0.64.0',
  config: { ...DEFAULT_CONFIG, telegramChatId: 'FROMFILE', maxPostsPerDay: 42 } });
ok('a real settings file restores', good.ok === true, JSON.stringify(good));
ok('and the settings are live', local.config.telegramChatId === 'FROMFILE' && local.config.maxPostsPerDay === 42,
   JSON.stringify({ id: local.config.telegramChatId, cap: local.config.maxPostsPerDay }));
ok('and it is mirrored to sync as well, so the new machine is covered both ways',
   (await B.readSynced()).cfg.telegramChatId === 'FROMFILE');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
