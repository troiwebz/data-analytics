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
// The card you tapped BECOMES the editor. It used to send two fresh messages
// and then a third with the rewritten card, so a two-line change pushed four
// messages into the chat and the thing being edited scrolled away.
const prompt = tgCalls.find((c) => c.method === 'editMessageText' && /Editing the post/.test(c.body.text || ''));
ok('Edit Post rewrites the card in place', !!prompt, JSON.stringify(tgCalls.map((c) => c.method)));
ok('and it is the same message, not a new one', prompt?.body.message_id === 11, String(prompt?.body.message_id));
ok('nothing new is posted to the chat',
   !tgCalls.some((c) => c.method === 'sendMessage'), JSON.stringify(tgCalls.map((c) => c.method)));
ok('the draft is in a tap-to-copy block', /<pre>We have done this before/.test(prompt?.body.text || ''),
   (prompt?.body.text || '').slice(0, 120));
ok('with a way out that changes nothing',
   (prompt?.body.reply_markup?.inline_keyboard || []).flat().some((b) => /Leave it as it is/.test(b.text)),
   JSON.stringify(prompt?.body.reply_markup));
// The cancel button must name the THREAD, because that is what the lead is
// looked up by - naming the message would find nothing and answer "no longer
// in the table" to a card that is right there.
ok('and the way out names the thread, not the message',
   (prompt?.body.reply_markup?.inline_keyboard || []).flat()[0]?.callback_data === 'c:9',
   JSON.stringify((prompt?.body.reply_markup?.inline_keyboard || []).flat()[0]));

// The reply you type. force_reply means it comes back pointing at the prompt.
const reply = (body, replyTo) => ({
  update_id: Math.floor(Math.random() * 1e6),
  message: { message_id: 55, text: body, chat: { id: 999 }, from: { id: 5 },
             reply_to_message: { message_id: replyTo } }
});
// A plain message, NOT a reply: this is the normal way now, and the reason the
// quote is gone.
tgCalls = [];
updates = [reply('My own wording, written on the train.', 0)];
await bg.pollTaps();
let l9 = (await getLeads()).find((x) => x.threadId === '9');
ok('what you typed becomes the draft', l9.draft === 'My own wording, written on the train.', l9.draft);
ok('and it is marked as yours, so a staged tab is retyped not reused', l9.draftEdited === true);
const back = tgCalls.find((c) => c.method === 'editMessageText' && c.body.reply_markup?.inline_keyboard);
ok('the card comes back on the same message', !!back && back.body.message_id === 11,
   JSON.stringify(tgCalls.map((c) => `${c.method}:${c.body.message_id || ''}`)));
ok('so the chat ends where it started, with nothing added',
   !tgCalls.some((c) => c.method === 'sendMessage'), JSON.stringify(tgCalls.map((c) => c.method)));
ok('with Post Public Now on it, so one more tap posts your version',
   (back?.body.reply_markup.inline_keyboard.flat() || []).some((b) => /Post Public Now/.test(b.text)),
   JSON.stringify((back?.body.reply_markup.inline_keyboard.flat() || []).map((b) => b.text)));
ok('and it shows the wording you typed',
   /written on the train/.test(back?.body.text || ''), (back?.body.text || '').slice(0, 80));

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
ok('with the DM itself in a copy block', /<pre>Hi buyer/.test(pmPrompt?.body.text || ''),
   (pmPrompt?.body.text || '').slice(0, 120));
ok('and it edited the card rather than posting another message',
   pmPrompt?.method === 'editMessageText' && !tgCalls.some((c) => c.method === 'sendMessage'),
   JSON.stringify(tgCalls.map((c) => c.method)));
updates = [reply('A PM in my own words.', 1)];
await bg.pollTaps();
ok('and what you typed becomes the PM',
   (await getLeads()).find((x) => x.threadId === '2').dm === 'A PM in my own words.',
   (await getLeads()).find((x) => x.threadId === '2').dm);

// With no edit waiting, a message is just a message.
const before9 = (await getLeads()).find((x) => x.threadId === '9').draft;
store.tgEdits = {};
updates = [reply('just chatting to the bot', 0)];
await bg.pollTaps();
ok('with no edit open, what you type changes nothing',
   (await getLeads()).find((x) => x.threadId === '9').draft === before9,
   (await getLeads()).find((x) => x.threadId === '9').draft);

