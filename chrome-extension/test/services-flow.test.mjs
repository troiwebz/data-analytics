// Your own service threads, end to end through Telegram: track, list, get
// reminded when due (held to peak hours), and reset the clock once you've
// actually posted the bump yourself. Nothing here ever posts to BHW - this
// feature is notify-and-confirm only, on purpose, until the reply-watching
// and auto-post pieces are built on top of it.
const store = {};
let tgCalls = [];
globalThis.chrome = {
  runtime: {
    onInstalled: { addListener: () => {} }, onStartup: { addListener: () => {} },
    onMessage: { addListener: () => {} },
    getManifest: () => ({ version: '0.94.0' }), getURL: (p) => 'x/' + p, reload: () => {}
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

let onlineHtml = '';   // empty by default = "could not read it", exactly like a page that changed shape
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('api.telegram.org')) {
    const method = u.split('/').pop();
    const body = opts?.body ? JSON.parse(opts.body) : {};
    tgCalls.push({ method, body });
    if (method === 'getUpdates') return { ok: true, status: 200, json: async () => ({ ok: true, result: updates }) };
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  }
  if (u.includes('blackhatworld.com/online/')) return { ok: true, status: 200, text: async () => onlineHtml };
  return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
};
const onlinePage = (members) =>
  `<div>Members online: ${members}</div><div>Guests online: 9000</div><div>Total visitors: ${members + 9000}</div>`;

let updates = [];
const bg = await import('../src/background.js');
const T = await import('../src/telegram.js');
const { setConfig, getConfig } = await import('../src/config.js');
const services = await import('../src/services.js');

let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + '  ' + e); } };

await T.setToken('1234567890:AAtoken');
await setConfig({ enabled: true, telegramEnabled: true, telegramChatId: '999', telegramApprovals: true, webhookUrl: '' });

const msg = (text, id = Math.floor(Math.random() * 1e6)) => ({
  update_id: id, message: { message_id: id, text, chat: { id: 999 }, from: { id: 5 } }
});

// --- nothing tracked yet -----------------------------------------------------
tgCalls = [];
updates = [msg('services')];
await bg.pollTaps();
let said = tgCalls.filter((c) => c.method === 'sendMessage').map((c) => c.body.text).join(' ');
ok('with nothing tracked, "services" says so', /No service threads tracked/.test(said), said);

// --- tracking one ------------------------------------------------------------
tgCalls = [];
updates = [msg('track https://www.blackhatworld.com/seo/my-seo-service.555111/ My SEO Gigs')];
await bg.pollTaps();
said = tgCalls.filter((c) => c.method === 'sendMessage').map((c) => c.body.text).join(' ');
ok('tracking confirms the label', /Tracking "My SEO Gigs"/.test(said), said);

let cfg = await getConfig();
ok('the thread is stored', cfg.serviceThreads.length === 1 && cfg.serviceThreads[0].id === '555111',
   JSON.stringify(cfg.serviceThreads));
ok('never bumped, so it shows as eligible from the start',
   services.isBumpEligible(cfg.serviceThreads[0]));

// A bad URL is refused, not silently ignored.
tgCalls = [];
updates = [msg('track not-a-real-url Whatever')];
await bg.pollTaps();
said = tgCalls.filter((c) => c.method === 'sendMessage').map((c) => c.body.text).join(' ');
ok('a URL with no thread id is refused', /Could not find a thread id/.test(said), said);
ok('and nothing extra was added', (await getConfig()).serviceThreads.length === 1);

// --- "services" lists it with a countdown ------------------------------------
tgCalls = [];
updates = [msg('services')];
await bg.pollTaps();
said = tgCalls.filter((c) => c.method === 'sendMessage').map((c) => c.body.text).join(' ');
ok('"services" lists the tracked thread', /My SEO Gigs/.test(said), said);
ok('and says it is eligible now (never bumped)', /eligible now/.test(said), said);

// --- the reminder itself, held to peak hours ---------------------------------
await setConfig({ servicesPeakStartHour: 9, servicesPeakEndHour: 22, timezone: 'UTC' });

// Force "now" outside the window by setting a peak window that excludes the
// current UTC hour, whatever it happens to be when this test runs.
const outsideHour = (new Date().getUTCHours() + 12) % 24;
await setConfig({ servicesPeakStartHour: outsideHour, servicesPeakEndHour: (outsideHour + 1) % 24 });
tgCalls = [];
let r = await bg.checkServiceBumps();
ok('outside peak hours, no reminder is sent', r.skipped === 'outside peak hours', JSON.stringify(r));
ok('and nothing was posted to Telegram', tgCalls.filter((c) => c.method === 'sendMessage').length === 0);

// Now open the window to include the current hour.
const nowHour = new Date().getUTCHours();
await setConfig({ servicesPeakStartHour: nowHour, servicesPeakEndHour: (nowHour + 2) % 24 });
tgCalls = [];
r = await bg.checkServiceBumps();
ok('inside peak hours, the due thread is reminded', r.due === 1, JSON.stringify(r));
const reminder = tgCalls.filter((c) => c.method === 'sendMessage').map((c) => c.body.text || '').join(' ||| ');
ok('the reminder names the thread', /My SEO Gigs/.test(reminder), reminder);
ok('and carries suggested wording to copy', /<pre>/.test(reminder), reminder);
ok('and the thread link', /555111/.test(reminder), reminder);
ok('and tells you how to reset the clock', /bumped My SEO Gigs/.test(reminder), reminder);

// It must not be part of an actual sendable draft anywhere - this feature
// never constructs one, so there is nothing to check there; but the outcome
// text itself must never look like it came from a lead card.
const { botTextIn } = await import('../src/compliance.js');
ok('the reminder is plainly a status message, not a draft', !/Public reply|PM to /.test(reminder));

