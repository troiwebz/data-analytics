// Posting while you are asleep.
//
// This is the only thing in the extension that posts without a tap, so most of
// these checks are about what it REFUSES to do. Each refusal exists because of
// something that has already gone wrong here.
import { isNight, blockedReason, dueNow, pending, postAt, nightCount, minutesNow } from '../src/night.js';

let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + '  ' + e); } };

const cfg = { nightMode: true, nightStart: '23:00', nightEnd: '07:00', timezone: 'Asia/Kolkata',
              nightMinScore: 10, nightVetoMinutes: 20, nightMaxPosts: 3 };
// IST is UTC+5:30, so build the instant that IS that wall-clock time there.
const ist = (h, m = 0) => new Date(Date.UTC(2026, 8, 17, h - 5, m - 30));

// --- the window crosses midnight, which is the whole difficulty -------------
ok('23:30 is night', isNight(cfg, ist(23, 30)));
ok('02:00 is night', isNight(cfg, ist(2)));
ok('06:59 is still night', isNight(cfg, ist(6, 59)));
ok('07:01 is not', !isNight(cfg, ist(7, 1)));
ok('22:00 is not', !isNight(cfg, ist(22)));
ok('midday is certainly not', !isNight(cfg, ist(12)));
ok('switched off, nothing is ever night', !isNight({ ...cfg, nightMode: false }, ist(2)));
ok('the window is read in YOUR zone, not the machine\'s',
   minutesNow({ timezone: 'Asia/Kolkata' }, ist(2)) === 120, String(minutesNow({ timezone: 'Asia/Kolkata' }, ist(2))));

// --- what may post by itself ------------------------------------------------
const good = { threadId: '1', title: 't', draft: 'A reply.', status: 'SENT', score: 20,
               body: 'The buyer wrote this, and it was actually read.',
               aiSpecifics: { tips: ['We have done this'] }, lint: { ok: true } };
ok('a good lead may post itself', blockedReason(good, cfg) === null, blockedReason(good, cfg));

// The one that matters most: a draft written from the title alone. This is the
// "Crypto Runner" case - answered with multi-chain wallet operations because
// the post was never read. In public, unattended, under your name.
ok('a draft written without the post is refused',
   /never read/.test(blockedReason({ ...good, body: '' }, cfg) || ''), blockedReason({ ...good, body: '' }, cfg));
ok('and no score can buy its way past that',
   blockedReason({ ...good, body: '', score: 999 }, cfg) !== null);

ok('built-in rules rather than Claude is refused',
   /built-in rules/.test(blockedReason({ ...good, aiSpecifics: null }, cfg) || ''));
ok('a failed compliance check is refused',
   /compliance/.test(blockedReason({ ...good, lint: { ok: false, errors: ['banned phrase'] } }, cfg) || ''));
ok('and it says which phrase, so the hold is not a mystery',
   /banned phrase/.test(blockedReason({ ...good, lint: { ok: false, errors: ['banned phrase'] } }, cfg) || ''));
ok('below your score bar it waits for you',
   /below your overnight bar/.test(blockedReason({ ...good, score: 4 }, cfg) || ''));
ok('an empty draft is refused', !!blockedReason({ ...good, draft: '' }, cfg));
for (const status of ['POSTED', 'SKIPPED', 'FAILED']) {
  ok(`a lead already ${status.toLowerCase()} is not posted again`, !!blockedReason({ ...good, status }, cfg));
}

// --- the veto window --------------------------------------------------------
const now = Date.now();
ok('the countdown is your minutes, not a guess', postAt(cfg, now) === now + 20 * 60000);
ok('zero minutes means straight away', postAt({ ...cfg, nightVetoMinutes: 0 }, now) === now);

const queue = [
  { threadId: 'a', status: 'SENT', autoPostAt: now - 1000 },              // due
  { threadId: 'b', status: 'SENT', autoPostAt: now + 600000 },            // counting down
  { threadId: 'c', status: 'SENT', autoPostAt: now - 1000, autoHeld: true }, // you held it
  { threadId: 'd', status: 'POSTED', autoPostAt: now - 1000 },            // already gone
  { threadId: 'e', status: 'SENT' }                                        // never armed
];
ok('only the one that is due is due', dueNow(queue, now).map((l) => l.threadId).join() === 'a',
   dueNow(queue, now).map((l) => l.threadId).join());
ok('one you held never becomes due', !dueNow(queue, now).some((l) => l.threadId === 'c'));
ok('and the rest are still counting down', pending(queue, now).map((l) => l.threadId).join() === 'b');

// --- the overnight cap ------------------------------------------------------
// "Tonight" starts when the window opened, not at midnight, or a cap would
// reset halfway through the night.
const at2am = ist(2);
const postedAt = (h, m) => ({ autoPostedAt: ist(h, m).toISOString() });
const tonight = [postedAt(23, 30), postedAt(1, 0), postedAt(1, 30)];
ok('posts from before midnight still count tonight', nightCount(tonight, cfg, at2am.getTime()) === 3,
   String(nightCount(tonight, cfg, at2am.getTime())));
// 22:00 the previous evening is before the window opened at 23:00, so it
// belongs to yesterday's tally, not tonight's.
const before = { autoPostedAt: new Date(ist(2).getTime() - 4 * 3600000).toISOString() };
ok('and anything from before the window opened does not',
   nightCount([...tonight, before], cfg, at2am.getTime()) === 3,
   String(nightCount([...tonight, before], cfg, at2am.getTime())));
ok('nor does the night before that',
   nightCount([{ autoPostedAt: new Date(ist(2).getTime() - 26 * 3600000).toISOString() }], cfg, at2am.getTime()) === 0);
ok('a lead that never auto-posted is not counted', nightCount([{ status: 'POSTED' }], cfg, at2am.getTime()) === 0);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
