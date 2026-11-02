// One row per thread, ever. "Load last 48h" forgets what has been seen and
// polls again, so every thread already in the table came back as a second row.
const bag = {};
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
globalThis.chrome = { storage: { local: {
  get: async (k) => (k in bag ? { [k]: clone(bag[k]) } : {}),
  set: async (o) => Object.assign(bag, clone(o)),
  remove: async (k) => { delete bag[k]; }
} } };

const { recordLeads, dedupeLeads, getLeads } = await import('../src/store.js');
let fails = 0;
const ok = (n, c, e='') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + ' ' + e); } };
const lead = (id, over = {}) => ({ threadId: id, title: 't' + id, status: 'SENT',
  foundAt: new Date(Date.now() - Number(id) * 1000).toISOString(), draft: 'd', ...over });

await recordLeads([lead('1'), lead('2')]);
ok('new leads are recorded', (await getLeads()).length === 2);

// The same poll again - which is exactly what Load last 48h causes.
await recordLeads([lead('1'), lead('2')]);
ok('polling the same threads again adds no rows', (await getLeads()).length === 2, String((await getLeads()).length));

// A decision must survive being re-found.
await recordLeads([lead('3', { status: 'SENT' })]);
bag.recentLeads = bag.recentLeads.map((l) => (l.threadId === '3' ? { ...l, status: 'POSTED', pmSent: true } : l));
await recordLeads([lead('3', { title: 'renamed', status: 'SENT', replyCount: 9 })]);
const three = (await getLeads()).find((l) => l.threadId === '3');
ok('re-finding a thread keeps that it was posted', three.status === 'POSTED', three.status);
ok('and that the PM was sent', three.pmSent === true);
ok('but takes the newer title', three.title === 'renamed', three.title);
ok('and the newer reply count', three.replyCount === 9);
ok('still one row', (await getLeads()).filter((l) => l.threadId === '3').length === 1);

// Rows already duplicated before the keying existed.
bag.recentLeads = [
  { threadId: '9', title: 'dup', status: 'SENT', foundAt: '2026-09-16T01:00:00Z' },
  { threadId: '9', title: 'dup', status: 'SENT', pmSent: true, foundAt: '2026-09-16T01:00:00Z' },
  { threadId: '9', title: 'dup', status: 'POSTED', foundAt: '2026-09-16T01:00:00Z' },
  { threadId: '8', title: 'solo', status: 'SENT', foundAt: '2026-09-16T00:00:00Z' }
];
const r = await dedupeLeads();
ok('duplicates are collapsed', r.removed === 2 && r.after === 2, JSON.stringify(r));
const nine = (await getLeads()).find((l) => l.threadId === '9');
ok('and no decision is lost in the merge', nine.status === 'POSTED' && nine.pmSent === true, JSON.stringify(nine));
ok('running it again changes nothing', (await dedupeLeads()).removed === 0);

// Newest first.
await recordLeads([lead('100', { foundAt: new Date().toISOString() })]);
ok('the newest lead is first', (await getLeads())[0].threadId === '100', (await getLeads())[0].threadId);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
