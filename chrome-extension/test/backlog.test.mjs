const bags = { local: {}, sync: {} };
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const mk = (area) => ({
  get: async (k) => { const bag = bags[area];
    if (k == null) return clone(bag);
    const ks = Array.isArray(k) ? k : [k];
    return Object.fromEntries(ks.filter((x) => x in bag).map((x) => [x, clone(bag[x])])); },
  set: async (o) => Object.assign(bags[area], o),
  remove: async (k) => { for (const x of (Array.isArray(k) ? k : [k])) delete bags[area][x]; }
});

globalThis.chrome = {
  runtime: {
    onInstalled: { addListener: () => {} }, onStartup: { addListener: () => {} },
    onMessage: { addListener: () => {} },
    getManifest: () => ({ version: '0.46.0' }), getURL: (p) => 'chrome-extension://x/' + p, lastError: null,
    sendMessage: async () => ({})
  },
  action: { onClicked: { addListener: () => {} } },
  tabs: { onRemoved: { addListener: () => {} }, onUpdated: { addListener: () => {}, removeListener: () => {} } },
  alarms: { onAlarm: { addListener: () => {} }, clear: async () => {}, create: () => {} },
  notifications: { create: (id, o, cb) => cb && cb(id), clear: () => {},
                   onClicked: { addListener: () => {} }, onButtonClicked: { addListener: () => {} } },
  scripting: { executeScript: async () => [{ result: {} }] },
  offscreen: { hasDocument: async () => true, createDocument: async () => {} },
  storage: { local: mk('local'), sync: mk('sync') }
};

// "Some HAFs were missed yesterday - check whether they were already done and
// just not marked, send the rest, and space them out" (1.11.3).
const ME = 'bargainbed';
const ts = (d) => Math.floor(new Date(d).getTime() / 1000);
const row = (id, title, people, when, starter) => `
  <div class="structItem structItem--conversation" data-author="${starter || people[0]}">
    <div class="structItem-title"><a href="/direct-messages/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${id}/">${title}</a></div>
    <div class="structItem-minor"><ul class="listInline listInline--comma">
      ${people.map((p) => `<li><a href="/members/${p.toLowerCase()}.99/" class="username">${p}</a></li>`).join('')}
    </ul></div>
    <div class="structItem-cell--latest"><time data-timestamp="${ts(when)}"></time></div>
  </div>`;
const page = (rows) => '<html><div class="p-navgroup-user"><span class="p-navgroup-user-linkText">' + ME + '</span></div><div class="structItemContainer">' + rows.join('') + '</div></html>';
const H = 3600000, ago = (h) => new Date(Date.now() - h * H).toISOString();
const PAGES = {
  1: page([row(901, 'Photoshop master', [ME, 'artguy'], ago(3), ME), row(902, 'something else', ['friend', ME], ago(5), 'friend')]),
  2: page([row(903, 'GMB services Require for US Uk', [ME, 'abbask'], ago(30), ME), row(904, 'old chat', ['x', ME], ago(40), 'x')]),
  3: page([row(905, 'ancient', [ME, 'y'], ago(120), ME), row(906, 'ancient 2', [ME, 'z'], ago(130), ME)]),
  4: page([row(907, 'prehistoric', [ME, 'w'], ago(300), ME)])
};
let fetched = [];
globalThis.fetch = async (url) => {
  const u = String(url);
  const m = u.match(/direct-messages\/(?:page-(\d+))?$/);
  if (m) { const p = Number(m[1] || 1); fetched.push(p); return { ok: true, status: 200, text: async () => PAGES[p] || page([]) }; }
  return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }), text: async () => '' };
};

const { fetchConversations } = await import('../src/messages.js');
const bg = await import('../src/background.js');
let fails = 0;
const ok = (n, c, e) => { if (!c) fails++; console.log(`${c ? '  ok' : 'FAIL'}  ${n}${c || e === undefined ? '' : `  -> ${JSON.stringify(e).slice(0, 300)}`}`); };

