// Spend and the balance estimate. Anthropic exposes no balance endpoint, so
// this is our own count and has to be right.
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
globalThis.chrome = { storage: { local: mk('local'), sync: mk('sync') } };

let usage = { input_tokens: 1000, cache_read_input_tokens: 0, output_tokens: 100 };
globalThis.fetch = async (url, opts) => ({
  ok: true, status: 200,
  json: async () => (String(url).includes('/models') ? { data: [] } : {
    content: [{ type: 'text', text: JSON.stringify({ t: { tips: ['a line long enough to survive the filter'], question: 'a or b for this job?', offer: 'terms' } }) }],
    usage
  })
});

const C = await import('../src/claude.js');
let fails = 0;
const ok = (n, c, e='') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + ' ' + e); } };
const call = () => C.writeSpecifics([{ threadId: 't', title: 'x', snippet: 'y' }]);

await C.saveKey('sk-ant-api03-SPENDTEST00001');
let st = await C.aiStatus();
ok('the daily limit defaults to $1', st.budget === 1, String(st.budget));
ok('nothing spent yet', st.spentToday === 0 && st.spentTotal === 0);
ok('no balance claimed without a top-up', st.credits === 0 && st.balance === 0);

// sonnet: 1000/1e6*2 + 100/1e6*10 = 0.002 + 0.001 = 0.003
await call();
st = await C.aiStatus();
ok('today counts the call', Math.abs(st.spentToday - 0.003) < 1e-9, String(st.spentToday));
ok('all time counts it too', Math.abs(st.spentTotal - 0.003) < 1e-9, String(st.spentTotal));
ok('leads counted all time', st.leadsTotal === 1);
ok('left today is the rest of the $1', Math.abs(st.remaining - 0.997) < 1e-9, String(st.remaining));

// A top-up gives a balance to count down from.
await C.addCredits(5);
st = await C.aiStatus();
ok('top-up recorded', st.credits === 5);
ok('balance counts down from it', Math.abs(st.balance - 4.997) < 0.005, String(st.balance));
await call();
st = await C.aiStatus();
ok('balance keeps falling', st.balance < 5 && st.spentTotal > 0.005, JSON.stringify({ b: st.balance, s: st.spentTotal }));
await C.addCredits(5);
ok('a second top-up adds up', (await C.aiStatus()).credits === 10);
await C.addCredits(0).then(() => ok('rejects a zero top-up', false), () => ok('rejects a zero top-up', true));

// A model switch must not reprice what was already spent.
const before = (await C.aiStatus()).spentTotal;
await C.setModel('claude-opus-5');
ok('switching model leaves history alone', (await C.aiStatus()).spentTotal === before, String(before));
// opus: 1000/1e6*5 + 100/1e6*25 = 0.005 + 0.0025 = 0.0075
await call();
ok('and prices the next call at the new rate',
  Math.abs((await C.aiStatus()).spentTotal - (before + 0.0075)) < 1e-9, String((await C.aiStatus()).spentTotal));

// Today resets at midnight; the all-time count does not.
bags.local.ai = { ...bags.local.ai, usage: { ...bags.local.ai.usage, day: '2000-01-01' } };
st = await C.aiStatus();
ok('yesterday does not count against today', st.spentToday === 0);
ok('but all time still holds it', st.spentTotal > 0.01, String(st.spentTotal));

// The limit is enforced against today, not the lifetime total.
await C.setBudget(0.001);
await call();                                // this one is allowed and blows the limit
ok('under the limit the call goes through', (await C.aiStatus()).spentToday > 0.001);
ok('over the daily limit, Claude stands down', /daily limit/.test((await call()).note || ''));
await C.setBudget(1);

// Starting the count again clears ours, never the key.
await C.resetSpend();
st = await C.aiStatus();
ok('reset clears the running total', st.spentTotal === 0 && st.credits === 0 && st.leadsTotal === 0);
ok('and keeps the key', st.configured);

// An upgrade from the old $0.50 default lifts it once, and only once.
for (const k of Object.keys(bags.local)) delete bags.local[k];
for (const k of Object.keys(bags.sync)) delete bags.sync[k];
await C.saveKey('sk-ant-api03-SPENDTEST00002');
bags.local.ai = { model: 'claude-sonnet-5', budget: 0.5, enabled: true, usage: {} };
ok('the old $0.50 default is lifted to $1', (await C.aiStatus()).budget === 1);
await C.setBudget(0.5);                      // a figure deliberately chosen
ok('a chosen $0.50 is left alone', (await C.aiStatus()).budget === 0.5);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
