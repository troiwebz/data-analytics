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
  tabs: { onRemoved: { addListener: () => {} }, onUpdated: { addListener: () => {}, removeListener: () => {} }, query: async () => [], create: async () => ({ id: 1 }) },
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
    sentToClaude = JSON.parse(opts.body).messages[0].content;
    const ids = sentToClaude.match(/id: (\d+)/g).map((s) => s.slice(4));
    return { ok: true, status: 200, json: async () => ({
      content: [{ type: 'text', text: JSON.stringify(Object.fromEntries(ids.map((id) => [id, {
        tips: ['We have built citations manually on directories that index in the UAE', 'We can audit the NAP across the existing profiles first', 'We are able to fix GMB categories before anything else'],
        question: 'Audit-safe citations, or volume for a tier 2 layer?', offer: 'formula'
      }]))) }],
      usage: { input_tokens: 800, cache_read_input_tokens: 300, output_tokens: 90 }
    }) };
  }
  if (u.includes('api.telegram.org')) { tg.push(JSON.parse(opts.body)); return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) }; }
  if (/\/threads\//.test(u)) {                       // the thread page itself
    threadReads.push(u);
    return { ok: true, status: 200, text: async () => THREAD };
  }
  if (u.includes('script.google.com')) throw new Error('Apps Script must NOT be called');
  if (u.includes('index.rss')) return { ok: true, status: 200, text: async () => RSS };
  if (u.includes('manifest.json')) return { ok: true, json: async () => ({ version: '0.21.0' }) };
  return { ok: true, status: 200, text: async () => LISTING };
};

// A thread page: the buyer's post, and one freelancer already pitching.
let THREAD = `
<article class="message" data-author="buyer0">
  <div class="bbWrapper">Need citations for a clinic in Dubai and a second site in Manchester.
  Budget $400. Must survive a manual audit.</div>
</article>
<article class="message" data-author="rival_seo">
  <div class="bbWrapper">We can do 500 citations cheap, fast delivery.</div>
</article>`;
let threadReads = [], sentToClaude = '';

const bg = await import('../src/background.js');
const { setConfig, getConfig } = await import('../src/config.js');
const C = await import('../src/claude.js');

let fails = 0;
const ok = (n, c, e='') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + ' ' + e); } };

await C.saveKey('sk-ant-api03-TESTKEYTESTKEY');
// No webhookUrl, no sharedSecret: the Apps Script path must never be touched.
await setConfig({ enabled: true, webhookUrl: '', sharedSecret: '', backfillHours: 0,
                  telegramEnabled: true, telegramChatId: '999', telegramApprovals: true,
                  secondsBetweenThreadReads: 0 });   // no need to pace a stub
const TG = await import('../src/telegram.js');
await TG.setToken('1234567890:AAtesttoken');

let r = await bg.runCheck();                    // first run seeds the database
ok('first run seeds without Apps Script', r.seeded === 3, JSON.stringify(r));

// Forget the seeded ids so the same threads come back as new.
store.seenThreads = { 'x': Date.now() };
r = await bg.runCheck();
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
// The question is written but held back for the PM: nobody on HAF opens a
// public reply with a question, and asking one in the open invites the other
// freelancers to answer it for you.
ok('the public reply asks no question', !lead.draft.includes('?'), lead.draft);
ok('and is just the claim then the PM line', lead.draft.trim().split('\n').filter(Boolean).length === 2, lead.draft);

// The thread page is read before drafting, so Claude answers the post rather
// than the title - and knows what the competition already promised.
ok('each thread was opened before drafting', threadReads.length === 3, JSON.stringify(threadReads.length));
ok('the buyer\'s real post reached the lead', /survive a manual audit/.test(lead.body || ''), JSON.stringify(lead.body));
ok('and the freelancer already pitching came with it',
   (lead.replies || []).some((x) => /500 citations cheap/.test(x.text)), JSON.stringify(lead.replies));
ok('the post went to Claude, not just the title', /survive a manual audit/.test(sentToClaude), sentToClaude.slice(0, 120));
ok('and so did the competition', /500 citations cheap/.test(sentToClaude), sentToClaude.slice(0, 200));

// The thread is read locally first - for nothing - and what it found is what
// Claude is pointed at: what everyone is already promising, and the part of the
// buyer's ask nobody has answered.
ok('the reading of the thread went with it', /thread so far:/.test(sentToClaude), sentToClaude.slice(0, 400));
ok('including what nobody has answered', /STILL UNANSWERED/.test(sentToClaude), sentToClaude.slice(0, 400));
ok('the audit requirement is the opening here', /STILL UNANSWERED[^\n]*audit/.test(sentToClaude),
   (sentToClaude.match(/STILL UNANSWERED[^\n]*/) || [''])[0]);
ok('the lead remembers what its lines were written from', !!lead.aiFrom, JSON.stringify(lead.aiFrom));

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

// Every newly launched thread reaches the phone ready to approve, on the
// ordinary 3-minute check - no button pressed, nothing else to do.
ok('every new thread arrives with approval buttons',
   tg.length === 6 && tg.every((m) => !!m.reply_markup), JSON.stringify(tg.map((m) => !!m.reply_markup)));
