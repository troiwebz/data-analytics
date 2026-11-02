// HAF used to go quiet for days with nothing but a local log line nobody was
// reading: a stuck feed poll, Claude failing to draft, BHW walling every
// read. This proves the fix - a Telegram alert the first time each of these
// starts, throttled while it continues, and a "back to normal" the moment it
// clears - and the phone-reachable "catch up" command for recovering from a
// stretch that was missed. (Testable without a Chrome tab: pollTaps' own
// watchdog, and pollFeed's Claude-draft watchdog in RSS mode. The BHW-wall
// alert reuses the same watch() helper these two already prove, and is
// walked live by the regression checklist, which also covers "catch up"'s
// full recovery path against real listing pages.)
const store = {};
globalThis.chrome = {
  runtime: {
    onInstalled: { addListener: () => {} }, onStartup: { addListener: () => {} },
    onMessage: { addListener: () => {} },
    getManifest: () => ({ version: '1.18.1' }), getURL: (p) => 'x/' + p, reload: () => {}
  },
  action: { onClicked: { addListener: () => {} } },
  tabs: { onRemoved: { addListener: () => {} }, onUpdated: { addListener: () => {}, removeListener: () => {} },
          query: async () => [], create: async () => ({ id: 1 }) },
  alarms: { onAlarm: { addListener: () => {} }, clear: async () => {}, create: () => {} },
  notifications: { create: (id, o, cb) => cb && cb(id), clear: () => {},
                   onClicked: { addListener: () => {} }, onButtonClicked: { addListener: () => {} } },
  offscreen: { hasDocument: async () => true, createDocument: async () => {} },
  scripting: { executeScript: async () => [{ result: {} }] },
  storage: {
    local: {
      get: async (k) => { if (k == null) return structuredClone(store);
        if (Array.isArray(k)) return Object.fromEntries(k.filter((x) => x in store).map((x) => [x, structuredClone(store[x])]));
        return k in store ? { [k]: structuredClone(store[k]) } : {}; },
      set: async (o) => Object.assign(store, o),
      remove: async (k) => { for (const x of (Array.isArray(k) ? k : [k])) delete store[x]; }
    },
    sync: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    onChanged: { addListener: () => {} }
  }
};

let claudeFails = false;
let tg = [];
let updates = [];
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('api.anthropic.com/v1/models')) return { ok: true, status: 200, json: async () => ({ data: [] }) };
  if (u.includes('api.anthropic.com')) {
    if (claudeFails) return { ok: false, status: 529, json: async () => ({ error: { message: 'Overloaded' } }) };
    const ids = JSON.parse(opts.body).messages[0].content.match(/id: (\d+)/g).map((s) => s.slice(4));
    return { ok: true, status: 200, json: async () => ({
      content: [{ type: 'text', text: JSON.stringify(Object.fromEntries(ids.map((id) => [id, {
        tips: ['We handle this exact kind of job'], question: 'Scope or budget first?', offer: 'formula'
      }]))) }],
      usage: { input_tokens: 500, output_tokens: 60 }
    }) };
  }
  if (u.includes('api.telegram.org')) {
    const method = u.split('/').pop();
    const body = opts?.body ? JSON.parse(opts.body) : {};
    if (method === 'getUpdates') return { ok: true, status: 200, json: async () => ({ ok: true, result: updates }) };
    tg.push(body);
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  }
  if (/\/threads\//.test(u)) return { ok: true, status: 200, text: async () => '<article class="message" data-author="buyer"><div class="bbWrapper">Need a thing done. Budget $100.</div></article>' };
  if (u.includes('index.rss')) return { ok: true, status: 200, text: async () => RSS() };
  if (u.includes('manifest.json')) return { ok: true, json: async () => ({ version: '1.18.1' }) };
  return { ok: true, status: 200, text: async () => '' };
};

let rssId = 5000000;
const RSS = () => `<rss><channel><item>
  <title>Need a Website Developer &amp; SEO Freelancer ${++rssId}</title>
  <link>https://www.blackhatworld.com/threads/need-a-dev.${rssId}/</link>
  <pubDate>${new Date().toUTCString()}</pubDate>
  <dc:creator>buyer${rssId}</dc:creator>
  <description>Need a dev. Budget $500.</description>
</item></channel></rss>`;

const bg = await import('../src/background.js');
const { setConfig } = await import('../src/config.js');
const C = await import('../src/claude.js');
const TG = await import('../src/telegram.js');

let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + '  ' + e); } };
const said = () => tg.filter((m) => m.text).map((m) => m.text).join(' ||| ');

await C.saveKey('sk-ant-api03-TESTKEYTESTKEY');
await TG.setToken('1234567890:AAtesttoken');
await setConfig({ enabled: true, readMode: 'feeds', webhookUrl: '', sharedSecret: '', backfillHours: 0, hafMinThreads: 0,
                  aiSpecifics: true, telegramEnabled: true, telegramChatId: '999', telegramApprovals: true,
                  secondsBetweenThreadReads: 0, pollMinutes: 10 });

// ---- the feed poll going stale (Chrome asleep, closed, VPS logged off) ------
await bg.runCheck();   // first run seeds, sets a fresh lastPollAt

tg = [];
store.lastPollAt = Date.now() - 50 * 60000;   // 50 min since the last check, every-10-min schedule
await bg.pollTaps();
ok('a stale feed poll is flagged on Telegram', /hasn.t completed a check/.test(said()), said());

tg = [];
await bg.pollTaps();
ok('the same staleness is not repeated every tick', !said(), said());

tg = [];
store.lastPollAt = Date.now();   // the poll ran again
await bg.pollTaps();
ok('and recovery is announced once it is fresh again', /back to normal|checking BlackHatWorld again/.test(said()), said());

tg = [];
await bg.pollTaps();
ok('and not repeated once recovered', !said(), said());

// ---- Claude failing to draft, which never blocks a thread from reaching you -
// Each poll's RSS fixture carries a fresh thread id (see RSS(), rssId++), so
// every call below is naturally "new" without needing to forget seenThreads -
// which would also reset isFirstRun() and change what pollFeed does entirely.
claudeFails = true;
tg = [];
let r = await bg.pollFeed();
ok('the thread still gets through with a generic draft', r.matched === 1, JSON.stringify(r));
ok('and Claude\'s failure is flagged on Telegram, not left to be noticed in the draft',
   /Claude isn.t writing drafts right now/.test(said()), said());

tg = [];
r = await bg.pollFeed();
ok('still failing is not re-announced inside the same hour', !/Claude isn.t writing/.test(said()), said());

claudeFails = false;
tg = [];
r = await bg.pollFeed();
ok('Claude recovering sends one "back to normal" message', /Claude is writing drafts normally again/.test(said()), said());

// ---- "catch up" refuses to read while BHW is already blocking us -----------
store.sourcesBackoffUntil = Date.now() + 20 * 60000;
tg = [];
updates = [{ update_id: 1, message: { message_id: 1, text: 'catch up 3', chat: { id: 999 }, from: { id: 5 } } }];
await bg.pollTaps();
ok('"catch up" while walled refuses rather than hammering a blocked site', /currently blocking reads/.test(said()), said());
ok('and never claims to be reading anything', !/Reading the last/.test(said()), said());

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