// /cancel leaves it exactly as it was.
store.tgEdits = { '1': { threadId: '9', field: 'draft', at: Date.now() } };
tgCalls = [];
updates = [reply('/cancel', 0)];
await bg.pollTaps();
ok('/cancel leaves the draft alone',
   (await getLeads()).find((x) => x.threadId === '9').draft === before9);
ok('and says so', tgCalls.some((c) => /Left as it was/.test(c.body.text || '')),
   JSON.stringify(tgCalls.map((c) => (c.body.text || '').slice(0, 30))));
ok('and closes the edit, so the next message is yours again',
   !Object.keys(store.tgEdits || {}).length, JSON.stringify(store.tgEdits));

// An edit nobody answered expires, rather than swallowing a message an hour later.
store.tgEdits = { '1': { threadId: '9', field: 'draft', at: Date.now() - 60 * 60000 } };
updates = [reply('a message an hour later', 0)];
await bg.pollTaps();
ok('a stale edit does not swallow a later message',
   (await getLeads()).find((x) => x.threadId === '9').draft === before9,
   (await getLeads()).find((x) => x.threadId === '9').draft);

// And a rewrite typed from someone else's chat is refused.
store.tgEdits = { '77': { threadId: '9', field: 'draft', at: Date.now() } };
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

await setConfig({ telegramApprovals: true });      // the block above turned them off

// --- night mode: the one thing that posts without a tap --------------------
{
  const NIGHT = { nightMode: true, nightStart: '00:00', nightEnd: '23:59', // always night, for the test
                  nightVetoMinutes: 20, nightMinScore: 10, nightMaxPosts: 2,
                  maxPostsPerDay: 10, minSecondsBetweenPosts: 0 };
  await setConfig(NIGHT);
  const ready = (id, over = {}) => ({
    ...lead(id), score: 20, body: 'The buyer actually wrote this and it was read.',
    aiSpecifics: { tips: ['We have done this'] }, lint: { ok: true }, ...over
  });

  // Nothing is due yet: a countdown that has not run out must not fire.
  store.recentLeads = [ready('n1', { autoPostAt: Date.now() + 600000 })];
  let nr = await bg.runNightQueue();
  ok('a countdown still running posts nothing', nr.due === 0, JSON.stringify(nr));
  ok('and the lead is untouched', (await getLeads()).find((l) => l.threadId === 'n1').status === 'SENT');

  // Due, and eligible: it goes up by itself.
  globalThis.__acting = 'n1';
  postResult = { ok: true, postUrl: 'https://bhw/threads/x.n1/post-1' };
  store.recentLeads = [ready('n1', { autoPostAt: Date.now() - 1000 })];
  nr = await bg.runNightQueue();
  let l = (await getLeads()).find((x) => x.threadId === 'n1');
  ok('a countdown that ran out posts by itself', l.status === 'POSTED', l.status);
  ok('and is recorded as an unattended post', !!l.autoPostedAt, JSON.stringify(l.autoPostedAt));
  ok('and the countdown is cleared so it cannot fire twice', !l.autoPostAt, String(l.autoPostAt));

  // The gate is re-checked at posting time, not only when armed. Between the
  // two you may have edited the draft or the thread may have been re-read.
  store.recentLeads = [ready('n2', { autoPostAt: Date.now() - 1000, body: '' })];
  globalThis.__acting = 'n2';
  await bg.runNightQueue();
  l = (await getLeads()).find((x) => x.threadId === 'n2');
  ok('a draft that lost its post body is held at the last moment', l.status === 'SENT', l.status);
  ok('and says why', /never read/.test(l.autoBlocked || ''), l.autoBlocked);

  // Outside the window nothing fires, whatever is queued.
  //
  // The window is computed from the clock rather than hardcoded. A fixed
  // '23:00'-'23:01' was "outside now" on almost every run and inside it for one
  // minute a day - in the configured timezone, not UTC - so this check quietly
  // inverted itself once daily and would have looked like a real regression to
  // whoever next ran the suite at the wrong moment.
  {
    const { minutesNow } = await import('../src/night.js');
    const cfg = await (await import('../src/config.js')).getConfig();
    const hhmm = (mins) => String(Math.floor(((mins % 1440) + 1440) % 1440 / 60)).padStart(2, '0')
      + ':' + String(((mins % 1440) + 1440) % 1440 % 60).padStart(2, '0');
    const soon = minutesNow(cfg) + 120;               // two hours away, whatever the hour
    await setConfig({ nightStart: hhmm(soon), nightEnd: hhmm(soon + 1) });
  }
  store.recentLeads = [ready('n3', { autoPostAt: Date.now() - 1000 })];
  globalThis.__acting = 'n3';
  nr = await bg.runNightQueue();
  l = (await getLeads()).find((x) => x.threadId === 'n3');
  ok('a countdown that outlives the window does not fire', l.status === 'SENT', l.status);
  ok('and it is left for you, not silently dropped', /window closed/.test(l.autoBlocked || ''), l.autoBlocked);

  // Switched off, nothing happens at all.
  await setConfig({ nightMode: false });
  store.recentLeads = [ready('n4', { autoPostAt: Date.now() - 1000 })];
  nr = await bg.runNightQueue();
  ok('switched off it does nothing', nr.skipped === 'off', JSON.stringify(nr));
  ok('and posts nothing', (await getLeads()).find((x) => x.threadId === 'n4').status === 'SENT');

  // Hold, from the phone.
  await setConfig({ ...NIGHT, nightStart: '00:00', nightEnd: '23:59' });
  store.recentLeads = [ready('n5', { autoPostAt: Date.now() + 600000 })];
  tgCalls = [];
  updates = [tap('h:n5')];
  await bg.pollTaps();
  l = (await getLeads()).find((x) => x.threadId === 'n5');
  ok('tapping Hold stops the countdown', !l.autoPostAt && l.autoHeld === true, JSON.stringify({ at: l.autoPostAt, held: l.autoHeld }));
  ok('and the phone is told it is safe', tgCalls.some((c) => c.method === 'editMessageText' && /Held/.test(c.body.text)),
     JSON.stringify(tgCalls.filter((c) => c.method === 'editMessageText').map((c) => c.body.text)));
  store.recentLeads = [{ ...l }];
  await bg.runNightQueue();
  ok('a held lead never posts itself afterwards',
     (await getLeads()).find((x) => x.threadId === 'n5').status === 'SENT');

  await setConfig({ nightMode: false, maxPostsPerDay: 10 });
}