const btns = tg.flatMap((m) => m.reply_markup.inline_keyboard.flat().map((b) => b.text));
ok('every message can post the public reply', btns.filter((t) => /Post Public Now/.test(t)).length === 6, btns.join(' | '));
ok('and send the DM', btns.filter((t) => /Post DM Now/.test(t)).length === 6, btns.join(' | '));
ok('and edit either of them first', btns.filter((t) => /Edit Post|Edit DM/.test(t)).length === 12,
   String(btns.filter((t) => /Edit/.test(t)).length));
ok('nothing was posted by the check itself - a thread only goes out when you tap',
   (store.recentLeads || []).every((l) => l.status !== 'POSTED'),
   JSON.stringify((store.recentLeads || []).map((l) => l.status)));

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




// Claude is not asked again when nothing about the thread has changed.
const callsAtRest = aiCalls;
await bg.rebuildDrafts({ withAi: true });
ok('a second rewrite with nothing new costs nothing', aiCalls === callsAtRest, `calls=${aiCalls} was=${callsAtRest}`);

// A new reply on the thread is new information, so it is worth asking again.
// It has to appear on the thread itself, not just in the stored row: the
// rewrite re-reads the page, and the live thread is what counts.
THREAD += `
<article class="message" data-author="latecomer">
  <div class="bbWrapper">We also handle the manual audit side.</div>
</article>`;
await bg.rebuildDrafts({ withAi: true });
ok('a new reply on the thread does buy another call', aiCalls > callsAtRest, `calls=${aiCalls} was=${callsAtRest}`);
ok('and the newcomer reached Claude', /manual audit side/.test(sentToClaude), sentToClaude.slice(0, 300));

// --- a busy poll must not silence the overflow ------------------------------
//
// sendLeads sends at most six per poll, on purpose - a quiet burst, not a
// flood. But the whole batch was stamped as announced, so a poll that found 33
// threads sent six and marked twenty-seven as done. A thread is only "new"
// once, so those twenty-seven waited for a re-find that never comes: silent
// for ever, with nothing anywhere saying so.
{
  const { getLeads: gl } = await import('../src/store.js');
  const { getConfig } = await import('../src/config.js');
  const cfg = await getConfig();

  const many = [];
  for (let i = 1; i <= 15; i++) {
    many.push({ threadId: `b${i}`, title: `waiting ${i}`, author: `a${i}`,
                url: `https://bhw/threads/x.b${i}/`, foundAt: new Date(Date.now() - i * 60000).toISOString(),
                draft: 'reply body', dm: 'pm body', dmTitle: `waiting ${i}`, status: 'SENT' });
  }
  store.recentLeads = many;

  tg = [];
  const r1 = await bg.announceNew(cfg);
  const stamped1 = (await gl()).filter((l) => l.tgSentAt).length;
  ok('only a handful go on one poll', r1.sent > 0 && r1.sent < 15, JSON.stringify(r1));
  ok('and ONLY those are stamped as announced', stamped1 === r1.sent, `${stamped1} stamped, ${r1.sent} sent`);
  ok('the rest are reported as waiting, not silently dropped', r1.left === 15 - r1.sent, JSON.stringify(r1));

  // The next check drains more, without waiting for a new thread to carry them.
  tg = [];
  const r2 = await bg.announceNew(cfg);
  const stamped2 = (await gl()).filter((l) => l.tgSentAt).length;
  ok('the next check sends more of them', stamped2 > stamped1, `${stamped1} → ${stamped2}`);
  ok('and never re-sends one already announced', r2.sent + r1.sent === stamped2,
     `${r1.sent} + ${r2.sent} vs ${stamped2}`);

  // Drain it completely.
  for (let i = 0; i < 5; i++) await bg.announceNew(cfg);
  ok('every lead reaches Telegram eventually', (await gl()).every((l) => l.tgSentAt),
     String((await gl()).filter((l) => !l.tgSentAt).length) + ' left');
  const done = await bg.announceNew(cfg);
  ok('and then it goes quiet', done.waiting === 0, JSON.stringify(done));

  // History recorded on first run is not a queue of leads to pitch.
  store.recentLeads = [{ threadId: 'h1', title: 'old', author: 'x', foundAt: new Date().toISOString(),
                         draft: 'd', dm: 'p', status: 'BACKFILL' }];
  const hist = await bg.announceNew(cfg);
  ok('backfilled history is never announced', hist.waiting === 0, JSON.stringify(hist));

  // Nor is anything you have already dealt with.
  store.recentLeads = [{ threadId: 'p1', status: 'POSTED', title: 'x', draft: 'd', dm: 'p', foundAt: new Date().toISOString() },
                       { threadId: 's1', status: 'SKIPPED', title: 'y', draft: 'd', dm: 'p', foundAt: new Date().toISOString() }];
  const decided = await bg.announceNew(cfg);
  ok('and neither is a lead you already posted or skipped', decided.waiting === 0, JSON.stringify(decided));
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
