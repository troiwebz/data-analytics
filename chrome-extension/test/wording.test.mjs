// New draft wording actually reaching the browser.
//
// This is the bug behind a public reply that still read "Hi @Patrick_jane,"
// and still asked a question, on v0.52, days after both were removed from the
// source. setConfig writes the WHOLE merged config, so the first time Save was
// ever pressed a copy of the templates was frozen into chrome.storage - and
// from then on the stored copy beat anything the code shipped. Every template
// fix since was invisible, and there was no way to tell from the outside.
//
// Untouched wording now comes from the code. Wording you rewrote yourself is
// left alone, and said so.
const store = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (k) => { if (k == null) return structuredClone(store);
        if (Array.isArray(k)) return Object.fromEntries(k.filter((x) => x in store).map((x) => [x, structuredClone(store[x])]));
        return k in store ? { [k]: structuredClone(store[k]) } : {}; },
      set: async (o) => Object.assign(store, o),
      remove: async (k) => { delete store[k]; }
    },
    sync: { get: async () => ({}), set: async () => {}, remove: async () => {} }
  }
};

const C = await import('../src/config.js');
let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + '  ' + e); } };

// Someone on an old version: their stored templates still carry the salutation
// and the question that the code no longer ships.
const OLD = {
  configVersion: 25,
  telegramChatId: '999',
  templates: {
    seo: '{Hi|Hey} @{{author}},\n\n{{tip}}\n\n{{question}}\n\n{Sent you a PM}.',
    generic: '{Hi|Hey} @{{author}},\n\n{{tip}}\n\n{{question}}\n\n{Sent you a PM}.'
  }
};
store.config = { ...OLD };

await C.migrateConfig();
let cfg = await C.getConfig();
ok('the stale wording is replaced on upgrade', !JSON.stringify(cfg.templates).includes('{{author}}'),
   JSON.stringify(cfg.templates.seo || '').slice(0, 60));
ok('and the question goes with it', !JSON.stringify(cfg.templates).includes('{{question}}'),
   JSON.stringify(cfg.templates.seo || '').slice(0, 60));
ok('the public reply is what the code ships now', cfg.templates.seo === C.DEFAULT_CONFIG.templates.seo, cfg.templates.seo);
ok('your own settings are untouched', cfg.telegramChatId === '999', cfg.telegramChatId);

// Pressing Save must not re-freeze anything.
await C.setConfig({ pollMinutes: 5 });
cfg = await C.getConfig();
ok('saving settings does not resurrect the old wording', cfg.templates.seo === C.DEFAULT_CONFIG.templates.seo,
   cfg.templates.seo);
ok('and the fingerprint says the wording is still the shipped one',
   cfg.templateDefaults === C.textStamp(C.DEFAULT_CONFIG), cfg.templateDefaults);

// The next version ships different wording. Untouched wording follows it.
const shipped = C.DEFAULT_CONFIG.templates.seo;
store.config = { ...store.config, templates: { ...store.config.templates, seo: 'OLD SHIPPED WORDING' },
                 templateDefaults: C.textStamp({ ...store.config, templates: { ...store.config.templates, seo: 'OLD SHIPPED WORDING' } }) };
let r = await C.adoptNewTemplates();
ok('wording you never touched is brought up to date', r.adopted === true, JSON.stringify(r));
ok('and it is the new wording', (await C.getConfig()).templates.seo === shipped);

// Wording you wrote yourself is yours.
store.config = { ...store.config, templates: { ...C.DEFAULT_CONFIG.templates, seo: 'MY OWN WORDING' },
                 templateDefaults: C.textStamp(C.DEFAULT_CONFIG) };
r = await C.adoptNewTemplates();
ok('wording you rewrote is left alone', r.adopted === false && r.yours === true, JSON.stringify(r));
ok('and it is still yours afterwards', (await C.getConfig()).templates.seo === 'MY OWN WORDING');

// Already current: nothing to do, and no pointless write.
store.config = { ...C.DEFAULT_CONFIG, templateDefaults: C.textStamp(C.DEFAULT_CONFIG) };
r = await C.adoptNewTemplates();
ok('nothing to adopt when it is already current', r.adopted === false && !r.yours, JSON.stringify(r));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