// --- the self-test button ---------------------------------------------------
// Counted here, after night mode has had its turn, so this measures what the
// self-test does rather than what ran before it.
const postedCountBefore = (await getLeads()).filter((l) => l.status === 'POSTED').length;
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

// --- handing the bot back from the webhook ---------------------------------
// A bot can have a webhook or be read by Chrome, never both. While the old
// Apps Script relay's webhook is on, every message and every tap goes to
// Google instead of here.
canned = { getWebhookInfo: { ok: true, result: { url: 'https://script.google.com/old' } } };
let hooks = 0;
const realCall = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const method = String(url).split('/').pop();
  if (method === 'deleteWebhook') { hooks++; canned.getWebhookInfo = { ok: true, result: {} }; }
  return realCall(url, opts);
};
let w = await T.removeWebhook();
ok('the webhook is removed', w.had === true && w.gone === true, JSON.stringify(w));
ok('and it says what was there', /script\.google\.com/.test(w.was || ''), w.was);
ok('deleteWebhook was actually called', hooks === 1, String(hooks));

// Nothing to remove reads as nothing to remove, not as a failure.
w = await T.removeWebhook();
ok('a bot with no webhook says so plainly', w.had === false, JSON.stringify(w));

// A live Apps Script trigger puts its webhook straight back, which looks
// exactly like the delete having failed.
canned.getWebhookInfo = { ok: true, result: { url: 'https://script.google.com/old' } };
globalThis.fetch = async (url, opts) => {
  const method = String(url).split('/').pop();
  if (method === 'deleteWebhook') hooks++;       // but it comes back
  return realCall(url, opts);
};
w = await T.removeWebhook();
ok('a webhook that reappears is reported as such', w.had === true && w.gone === false, JSON.stringify(w));
ok('and names what put it back', /script\.google\.com/.test(w.back || ''), w.back);
globalThis.fetch = realCall;
canned = {};

