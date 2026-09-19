// One tap, two copies of the extension, two identical PMs to the same buyer.
//
// Telegram keeps ONE update queue per bot, and each install tracks its own
// position in it in its own chrome.storage. Two installs polling the same bot -
// a Mac and a VPS both left open - therefore each receive the SAME
// callback_query, and each acts on it.
//
// The inbox check cannot catch this. Both copies read the message list before
// either had sent, so neither saw the other's PM. Check-then-act is not safe
// when two actors do it at once; it needs a lock, and answerCallbackQuery is
// one: a callback_query_id can be answered exactly once, and Telegram rejects
// the second.
const store = {};
const msgListeners = [], tabWatchers = [];
let tgCalls = [], answered = new Set(), updates = [], inboxHtml = '';

globalThis.chrome = {
  runtime: {
    onInstalled: { addListener: () => {} }, onStartup: { addListener: () => {} },
    onMessage: { addListener: (f) => msgListeners.push(f), removeListener: () => {} },
    getManifest: () => ({ version: '0.80.0' }), getURL: (p) => 'x/' + p, reload: () => {},
    sendMessage: async () => ({}), getPlatformInfo: async () => ({}), lastError: null
  },
  action: { onClicked: { addListener: () => {} } },
  tabs: { onRemoved: { addListener: () => {} },
          onUpdated: { addListener: (f) => tabWatchers.push(f),
                       removeListener: (f) => { const i = tabWatchers.indexOf(f); if (i >= 0) tabWatchers.splice(i, 1); } },
          create: async () => { setTimeout(() => { for (const f of [...tabWatchers]) f(7, { status: 'complete' }); }, 2); return { id: 7 }; },
          get: async () => ({ id: 7 }), remove: async () => {}, update: async () => {} },
  alarms: { onAlarm: { addListener: () => {} }, clear: async () => {}, create: () => {}, get: async () => null },
  notifications: { create: (id, o, cb) => cb && cb(id), clear: () => {},
                   onClicked: { addListener: () => {} }, onButtonClicked: { addListener: () => {} } },
  offscreen: { hasDocument: async () => true, createDocument: async () => {} },
  scripting: {
    executeScript: async ({ files }) => {
      if (files) setTimeout(() => {
        for (const f of [...msgListeners]) {
          f({ type: 'haf-dm-result', threadId: globalThis.__acting, mode: 'send', result: { ok: true, sent: true } }, {}, () => {});
        }
      }, 5);
      return [{ result: {} }];
    }
  },
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

// Telegram, as it really behaves: a callback_query can be answered ONCE.
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('api.telegram.org')) {
    const method = u.split('/').pop();
    const body = opts?.body ? JSON.parse(opts.body) : {};
    tgCalls.push({ method, body });
    if (method === 'getUpdates') return { ok: true, status: 200, json: async () => ({ ok: true, result: updates }) };
    if (method === 'answerCallbackQuery') {
      const id = body.callback_query_id;
      if (answered.has(id)) {
        return { ok: false, status: 400,
                 json: async () => ({ ok: false, description: 'Bad Request: query is too old and response timeout expired or query ID is invalid' }) };
      }
      answered.add(id);
      return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  }
  if (u.includes('/direct-messages')) return { ok: true, status: 200, text: async () => inboxHtml };
  return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
};

const bg = await import('../src/background.js');
const T = await import('../src/telegram.js');
const { setConfig, getConfig } = await import('../src/config.js');
const { getLeads, getRateState } = await import('../src/store.js');

let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + '  ' + e); } };

await T.setToken('1234567890:AAtoken');
await setConfig({ enabled: true, telegramEnabled: true, telegramChatId: '999', telegramApprovals: true,
                  autoPost: true, maxDmsPerDay: 30, minSecondsBetweenDms: 0,
                  maxPostsPerDay: 10, minSecondsBetweenPosts: 0 });

const today = new Date().toLocaleDateString('en-CA');
const lead = (id, over = {}) => ({
  threadId: id, title: 'SEO Content Writer - Dubai', author: 'linonblackhat',
  url: `https://bhw/threads/x.${id}/`, foundAt: new Date().toISOString(),
  draft: 'body', dm: 'pm body', dmTitle: 'SEO Content Writer - Dubai', status: 'SENT', ...over
});
const tap = (data, id) => ({
  update_id: Math.floor(Math.random() * 1e6),
  callback_query: { id, data, from: { id: 5 },
    message: { message_id: 11, chat: { id: 999 }, text: 'a lead' } }
});

// --- the claim is exclusive --------------------------------------------------
answered = new Set();
ok('the first copy claims the tap', (await T.claimTap('q1', 'Working…')) === true);
const second = await T.claimTap('q1', 'Working…');
ok('the second copy is refused', second !== true, JSON.stringify(second));
ok('and is told why', /query ID is invalid|too old/i.test(second.why || ''), second.why);

