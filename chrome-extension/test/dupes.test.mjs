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
let tgCalls = [], inboxHtml = '', inboxFail = '', fetched = 0, editFails = false;
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
    // Simulates Telegram refusing to edit a message past its 48-hour window.
    if (method === 'editMessageText' && editFails) {
      return { ok: false, status: 400,
               json: async () => ({ ok: false, description: "Bad Request: message can't be edited" }) };
    }
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

// --- the inbox is the authority on a send, not the tab ----------------------
//
// The tab can only report what it saw. The message list is the forum's own
// record of what exists, so it is asked on every send - and "sent" on the
// dashboard then means the same thing as "sent" on BHW, which is what makes
// the strike-through trustworthy enough to stop a second PM.
//
// The case that used to vanish: {ok:true, sent:false}. It matched neither
// branch, so there was no flag, no error and no log line - a row that looked
// untouched for a PM that had almost certainly gone.
store.recentLeads = [lead('8')];
store.rateState = { day: today, count: 0, lastPostAt: 0, dmCount: 0, lastDmAt: 0 };
dmResult = { ok: true, sent: false, unconfirmed: true, error: 'submitted, but the page never confirmed it within 20s' };
inboxHtml = inbox(convRow(508, 'Need a Google Ads guy for crypto', 'buyer8', new Date().toISOString(), ME));
globalThis.__acting = '8';
let l8 = await bg.sendDm((await getLeads())[0], await (await import('../src/config.js')).getConfig(), { mode: 'send' });
let row8 = (await getLeads())[0];
ok('a send the page could not confirm is settled by the message list', row8.pmSent === true,
   JSON.stringify({ r: l8, pmSent: row8.pmSent }));
ok('so the row strikes through instead of looking untouched', row8.pmSent === true);
ok('and it counts once', (await getRateState()).dmCount === 1, String((await getRateState()).dmCount));
ok('the conversation is linked from the row', /direct-messages/.test(row8.pmUrl || ''), row8.pmUrl);
ok('and it is recorded as ours, not as a list find', row8.pmFrom === 'sent from here', row8.pmFrom);

// Which matters: the clearing pass must never take back a PM we sent.
inboxHtml = inbox();                                  // the list no longer matches
const before8 = (await getLeads())[0].pmSent;
await bg.syncSentPms({ pages: 1 });
ok('a PM we sent is never un-marked by the message-list check',
   (await getLeads())[0].pmSent === before8 && before8 === true,
   JSON.stringify((await getLeads())[0]));

// Page says sent, list has not caught up yet: the tab is evidence enough.
store.recentLeads = [lead('9')];
store.rateState = { day: today, count: 0, lastPostAt: 0, dmCount: 0, lastDmAt: 0 };
dmResult = { ok: true, sent: true, dmUrl: 'https://bhw/direct-messages/t.9/' };
inboxHtml = inbox();
globalThis.__acting = '9';
await bg.sendDm((await getLeads())[0], await (await import('../src/config.js')).getConfig(), { mode: 'send' });
ok('a send the tab watched is marked even before the list shows it',
   (await getLeads())[0].pmSent === true, JSON.stringify((await getLeads())[0]));

// Neither the page nor the list: this really did not go, and says so.
store.recentLeads = [lead('10')];
store.rateState = { day: today, count: 0, lastPostAt: 0, dmCount: 0, lastDmAt: 0 };
dmResult = { ok: true, sent: false, unconfirmed: true, error: 'submitted, but the page never confirmed it within 20s' };
inboxHtml = inbox();
globalThis.__acting = '10';
await bg.sendDm((await getLeads())[0], await (await import('../src/config.js')).getConfig(), { mode: 'send' });
let row10 = (await getLeads())[0];
ok('with no evidence anywhere it is not marked sent', !row10.pmSent, JSON.stringify(row10));
ok('and the reason is on the row rather than nowhere', /never confirmed/.test(row10.pmError || ''), row10.pmError);
ok('and no slot is spent', (await getRateState()).dmCount === 0, String((await getRateState()).dmCount));
dmResult = { ok: true, sent: true };

