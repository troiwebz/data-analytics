// Auto mode: post the public reply by itself, 1-3 minutes after a thread is
// found, any time of day. Same shape as night mode, and most of these checks
// mirror night.test.mjs on purpose - it is the same bar, just not gated to a
// time window, and a PM is never part of it.
import { blockedReason, postAt, dueNow, pending } from '../src/auto.js';

let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + '  ' + e); } };

const cfg = { autoMode: true, autoModeMinScore: 0 };

// --- what may post by itself -------------------------------------------
const good = { threadId: '1', title: 't', draft: 'A reply.', status: 'SENT', score: 5,
               body: 'The buyer wrote this, and it was actually read.',
               aiSpecifics: { tips: ['We have done this'] }, lint: { ok: true } };
ok('a good lead may post itself', blockedReason(good, cfg) === null, blockedReason(good, cfg));

ok('a draft written without the post is refused',
   /never read/.test(blockedReason({ ...good, body: '' }, cfg) || ''), blockedReason({ ...good, body: '' }, cfg));
ok('and no score can buy its way past that',
   blockedReason({ ...good, body: '', score: 999 }, cfg) !== null);

ok('built-in rules rather than Claude is refused',
   /built-in rules/.test(blockedReason({ ...good, aiSpecifics: null }, cfg) || ''));
ok('a failed compliance check is refused',
   /compliance/.test(blockedReason({ ...good, lint: { ok: false, errors: ['banned phrase'] } }, cfg) || ''));
ok('and it says which phrase', /banned phrase/.test(blockedReason({ ...good, lint: { ok: false, errors: ['banned phrase'] } }, cfg) || ''));
ok('below the auto-mode score bar it waits for you',
   /below your auto-mode bar/.test(blockedReason({ ...good, score: 1 }, { autoModeMinScore: 4 }) || ''));
ok('an empty draft is refused', !!blockedReason({ ...good, draft: '' }, cfg));
for (const status of ['POSTED', 'SKIPPED', 'FAILED']) {
  ok(`a lead already ${status.toLowerCase()} is not posted again`, !!blockedReason({ ...good, status }, cfg));
}

// --- the countdown ------------------------------------------------------
const now = Date.now();
const at = postAt(cfg, now, () => 0);       // rand() = 0 -> the floor, 60s
ok('the floor is one minute', at === now + 60000, String(at - now));
const at2 = postAt(cfg, now, () => 1);      // rand() = 1 -> the ceiling, 180s
ok('the ceiling is three minutes', at2 === now + 180000, String(at2 - now));

const queue = [
  { threadId: 'a', status: 'SENT', autoSendAt: now - 1000 },                 // due
  { threadId: 'b', status: 'SENT', autoSendAt: now + 90000 },                // counting down
  { threadId: 'c', status: 'SENT', autoSendAt: now - 1000, autoSendHeld: true }, // held
  { threadId: 'd', status: 'POSTED', autoSendAt: now - 1000 },               // already gone
  { threadId: 'e', status: 'SENT' }                                          // never armed
];
ok('only the one that is due is due', dueNow(queue, now).map((l) => l.threadId).join() === 'a',
   dueNow(queue, now).map((l) => l.threadId).join());
ok('a held one never becomes due', !dueNow(queue, now).some((l) => l.threadId === 'c'));
ok('and the rest are still counting down', pending(queue, now).map((l) => l.threadId).join() === 'b');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
