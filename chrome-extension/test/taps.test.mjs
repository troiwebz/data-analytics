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
// The same four on every message, so whichever one is in front of you can do
// the whole job rather than sending you hunting for the other card.
for (const c of sends) {
  const t = c.body.reply_markup.inline_keyboard.flat().map((b) => b.text);
  ok('a message offers Post Public Now', t.some((x) => /Post Public Now/.test(x)), t.join(' | '));
  ok('and Post DM Now', t.some((x) => /Post DM Now/.test(x)), t.join(' | '));
  ok('and Edit Post', t.some((x) => /Edit Post/.test(x)), t.join(' | '));
  ok('and Edit DM', t.some((x) => /Edit DM/.test(x)), t.join(' | '));
  ok('and Skip', t.some((x) => /Skip/.test(x)), t.join(' | '));
  ok('but no "I posted it" - that is applied when the reply really lands',
     !t.some((x) => /I posted/i.test(x)), t.join(' | '));
}
const labels = sends.flatMap((c) => c.body.reply_markup.inline_keyboard.flat().map((b) => b.text));
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

// --- rewriting from the phone ----------------------------------------------
// Tap Rewrite, type the new wording, and the next tap posts what YOU wrote.
store.recentLeads = [...(await getLeads()), lead('9')];
tgCalls = [];
updates = [tap('e:9')];
await bg.pollTaps();
const prompt = tgCalls.find((c) => c.method === 'sendMessage' && /Editing the post/.test(c.body.text || ''));
ok('Edit Post opens an edit box', !!prompt, JSON.stringify(tgCalls.map((c) => c.method)));
ok('and opens the reply box on your phone', prompt?.body.reply_markup?.force_reply === true,
   JSON.stringify(prompt?.body.reply_markup));
ok('with the post itself in front of you to edit',
   /We have done this before/.test(prompt?.body.text || ''), (prompt?.body.text || '').slice(0, 140));
ok('and it says Post Public Now comes back after', /Post Public Now/.test(prompt?.body.text || ''),
   (prompt?.body.text || '').slice(0, 200));

// The reply you type. force_reply means it comes back pointing at the prompt.
const reply = (body, replyTo) => ({
  update_id: Math.floor(Math.random() * 1e6),
  message: { message_id: 55, text: body, chat: { id: 999 }, from: { id: 5 },
             reply_to_message: { message_id: replyTo } }
});
tgCalls = [];
updates = [reply('My own wording, written on the train.', 1)];
await bg.pollTaps();
let l9 = (await getLeads()).find((x) => x.threadId === '9');
ok('what you typed becomes the draft', l9.draft === 'My own wording, written on the train.', l9.draft);
ok('and it is marked as yours, so a staged tab is retyped not reused', l9.draftEdited === true);
const back = tgCalls.find((c) => c.method === 'sendMessage' && c.body.reply_markup?.inline_keyboard);
ok('the edited lead comes straight back', !!back, JSON.stringify(tgCalls.map((c) => c.method)));
ok('with Post Public Now on it, so one more tap posts your version',
   (back?.body.reply_markup.inline_keyboard.flat() || []).some((b) => /Post Public Now/.test(b.text)),
   JSON.stringify((back?.body.reply_markup.inline_keyboard.flat() || []).map((b) => b.text)));
ok('and the message it sends back is the wording you typed',
   tgCalls.some((c) => /written on the train/.test(c.body.text || '')),
   JSON.stringify(tgCalls.map((c) => (c.body.text || '').slice(0, 40))));

// Then approving posts YOUR text, not Claude's.
await setConfig({ maxPostsPerDay: 10 });
globalThis.__acting = '9';
postResult = { ok: true, postUrl: 'https://bhw/threads/x.9/post-12' };
updates = [tap('p:9')];
await bg.pollTaps();
l9 = (await getLeads()).find((x) => x.threadId === '9');
ok('approving after a rewrite posts it', l9.status === 'POSTED', l9.status);
ok('and the posted draft is the one you wrote', l9.draft === 'My own wording, written on the train.', l9.draft);