// --- the inbox is swept on every poll, not hourly ---------------------------
//
// The table is what stops a PM going out twice, so up to an hour stale was the
// wrong trade: a PM sent from the phone or another machine should show as sent
// by the next check.
{
  const { getConfig } = await import('../src/config.js');
  store.recentLeads = [lead('20')];
  store.rateState = { day: today, count: 0, lastPostAt: 0, dmCount: 0, lastDmAt: 0 };
  inboxHtml = inbox(convRow(520, 'Need a Google Ads guy for crypto', 'buyer20', new Date().toISOString(), ME),
                    convRow(521, 'something else', 'someone', new Date().toISOString(), ME),
                    convRow(522, 'a third', 'another', new Date().toISOString(), ME));
  fetched = 0;
  // runCheck, not pollFeed: pollFeed returns early when nothing is new, and
  // "nothing new on the forum" says nothing about what you sent from your
  // phone since. The sweep has to happen on every path.
  await bg.runCheck().catch(() => {});
  ok('a check reads the message list too', fetched > 0, String(fetched));
  ok('and strikes off what it finds', (await getLeads()).find((l) => l.threadId === '20')?.pmSent === true,
     JSON.stringify((await getLeads()).find((l) => l.threadId === '20')));
  // Identity came from the conversations themselves - the fixture's nav markup
  // is not what proves it.
  const r2 = await bg.syncSentPms({ pages: 1 });
  ok('and it knows which account you are without any Settings entry', r2.me === ME.toLowerCase(), r2.me);
}

// --- a card that cannot be tapped into a refusal ----------------------------
//
// A PM already in the list has no business offering a send button: the tap can
// only be refused, and the refusal lands seconds later on a card that still
// looks sendable.
{
  const buttons = (l) => (T.keyboard(l, 'PM', { telegramApprovals: true })?.inline_keyboard || [])
    .flat().map((b) => b.text).join(' | ');
  ok('an unsent lead offers Post DM Now', /Post DM Now/.test(buttons(lead('30'))), buttons(lead('30')));
  const gone = lead('31', { pmSent: true, pmUrl: 'https://www.blackhatworld.com/direct-messages/t.9/' });
  ok('one already in the list does not', !/Post DM Now/.test(buttons(gone)), buttons(gone));
  ok('nor offers to edit a PM that has gone', !/Edit DM/.test(buttons(gone)), buttons(gone));
  ok('it links the conversation instead', /already sent/i.test(buttons(gone)), buttons(gone));
  ok('and the public reply is still fully actionable',
     /Post Public Now/.test(buttons(gone)) && /Edit Post/.test(buttons(gone)), buttons(gone));
}

// --- failing closed must never be quiet -------------------------------------
//
// Marking leads done on a bad guess is worse than marking nothing, so no
// username means nothing is marked. But a silent "0 already sent" reads exactly
// like "nothing to do", which is how this looked broken rather than stuck.
{
  store.recentLeads = [lead('40')];
  // One row only: too little to conclude from, and no nav markup to fall back on.
  inboxHtml = '<html>' + convRow(540, 'x', 'buyer40', new Date().toISOString(), 'buyer40') + '</html>';
  const r3 = await bg.syncSentPms({ pages: 1 });
  ok('with no way to tell who you are, nothing is marked sent',
     !(await getLeads())[0].pmSent && r3.me === '', JSON.stringify(r3));
  ok('and the result says so rather than reading as "nothing to do"', r3.me === '', JSON.stringify(r3));
  const said = (await (await import('../src/store.js')).getLog())[0]?.msg || '';
  ok('the log names the problem and the fix', /which BHW account you are/.test(said) || /could not be identified/.test(said), said);
}

