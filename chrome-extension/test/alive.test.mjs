// Surviving a long job on a machine nobody is touching.
//
// MV3 kills a service worker after 30 seconds with no extension-API activity.
// Posting spends far longer than that waiting - for a tab to load, for a
// content script to answer - and none of that waiting counts as activity. On a
// desktop the open dashboard keeps the worker alive by accident, every message
// it sends resetting the idle timer. On a server nothing does, so the worker
// dies in the middle of the job with no error anywhere, because the code that
// would have logged one dies with it.
let platformCalls = 0;
globalThis.chrome = { runtime: { getPlatformInfo: async () => { platformCalls++; return {}; } } };

const { alive, held } = await import('../src/alive.js');

let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + '  ' + e); } };

ok('nothing is held to begin with', held() === 0, String(held()));

// The real interval is 20s. Driving it directly would make this suite a
// minute long, so the clock is moved instead.
const realSetInterval = globalThis.setInterval;
let ticker = null;
globalThis.setInterval = (fn) => { ticker = fn; return 1; };
globalThis.clearInterval = () => { ticker = null; };

let released = false;
const job = alive(async () => {
  ok('the worker is held while the job runs', held() === 1, String(held()));
  ok('and a ticker was started', typeof ticker === 'function', String(typeof ticker));
  ticker(); ticker();                 // two 20s boundaries inside one job
  released = true;
  return 'done';
});
ok('the value comes back through', (await job) === 'done');
ok('an extension API was called on each tick, which is what resets the timer',
   platformCalls === 2, String(platformCalls));
ok('and the hold is released when the job ends', held() === 0 && released, String(held()));
ok('and the ticker is stopped, not left running forever', ticker === null, String(ticker));

// Two overlapping jobs must not cancel each other's hold.
let release1;
const slow = alive(() => new Promise((r) => { release1 = r; }));
const quick = alive(async () => 'q');
await quick;
ok('a finished job does not drop a hold another job still needs', held() === 1, String(held()));
ok('and the ticker is still running', typeof ticker === 'function', String(typeof ticker));
release1();
await slow;
ok('the last job out stops the ticker', held() === 0 && ticker === null);

// A throw must not leave the worker pinned awake for the rest of the session.
platformCalls = 0;
let threw = false;
try { await alive(async () => { throw new Error('boom'); }); } catch { threw = true; }
ok('a job that throws still rethrows', threw);
ok('and releases its hold rather than pinning the worker awake',
   held() === 0 && ticker === null, `${held()} / ${ticker}`);

globalThis.setInterval = realSetInterval;

// --- a Telegram request that never comes back -------------------------------
//
// fetch has no timeout. A server that cannot reach api.telegram.org leaves the
// request hanging, which in a service worker is worse than an error: nothing
// resets the idle timer while we wait, so the worker is killed mid-request and
// the catch block that would have logged it never runs. Every thirty seconds,
// in silence, forever.
const store = {};
globalThis.chrome = {
  runtime: { getPlatformInfo: async () => ({}) },
  storage: {
    local: {
      get: async (k) => (k in store ? { [k]: store[k] } : {}),
      set: async (o) => Object.assign(store, o),
      remove: async (k) => { delete store[k]; }
    },
    session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    sync: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    onChanged: { addListener: () => {} }
  }
};
const T = await import('../src/telegram.js');
await T.setToken('1234567890:AAtoken');

globalThis.fetch = (url, opts) => new Promise((resolve, reject) => {
  // Exactly what Chrome does on abort: reject with an AbortError.
  opts?.signal?.addEventListener('abort', () => {
    const e = new Error('The user aborted a request.');
    e.name = 'AbortError';
    reject(e);
  });
});

const t0 = Date.now();
const err = await T.status({}).then(() => '', (e) => e.message).catch((e) => e.message);
const waited = Date.now() - t0;
const said = String(err || (await T.diagnose({ telegramChatId: '9' })).checks.map((c) => c[1]).join(' '));
ok('a hanging request gives up rather than waiting forever', waited < 25000, `${waited}ms`);
ok('and names the host it could not reach', /api\.telegram\.org/.test(said), said);
ok('and points at the firewall rather than blaming the token',
   /firewall|proxy|network/i.test(said), said);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
