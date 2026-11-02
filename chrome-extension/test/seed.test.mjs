// Keys that travel with the folder.
//
// The vault belongs to one Chrome profile on one machine, so copying the
// extension to a server copied the code and none of the setup - every move
// meant retyping an Anthropic key and a Telegram token by hand over RDP. A
// haf-secrets.json beside manifest.json is read on install and on every
// browser start, so the folder carries its own configuration.
//
// The two rules this file holds down: it never overwrites a key that is
// already here, and a file that is absent or broken never breaks startup.
const store = {};
let seedText = null;              // null = no such file

globalThis.chrome = {
  runtime: {
    getURL: (p) => 'chrome-extension://x/' + p,
    getManifest: () => ({ version: '0.76.0' })
  },
  storage: {
    local: {
      get: async (k) => { if (k == null) return structuredClone(store);
        if (Array.isArray(k)) return Object.fromEntries(k.filter((x) => x in store).map((x) => [x, structuredClone(store[x])]));
        return k in store ? { [k]: structuredClone(store[k]) } : {}; },
      set: async (o) => Object.assign(store, o),
      remove: async (k) => { for (const x of (Array.isArray(k) ? k : [k])) delete store[x]; }
    },
    session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    sync: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    onChanged: { addListener: () => {} }
  }
};

globalThis.fetch = async (url) => {
  if (String(url).endsWith('haf-secrets.json')) {
    if (seedText === null) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => seedText };
  }
  return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
};

const seed = await import('../src/seed.js');
const vault = await import('../src/vault.js');
const { DEFAULT_CONFIG } = await import('../src/config.js');

let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + '  ' + e); } };

const reset = () => { for (const k of Object.keys(store)) delete store[k]; };

// --- no file is the normal case ---------------------------------------------
seedText = null;
let r = await seed.applySeed();
ok('no seed file is not an error', r.none === true, JSON.stringify(r));
ok('and the panel says there is none', (await seed.seedStatus()).present === false);

// --- the plain hand-written shape -------------------------------------------
reset();
seedText = JSON.stringify({
  anthropicKey: 'sk-ant-seeded', telegramToken: '111:seeded', telegramChatId: '8812664414'
});
r = await seed.applySeed();
ok('a hand-written file is accepted', r.ok === true, JSON.stringify(r));
ok('the Claude key is in the vault', (await vault.getSecret('anthropic')) === 'sk-ant-seeded');
ok('the bot token too', (await vault.getSecret('telegram')) === '111:seeded');
ok('and the chat id lands in the config', store.config.telegramChatId === '8812664414',
   JSON.stringify(store.config?.telegramChatId));

// Reading it again must not churn: nothing has changed.
r = await seed.applySeed();
ok('an unchanged file is not applied twice', r.already === true, JSON.stringify(r));
ok('and the panel knows it has been read', (await seed.seedStatus()).applied === true);

// --- a key already here wins ------------------------------------------------
//
// The browser you are sitting at is the more recent authority. A stale file in
// the folder must not undo a key you rotated this morning - that would be the
// setup silently reverting itself on every restart.
reset();
await vault.setSecret('anthropic', 'sk-ant-rotated-today');
seedText = JSON.stringify({ anthropicKey: 'sk-ant-old-and-revoked', telegramToken: '222:fresh' });
r = await seed.applySeed();
ok('the key already in the browser is kept', (await vault.getSecret('anthropic')) === 'sk-ant-rotated-today',
   await vault.getSecret('anthropic'));
ok('and it says which one it left alone', (r.kept || []).includes('anthropic'), JSON.stringify(r));
ok('while a key that was missing is still filled in',
   (await vault.getSecret('telegram')) === '222:fresh');

// force is the button in Settings: use the file even where I already have one.
r = await seed.applySeed({ force: true });
ok('forcing does overwrite, because you asked', (await vault.getSecret('anthropic')) === 'sk-ant-old-and-revoked',
   await vault.getSecret('anthropic'));

// --- settings fill gaps, they do not replace --------------------------------
reset();
store.config = { ...DEFAULT_CONFIG, telegramChatId: '', pollMinutes: 7, brief: 'mine, typed here' };
seedText = JSON.stringify({ telegramChatId: '999', config: { pollMinutes: 99, brief: 'from the file' } });
await seed.applySeed();
ok('a setting the browser did not have is taken from the file', store.config.telegramChatId === '999',
   store.config.telegramChatId);
ok('a setting you already have is left as yours', store.config.pollMinutes === 7,
   String(store.config.pollMinutes));
ok('including text you typed', store.config.brief === 'mine, typed here', store.config.brief);

// --- the export shape works unchanged --------------------------------------
//
// Deliberate: "Download haf-secrets.json" in Settings is the ordinary settings
// export, so the file needs no editing to work as a seed.
reset();
seedText = JSON.stringify({
  kind: 'haf-watcher-settings', version: '0.75.0',
  config: { ...DEFAULT_CONFIG, telegramChatId: '4242' },
  secrets: { anthropic: 'sk-ant-exported', telegram: '333:exported' }
});
r = await seed.applySeed();
ok('a settings export doubles as a seed file', r.ok === true, JSON.stringify(r));
ok('with its keys', (await vault.getSecret('anthropic')) === 'sk-ant-exported');
ok('and its settings', store.config.telegramChatId === '4242', store.config.telegramChatId);

// --- a broken file is reported, never fatal ---------------------------------
reset();
seedText = '{ this is not json';
r = await seed.applySeed();
ok('unreadable JSON is reported', /not valid JSON/.test(r.error || ''), JSON.stringify(r));
ok('and the panel shows the error rather than claiming it worked',
   (await seed.seedStatus()).error !== undefined);

reset();
seedText = JSON.stringify({ nothing: 'useful' });
r = await seed.applySeed();
ok('a file with no keys and no settings says so', /no keys or settings/.test(r.error || ''), JSON.stringify(r));

reset();
seedText = '';
ok('an empty file reads as no file', (await seed.applySeed()).none === true);

// --- an edited file is picked up --------------------------------------------
reset();
seedText = JSON.stringify({ telegramToken: '444:first' });
await seed.applySeed();
seedText = JSON.stringify({ telegramToken: '444:first', telegramChatId: '777' });
r = await seed.applySeed();
ok('changing the file makes it apply again', r.ok === true, JSON.stringify(r));
ok('and the new value lands', store.config.telegramChatId === '777', store.config.telegramChatId);

// --- the status panel reports contents without leaking them -----------------
reset();
seedText = JSON.stringify({ anthropicKey: 'sk-ant-secret-value', telegramChatId: '5' });
const st = await seed.seedStatus();
ok('the panel says a Claude key is in there', st.has.anthropic === true, JSON.stringify(st));
ok('and that the bot token is not', st.has.telegram === false, JSON.stringify(st));
ok('and never repeats the key itself', !JSON.stringify(st).includes('sk-ant-secret-value'), JSON.stringify(st));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
