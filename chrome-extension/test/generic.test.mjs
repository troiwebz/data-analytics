// A generic, rule-based draft must never look like a real, Claude-written
// one. This is the exact bug behind "totally generic message, do you see the
// technical point?" - a buyer got "Tell us the details and we will scope it
// same day" with nothing about their actual thread, and nothing anywhere
// said this draft was the built-in fallback rather than a real answer.
const store = {};
globalThis.chrome = {
  runtime: {
    onInstalled: { addListener: () => {} }, onStartup: { addListener: () => {} },
    onMessage: { addListener: () => {} },
    getManifest: () => ({ version: '0.90.0' }), getURL: (p) => 'x/' + p, reload: () => {}
  },
  action: { onClicked: { addListener: () => {} } },
  tabs: { onRemoved: { addListener: () => {} }, onUpdated: { addListener: () => {}, removeListener: () => {} },
          query: async () => [], create: async () => ({ id: 1 }) },
  alarms: { onAlarm: { addListener: () => {} }, clear: async () => {}, create: () => {} },
  notifications: { create: (id, o, cb) => cb && cb(id), clear: () => {},
                   onClicked: { addListener: () => {} }, onButtonClicked: { addListener: () => {} } },
  offscreen: { hasDocument: async () => false, createDocument: async () => {} },
  scripting: { executeScript: async () => [{ result: { ok: true } }] },
  storage: { local: {
    get: async (k) => { if (k == null) return structuredClone(store);
      if (Array.isArray(k)) return Object.fromEntries(k.filter((x) => x in store).map((x) => [x, structuredClone(store[x])]));
      return k in store ? { [k]: structuredClone(store[k]) } : {}; },
    set: async (o) => Object.assign(store, o),
    remove: async (k) => { for (const x of (Array.isArray(k) ? k : [k])) delete store[x]; }
  }, sync: { get: async () => ({}), set: async () => {}, remove: async () => {} } }
};

const RSS = `<rss><channel>
  <item>
    <title>help with handling negative google feedback</title>
    <link>https://www.blackhatworld.com/seo/help-with-handling-negative-google-feedback.1849995/</link>
    <pubDate>${new Date().toUTCString()}</pubDate>
    <dc:creator>thanhbear</dc:creator>
    <description>Need help getting negative reviews handled and pushed down.</description>
  </item>
</channel></rss>`;
const LISTING = `<html>
  <div class="structItem structItem--thread js-threadListItem-1849995">
    <div class="structItem-title"><a href="/threads/x.1849995/">help with handling negative google feedback</a></div>
    <a href="/members/thanhbear.1/" data-author="thanhbear" class="username">thanhbear</a>
    <time class="structItem-startDate" data-timestamp="${Math.floor(Date.now() / 1000) - 600}"></time>
    <dd>12</dd>
  </div>
</html>`;
const THREAD = `<article class="message" data-author="thanhbear">
  <div class="bbWrapper">We have a string of negative reviews on our Google profile and need help handling them.</div>
</article>`;

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('index.rss')) return { ok: true, status: 200, text: async () => RSS };
  if (/\/threads\//.test(u)) return { ok: true, status: 200, text: async () => THREAD };
  if (u.includes('manifest.json')) return { ok: true, json: async () => ({ version: '0.90.0' }) };
  return { ok: true, status: 200, text: async () => LISTING };
};

const bg = await import('../src/background.js');
const { setConfig } = await import('../src/config.js');

let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + '  ' + e); } };

// No Claude key saved at all - the simplest, most deterministic way to force
// writeSpecifics to stand down without needing to mock api.anthropic.com.
await setConfig({ enabled: true, webhookUrl: '', sharedSecret: '', backfillHours: 0,
                  telegramEnabled: false, aiSpecifics: true, secondsBetweenThreadReads: 0 });

let r = await bg.runCheck();                    // first run: seeds, no leads yet
ok('first run just seeds', r.seeded === 1, JSON.stringify(r));

store.seenThreads = { x: Date.now() };           // non-empty, so this is no longer "first run",
                                                  // but our thread id itself is still unseen
r = await bg.runCheck();
ok('second run matches the thread', r.matched === 1, JSON.stringify(r));

const lead = (store.recentLeads || [])[0];
ok('a lead was recorded', !!lead, JSON.stringify(store.recentLeads));
ok('it is marked as drafted by the built-in rules, not Claude', lead.draftedBy === 'rules', lead.draftedBy);
ok('and says why', /no claude key/i.test(lead.draftedByNote || ''), lead.draftedByNote);
ok('the draft itself is still real text, not blank', lead.draft.length > 20, lead.draft);

// The card - what actually reaches the phone - carries the warning, loud and
// before the drafts themselves.
ok('the card warns this is a generic draft', /Generic draft/.test(lead.card), lead.card);
ok('and names the reason', /no claude key/i.test(lead.card), lead.card);
ok('the warning comes before the rest of the card', lead.card.indexOf('Generic draft') < lead.card.indexOf('Suggested'),
   lead.card);

// The warning line itself must never be sendable - the same hard stop that
// already exists for every other piece of this extension's own interface.
const { botTextIn } = await import('../src/compliance.js');
ok('the warning text is recognised as bot text, not buyer text', !!botTextIn(lead.card), botTextIn(lead.card));
ok('but the draft and DM themselves are clean - the warning never gets INTO them',
   !botTextIn(lead.draft) && !botTextIn(lead.dm), JSON.stringify({ draft: botTextIn(lead.draft), dm: botTextIn(lead.dm) }));

// A lead Claude DID write for is never marked generic.
{
  const { getLeads, updateLead } = await import('../src/store.js');
  await updateLead(lead.threadId, {
    aiSpecifics: { tips: ['We already handle review suppression for clients in this exact spot'], question: 'q?', offer: 'terms' },
    draftedBy: 'claude', draftedByNote: ''
  });
  const real = (await getLeads()).find((l) => l.threadId === lead.threadId);
  ok('a real Claude answer is not generic', real.draftedBy === 'claude' && !real.draftedByNote, JSON.stringify(real.draftedByNote));
}

// With AI switched off entirely, this is not a failure - no warning is owed.
{
  const { enrich } = bg;
  const cfg = await (await import('../src/config.js')).getConfig();
  const plain = enrich({ threadId: 'x1', title: 'a thread', author: 'a', url: 'https://bhw/threads/x.1/',
                          category: '', snippet: '' }, { ...cfg, aiSpecifics: false }, 'SENT', undefined);
  ok('no AI configured is drafted by rules too', plain.draftedBy === 'rules');
  ok('but carries no note, and no warning on the card', !plain.draftedByNote && !/Generic draft/.test(plain.card),
     JSON.stringify({ note: plain.draftedByNote, card: plain.card.slice(0, 80) }));
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
