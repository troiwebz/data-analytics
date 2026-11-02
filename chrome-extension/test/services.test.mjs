// Bump-due tracking for your own BHW service threads, proven directly - no
// chrome API, no network.
import { GENUINE_BUMP_HOURS, PROMO_BUMP_HOURS, nextEligibleAt, isBumpEligible,
         hoursUntilEligible, dueThreads, alreadyNotified, newlyDue, isPeakHours } from '../src/services.js';

let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + '  ' + e); } };

const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();

// --- the rule itself: 24h genuine, 72h promo --------------------------------
ok('never bumped is eligible right now', isBumpEligible({}));
ok('a promo bump under 72h is not yet eligible',
   !isBumpEligible({ lastBumpedAt: hoursAgo(50), lastBumpKind: 'promo' }));
ok('a promo bump right at 72h is eligible',
   isBumpEligible({ lastBumpedAt: hoursAgo(72), lastBumpKind: 'promo' }));
ok('a promo bump past 72h is eligible',
   isBumpEligible({ lastBumpedAt: hoursAgo(100), lastBumpKind: 'promo' }));
ok('a genuine bump is eligible again after only 24h',
   isBumpEligible({ lastBumpedAt: hoursAgo(25), lastBumpKind: 'genuine' }));
ok('a genuine bump under 24h is not yet eligible',
   !isBumpEligible({ lastBumpedAt: hoursAgo(10), lastBumpKind: 'genuine' }));
ok('no kind recorded defaults to the slower, safer promo rule',
   !isBumpEligible({ lastBumpedAt: hoursAgo(50) }));
ok('the constants are what BHW actually says', GENUINE_BUMP_HOURS === 24 && PROMO_BUMP_HOURS === 72);

// --- the countdown, for status/reminders ------------------------------------
ok('an eligible thread has 0 hours left', hoursUntilEligible({ lastBumpedAt: hoursAgo(80), lastBumpKind: 'promo' }) === 0);
ok('a thread bumped 60h ago (promo) has 12h left',
   hoursUntilEligible({ lastBumpedAt: hoursAgo(60), lastBumpKind: 'promo' }) === 12,
   String(hoursUntilEligible({ lastBumpedAt: hoursAgo(60), lastBumpKind: 'promo' })));

// --- picking what to remind about -------------------------------------------
const threads = [
  { id: 'a', lastBumpedAt: hoursAgo(100), lastBumpKind: 'promo' },   // very overdue
  { id: 'b', lastBumpedAt: hoursAgo(73), lastBumpKind: 'promo' },    // just eligible
  { id: 'c', lastBumpedAt: hoursAgo(10), lastBumpKind: 'promo' },    // not yet
  { id: 'd' }                                                        // never bumped - eligible now
];
const due = dueThreads(threads);
ok('only the eligible ones are due', due.map((t) => t.id).sort().join() === 'a,b,d', due.map((t) => t.id).join());
// A thread that has never been bumped counts as the oldest-eligible of all -
// it has been sitting there un-bumped indefinitely, not just since a timestamp.
ok('never-bumped sorts first, then longest overdue', due.map((t) => t.id).join() === 'd,a,b', due.map((t) => t.id).join());

// --- notifying once per eligibility window, not every poll ------------------
ok('never notified is not "already notified"', !alreadyNotified({ lastBumpedAt: hoursAgo(80), lastBumpKind: 'promo' }));
const told = { lastBumpedAt: hoursAgo(80), lastBumpKind: 'promo', bumpNotifiedAt: hoursAgo(1) };
ok('notified after the last bump counts as told', alreadyNotified(told));
ok('so newlyDue leaves it out', newlyDue([told]).length === 0);

// Bumping it resets the window - a notice from BEFORE that bump does not count.
const bumpedSince = { lastBumpedAt: hoursAgo(1), lastBumpKind: 'promo', bumpNotifiedAt: hoursAgo(80) };
ok('a notice from before the last bump does not count', !alreadyNotified(bumpedSince));
// Not due yet either way (bumped only 1h ago), so it should not appear.
ok('and it is not due again yet regardless', newlyDue([bumpedSince]).length === 0);

// --- peak hours --------------------------------------------------------------
const cfg = { timezone: 'Asia/Kolkata', servicesPeakStartHour: 9, servicesPeakEndHour: 22 };
const ist = (h, m = 0) => new Date(Date.UTC(2026, 8, 17, h - 5, m - 30));
ok('10am IST is peak', isPeakHours(cfg, ist(10)));
ok('9pm IST is still peak', isPeakHours(cfg, ist(21, 59)));
ok('10pm IST is not', !isPeakHours(cfg, ist(22)));
ok('3am IST is not', !isPeakHours(cfg, ist(3)));
ok('a window crossing midnight wraps correctly',
   isPeakHours({ ...cfg, servicesPeakStartHour: 20, servicesPeakEndHour: 6 }, ist(23))
   && isPeakHours({ ...cfg, servicesPeakStartHour: 20, servicesPeakEndHour: 6 }, ist(2))
   && !isPeakHours({ ...cfg, servicesPeakStartHour: 20, servicesPeakEndHour: 6 }, ist(12)));
ok('start === end means always', isPeakHours({ ...cfg, servicesPeakStartHour: 5, servicesPeakEndHour: 5 }, ist(2)));
ok('read in YOUR zone, not the machine\'s',
   isPeakHours(cfg, ist(10)) && !isPeakHours({ ...cfg, timezone: 'UTC' }, ist(10)));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