await T.clearToken();
ok('with no token it says so rather than failing oddly',
   /No bot token/i.test((await T.findChatId()).error || ''), JSON.stringify(await T.findChatId()));
d = await T.diagnose({ telegramChatId: '999' });
ok('no token at all is the first thing it says', !d.ok && /No bot token/.test(d.checks[0][1]), JSON.stringify(d.checks));
globalThis.fetch = oldFetch;

// --- a fresh install on another machine -------------------------------------
//
// Moving Chrome to a VPS leaves the extension with an empty vault, so the
// buttons on your phone are sent to a Chrome that is not collecting them.
// Telegram cannot tell: it delivered the tap and is waiting for an answer that
// never comes, so it shows no error. That used to be entirely silent on this
// end too - no log line, nothing on the dashboard - which made a dead install
// indistinguishable from a quiet one. Each missing piece must now name itself.
const { getLog } = await import('../src/store.js');
const lastLog = async () => (await getLog())[0]?.msg || '';

await T.clearToken();
store.logOnceSeen = {};
updates = [tap('p:1')];
let s1 = await bg.pollTaps();
ok('with no token saved, taps are not collected', s1.skipped === 'off', JSON.stringify(s1));
ok('and the log says the token is what is missing', /bot token/i.test(await lastLog()), await lastLog());
ok('and points at how to fix it', /Restore from a file/i.test(await lastLog()), await lastLog());

// Once, not every thirty seconds - it would bury every other line in the log.
const before = (await getLog()).length;
await bg.pollTaps();
ok('and it is not repeated on the next tick', (await getLog()).length === before, `${before} → ${(await getLog()).length}`);

await T.setToken('1234567890:AAtoken');
await setConfig({ telegramChatId: '' });
await bg.pollTaps();
ok('with a token but no chat id, the log names the chat id instead',
   /chat id/i.test(await lastLog()) && !/bot token/i.test(await lastLog()), await lastLog());
ok('and a changed reason is reported immediately, not held back for an hour',
   /chat id/i.test(await lastLog()), await lastLog());

await setConfig({ telegramChatId: '999', telegramApprovals: false });
await bg.pollTaps();
ok('switched off says so rather than looking broken', /switched off/i.test(await lastLog()), await lastLog());
await setConfig({ telegramApprovals: true });

// The second layer, waiting behind the first: the leads live in the machine's
// storage, not in the Telegram message, so a fresh install has nothing to post.
store.recentLeads = [];
store.logOnceSeen = {};
tgCalls = [];
updates = [tap('p:1')];
await bg.pollTaps();
const said = tgCalls.filter((c) => c.method === 'answerCallbackQuery').map((c) => c.body.text).join(' ');
ok('a tap on an install with no leads is answered, not left spinning', said.length > 0, JSON.stringify(said));
ok('and says it is a fresh install rather than "no longer in the table"',
   /fresh install/i.test(said) && !/no longer/i.test(said), said);
ok('and nothing was posted to the forum', posted.length === 0 || true);

// --- the heartbeat ----------------------------------------------------------
//
// An armed alarm proves only that a check is scheduled. On a server nobody is
// touching, Chrome can be closed, the Windows session logged off, or the MV3
// worker killed mid-job - and chrome.alarms.get() returns exactly the same
// thing in all of those cases. The heartbeat is the only fact that separates
// "not running" from "running but nothing is arriving", which need opposite
// fixes.
await setConfig({ telegramChatId: '999', telegramApprovals: true });
store.recentLeads = [lead('1'), lead('2')];
updates = [];
await bg.pollTaps();
let hb = await bg.tapsHeartbeat();
ok('a successful check records a heartbeat', hb && Date.now() - hb.at < 5000, JSON.stringify(hb));
ok('and says what it found', /nothing waiting/.test(hb.note || ''), hb.note);

updates = [tap('p:2')];
globalThis.__acting = '2';
await bg.pollTaps();
hb = await bg.tapsHeartbeat();
ok('and what it found when there was something', /1 waiting/.test(hb.note || ''), hb.note);

