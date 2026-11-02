// One bot, one copy acting on it. The lock lives in the bot's short
// description, which every copy holding the token can read.
const store = {};
let description = '';                      // the bot's short description, shared by "both machines"
let tokenSaved = true;
let telegramDown = false;
const calls = [];
globalThis.chrome = {
  storage: { local: {
    get: async (k) => { const o = {}; for (const x of [].concat(k)) if (x in store) o[x] = JSON.parse(JSON.stringify(store[x])); return o; },
    set: async (o) => { for (const [k, v] of Object.entries(o)) store[k] = JSON.parse(JSON.stringify(v)); },
    remove: async (k) => { for (const x of [].concat(k)) delete store[x]; }
  }, sync: { get: async () => ({ vault: tokenSaved ? { tgToken: '1:abc', savedAt: 1 } : {} }), set: async () => {}, remove: async () => {} } },
  runtime: { getPlatformInfo: async () => ({ os: globalThis.__os || 'mac' }) }
};
globalThis.fetch = async (url, opts) => {
  if (telegramDown) throw new Error('network down');
  const method = String(url).split('/').pop();
  const body = JSON.parse(opts.body || '{}');
  calls.push({ method, body });
  if (method === 'getMyShortDescription') return { json: async () => ({ ok: true, result: { short_description: description } }) };
  if (method === 'setMyShortDescription') { description = body.short_description; return { json: async () => ({ ok: true, result: true }) }; }
  return { json: async () => ({ ok: true, result: {} }) };
};

const { parseLock, lockText, decide, ownership, takeOver, describe, TTL_MS } = await import('../src/owner.js');

let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + '  ' + e); } };
const asMachine = async (id, os) => { store.instanceId = id; delete store.ownerState; globalThis.__os = os; };

// --- the rule, pure -------------------------------------------------------------
const now = Date.now();
ok('a lock round-trips', JSON.stringify(parseLock(lockText('abc123', 'mac', 5))) === JSON.stringify({ id: 'abc123', os: 'mac', at: 5, pin: false, auto: null, acct: '' }));
ok('anything else is no lock', parseLock('My helpful bot') === null && parseLock('') === null);
ok('no lock is free to take', decide(null, 'me', now) === 'take');
ok('my own lock is mine', decide({ id: 'me', at: now }, 'me', now) === 'mine');
ok('a fresh lock held by another is theirs', decide({ id: 'them', at: now - 60000 }, 'me', now) === 'theirs');
ok('an abandoned lock is free to take', decide({ id: 'them', at: now - TTL_MS - 1000 }, 'me', now) === 'take');

// --- two machines, one bot ------------------------------------------------------
await asMachine('macbook1', 'mac');
let a = await ownership({ fresh: true });
ok('the first copy takes the free lock', a.active === true && a.known === true, JSON.stringify(a));
ok('and writes its name on the bot', /owner=macbook1 os=mac/.test(description), description);

await asMachine('cloudvps', 'linux');
let b = await ownership({ fresh: true });
ok('a second copy finds it taken and goes passive', b.active === false && b.known === true, JSON.stringify(b));
ok('and knows who holds it', b.owner.id === 'macbook1' && b.owner.os === 'mac', JSON.stringify(b.owner));
ok('and did not overwrite the lock', /owner=macbook1/.test(description), description);
ok('and says so in words', /STANDBY/.test(describe(b)) && /MacBook/.test(describe(b)), describe(b));

// --- the owner's Chrome is closed for a while -----------------------------------
description = lockText('macbook1', 'mac', Date.now() - TTL_MS - 5000);
b = await ownership({ fresh: true });
ok('an abandoned lock is taken by the copy still running', b.active === true && /owner=cloudvps/.test(description), JSON.stringify({ b, description }));

await asMachine('macbook1', 'mac');
a = await ownership({ fresh: true });
ok('and the returning copy is the passive one now', a.active === false, JSON.stringify(a));