// --- Telegram announces a thread once, ever ---------------------------------
//
// `seen` decides what is new, but it can be emptied - "Load last 48h", a wiped
// profile, a fresh install on another machine - and every thread on the board
// then looks new again and arrives on the phone at once. The stamp lives on the
// lead and survives a re-parse, so this cannot happen however `seen` is
// disturbed.
{
  const { recordLeads, getLeads: gl } = await import('../src/store.js');
  store.recentLeads = [];
  store.seenThreads = {};

  // Announced once.
  await recordLeads([lead('60', { tgSentAt: '2026-09-17T10:00:00Z', tgCards: { PM: 44 } })]);
  ok('an announced thread carries its stamp', (await gl())[0].tgSentAt === '2026-09-17T10:00:00Z');

  // Re-found by a later poll, with a fresh parse that knows nothing about it.
  await recordLeads([lead('60')]);
  const again = (await gl()).find((l) => l.threadId === '60');
  ok('re-finding it does not clear the stamp', again.tgSentAt === '2026-09-17T10:00:00Z', again.tgSentAt);
  ok('and the card it belongs to is remembered too', again.tgCards?.PM === 44, JSON.stringify(again.tgCards));

  // Which is what the poll filters on.
  const announced = new Set((await gl()).filter((l) => l.tgSentAt).map((l) => String(l.threadId)));
  ok('so the poll skips it', announced.has('60'));
  ok('while a thread never announced is not skipped', !announced.has('61'));
}

// --- nothing carrying the bot's own text ever leaves ------------------------
//
// The checkpoint that cannot be tapped through. Stripping on the way in is the
// repair; this is the guarantee, because a draft can also reach a buyer by a
// path that never went through the editor at all.
{
  const { getConfig } = await import('../src/config.js');
  const cfg = await getConfig();
  const bad = '✏️ Editing the DM — a thread\nTap the text to copy it, paste it back, change what you like and send.\nHi there, we can help.';

  store.recentLeads = [lead('70', { dm: bad })];
  store.rateState = { day: today, count: 0, lastPostAt: 0, dmCount: 0, lastDmAt: 0 };
  inboxHtml = inbox();
  globalThis.__acting = '70';
  const r = await bg.sendDm((await getLeads())[0], cfg, { mode: 'send' });
  ok('a PM carrying my own instructions is refused', r.blocked === true && r.ok === false, JSON.stringify(r));
  ok('and nothing is marked sent', !(await getLeads())[0].pmSent, JSON.stringify((await getLeads())[0].pmSent));
  ok('and no slot is spent', (await getRateState()).dmCount === 0, String((await getRateState()).dmCount));
  ok('and the row says what is wrong and how to fix it',
     /my own text/.test((await getLeads())[0].pmError || '') && /grey block/.test((await getLeads())[0].pmError || ''),
     (await getLeads())[0].pmError);

  // A public reply is worse, not better: it is on the thread for everyone.
  store.recentLeads = [lead('71', { draft: bad })];
  const p = await bg.postLead((await getLeads())[0], cfg, {});
  ok('a public reply carrying it is refused too', p.blocked === true, JSON.stringify(p));
  ok('and the thread was never opened', (await getLeads())[0].status !== 'POSTED',
     (await getLeads())[0].status);

  // And an ordinary draft is not held up by any of this.
  store.recentLeads = [lead('72')];
  store.rateState = { day: today, count: 0, lastPostAt: 0, dmCount: 0, lastDmAt: 0 };
  globalThis.__acting = '72';
  dmResult = { ok: true, sent: true };
  const good = await bg.sendDm((await getLeads())[0], cfg, { mode: 'send' });
  ok('a normal PM still goes', good.sent === true && !good.blocked, JSON.stringify(good));
}