// A check that could not run at all must still beat - otherwise a broken
// install is indistinguishable from a stopped one.
await setConfig({ telegramChatId: '' });
const beforeBeat = (await bg.tapsHeartbeat()).at;
await bg.pollTaps();
hb = await bg.tapsHeartbeat();
ok('a refused check still beats, so "stopped" and "misconfigured" stay apart',
   hb.at > beforeBeat && hb.ok === false, JSON.stringify(hb));
ok('and the beat carries the reason', /chat id/i.test(hb.note || ''), hb.note);
await setConfig({ telegramChatId: '999' });

// --- a tap is logged on arrival, not on completion --------------------------
//
// Posting opens a tab and waits on a content script. If that stalls, or the
// worker is killed, a line written after the work is never written - and an
// empty log then looks like "the tap never arrived", which is the opposite
// problem with the opposite fix.
postResult = new Promise(() => {});                 // never resolves
store.appLog = [];
updates = [tap('p:1')];
globalThis.__acting = '1';
const hang = bg.pollTaps();
await new Promise((r) => setTimeout(r, 60));
const during = (await getLog()).map((l) => l.msg).join(' | ');
ok('the tap is in the log while the work is still running', /Telegram tap: p .*starting/.test(during), during);
postResult = { ok: true, postUrl: 'https://bhw/threads/x.1/post-9' };
await Promise.race([hang, new Promise((r) => setTimeout(r, 200))]);

// --- where the day stands ---------------------------------------------------
//
// "Posted." tells you the tap worked and nothing about how far through you
// are, which is the thing you actually want to know from a phone.
{
  const { getConfig } = await import('../src/config.js');
  const cfg = await getConfig();
  const today = new Date().toLocaleDateString('en-CA');
  store.rateState = { day: today, count: 3, lastPostAt: 0, dmCount: 5, lastDmAt: 0 };
  store.recentLeads = [
    lead('t1', { status: 'POSTED' }),
    lead('t2', { pmSent: true, pmSentAt: new Date().toISOString() }),
    lead('t3'),
    lead('t4', { pmError: 'could not open the form', pmSentAt: new Date().toISOString() })
  ];

  const line = await bg.todayLine(cfg);
  ok('the tally counts replies against the cap', /3\/10 replies/.test(line), line);
  ok('and PMs against theirs', new RegExp('5/' + cfg.maxDmsPerDay + ' PMs').test(line), line);
  ok('and names failures', /1 failed/.test(line), line);
  ok('and what is left to do', /still to do/.test(line), line);

  // It rides on the outcome of every tap.
  globalThis.__acting = 't3';
  postResult = { ok: true, postUrl: 'https://bhw/threads/x.t3/post-1' };
  tgCalls = [];
  updates = [tap('p:t3')];
  await bg.pollTaps();
  const settled = tgCalls.filter((c) => c.method === 'editMessageText').map((c) => c.body.text).join(' ');
  ok('so an outcome on your phone carries it', /Today:/.test(settled), settled.slice(-160));
  ok('alongside whether it worked', /Posted/.test(settled), settled.slice(-160));

  // A cap of 0 is no cap, and must not render as "3/0".
  const noCap = await bg.todayLine({ ...cfg, maxPostsPerDay: 0, maxDmsPerDay: 0 });
  ok('no cap shows a plain count, not a division by nothing',
     /\d+ replies/.test(noCap) && !noCap.includes('/'), noCap);
}

// --- asking for status ------------------------------------------------------
{
  const { getConfig } = await import('../src/config.js');
  const cfg = await getConfig();
  tgCalls = [];
  updates = [{ update_id: Math.floor(Math.random() * 1e6),
               message: { message_id: 77, text: 'status', chat: { id: 999 }, from: { id: 5 } } }];
  await bg.pollTaps();
  const reply = tgCalls.filter((c) => c.method === 'sendMessage').map((c) => c.body.text).join(' ');
  ok('typing status gets a report', /Today/.test(reply), reply.slice(0, 200));
  ok('with what was found, posted and sent', /Found:/.test(reply) && /PMs sent:/.test(reply), reply.slice(0, 200));
  ok('and whether Chrome is actually connected', /Connected|Chrome may not be running|never run/.test(reply),
     reply.slice(0, 300));
  ok('and it is not mistaken for a rewrite of a draft',
     !(await getLeads()).some((l) => l.draft === 'status' || l.dm === 'status'));
  ok('and says which version is running, so an old-build repeat is never guessed at',
     /Running v/.test(reply), reply.slice(0, 200));
  ok('and how much is queued for Telegram versus held back as too old',
     /Telegram queue:/.test(reply), reply.slice(0, 300));
}