// The PM half rewrites too.
tgCalls = [];
updates = [tap('m:2')];
await bg.pollTaps();
const pmPrompt = tgCalls.find((c) => /Editing the DM/.test(c.body.text || ''));
ok('Edit DM opens an edit box too', !!pmPrompt, JSON.stringify(tgCalls.map((c) => (c.body.text || '').slice(0, 30))));
ok('with the DM in front of you', /lines/.test(pmPrompt?.body.text || ''), (pmPrompt?.body.text || '').slice(0, 140));
updates = [reply('A PM in my own words.', 1)];
await bg.pollTaps();
ok('and what you typed becomes the PM',
   (await getLeads()).find((x) => x.threadId === '2').dm === 'A PM in my own words.',
   (await getLeads()).find((x) => x.threadId === '2').dm);

// A message that answers nothing of ours is not a rewrite.
const before9 = (await getLeads()).find((x) => x.threadId === '9').draft;
updates = [reply('just chatting to the bot', 99999)];
await bg.pollTaps();
ok('a reply to nothing of ours changes no draft',
   (await getLeads()).find((x) => x.threadId === '9').draft === before9);

// And a rewrite typed from someone else's chat is refused.
store.tgEdits = { '77': { threadId: '9', field: 'draft' } };
updates = [{ update_id: 1, message: { message_id: 78, text: 'hijacked', chat: { id: 4242 }, from: { id: 1 },
                                      reply_to_message: { message_id: 77 } } }];
await bg.pollTaps();
ok('a rewrite from a chat that is not yours is refused',
   (await getLeads()).find((x) => x.threadId === '9').draft === before9,
   (await getLeads()).find((x) => x.threadId === '9').draft);

// --- switched off, taps are not even read ----------------------------------
await setConfig({ telegramApprovals: false });
tgCalls = [];
r = await bg.pollTaps();
ok('with approvals off nothing is polled at all', r.skipped === 'off' && !tgCalls.length, JSON.stringify(r));

const postedCountBefore = (await getLeads()).filter((l) => l.status === 'POSTED').length;
await setConfig({ telegramApprovals: true });      // the block above turned them off

// --- the self-test button ---------------------------------------------------
// Tapping it belongs to no lead, so it must be answered before anything tries
// to look one up - otherwise the one button whose whole job is proving the
// chain works would fall through as "that lead is no longer in the table".
tgCalls = [];
updates = [tap('t:selftest')];
r = await bg.pollTaps();
ok('the self-test tap is acted on', r.done === 1, JSON.stringify(r));
ok('and answered on the phone',
   tgCalls.some((c) => c.method === 'editMessageText' && /taps reach Chrome/.test(c.body.text)),
   JSON.stringify(tgCalls.filter((c) => c.method === 'editMessageText').map((c) => c.body.text)));
ok('and recorded, so Settings can see it landed', (store.tgSelfTestAt || 0) > 0, String(store.tgSelfTestAt));
ok('it posts nothing to the forum',
   (await getLeads()).filter((l) => l.status === 'POSTED').length === postedCountBefore,
   JSON.stringify((await getLeads()).map((l) => l.status)));

// --- "the Telegram button does nothing" -------------------------------------
// Every one of these looks identical from the outside. The diagnostic has to
// name which it actually is.
let canned = {};
const oldFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const method = String(url).split('/').pop();
  const r = canned[method];
  if (r) return { ok: true, status: 200, json: async () => r };
  return { ok: true, status: 200, json: async () => ({ ok: true, result: { username: 'haf_bot' } }) };
};

const says = (d, re) => d.checks.some(([, t]) => re.test(t));

