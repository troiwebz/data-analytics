// "Already sent" - and the PM you never sent.
//
// Two separate failures met here. The message-list check called any recent
// conversation with the buyer proof that you had pitched them, so leads you
// had never touched were marked done. And marking one done also called
// recordDm(), so each phantom match spent a slot from the daily PM cap - which
// is how the cap of 8 filled up on a day with far fewer than 8 PMs sent.
//
// Nothing here existed before: syncSentPms had no tests at all, which is why
// the rules could be that loose and still look fine.
const store = {};
const msgListeners = [], tabWatchers = [];
let tgCalls = [], inboxHtml = '', inboxFail = '', fetched = 0;
let dmResult = { ok: true, sent: true };

globalThis.chrome = {
  runtime: {
    onInstalled: { addListener: () => {} }, onStartup: { addListener: () => {} },
    onMessage: { addListener: (f) => msgListeners.push(f), removeListener: () => {} },
    getManifest: () => ({ version: '0.75.0' }), getURL: (p) => 'x/' + p, reload: () => {},
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
          f({ type: 'haf-dm-result', threadId: globalThis.__acting, mode: 'send', result: dmResult }, {}, () => {});
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

globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('api.telegram.org')) {
    const method = u.split('/').pop();
    tgCalls.push({ method, body: opts?.body ? JSON.parse(opts.body) : {} });
    if (method === 'getUpdates') return { ok: true, status: 200, json: async () => ({ ok: true, result: updates }) };
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  }
  if (u.includes('/direct-messages')) {
    fetched++;
    if (inboxFail) throw new Error(inboxFail);
    return { ok: true, status: 200, text: async () => inboxHtml };
  }
  return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
};

let updates = [];
const bg = await import('../src/background.js');
const T = await import('../src/telegram.js');
const { setConfig } = await import('../src/config.js');
const { getLeads, getRateState } = await import('../src/store.js');

let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + '  ' + e); } };

const ME = 'bargainbed';
const ts = (d) => Math.floor(new Date(d).getTime() / 1000);
const convRow = (id, title, other, when, starter) => `
  <div class="structItem structItem--conversation" data-author="${starter}">
    <div class="structItem-title"><a href="/direct-messages/t.${id}/">${title}</a></div>
    <div class="structItem-minor"><a href="/members/${other.toLowerCase()}.9/">${other}</a>
      <a href="/members/${ME}.1/">${ME}</a></div>
    <div class="structItem-cell--latest"><time data-timestamp="${ts(when)}"></time></div>
  </div>`;
const inbox = (...rows) =>
  `<html><span class="p-navgroup-user-linkText">${ME}</span>` + rows.join('') + '</html>';

const today = new Date().toLocaleDateString('en-CA');
const lead = (id, over = {}) => ({
  threadId: id, title: 'Need a Google Ads guy for crypto', author: 'buyer' + id,
  url: `https://bhw/threads/x.${id}/`, foundAt: new Date(Date.now() - 3600e3).toISOString(),
  draft: 'body', dm: 'pm body', dmTitle: 'Need a Google Ads guy for crypto', status: 'SENT', ...over
});

await T.setToken('1234567890:AAtoken');
await setConfig({ enabled: true, telegramEnabled: true, telegramChatId: '999', telegramApprovals: true,
                  autoPost: true, maxPostsPerDay: 10, minSecondsBetweenPosts: 0,
                  maxDmsPerDay: 30, minSecondsBetweenDms: 0 });

// --- a flag set by mistake is taken back ------------------------------------
//
// The buyer messaged YOU. That is not a PM you sent, and the lead must come
// back onto the list rather than staying struck off forever.
store.recentLeads = [lead('1', { pmSent: true, pmSentAt: new Date().toISOString(),
                                 pmFrom: 'your BHW message list' })];
store.rateState = { day: today, count: 0, lastPostAt: 0, dmCount: 3, lastDmAt: 0 };
inboxHtml = inbox(convRow(501, 'hey about something else', 'buyer1', new Date().toISOString(), 'buyer1'));

let r = await bg.syncSentPms({ pages: 1 });
let l1 = (await getLeads())[0];
ok('a lead marked sent on no real evidence is put back', l1.pmSent === false, JSON.stringify(r));
ok('and the check reports it rather than doing it quietly', r.cleared === 1, JSON.stringify(r));
ok('and the PM slot it spent is refunded', (await getRateState()).dmCount === 2,
   String((await getRateState()).dmCount));
ok('and it is remembered as worth a look, not as done', /messaged you/.test(l1.pmMaybe || ''), l1.pmMaybe);

// --- a PM you really sent is left alone -------------------------------------
store.recentLeads = [lead('2', { pmSent: true, pmSentAt: new Date().toISOString(), pmFrom: 'the extension' })];
inboxHtml = inbox();
r = await bg.syncSentPms({ pages: 1 });
ok('a send the extension watched happen is never cleared by this',
   (await getLeads())[0].pmSent === true, JSON.stringify(await getLeads()));
