// Keys typed in Terminal land in the extension, replacing old ones, once.
const local = {}, sync = {};
let fileText = null;
const clone = (v) => JSON.parse(JSON.stringify(v));
const area = (s) => ({ get: async (k) => { const o = {}; for (const x of [].concat(k)) if (x in s) o[x] = clone(s[x]); return o; },
  set: async (o) => { for (const [k, v] of Object.entries(o)) s[k] = clone(v); }, remove: async (k) => { for (const x of [].concat(k)) delete s[x]; } });
globalThis.chrome = { storage: { local: area(local), sync: area(sync) }, runtime: { getURL: (p) => 'chrome-extension://x/' + p } };
globalThis.fetch = async () => (fileText == null ? { ok: false } : { ok: true, text: async () => fileText });
const { loadKeysFile } = await import('../src/keysfile.js');
const vault = await import('../src/vault.js');
let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + '  ' + e); } };
let chat = '';
const deps = { setChatId: async (id) => { chat = id; } };

ok('no file, nothing happens', (await loadKeysFile(deps)) === null);
await vault.setSecret('anthropic', 'sk-ant-OLD');
fileText = JSON.stringify({ anthropicKey: 'sk-ant-NEW-key-123', telegramToken: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw', telegramChatId: '8812664414' });
let r = await loadKeysFile(deps);
ok('all three are loaded', JSON.stringify(r.took) === JSON.stringify(['Claude key', 'bot token', 'chat id']), JSON.stringify(r));
ok('the Terminal key replaces the old one', (await vault.getSecret('anthropic')) === 'sk-ant-NEW-key-123');
ok('the bot token is stored', (await vault.getSecret('telegram')) === '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw');
ok('the chat id is set', chat === '8812664414');
ok('and they reach your Google account too', sync.vault?.key === 'sk-ant-NEW-key-123');
ok('the same file is not loaded twice', (await loadKeysFile(deps)) === null);
fileText = JSON.stringify({ anthropicKey: 'not-a-key' });
r = await loadKeysFile(deps);
ok('a malformed key is refused and says why', /does not start with sk-ant-/.test(r?.error || ''), JSON.stringify(r));
ok('and the good key stays', (await vault.getSecret('anthropic')) === 'sk-ant-NEW-key-123');
fileText = JSON.stringify({ telegramChatId: '555123' });
r = await loadKeysFile(deps);
ok('a file with only a chat id changes only the chat id', JSON.stringify(r.took) === '["chat id"]' && (await vault.getSecret('anthropic')) === 'sk-ant-NEW-key-123');
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
