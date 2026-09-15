// End-to-end: boot the service worker with NO Apps Script configured and run a
// full poll. Nothing may throw, and Claude must be called locally.
const store = {};
const listeners = [];
globalThis.chrome = {
  runtime: {
    onInstalled: { addListener: (f) => listeners.push(f) },
    onStartup:   { addListener: () => {} },
    onMessage:   { addListener: (f) => { globalThis.__msg = f; } },
    getManifest: () => ({ version: '0.21.0' }),
    getURL: (p) => 'chrome-extension://x/' + p,
    reload: () => {},
    sendMessage: async (m) => {
      if (m?.target === 'offscreen-audio') { globalThis.__sounds.push(m); return { ok: true }; }
      return {};
    }
  },
  action: { onClicked: { addListener: () => {} } },
  tabs: { onRemoved: { addListener: () => {} }, query: async () => [], create: async () => ({ id: 1 }) },
  alarms: { onAlarm: { addListener: () => {} }, clear: async () => {}, create: () => {} },
  notifications: { create: (id, o, cb) => cb && cb(id), clear: () => {},
                   onClicked: { addListener: () => {} }, onButtonClicked: { addListener: () => {} } },
  offscreen: { hasDocument: async () => false, createDocument: async () => {} },
  scripting: { executeScript: async () => [{ result: { ok: true } }] },
  storage: { local: {
    get: async (k) => {
      if (k == null) return structuredClone(store);
      if (Array.isArray(k)) return Object.fromEntries(k.filter((x) => x in store).map((x) => [x, structuredClone(store[x])]));
      return k in store ? { [k]: structuredClone(store[k]) } : {};
    },
    set: async (o) => Object.assign(store, o),
    remove: async (k) => { delete store[k]; }
  },
  sync: { get: async () => ({}), set: async () => {}, remove: async () => {} } }
};

const RSS = `<rss><channel>${Array.from({ length: 3 }, (_, i) => `
  <item>
    <title>Need local citations for Dubai and UK ${i}</title>
    <link>https://www.blackhatworld.com/threads/need-local-citations.${1900000 + i}/</link>
    <pubDate>${new Date().toUTCString()}</pubDate>
    <dc:creator>buyer${i}</dc:creator>
    <description>Looking for manual citation building, NAP consistency, budget $300</description>
  </item>`).join('')}</channel></rss>`;

const LISTING = `<html>${Array.from({ length: 3 }, (_, i) => `
  <div class="structItem structItem--thread js-threadListItem-${1900000 + i}">
    <div class="structItem-title"><a href="/threads/x.${1900000 + i}/">Need local citations for Dubai and UK ${i}</a></div>
    <a href="/members/buyer${i}.1/" class="username">buyer${i}</a>
    <time class="structItem-startDate" data-timestamp="${Math.floor(Date.now() / 1000) - 600}"></time>
    <dd>${i}</dd>
  </div>`).join('')}</html>`;

let aiCalls = 0;
let tg = [];
globalThis.__sounds = [];
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('api.anthropic.com/v1/models')) return { ok: true, status: 200, json: async () => ({ data: [] }) };
  if (u.includes('api.anthropic.com')) {
    aiCalls++;
    const ids = JSON.parse(opts.body).messages[0].content.match(/id: (\d+)/g).map((s) => s.slice(4));
    return { ok: true, status: 200, json: async () => ({
      content: [{ type: 'text', text: JSON.stringify(Object.fromEntries(ids.map((id) => [id, {
        tips: ['We have built citations manually on directories that index in the UAE', 'We can audit the NAP across the existing profiles first', 'We are able to fix GMB categories before anything else'],
        question: 'Audit-safe citations, or volume for a tier 2 layer?', offer: 'formula'
      }]))) }],
      usage: { input_tokens: 800, cache_read_input_tokens: 300, output_tokens: 90 }
    }) };
  }
  if (u.includes('api.telegram.org')) { tg.push(JSON.parse(opts.body)); return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) }; }
  if (u.includes('script.google.com')) throw new Error('Apps Script must NOT be called');
  if (u.includes('index.rss')) return { ok: true, status: 200, text: async () => RSS };
  if (u.includes('manifest.json')) return { ok: true, json: async () => ({ version: '0.21.0' }) };
  return { ok: true, status: 200, text: async () => LISTING };
};

const bg = await import('../src/background.js');
const { setConfig, getConfig } = await import('../src/config.js');
const C = await import('../src/claude.js');

let fails = 0;
const ok = (n, c, e='') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + ' ' + e); } };