// --- one tap, two installs, one PM ------------------------------------------
//
// The same callback_query_id arriving twice is exactly what a Mac and a VPS
// both polling the same bot produces.
answered = new Set();
store.recentLeads = [lead('80')];
store.rateState = { day: today, count: 0, lastPostAt: 0, dmCount: 0, lastDmAt: 0 };
inboxHtml = '';
globalThis.__acting = '80';
tgCalls = [];

updates = [tap('d:80', 'SAME-TAP')];
await bg.pollTaps();                      // the Mac
ok('the first copy sends it', (await getRateState()).dmCount === 1, String((await getRateState()).dmCount));

// The VPS polls the same queue and gets the same update.
updates = [tap('d:80', 'SAME-TAP')];
await bg.pollTaps();                      // the VPS
ok('the second copy does NOT send it again', (await getRateState()).dmCount === 1,
   String((await getRateState()).dmCount));
ok('and the buyer got one PM, not two', (await getLeads())[0].pmSent === true);

const said = (await (await import('../src/store.js')).getLog()).map((l) => l.msg).join(' | ');
ok('and you are told you have two copies running', /two running|Another copy/i.test(said), said.slice(0, 200));

// --- one install cannot race itself either ----------------------------------
//
// Sending takes up to a minute. That is a wide window to land a second tap in,
// and the Telegram claim does not help when both taps are genuinely different.
{
  const cfg = await getConfig();
  store.recentLeads = [lead('81', { pmSending: Date.now() })];
  store.rateState = { day: today, count: 0, lastPostAt: 0, dmCount: 0, lastDmAt: 0 };
  globalThis.__acting = '81';
  const r = await bg.sendDm((await getLeads())[0], cfg, { mode: 'send' });
  ok('a send already in flight is refused', r.blocked === true, JSON.stringify(r));
  ok('and says how long to wait', /Give it \d+s/.test(r.error || ''), r.error);
  ok('and nothing was sent', (await getRateState()).dmCount === 0, String((await getRateState()).dmCount));

  // A lock left behind by a worker that was killed must not wedge the lead.
  store.recentLeads = [lead('82', { pmSending: Date.now() - 10 * 60000 })];
  globalThis.__acting = '82';
  const r2 = await bg.sendDm((await getLeads())[0], cfg, { mode: 'send' });
  ok('a stale lock is ignored rather than wedging the lead for ever', !r2.blocked, JSON.stringify(r2));

  // And the lock comes off once the send finishes, or one send would block the next.
  ok('the lock is released after a send', !(await getLeads())[0].pmSending,
     String((await getLeads())[0].pmSending));

  // A lead settled between the tap and the send is not sent again.
  store.recentLeads = [lead('83', { pmSent: true })];
  globalThis.__acting = '83';
  const r3 = await bg.sendDm((await getLeads())[0], cfg, { mode: 'send' });
  ok('one already sent is refused outright', r3.blocked === true && /already sent/.test(r3.error), JSON.stringify(r3));
}

// --- an old tap must still work ---------------------------------------------
//
// Telegram returns ONE error for two different things: "already answered" and
// "too old to answer". Standing down on both meant a tap that had simply aged
// out - one copy running, the server shut down, a slow poll - did nothing at
// all and said nothing. That is worse than the duplicate it guards against.
{
  store.recentLeads = [lead('90')];
  store.rateState = { day: today, count: 0, lastPostAt: 0, dmCount: 0, lastDmAt: 0 };
  store.logOnceSeen = {};
  store.log = [];                            // the log is cumulative across this file
  globalThis.__acting = '90';
  answered = new Set(['OLD-TAP']);          // already answered: the claim will fail
  inboxHtml = '';                            // and nothing has been sent

  updates = [tap('d:90', 'OLD-TAP')];
  await bg.pollTaps();
  ok('a tap that cannot be answered is still honoured when nothing else acted',
     (await getRateState()).dmCount === 1, String((await getRateState()).dmCount));
  ok('and the PM actually went', (await getLeads())[0].pmSent === true);

  const log1 = (await (await import('../src/store.js')).getLog()).map((l) => l.msg).join(' | ');
  ok('and it is not blamed on a second copy', !/two running/.test(log1), log1.slice(0, 160));
  ok('while still saying the answer was refused', /would not let me answer/.test(log1), log1.slice(0, 160));
}

// But when the work IS already done, it stands down - that is the real duplicate.
{
  store.recentLeads = [lead('91', { pmSent: true })];
  store.rateState = { day: today, count: 0, lastPostAt: 0, dmCount: 0, lastDmAt: 0 };
  store.logOnceSeen = {};
  store.log = [];
  globalThis.__acting = '91';
  answered = new Set(['DONE-TAP']);
  updates = [tap('d:91', 'DONE-TAP')];
  await bg.pollTaps();
  ok('a tap for work already done sends nothing', (await getRateState()).dmCount === 0,
     String((await getRateState()).dmCount));
  const log2 = (await (await import('../src/store.js')).getLog()).map((l) => l.msg).join(' | ');
  ok('and THAT is when you are told about a second copy', /two running/.test(log2), log2.slice(0, 200));
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