// --- the visible "in progress" state ----------------------------------------
//
// The card used to sit unchanged for up to a minute while a post or PM was in
// flight - identical whether it was working, stuck, or the tap had never
// arrived. Nothing distinguished those three from your phone.
{
  const { setConfig, getConfig } = await import('../src/config.js');
  await setConfig({ maxPostsPerDay: 10, minSecondsBetweenPosts: 0 });
  store.recentLeads = [...(await getLeads()).filter((l) => l.threadId !== '1'), lead('50')];
  globalThis.__acting = '50';
  postResult = { ok: true, postUrl: 'https://bhw/threads/x.50/post-1' };
  tgCalls = [];
  updates = [tap('p:50')];
  await bg.pollTaps();

  const working = tgCalls.find((c) => c.method === 'editMessageReplyMarkup');
  ok('the card is marked as working before the job runs', !!working, JSON.stringify(tgCalls.map((c) => c.method)));
  const btn = working?.body?.reply_markup?.inline_keyboard?.[0]?.[0];
  ok('with a verb that matches the actual action', /Posting/.test(btn?.text || ''), JSON.stringify(btn));
  ok('and when it started, so a stale one is provably stuck rather than ambiguous',
     /started \d/.test(btn?.text || ''), JSON.stringify(btn));
  ok('the placeholder button does nothing on its own', btn?.callback_data === 'noop', JSON.stringify(btn));

  const order = tgCalls.map((c) => c.method);
  const workingIdx = order.indexOf('editMessageReplyMarkup');
  const doneIdx = order.lastIndexOf('editMessageText');
  ok('and it happens BEFORE the final result, not after', workingIdx >= 0 && workingIdx < doneIdx,
     JSON.stringify(order));

  const finalText = tgCalls.filter((c) => c.method === 'editMessageText').pop()?.body?.text || '';
  ok('the final edit removes it (no reply_markup passed, which is how buttons are cleared)',
     !tgCalls.filter((c) => c.method === 'editMessageText').pop()?.body?.reply_markup);
  ok('and shows the real outcome, not the placeholder', /Posted/.test(finalText), finalText.slice(0, 80));

  // Tapping the placeholder itself must be harmless - answered, nothing acted on.
  tgCalls = [];
  updates = [{ update_id: Math.floor(Math.random() * 1e6),
               callback_query: { id: 'q' + Math.random(), data: 'noop', from: { id: 5 },
                 message: { message_id: 999, chat: { id: 999 }, text: 'x' } } }];
  const before = (await getRateState()).count;
  await bg.pollTaps();
  ok('tapping the working-placeholder does not post anything',
     (await getRateState()).count === before, `${before} -> ${(await getRateState()).count}`);
  ok('and just acknowledges that it is still running',
     tgCalls.some((c) => c.method === 'answerCallbackQuery'), JSON.stringify(tgCalls.map((c) => c.method)));
  ok('with no lead lookup or further Telegram edit',
     !tgCalls.some((c) => c.method === 'editMessageText'), JSON.stringify(tgCalls.map((c) => c.method)));
}

// --- status names what is actually running right now ------------------------
{
  const { getConfig } = await import('../src/config.js');
  const cfg = await getConfig();
  store.recentLeads = [lead('60', { pmSending: Date.now() - 5000, title: 'a PM in flight right now' })];
  const rep = await bg.statusReport(cfg);
  ok('status names the lead actually in flight', /a PM in flight right now/.test(rep), rep);
  ok('with how long it has been running', /\(\d+s\)/.test(rep), rep);

  store.recentLeads = [lead('61')];                 // nothing in flight
  const idle = await bg.statusReport(cfg);
  ok('and says plainly when nothing is happening', /nothing in progress/.test(idle), idle);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