await C.saveKey('sk-ant-api03-TESTKEYTESTKEY');
// No webhookUrl, no sharedSecret: the Apps Script path must never be touched.
await setConfig({ enabled: true, webhookUrl: '', sharedSecret: '', backfillHours: 0,
                  telegramEnabled: true, telegramChatId: '999' });
const TG = await import('../src/telegram.js');
await TG.setToken('1234567890:AAtesttoken');

let r = await bg.pollFeed();                    // first run seeds the database
ok('first run seeds without Apps Script', r.seeded === 3, JSON.stringify(r));

// Forget the seeded ids so the same threads come back as new.
store.seenThreads = { 'x': Date.now() };
r = await bg.pollFeed();
ok('second poll finds the threads', r.matched === 3, JSON.stringify(r));
ok('Claude called once for the batch', aiCalls === 1, 'calls=' + aiCalls);

const leads = store.recentLeads || [];
ok('leads stored locally', leads.length === 3, String(leads.length));
const lead = leads[0];
ok("Claude's lines are in the public reply", lead.draft.includes('We have built citations manually'), lead.draft.slice(0, 300));
ok("Claude's lines are in the PM", lead.dm.includes('We have built citations manually'));
ok('the PM has the heading and the sign-off', lead.dm.includes('**Why We Can Do It:**') && lead.dm.trim().endsWith('Thanks!!'));
ok('PM opens with the thread link', /(saw|read|came across) your (HAF )?thread/i.test(lead.dm) && lead.dm.includes(lead.url));
ok('public reply carries one tip only', (lead.draft.match(/We (have built|can audit|are able)/g) || []).length === 1);
ok('the PM carries all three', (lead.dm.match(/We (have built|can audit|are able)/g) || []).length === 3);
ok('the public reply asks the question', /tier 2 layer\?/.test(lead.draft), lead.draft);
ok('the PM carries the close Claude chose', /whole method|sequence|order/i.test(lead.dm), lead.dm);
ok('no em dash in the reply', !/[–—]/.test(lead.draft + lead.dm));
ok('compliance ran', Array.isArray(lead.lint?.problems) || lead.lint != null);
ok('DM url built', /direct-messages\/add\?to=/.test(lead.dmUrl), lead.dmUrl);
// A &title= on the end is not something a person ever produces, so it stands out.
ok('the DM url is exactly what a human gets from a profile', !/[?&]title=/.test(lead.dmUrl), lead.dmUrl);
ok('the subject is still generated, just not in the url', !!lead.dmTitle, lead.dmTitle);

const st = await C.aiStatus();
ok('spend recorded', st.spentToday > 0 && st.leadsToday === 3, JSON.stringify(st));

// Telegram fires by itself on a new thread, with no Apps Script involved.
ok('a sound played for the check', globalThis.__sounds.length === 1, JSON.stringify(globalThis.__sounds));
ok('one sound for three threads, not three', globalThis.__sounds.filter((s) => s.target === 'offscreen-audio').length === 1);
ok('Telegram got two messages per new thread', tg.length === 6, String(tg.length));
ok('the public reply went to Telegram', tg.some((m) => /We have built citations manually/.test(m.text) && /Public reply/.test(m.text)));
ok('Telegram gets the words, not the bold markers', !tg.some((m) => m.text.includes('**')));
ok('the PM went to Telegram as its own message', tg.some((m) => /PM to buyer0/.test(m.text)));
ok('everything went to the configured chat', tg.every((m) => m.chat_id === '999'));

// --- Rebuild drafts: leads found before the key existed get Claude lines now.
store.recentLeads = store.recentLeads.map((l) => {
  const { aiSpecifics, ...rest } = l;
  return { ...rest, draft: 'stale draft', dm: 'stale dm', status: 'SENT' };
});
const callsBefore = aiCalls;
const rg = await globalThis.__msg({ cmd: 'regen' }, {}, () => {});
await new Promise((r) => setTimeout(r, 50));
const after = store.recentLeads;
ok('rebuild asked Claude again', aiCalls > callsBefore, 'calls=' + aiCalls);
ok('old leads now carry Claude lines', after.every((l) => l.aiSpecifics?.tips?.length), JSON.stringify(after.map((l) => !!l.aiSpecifics)));
ok('public reply rebuilt, not just the PM', after.every((l) => l.draft !== 'stale draft'));
ok('PM rebuilt too', after.every((l) => l.dm !== 'stale dm'));
ok("rebuilt reply carries Claude's lines", after[0].draft.includes('We have built citations manually'), after[0].draft.slice(0, 200));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