// --- what you approved is what the buyer gets -------------------------------
//
// A Telegram card showed three Claude-written lines about Facebook group
// posting, with "No payment upfront. You pay after the first piece is with
// you." The buyer received two generic lines and a different payment sentence.
//
// The card and the send each produced the text from the lead, separately. So
// anything that changed the lead in between - a draft rewrite, a lost set of
// Claude lines, a different close being chosen - meant approving one message
// and sending another. The card now records exactly what it displayed, and the
// send uses that string and never renders again.
{
  const { getConfig } = await import('../src/config.js');
  const cfg = await getConfig();

  const APPROVED = 'Hi Conor234,\n\n1. We run multi account Facebook group posting setups\n\n'
    + 'No payment upfront. You pay after the first piece is with you.\n\nThanks!!';

  // The lead has since been rewritten into something generic - the exact
  // situation that produced the mismatch.
  store.recentLeads = [lead('100', {
    dmApproved: APPROVED,
    dm: 'Hi Conor234,\n\n1. Tell us the details and we will scope it same day\n\nHappy to invoice after the first batch lands.\n\nThanks!!'
  })];
  store.rateState = { day: today, count: 0, lastPostAt: 0, dmCount: 0, lastDmAt: 0 };
  inboxHtml = '';
  globalThis.__acting = '100';
  dmResult = { ok: true, sent: true };

  let typed = '';
  const realExec = chrome.scripting.executeScript;
  chrome.scripting.executeScript = async (opts) => {
    if (opts.args?.[0]?.body) typed = opts.args[0].body;
    return realExec(opts);
  };
  await bg.sendDm((await getLeads())[0], cfg, { mode: 'send' });
  chrome.scripting.executeScript = realExec;

  ok('the buyer gets the text that was on the card', typed === APPROVED, typed.slice(0, 80));
  ok('and not the rewritten one', !/Tell us the details/.test(typed), typed.slice(0, 80));
  ok('specifically the Claude lines survive', /multi account Facebook group/.test(typed), typed.slice(0, 80));
  ok('and the payment sentence you saw', /You pay after the first piece is with you/.test(typed), typed.slice(-60));

  // With nothing approved it still sends, but says the text may not match.
  store.recentLeads = [lead('101', { dm: 'a draft nobody approved' })];
  store.rateState = { day: today, count: 0, lastPostAt: 0, dmCount: 0, lastDmAt: 0 };
  globalThis.__acting = '101';
  await bg.sendDm((await getLeads())[0], cfg, { mode: 'send' });
  ok('a lead never announced still sends its draft', (await getLeads())[0].pmSent === true);

  // An edit from the phone becomes the approved text, so the next tap sends it.
  store.recentLeads = [lead('102', { dmApproved: 'old approved', dm: 'old approved' })];
  await (await import('../src/store.js')).updateLead('102', { dm: 'my own wording', dmApproved: 'my own wording' });
  store.rateState = { day: today, count: 0, lastPostAt: 0, dmCount: 0, lastDmAt: 0 };
  globalThis.__acting = '102';
  typed = '';
  chrome.scripting.executeScript = async (opts) => {
    if (opts.args?.[0]?.body) typed = opts.args[0].body;
    return realExec(opts);
  };
  await bg.sendDm((await getLeads())[0], cfg, { mode: 'send' });
  chrome.scripting.executeScript = realExec;
  ok('an edited PM sends the edit, not the original', typed === 'my own wording', typed);
}

