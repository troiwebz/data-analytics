// 1.19.4: HAF sent nothing for days with nothing said on Telegram. Two causes
// fixed here and held down: (1) Cloudflare's "Performing security verification"
// page, which a real browser clears in seconds, was read too early and treated
// as a wall; (2) holds that stop every PM (standby, wrong login, unreadable
// inbox) were only written to the dashboard log.
const bags = { local: {}, sync: {} };
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const mk = (area) => ({
  get: async (k) => { const bag = bags[area]; if (k == null) return clone(bag); const ks = Array.isArray(k) ? k : [k]; return Object.fromEntries(ks.filter((x) => x in bag).map((x) => [x, clone(bag[x])])); },
  set: async (o) => Object.assign(bags[area], clone(o)), remove: async (k) => { for (const x of (Array.isArray(k) ? k : [k])) delete bags[area][x]; }
});
const upd = []; let tabN = 0; const tabUrl = {}; let probes = 0; let challengeFor = 0; const opened = [];
globalThis.chrome = {
  runtime: { onInstalled: { addListener: () => {} }, onStartup: { addListener: () => {} }, onMessage: { addListener: () => {}, removeListener: () => {} }, getManifest: () => ({ version: '1.19.4' }), getURL: (p) => 'chrome-extension://x/' + p, lastError: null, sendMessage: async () => ({}) },
  action: { onClicked: { addListener: () => {} } },
  tabs: { onRemoved: { addListener: () => {} }, onUpdated: { addListener: (f) => upd.push(f), removeListener: (f) => { const i = upd.indexOf(f); if (i >= 0) upd.splice(i, 1); } },
    create: async ({ url }) => { const id = ++tabN; tabUrl[id] = url; opened.push(url); setTimeout(() => upd.slice().forEach((f) => f(id, { status: 'complete' })), 1); return { id }; }, remove: async () => {} },
  alarms: { onAlarm: { addListener: () => {} }, clear: async () => {}, create: () => {} },
  notifications: { create: (id, o, cb) => cb && cb(id), clear: () => {}, onClicked: { addListener: () => {} }, onButtonClicked: { addListener: () => {} } },
  scripting: { executeScript: async ({ target, func }) => {
    if (!func) return [{ result: null }];                          // content-script files: not exercised here
    if (func.name === 'stillBlocked') return [{ result: { blocked: 'BHW blocked the page: Just a moment...' } }];
    if (func.name === 'isChallengePage') { probes++; const still = probes <= challengeFor; if (!still) {} else setTimeout(() => upd.slice().forEach((f) => f(target.tabId, { status: 'complete' })), 1); return [{ result: still }]; }
    if (func.name === 'pageHtml') return [{ result: { html: globalThis.__tabStillChallenge ? '<html><head><title>Just a moment...</title></head><body>Performing security verification</body></html>' : '<html><div class="structItemContainer"></div></html>', title: 'x' } }];
    return [{ result: { rows: [{ threadId: '1', title: 'x' }], me: 'bargainbed', loggedIn: true } }];
  } },
  offscreen: { hasDocument: async () => true, createDocument: async () => {} },
  storage: { local: mk('local'), sync: mk('sync') }
};
let sent = [];
globalThis.fetch = async (url, opts) => {
  const u = String(url); const b = JSON.parse(opts?.body || '{}');
  if (/api\.telegram\.org/.test(u)) {
    if (/getUpdates/.test(u)) return { ok: true, status: 200, json: async () => ({ ok: true, result: [] }) };
    if (/getMyShortDescription/.test(u)) return { ok: true, status: 200, json: async () => ({ ok: true, result: { short_description: globalThis.__lock || '' } }) };
    if (b.text) sent.push(b.text);
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 7 } }) };
  }
  if (/direct-messages/.test(u)) return globalThis.__inbox ? globalThis.__inbox() : { ok: false, status: 403, text: async () => '<title>Just a moment...</title>' };
  return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }), text: async () => '<html></html>' };
};
const { DEFAULT_CONFIG, CONFIG_VERSION } = await import('../src/config.js');
const browse = await import('../src/browse.js');
const bg = await import('../src/background.js');
let fails = 0;
const ok = (n, c, e) => { if (!c) fails++; console.log(`${c ? '  ok' : 'FAIL'}  ${n}${c || e === undefined ? '' : `  -> ${JSON.stringify(e).slice(0, 300)}`}`); };