ok('and nothing is reported as cleared', r.cleared === 0, JSON.stringify(r));

// --- real proof still counts ------------------------------------------------
store.recentLeads = [lead('3')];
store.rateState = { day: today, count: 0, lastPostAt: 0, dmCount: 0, lastDmAt: 0 };
inboxHtml = inbox(convRow(503, 'Need a Google Ads guy for crypto', 'buyer3', new Date().toISOString(), ME));
r = await bg.syncSentPms({ pages: 1 });
ok('a conversation you started with that subject is still ticked off',
   (await getLeads())[0].pmSent === true, JSON.stringify(await getLeads()));
ok('and today it does count against today', (await getRateState()).dmCount === 1,
   String((await getRateState()).dmCount));

// A PM discovered from last week is history, not a PM sent now. Charging it to
// today was spending today's allowance on the past.
store.recentLeads = [lead('4', { foundAt: '2026-01-01T00:00:00Z' })];
store.rateState = { day: today, count: 0, lastPostAt: 0, dmCount: 0, lastDmAt: 0 };
inboxHtml = inbox(convRow(504, 'Need a Google Ads guy for crypto', 'buyer4', '2026-01-02T00:00:00Z', ME));
await bg.syncSentPms({ pages: 1 });
ok('an old PM found today is marked sent', (await getLeads())[0].pmSent === true);
ok('but does not spend a slot from today', (await getRateState()).dmCount === 0,
   String((await getRateState()).dmCount));

// --- the tap: checked live, and yours to override ---------------------------
const tap = (data) => ({
  update_id: Math.floor(Math.random() * 1e6),
  callback_query: { id: 'q' + Math.random(), data, from: { id: 5 },
    message: { message_id: 11, chat: { id: 999 }, text: 'a lead' } }
});

store.recentLeads = [lead('5')];
store.rateState = { day: today, count: 0, lastPostAt: 0, dmCount: 0, lastDmAt: 0 };
// They messaged you recently: a maybe, not a duplicate.
inboxHtml = inbox(convRow(505, 'unrelated chat', 'buyer5', new Date().toISOString(), 'buyer5'));
globalThis.__acting = '5';
tgCalls = []; fetched = 0;
updates = [tap('d:5')];
await bg.pollTaps();
ok('the tap asks BHW rather than trusting the stored flag', fetched > 0, String(fetched));
ok('a possible duplicate does not send', (await getRateState()).dmCount === 0,
   String((await getRateState()).dmCount));
let sent = tgCalls.filter((c) => c.method === 'sendMessage');
ok('and you are asked on your phone instead', sent.length === 1, JSON.stringify(sent.map((c) => c.method)));
ok('with the reason spelled out', /messaged you/.test(sent[0]?.body?.text || ''), sent[0]?.body?.text);
let btns = (sent[0]?.body?.reply_markup?.inline_keyboard || []).flat();
ok('a link to read the conversation', btns.some((b) => /direct-messages/.test(b.url || '')), JSON.stringify(btns));
ok('and a Send anyway button', btns.some((b) => /Send anyway/.test(b.text)), JSON.stringify(btns));
ok('and Skip', btns.some((b) => /Skip/.test(b.text)), JSON.stringify(btns));

// Send anyway goes past the check, because you have now seen the evidence.
tgCalls = [];
updates = [tap('f:5')];
await bg.pollTaps();
ok('Send anyway actually sends', (await getRateState()).dmCount === 1,
   String((await getRateState()).dmCount));
ok('and the lead is marked PM sent', (await getLeads())[0].pmSent === true);

// --- real proof at tap time still refuses, with the evidence ----------------
store.recentLeads = [lead('6')];
store.rateState = { day: today, count: 0, lastPostAt: 0, dmCount: 0, lastDmAt: 0 };
inboxHtml = inbox(convRow(506, 'Need a Google Ads guy for crypto', 'buyer6', new Date().toISOString(), ME));
globalThis.__acting = '6';
tgCalls = [];
updates = [tap('d:6')];
await bg.pollTaps();
ok('a genuine duplicate is still refused', (await getRateState()).dmCount === 0,
   String((await getRateState()).dmCount));
const edits = tgCalls.filter((c) => c.method === 'editMessageText').map((c) => c.body.text).join(' ');
ok('and says it was yours, with the link', /Already sent/.test(edits) && /direct-messages/.test(edits), edits);

// --- an unreachable inbox must never look like a duplicate -----------------
//
// Failing closed here would turn "BHW is down" into "you already sent this",
// which is the same class of mistake this whole change is about.
store.recentLeads = [lead('7')];
store.rateState = { day: today, count: 0, lastPostAt: 0, dmCount: 0, lastDmAt: 0 };
inboxFail = 'network down';
globalThis.__acting = '7';
tgCalls = [];
updates = [tap('d:7')];
await bg.pollTaps();
ok('a check that could not run does not block the send', (await getRateState()).dmCount === 1,
   String((await getRateState()).dmCount));
inboxFail = '';

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
