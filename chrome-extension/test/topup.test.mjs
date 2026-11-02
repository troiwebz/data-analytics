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
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: {} }) });

const bg = await import('../src/background.js');
const { DEFAULT_CONFIG, migrateConfig } = await import('../src/config.js');

let fails = 0;
const ok = (name, cond, extra) => { if (!cond) fails++; console.log(`${cond ? '  ok' : 'FAIL'}  ${name}${cond || extra === undefined ? '' : `  -> ${JSON.stringify(extra).slice(0, 200)}`}`); };

// 1.10.1: "I only find 4 threads in the dashboard" after a fresh install. The
// dashboard must show at least the newest 20 HAF threads, and auto mode must
// cover 3 days, not 1.
const H = 3600000;
const row = (id, hoursAgo) => ({ threadId: String(id), url: `https://www.blackhatworld.com/seo/t.${id}/`, title: `need seo help ${id}`,
  author: `buyer${id}`, snippet: '', postedAt: new Date(Date.now() - hoursAgo * H).toISOString() });

ok('the auto window ships at 72 hours', DEFAULT_CONFIG.autoBackfillHours === 72);
ok('and the dashboard minimum at 20 threads', DEFAULT_CONFIG.hafMinThreads === 20);

{
  const items = Array.from({ length: 18 }, (_, i) => row(100 + i, 10 + i * 12));   // 10h … 214h old
  const recent = items.filter((i) => Date.now() - new Date(i.postedAt) < 48 * H);
  ok('only a few are inside 48h', recent.length === 4, recent.length);
  const got = bg.newestAtLeast(recent, items, { hafMinThreads: 20 });
  ok('first run keeps every row page 1 has when that is under 20', got.length === 18, got.length);
  const ids = got.map((i) => i.threadId);
  ok('with no duplicates', new Set(ids).size === ids.length);
  ok('and the 48h ones are all still in', recent.every((r) => ids.includes(r.threadId)));
  const few = bg.newestAtLeast(recent, items, { hafMinThreads: 6 });
  ok('a smaller minimum adds only the newest others', few.length === 6 && few.slice(4).every((i) => ['104', '105'].includes(i.threadId)), few.map((i) => i.threadId));
  ok('the minimum never trims the recent ones', bg.newestAtLeast(items, items, { hafMinThreads: 2 }).length === 18);
}

{
  // An install that already ran: 4 leads, page 1 offers more - the top-up fills to 20.
  bags.local.recentLeads = [row(1, 4), row(2, 9), row(3, 30), row(4, 50)].map((l) => ({ ...l, status: 'BACKFILL' }));
  const items = [row(1, 4), row(2, 9), ...Array.from({ length: 16 }, (_, i) => row(200 + i, 20 + i * 10))];
  bags.local.hafPage2At = Date.now();            // page 2 not due: only page 1 is used here
  const r = await bg.topUpHaf(items, {}, { ...DEFAULT_CONFIG, readMode: 'tabs' });
  const haf = bags.local.recentLeads;
  ok('the top-up records the missing newest threads', r.added === 16 && haf.length === 20, { r, n: haf.length });
  ok('as History, so nothing new goes to Telegram', haf.every((l) => l.status === 'BACKFILL'));
  const added = haf.filter((l) => Number(l.threadId) >= 200);
  ok('each with its PM drafted, so auto mode can send it', added.length === 16 && added.every((l) => String(l.dm || '').length > 20), added.map((l) => (l.dm || '').length));
  const again = await bg.topUpHaf(items, {}, { ...DEFAULT_CONFIG, readMode: 'tabs' });
  ok('and once there are 20, it does nothing', again.added === 0);
}

{
  // An existing install keeps its own number; the old 24h default moves to 72h.
  bags.local.config = { configVersion: 34, autoBackfillHours: 24 };
  await migrateConfig();
  ok('the old 24h default becomes 72h', bags.local.config.autoBackfillHours === 72, bags.local.config.autoBackfillHours);
  bags.local.config = { configVersion: 34, autoBackfillHours: 12 };
  await migrateConfig();
  ok('a number you chose yourself is kept', bags.local.config.autoBackfillHours === 12);
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