canned = {};
let d = await T.diagnose({ telegramChatId: '999', telegramEnabled: true, telegramApprovals: true });
ok('all set up reads as fine', d.ok === true, JSON.stringify(d.checks));

d = await T.diagnose({ telegramChatId: '', telegramEnabled: true });
ok('a missing chat id is named', !d.ok && says(d, /No chat id saved/), JSON.stringify(d.checks));
ok('and it points at the button that fills it in', says(d, /Find it for me/), JSON.stringify(d.checks));
ok('naming the actual bot to message', says(d, /@haf_bot/), JSON.stringify(d.checks));

// The bot cannot message you until you press Start on it - the commonest one.
canned = { sendChatAction: { ok: false, description: 'Forbidden: bot can\'t initiate conversation with a user' } };
d = await T.diagnose({ telegramChatId: '999', telegramEnabled: true });
ok('a bot you have never started is named', !d.ok && says(d, /press Start/), JSON.stringify(d.checks));

// A webhook left over from the Apps Script days: messages go out, taps never
// come back, and nothing anywhere says so.
canned = { getWebhookInfo: { ok: true, result: { url: 'https://script.google.com/old' } } };
d = await T.diagnose({ telegramChatId: '999', telegramEnabled: true });
ok('a leftover webhook is named', !d.ok && says(d, /webhook is set/), JSON.stringify(d.checks));
ok('and it says how to remove it', says(d, /deleteWebhook/), JSON.stringify(d.checks));
ok('an Apps Script webhook is called what it is',
   says(d, /old Apps Script relay/) && says(d, /Post now \/ I posted it \/ Skip/), JSON.stringify(d.checks));

canned = { getWebhookInfo: { ok: true, result: { url: 'https://example.com/hook' } } };
d = await T.diagnose({ telegramChatId: '999', telegramEnabled: true });
ok('a webhook that is not Apps Script is not blamed on it', !says(d, /Apps Script/), JSON.stringify(d.checks));

canned = {};
d = await T.diagnose({ telegramChatId: '999', telegramEnabled: true, telegramApprovals: false });
ok('approvals being off is flagged but not called broken', d.ok === true && says(d, /Approval buttons are off/),
   JSON.stringify(d.checks));

// --- finding your own chat id ----------------------------------------------
// The chat id is the one setting with no way to discover it from the UI, and
// an empty one fails every send. It is already sitting in anything you have
// ever sent the bot.
canned = { getUpdates: { ok: true, result: [
  { update_id: 5, message: { message_id: 1, text: 'hi', chat: { id: 8812664414, username: 'troi' }, from: { id: 1 } } }
] } };
let f = await T.findChatId();
ok('your chat id is read off the bot', f.chatId === '8812664414', JSON.stringify(f));
ok('and it says who it belongs to', f.chats[0].name === 'troi', JSON.stringify(f.chats));

// Looking it up must never swallow a tap you made a second earlier.
store.tgOffset = 41;
await T.findChatId();
ok('looking it up does not acknowledge anything', store.tgOffset === 41, String(store.tgOffset));

canned = { getUpdates: { ok: true, result: [] } };
f = await T.findChatId();
ok('with nothing sent yet it says to message the bot first',
   /send it any message/i.test(f.error || ''), JSON.stringify(f));

canned = { getUpdates: { ok: false, description: 'Conflict: can\'t use getUpdates method while webhook is active' } };
f = await T.findChatId();
ok('and a webhook is named rather than shrugged at', /webhook/i.test(f.error || ''), JSON.stringify(f));
canned = {};

await T.clearToken();
ok('with no token it says so rather than failing oddly',
   /No bot token/i.test((await T.findChatId()).error || ''), JSON.stringify(await T.findChatId()));
d = await T.diagnose({ telegramChatId: '999' });
ok('no token at all is the first thing it says', !d.ok && /No bot token/.test(d.checks[0][1]), JSON.stringify(d.checks));
globalThis.fetch = oldFetch;

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