// A second check in the same window does not re-notify.
tgCalls = [];
r = await bg.checkServiceBumps();
ok('a second check in the same window sends nothing new', r.due === 0, JSON.stringify(r));

// --- marking it bumped resets the clock --------------------------------------
tgCalls = [];
updates = [msg('bumped My SEO Gigs')];
await bg.pollTaps();
said = tgCalls.filter((c) => c.method === 'sendMessage').map((c) => c.body.text).join(' ');
ok('marking it bumped confirms and names the wait', /marked bumped/.test(said) && /72h/.test(said), said);

cfg = await getConfig();
const thread = cfg.serviceThreads[0];
ok('lastBumpedAt is set', !!thread.lastBumpedAt);
ok('and it is the slower, safer promo cadence', thread.lastBumpKind === 'promo');
ok('so it is not eligible again immediately', !services.isBumpEligible(thread));

// A bump clears the old notification, so the NEXT window notifies again.
tgCalls = [];
r = await bg.checkServiceBumps();
ok('freshly bumped, nothing is due', r.due === 0, JSON.stringify(r));

// A typo'd label is refused, not silently ignored.
tgCalls = [];
updates = [msg('bumped Some Other Thread')];
await bg.pollTaps();
said = tgCalls.filter((c) => c.method === 'sendMessage').map((c) => c.body.text).join(' ');
ok('an unknown label is refused', /No tracked thread matches/.test(said), said);

// Not mistaken for a draft rewrite.
{
  const { getLeads } = await import('../src/store.js');
  ok('typing these never becomes a draft anywhere',
     !(await getLeads()).some((l) => l.draft === 'services' || l.dm === 'services'));
}

// --- learning real traffic, and using it once there is enough --------------
{
  const trafficMod = await import('../src/traffic.js');

  // Before any data exists, "traffic" says so plainly and names the fallback.
  onlineHtml = '';
  tgCalls = [];
  updates = [msg('traffic')];
  await bg.pollTaps();
  said = tgCalls.filter((c) => c.method === 'sendMessage').map((c) => c.body.text).join(' ');
  ok('with no data yet, "traffic" admits it could not read the count', /Could not read the online count/.test(said), said);
  ok('and names the manual fallback', /Still learning/.test(said) && /manual peak-hours window/.test(said), said);

  // A working page reports the live count.
  onlineHtml = onlinePage(500);
  tgCalls = [];
  updates = [msg('traffic')];
  await bg.pollTaps();
  said = tgCalls.filter((c) => c.method === 'sendMessage').map((c) => c.body.text).join(' ');
  ok('with a working page, the live count shows', /500 members online/.test(said), said);

  // Track a thread again so there is something for checkServiceBumps to
  // actually act on, and set the MANUAL window to exclude the current hour -
  // so any reminder that goes out below can only be explained by the
  // LEARNED traffic pattern overriding that fallback, not the manual one.
  await bg.trackServiceThread(await getConfig(),
    'https://www.blackhatworld.com/seo/another-thread.777888/', 'Learning Test');
  const nowHour = new Date().getUTCHours();
  const farHour = (nowHour + 12) % 24;
  await setConfig({ servicesPeakStartHour: farHour, servicesPeakEndHour: (farHour + 1) % 24, timezone: 'UTC' });

  // Seed a real pattern: busy at the current hour, quiet twelve hours away -
  // enough readings, spread over enough days, to clear the minimum before
  // the learned data is trusted over the guess.
  const atHourDaysAgo = (hour, daysAgo) => {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - daysAgo); d.setUTCHours(hour, 0, 0, 0);
    return d.getTime();
  };
  const seeded = [];
  for (let i = 1; i <= trafficMod.MIN_SAMPLES; i++) {
    seeded.push({ ts: atHourDaysAgo(nowHour, i), members: 500 });
    seeded.push({ ts: atHourDaysAgo(farHour, i), members: 10 });
  }
  store.trafficSamples = seeded;

  tgCalls = [];
  const r = await bg.checkServiceBumps();
  ok('the learned pattern overrides the manual window and lets the bump through',
     r.due === 1, JSON.stringify(r));
  const bumpMsg = tgCalls.filter((c) => c.method === 'sendMessage').map((c) => c.body.text || '').join(' ||| ');
  ok('and the reminder actually names the tracked thread', /Learning Test/.test(bumpMsg), bumpMsg);

  // Once there is enough data, "traffic" reports it as learned, not "still learning".
  tgCalls = [];
  updates = [msg('traffic')];
  await bg.pollTaps();
  said = tgCalls.filter((c) => c.method === 'sendMessage').map((c) => c.body.text).join(' ');
  ok('"traffic" now reports the learned pattern instead of "still learning"',
     /usually <b>busier<\/b>/.test(said) || /busier.*than average/.test(said), said);
}

// --- untracking ---------------------------------------------------------------
tgCalls = [];
updates = [msg('untrack My SEO Gigs')];
await bg.pollTaps();
said = tgCalls.filter((c) => c.method === 'sendMessage').map((c) => c.body.text).join(' ');
ok('untracking confirms', /Stopped tracking "My SEO Gigs"/.test(said), said);
ok('and it is gone from config', !(await getConfig()).serviceThreads.some((t) => t.label === 'My SEO Gigs'));

tgCalls = [];
updates = [msg('untrack My SEO Gigs')];
await bg.pollTaps();
said = tgCalls.filter((c) => c.method === 'sendMessage').map((c) => c.body.text).join(' ');
ok('untracking something already gone is refused, not silent', /No tracked thread matches/.test(said), said);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
