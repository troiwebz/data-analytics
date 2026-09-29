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
ok('a lock round-trips', JSON.stringify(parseLock(lockText('abc123', 'mac', 5))) === JSON.stringify({ id: 'abc123', os: 'mac', at: 5 }));
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
ok('and says so in words', /PASSIVE/.test(describe(b)) && /mac/.test(describe(b)), describe(b));

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