// --- an automatic template refresh must never silently re-approve ----------
//
// A real buyer received wording nobody had signed off on. Cause: every
// release this week changed the template wording, refreshIfTemplatesChanged
// runs automatically on every reload and calls rebuildDrafts for every open
// lead, and rebuildDrafts used to push the freshly-rendered text straight into
// dmApproved/draftApproved for any already-announced lead - whether or not the
// Telegram card actually got updated to match. Telegram refuses to edit a
// message older than 48 hours, and that failure was swallowed, so the card
// kept showing the old, approved wording while storage silently moved on to
// the new wording. Tapping Post DM Now days later sent the new wording - text
// that had never been shown to anyone.
{
  const { getConfig, setConfig } = await import('../src/config.js');
  const { updateLead, getLeads: gl } = await import('../src/store.js');

  store.recentLeads = [lead('200', {
    tgSentAt: new Date().toISOString(),
    tgCards: { PM: 501, 'public reply': 502 },
    dm: 'Hi buyer200,\n\nOLD WORDING - this is what the card on the phone shows.\n\nThanks!!',
    dmApproved: 'Hi buyer200,\n\nOLD WORDING - this is what the card on the phone shows.\n\nThanks!!',
    draft: 'OLD public reply wording.',
    draftApproved: 'OLD public reply wording.'
  })];

  // A release changes the template wording - the everyday trigger.
  await setConfig({ dmTemplates: { generic: 'Hi {{author}},\n\nNEW WORDING after the release.\n\nThanks!!' } });
  const cfg = await getConfig();

  // The automatic path: refreshIfTemplatesChanged calls exactly this.
  tgCalls = [];
  editFails = true;                       // the card is past its 48h edit window
  await bg.rebuildDrafts({ withAi: false, syncApproved: false });
  let row = (await gl())[0];
  ok('the underlying draft is refreshed for the dashboard', /NEW WORDING/.test(row.dm), row.dm);
  ok('but the approved, frozen text is NOT touched automatically',
     /OLD WORDING/.test(row.dmApproved), row.dmApproved);
  ok('and Telegram is never even asked to edit anything on this path',
     !tgCalls.some((c) => c.method === 'editMessageText'), JSON.stringify(tgCalls.map((c) => c.method)));

  // Which means a tap on the OLD card sends the OLD, still-matching text.
  store.rateState = { day: today, count: 0, lastPostAt: 0, dmCount: 0, lastDmAt: 0 };
  inboxHtml = '';
  globalThis.__acting = '200';
  let typed = '';
  const realExec = chrome.scripting.executeScript;
  chrome.scripting.executeScript = async (opts) => {
    if (opts.args?.[0]?.body) typed = opts.args[0].body;
    return realExec(opts);
  };
  await bg.sendDm((await gl())[0], cfg, { mode: 'send' });
  chrome.scripting.executeScript = realExec;
  ok('so what gets sent still matches the card, not the new release wording',
     /OLD WORDING/.test(typed) && !/NEW WORDING/.test(typed), typed);

  // The explicit "Rewrite drafts" button IS allowed to sync, but only when the
  // Telegram card can actually be updated to match.
  store.recentLeads = [lead('201', {
    tgSentAt: new Date().toISOString(),
    tgCards: { PM: 601, 'public reply': 602 },
    dm: 'Hi buyer201,\n\nOLD WORDING here too.\n\nThanks!!',
    dmApproved: 'Hi buyer201,\n\nOLD WORDING here too.\n\nThanks!!'
  })];
  tgCalls = [];
  editFails = false;                      // this one CAN still be edited
  await bg.rebuildDrafts({ withAi: false });
  row = (await gl())[0];
  ok('when the card can be updated, the explicit rewrite does sync it',
     /NEW WORDING/.test(row.dmApproved), row.dmApproved);
  ok('and Telegram was actually asked to edit it',
     tgCalls.some((c) => c.method === 'editMessageText'), JSON.stringify(tgCalls.map((c) => c.method)));

  // And when it explicitly cannot (still 48h-locked), the explicit rewrite
  // still refuses to let the approved text drift from the card, and says why.
  store.recentLeads = [lead('202', {
    tgSentAt: new Date().toISOString(),
    tgCards: { PM: 701, 'public reply': 702 },
    dm: 'Hi buyer202,\n\nOLD WORDING, locked card.\n\nThanks!!',
    dmApproved: 'Hi buyer202,\n\nOLD WORDING, locked card.\n\nThanks!!'
  })];
  editFails = true;
  await bg.rebuildDrafts({ withAi: false });
  row = (await gl())[0];
  ok('a card that truly cannot be updated keeps its old approved text even on an explicit rewrite',
     /OLD WORDING/.test(row.dmApproved), row.dmApproved);
  const said = (await (await import('../src/store.js')).getLog()).map((l) => l.msg).join(' | ');
  ok('and you are told, rather than it happening silently', /could not update the Telegram card/.test(said),
     said.slice(0, 200));
  editFails = false;
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