// --- the inbox is read back to the oldest waiting thread, no further -------------
fetched = [];
let got = await fetchConversations(8, { told: ME, since: Date.now() - 50 * H });
ok('a 2-day-old thread: reads until a whole page is older than it, then stops', JSON.stringify(fetched) === '[1,2,3]', fetched);
ok('and has the PM sent 30h ago, on page 2', got.rows.some((r) => /GMB services/.test(r.title)), got.rows.map((r) => r.title));
fetched = [];
await fetchConversations(8, { told: ME, since: Date.now() - 1 * H });
ok('a fresh thread: one page is enough', JSON.stringify(fetched) === '[1]', fetched);

// --- the preliminary check: already done, marked done; not done, left to send --------
const lead = (id, title, author, h) => ({ threadId: String(id), title, author, dmTitle: title, url: `https://www.blackhatworld.com/seo/t.${id}/`,
  postedAt: ago(h), foundAt: ago(h), status: 'BACKFILL', dm: 'Hi', aiSpecifics: null });
bags.local.recentLeads = [lead(1850834, 'GMB services Require for US Uk', 'abbask', 43), lead(1850910, 'Hiring Freelancer for High Authority Guest Posts', 'Cannabis Walk', 32)];
bags.local.config = { bhwUsername: ME };
fetched = [];
const r = await bg.crossCheckDone(bags.local.recentLeads, { bhwUsername: ME });
ok('the one you already messaged is found', r.done.map((l) => l.threadId).join() === '1850834', { done: r.done.map((l) => l.threadId), open: r.open.map((l) => l.threadId), maybe: r.maybe.map((l) => l.threadId) });
ok('and marked done, with where the proof came from', bags.local.recentLeads.find((l) => l.threadId === '1850834').pmSent === true
  && /message list/.test(bags.local.recentLeads.find((l) => l.threadId === '1850834').pmFrom || ''));
ok('the one never messaged is left to send', r.open.map((l) => l.threadId).join() === '1850910');
ok('read back far enough for the 43h-old thread (3 pages), not 8', JSON.stringify(fetched) === '[1,2,3]', fetched);

// --- a backlog goes out slowly -------------------------------------------------
const cfg = { backlogGapMinutes: 6 };
const now = Date.now();
ok('a fresh thread keeps the ordinary spacing', bg.backlogWait({ threadId: '1', postedAt: new Date(now - 1 * H).toISOString() }, now - 60000, cfg, now) === 0);
const w = bg.backlogWait({ threadId: '1850910', postedAt: new Date(now - 32 * H).toISOString() }, now - 60000, cfg, now);
ok('a 32h-old thread one minute after the last PM waits 5+ more minutes', w >= 5 * 60000 && w <= 9.6 * 60000, w / 60000);
ok('and goes once the gap is over', bg.backlogWait({ threadId: '1850910', postedAt: new Date(now - 32 * H).toISOString() }, now - 20 * 60000, cfg, now) === 0);
const gaps = ['11', '222', '3333', '44444'].map((id) => bg.backlogWait({ threadId: id, postedAt: new Date(now - 30 * H).toISOString() }, now, cfg, now));
ok('the gaps are uneven, never on the clock', new Set(gaps.map((g) => Math.round(g / 1000))).size > 1, gaps.map((g) => Math.round(g / 1000)));

// --- "(as 0)": a username saved as the number 0 is no username ------------------------
{ const { cleanUsername, getConfig } = await import('../src/config.js');
  ok('0, "0", NaN and blanks are no name', ['', 0, '0', ' 0 ', 'NaN', null, undefined].every((v) => cleanUsername(v) === ''));
  ok('a real name is kept', cleanUsername(' bargainbed ') === 'bargainbed' && cleanUsername('user0') === 'user0');
  bags.local.config = { bhwUsername: '0', boundAccount: 'bargainbed' };
  ok('getConfig never hands out "0"', (await getConfig()).bhwUsername === ''); }

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
