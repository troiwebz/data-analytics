// Keys and the chat id follow you: every settings change reaches sync, and a
// machine that is missing the chat id takes it from there - even when it is
// otherwise set up.
const local = {}, sync = {};
const clone = (v) => JSON.parse(JSON.stringify(v));
const area = (s) => ({
  get: async (k) => { if (k == null) return clone(s); const o = {}; for (const x of [].concat(k)) if (x in s) o[x] = clone(s[x]); return o; },
  set: async (o) => { for (const [k, v] of Object.entries(o)) s[k] = clone(v); },
  remove: async (k) => { for (const x of [].concat(k)) delete s[x]; }
});
globalThis.chrome = { storage: { local: area(local), sync: area(sync) } };
const { setConfig, getConfig } = await import('../src/config.js');
const { fillEssentials } = await import('../src/backup.js');
const vault = await import('../src/vault.js');

let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + '  ' + e); } };
const tick = () => new Promise((r) => setTimeout(r, 20));

// Machine A: the chat id is set from Telegram ("Find it for me"), not by Save.
await setConfig({ telegramChatId: '8812664414' });
await tick();
ok('a chat id set any way reaches your Google account', sync['c:telegramChatId'] === '8812664414', JSON.stringify(sync['c:telegramChatId']));
await vault.setSecret('anthropic', 'sk-ant-test');
await vault.setSecret('telegram', '123:abc');
ok('the Claude key and bot token reach it too', sync.vault?.key === 'sk-ant-test' && sync.vault?.tgToken === '123:abc');

// Machine B: set up (many settings), but no chat id and no keys.
for (const k of Object.keys(local)) delete local[k];
local.config = { configVersion: 40, pollMinutes: 6, autoMode: true, watchWords: [{ word: 'casino' }], telegramChatId: '' };
const filled = await fillEssentials();
ok('the missing chat id is filled from sync on an install that is otherwise set up', filled.includes('telegramChatId') && (await getConfig()).telegramChatId === '8812664414', JSON.stringify(filled));
ok('and its own settings are left alone', (await getConfig()).pollMinutes === 6 && (await getConfig()).autoMode === true);
ok('the keys come back from the vault mirror', (await vault.getSecret('anthropic')) === 'sk-ant-test' && (await vault.getSecret('telegram')) === '123:abc');

// A chat id already here is never replaced.
local.config.telegramChatId = '555';
ok('a chat id already set is never overwritten', (await fillEssentials()).length === 0 && (await getConfig()).telegramChatId === '555');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
