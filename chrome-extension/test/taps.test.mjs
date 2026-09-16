// Approving from Telegram: tap on your phone, Chrome does it.
//
// No server anywhere. Telegram's other option is a webhook, which needs a
// public URL - the Apps Script we got rid of. Instead Chrome asks Telegram
// "any taps?" on a timer, acts on them, and edits the message on your phone to
// say what happened.
//
// The two things this must never do are what most of these checks are about:
// act on a tap from a chat that is not yours, and post anything at all without
// a tap.
const store = {};
const msgListeners = [], tabWatchers = [];
let tgCalls = [], posted = [], dmSent = [];
let updates = [];
// What the content script reports back when a tap fires the real posting code.
let postResult = { ok: true, postUrl: 'https://bhw/threads/x.1/post-9' };
let dmResult = { ok: true, sent: true };

globalThis.chrome = {
  runtime: {
    onInstalled: { addListener: () => {} }, onStartup: { addListener: () => {} },
    onMessage: { addListener: (f) => msgListeners.push(f), removeListener: () => {} },
    getManifest: () => ({ version: '0.53.0' }), getURL: (p) => 'x/' + p, reload: () => {},
    sendMessage: async () => ({}), lastError: null
  },
  action: { onClicked: { addListener: () => {} } },
  tabs: { onRemoved: { addListener: () => {} },
          onUpdated: { addListener: (f) => tabWatchers.push(f),
                       removeListener: (f) => { const i = tabWatchers.indexOf(f); if (i >= 0) tabWatchers.splice(i, 1); } },
          create: async () => { setTimeout(() => { for (const f of [...tabWatchers]) f(7, { status: 'complete' }); }, 2); return { id: 7 }; },
          get: async () => ({ id: 7 }), remove: async () => {}, update: async () => {} },
  alarms: { onAlarm: { addListener: () => {} }, clear: async () => {}, create: () => {} },
  notifications: { create: (id, o, cb) => cb && cb(id), clear: () => {},
                   onClicked: { addListener: () => {} }, onButtonClicked: { addListener: () => {} } },
  offscreen: { hasDocument: async () => true, createDocument: async () => {} },
  scripting: {
    executeScript: async ({ files }) => {
      if (files) setTimeout(() => {
        const type = files.some((f) => /content-dm/.test(f)) ? 'haf-dm-result' : 'haf-post-result';
        const result = type === 'haf-dm-result' ? dmResult : postResult;
        for (const f of [...msgListeners]) f({ type, threadId: globalThis.__acting, mode: 'full', result }, {}, () => {});
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
    const body = opts?.body ? JSON.parse(opts.body) : {};
    tgCalls.push({ method, body });
    if (method === 'getUpdates') {
      const out = updates;
      return { ok: true, status: 200, json: async () => ({ ok: true, result: out }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  }
  return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
};

const bg = await import('../src/background.js');
const T = await import('../src/telegram.js');
const { setConfig } = await import('../src/config.js');
const { getLeads, getRateState } = await import('../src/store.js');



let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + '  ' + e); } };

await T.setToken('1234567890:AAtoken');
await setConfig({ enabled: true, telegramEnabled: true, telegramChatId: '999', telegramApprovals: true,
                  webhookUrl: '', autoPost: true, maxPostsPerDay: 10, minSecondsBetweenPosts: 0,
                  maxDmsPerDay: 8, minSecondsBetweenDms: 0 });

const lead = (id, over = {}) => ({
  threadId: id, title: 'thread ' + id, author: 'buyer' + id, url: `https://bhw/threads/x.${id}/`,
  draft: 'We have done this before.\n\nSent you a PM.', dm: 'Hi buyer,\n\nlines\n\nThanks!!',
  dmTitle: 'thread ' + id, status: 'SENT', ...over
});
store.recentLeads = [lead('1'), lead('2'), lead('3')];

// --- the buttons ------------------------------------------------------------
tgCalls = [];
await T.sendLead(lead('1'), { telegramChatId: '999', telegramSend: 'both', telegramApprovals: true });
const sends = tgCalls.filter((c) => c.method === 'sendMessage');
ok('both messages carry buttons', sends.every((c) => !!c.body.reply_markup), JSON.stringify(sends.map((c) => !!c.body.reply_markup)));
const labels = sends.flatMap((c) => c.body.reply_markup.inline_keyboard.flat().map((b) => b.text));
ok('the PM message offers to send the PM', labels.some((t) => /Send this PM/.test(t)), labels.join(' | '));
ok('the reply message offers to post it', labels.some((t) => /Post this reply/.test(t)), labels.join(' | '));
ok('and both offer Skip', labels.filter((t) => /Skip/.test(t)).length === 2, labels.join(' | '));
const datas = sends.flatMap((c) => c.body.reply_markup.inline_keyboard.flat().map((b) => b.callback_data));
ok('every button fits Telegram\'s 64-byte limit', datas.every((d) => d.length <= 64), JSON.stringify(datas));
ok('and names the thread it belongs to', datas.every((d) => d.endsWith(':1')), JSON.stringify(datas));

tgCalls = [];
await T.sendLead(lead('1'), { telegramChatId: '999', telegramSend: 'both', telegramApprovals: false });
ok('switched off, no buttons at all',
   tgCalls.filter((c) => c.method === 'sendMessage').every((c) => !c.body.reply_markup));

// A sample lead must never carry a button that posts to the forum.
tgCalls = [];
await T.sendLead(lead('sample'), { telegramChatId: '999', telegramSend: 'both', telegramApprovals: true });
ok('the sample lead gets no posting buttons',
   tgCalls.filter((c) => c.method === 'sendMessage').every((c) => !c.body.reply_markup));

// --- nothing happens without a tap -----------------------------------------
updates = [];
tgCalls = [];
let r = await bg.pollTaps();
ok('no taps means nothing posted', r.taps === 0, JSON.stringify(r));
ok('and nothing was sent to the forum', posted.length === 0 && dmSent.length === 0);

// --- a tap from someone else's chat -----------------------------------------
const tap = (data, over = {}) => ({
  update_id: Math.floor(Math.random() * 1e6),
  callback_query: { id: 'q' + Math.random(), data, from: { id: 5 },
    message: { message_id: 11, chat: { id: 999 }, text: 'a lead' }, ...over }
});
updates = [tap('p:1', { message: { message_id: 11, chat: { id: 4242 }, text: 'a lead' } })];
tgCalls = [];
r = await bg.pollTaps();
ok('a tap from a chat that is not yours posts nothing', (await getLeads()).find((l) => l.threadId === '1').status === 'SENT');
ok('and it is acknowledged rather than left spinning',
   tgCalls.some((c) => c.method === 'answerCallbackQuery'), JSON.stringify(tgCalls.map((c) => c.method)));

// --- offset: a tap is never acted on twice ----------------------------------
const first = tgCalls.find((c) => c.method === 'getUpdates');
ok('updates are asked for from an offset', 'offset' in first.body, JSON.stringify(first.body));
ok('and the offset moved past what was handled', (store.tgOffset || 0) > 0, String(store.tgOffset));

// --- a real tap, from your chat --------------------------------------------
globalThis.__acting = '1';
updates = [tap('p:1')];
tgCalls = [];
r = await bg.pollTaps();
let l1 = (await getLeads()).find((x) => x.threadId === '1');
ok('tapping Post actually posts it', l1.status === 'POSTED', l1.status);
ok('and saves the post link', /post-9$/.test(l1.postUrl || ''), l1.postUrl);
ok('and it counts against your daily replies', (await getRateState()).count === 1, String((await getRateState()).count));
ok('the message on your phone is edited to say so',
   tgCalls.some((c) => c.method === 'editMessageText' && /Posted/.test(c.body.text)),
   JSON.stringify(tgCalls.map((c) => c.method)));

// Tapping the same card again must not post twice.
updates = [tap('p:1')];
tgCalls = [];
await bg.pollTaps();
ok('tapping it again does not post twice', (await getRateState()).count === 1, String((await getRateState()).count));
ok('and says why', tgCalls.some((c) => c.method === 'editMessageText' && /Already posted/.test(c.body.text)),
   JSON.stringify(tgCalls.filter((c) => c.method === 'editMessageText').map((c) => c.body.text)));

// --- the PM button ----------------------------------------------------------
globalThis.__acting = '2';
updates = [tap('d:2')];
tgCalls = [];
await bg.pollTaps();
const l2 = (await getLeads()).find((x) => x.threadId === '2');
ok('tapping Send PM sends it', l2.pmSent === true, JSON.stringify({ pmSent: l2.pmSent }));
ok('and it counts once against the PM cap, not twice',
   (await getRateState()).dmCount === 1, String((await getRateState()).dmCount));
ok('and the phone is told', tgCalls.some((c) => c.method === 'editMessageText' && /PM sent/.test(c.body.text)),
   JSON.stringify(tgCalls.filter((c) => c.method === 'editMessageText').map((c) => c.body.text)));

// --- Skip -------------------------------------------------------------------
updates = [tap('s:3')];
await bg.pollTaps();
ok('tapping Skip skips it', (await getLeads()).find((x) => x.threadId === '3').status === 'SKIPPED');

// --- your own limits are not an override -----------------------------------
await setConfig({ maxPostsPerDay: 1 });          // already used by the post above
store.recentLeads = store.recentLeads.map((x) => (x.threadId === '3' ? { ...x, status: 'SENT' } : x));
globalThis.__acting = '3';
updates = [tap('p:3')];
tgCalls = [];
await bg.pollTaps();
ok('at your daily cap a tap posts nothing', (await getLeads()).find((x) => x.threadId === '3').status === 'SENT',
   (await getLeads()).find((x) => x.threadId === '3').status);
ok('and the phone says it was held, not that it worked',
   tgCalls.some((c) => c.method === 'editMessageText' && /Held/.test(c.body.text)),
   JSON.stringify(tgCalls.filter((c) => c.method === 'editMessageText').map((c) => c.body.text)));

// --- switched off, taps are not even read ----------------------------------
await setConfig({ telegramApprovals: false });
tgCalls = [];
r = await bg.pollTaps();
ok('with approvals off nothing is polled at all', r.skipped === 'off' && !tgCalls.length, JSON.stringify(r));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