// --- (1) Cloudflare's check page clears by itself: wait for it -------------------------------------
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (f, ms, ...a) => realSetTimeout(f, Math.min(ms, 5), ...a);   // the waits, fast
probes = 0; challengeFor = 2;
let r = await browse.readInTab('https://www.blackhatworld.com/forums/hire-a-freelancer.76/', browse.extractListing, { settleMs: 1 });
ok('a page that shows the check twice and then the forum is read normally, not called a wall', r && r.rows && r.rows.length === 1 && probes === 3, { probes, r });
probes = 0; challengeFor = 99;
function stillBlocked() { return { blocked: 'x' }; }
let err = ''; try { await browse.readInTab('https://www.blackhatworld.com/forums/hire-a-freelancer.76/', stillBlocked, { settleMs: 1 }); } catch (e) { err = e.message; }
ok('a check that never clears is still reported (after about 30 s of waiting), so the wall logic still works', /blocked/.test(err) && probes === 10, { probes, err });
probes = 0; challengeFor = 0;
r = await browse.readInTab('https://www.blackhatworld.com/x/', browse.extractListing, { settleMs: 1 });
ok('a normal page costs one quick probe and nothing else', probes === 1 && r.rows.length === 1);
probes = 0;
r = await browse.readInTab('https://www.blackhatworld.com/x/', browse.extractListing, { settleMs: 0 });
ok('fast test reads (settleMs 0) skip the probe', probes === 0);
globalThis.setTimeout = realSetTimeout;

// --- (2) holds that stop every PM are said on Telegram ------------------------------------------------
bags.local.vault = { tgToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef', savedAt: 1 };
bags.local.config = { ...DEFAULT_CONFIG, configVersion: CONFIG_VERSION, enabled: true, telegramEnabled: true, telegramChatId: '999', autoMode: true, autoModeSince: new Date(Date.now() - 86400000).toISOString(), minSecondsBetweenDms: 0, bhwUsername: 'bargainbed' };
const lead = (id) => ({ threadId: String(id), title: `Need casino ads ${id}`, author: 'buyer' + id, url: `https://www.blackhatworld.com/seo/x.${id}/`, postedAt: new Date(Date.now() - 3600000).toISOString(), foundAt: new Date().toISOString(), status: 'SENT',
  dm: 'Hi, saw your thread.', dmTitle: 'Need casino ads', body: 'need casino ads', aiSpecifics: { tips: ['a', 'b', 'c'], pm: 'yes' }, autoRules: 4, autoSendAt: Date.now() - 1000, dmLint: { ok: true, errors: [] } });
bags.local.recentLeads = [lead(501), lead(502)];
// a. the inbox stays behind Cloudflare even in a tab
globalThis.__inbox = () => ({ ok: false, status: 403, text: async () => '<title>Just a moment...</title>' }); globalThis.__tabStillChallenge = true;
sent = [];
let q = await bg.runAutoQueue();
const inboxNote = sent.find((t) => /could not be read/.test(t)) || '';
ok('inbox unreadable (fetch 403, tab fallback tried): nothing sent, and Telegram is told why', !bags.local.recentLeads.some((l) => l.pmSent) && /HAF auto mode is holding 2 PM\(s\): your BHW message list could not be read/.test(inboxNote), { q, sent });
ok('the tab fallback was actually tried for the inbox', opened.some((u) => /direct-messages/.test(u)), opened);
sent = []; await bg.runAutoQueue();
ok('the same notice is not repeated within the hour', !sent.some((t) => /could not be read/.test(t)), sent);
// b. Chrome signed in to a different BHW account than the one this copy is bound to
delete globalThis.__inbox; globalThis.__tabStillChallenge = false;
bags.local.recentLeads = [lead(601), lead(602)];
bags.local.config = { ...bags.local.config, boundAccount: 'bargainbed' }; bags.local.bhwMe = 'someoneelse';
bags.local.holdNotices = {}; sent = [];
q = await bg.runAutoQueue();
ok('wrong BHW login: nothing sent, and Telegram is told to sign in to the right account', !bags.local.recentLeads.some((l) => l.pmSent) && sent.some((t) => /HAF auto mode is holding 2 PM\(s\):.*Sign in to the right BHW account/.test(t)), { q, sent });

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