// --- taking over by hand -------------------------------------------------------
a = await takeOver();
ok('"Make this copy the active one" takes the lock', a.active === true && /owner=macbook1/.test(description), description);
await asMachine('cloudvps', 'linux');
b = await ownership({ fresh: true });
ok('and the other copy stands down at its next look', b.active === false, JSON.stringify(b));

// --- the main system you choose stays main -------------------------------------
ok('a pinned lock is read as pinned', parseLock(lockText('a', 'win', 5, true)).pin === true && parseLock(lockText('a', 'win', 5)).pin === false);
ok('a pinned main system is never taken over by time', decide({ id: 'server', at: now - 24 * 3600000, pin: true }, 'mac', now) === 'theirs');
await asMachine('winsrv01', 'win');
a = await takeOver();
ok('"Keep this as the main system" pins it', /owner=winsrv01 os=win at=\d+ pin=1/.test(description), description);
description = lockText('winsrv01', 'win', Date.now() - 3 * 3600000, true);     // server switched off for 3 hours
await asMachine('macbook1', 'mac');
b = await ownership({ fresh: true });
ok('the MacBook stays on standby while the chosen server is off', b.active === false && /Windows server/.test(describe(b)) && /chosen by you/.test(describe(b)), describe(b));
ok('and does not steal the lock', /owner=winsrv01/.test(description), description);
await asMachine('winsrv01', 'win');
description = lockText('winsrv01', 'win', Date.now() - 5 * 60000, true);
a = await ownership({ fresh: true });
ok('the chosen main keeps its pin when it re-stamps', a.active && /pin=1/.test(description), description);
await asMachine('macbook1', 'mac');
b = await takeOver();
ok('choosing the MacBook moves main there', b.active && /owner=macbook1 .* pin=1/.test(description), description);
await asMachine('winsrv01', 'win');
a = await ownership({ fresh: true });
ok('and the server goes on standby', a.active === false, JSON.stringify(a));
description = '';

// --- auto mode travels with the main system -----------------------------------
ok('the lock can carry auto mode', parseLock(lockText('a', 'win', 5, true, true)).auto === true && parseLock(lockText('a', 'win', 5, true, false)).auto === false && parseLock(lockText('a', 'win', 5)).auto === null);
await asMachine('winsrv01', 'win');
store.config = { autoMode: true };
await takeOver();
ok('the main system stamps its auto mode on the bot', / auto=1/.test(description), description);
await asMachine('macbook1', 'mac');
store.config = { autoMode: false };
const took = await takeOver();
ok('making the MacBook main hands it the server\'s auto mode', took.inheritAuto === true && / auto=1/.test(description), JSON.stringify({ took: took.inheritAuto, description }));
delete store.config;
description = '';

// --- the owner keeps its stamp fresh -------------------------------------------
await asMachine('macbook1', 'mac');
description = lockText('macbook1', 'mac', Date.now() - 5 * 60000);
calls.length = 0;
a = await ownership({ fresh: true });
ok('the owner re-stamps a lock that is getting old', a.active && calls.some((c) => c.method === 'setMyShortDescription'), JSON.stringify(calls.map((c) => c.method)));
calls.length = 0;
a = await ownership();                     // not fresh: within the minute
ok('and does not ask Telegram again inside a minute', calls.length === 0, JSON.stringify(calls.map((c) => c.method)));

// --- when the answer cannot be had ---------------------------------------------
telegramDown = true;
a = await ownership({ fresh: true });
ok('Telegram unreachable: the last answer stands', a.active === true && a.stale === true, JSON.stringify(a));
delete store.ownerState;
a = await ownership({ fresh: true });
ok('Telegram unreachable and no last answer: it does not act by itself', a.active === false && a.known === false, JSON.stringify(a));
telegramDown = false;

tokenSaved = false;
delete store.vault; delete store.ownerState;
a = await ownership({ fresh: true });
ok('no bot token: nothing is shared, so the copy is active', a.active === true && a.known === false, JSON.stringify(a));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
