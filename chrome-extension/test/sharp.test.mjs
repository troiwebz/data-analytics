// The sharp lane: Hire a Freelancer read every ~75s while auto mode is on, so
// the PM lands a minute or two after the buyer posts. These are the rules in
// src/sharp.js, and the one place auto.js leans on them (the shorter wait).
import * as sharp from '../src/sharp.js';
import { postAt } from '../src/auto.js';
import { isExcludedThread } from '../src/matcher.js';
import { DEFAULT_CONFIG } from '../src/config.js';

let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + '  ' + e); } };

const on = { enabled: true, autoMode: true, sharpLane: true, readMode: 'tabs', sharpSeconds: 75, sharpWaitMin: 25, sharpWaitMax: 50 };
const now = 1_800_000_000_000;

// --- it ships off, and only your word turns it on ------------------------
ok('the sharp lane ships OFF', DEFAULT_CONFIG.sharpLane === false);
ok('so an untouched install never reads faster', !sharp.wanted({ ...DEFAULT_CONFIG, autoMode: true }));
ok('with the ship settings and "sharp on" it runs', sharp.wanted({ ...DEFAULT_CONFIG, enabled: true, autoMode: true, sharpLane: true, readMode: 'tabs' }));

// --- when it runs --------------------------------------------------------
ok('auto mode on + sharp on + tabs mode: it runs', sharp.wanted(on));
ok('auto mode off: it does not', !sharp.wanted({ ...on, autoMode: false }));
ok('sharp off: it does not', !sharp.wanted({ ...on, sharpLane: false }));
ok('a missing setting is off, not on', !sharp.wanted({ ...on, sharpLane: undefined }));
ok('feeds mode never runs sharp', !sharp.wanted({ ...on, readMode: 'feeds' }));
ok('a paused watcher never runs sharp', !sharp.wanted({ ...on, enabled: false }));

// --- how often -----------------------------------------------------------
ok('75 seconds by default', sharp.everySeconds(on) === 75);
ok('never faster than a minute, whatever is typed', sharp.everySeconds({ ...on, sharpSeconds: 5 }) === 60);
ok('junk falls back to 75', sharp.everySeconds({ ...on, sharpSeconds: 'fast' }) === 75);
ok('and never slower than ten minutes', sharp.everySeconds({ ...on, sharpSeconds: 99999 }) === 600);
ok('the jitter is 0-20 seconds', sharp.jitterMs(on, () => 0) === 0 && sharp.jitterMs(on, () => 1) === 20000);

// --- when a tick reads nothing ------------------------------------------
ok('a clear tick reads', sharp.skipReason(on, { now }) === '');
ok('auto mode off reads nothing', /auto mode is off/.test(sharp.skipReason({ ...on, autoMode: false }, { now })));
ok('sharp off reads nothing', /switched off/.test(sharp.skipReason({ ...on, sharpLane: false }, { now })));
ok('asleep reads nothing', sharp.skipReason(on, { now, asleep: true }) === 'asleep');
ok('the shared 30-minute wall pause is honoured', /wall/.test(sharp.skipReason(on, { now, wallUntil: now + 1000 })));
ok('an expired wall is not', sharp.skipReason(on, { now, wallUntil: now - 1 }) === '');
ok('its own 2-hour stand-down is honoured', /standing down/.test(sharp.skipReason(on, { now, state: { backoffUntil: now + 60000 } })));
ok('and ends by itself', sharp.skipReason(on, { now, state: { backoffUntil: now - 1 } }) === '');
ok('a check already running is not doubled', /still running/.test(sharp.skipReason(on, { now, busy: true })));
ok('two alarms 10s apart are one read', /moment ago/.test(sharp.skipReason(on, { now, state: { lastAt: now - 10000 } })));
ok('75s apart is two reads', sharp.skipReason(on, { now, state: { lastAt: now - 75000 } }) === '');
ok('the stand-down is two hours', sharp.WALL_BACKOFF_MS === 2 * 3600000);

// --- the slow check leaves the page to it --------------------------------
ok('read 60s ago: the ordinary check skips its own HAF read', sharp.keepsFresh(on, { lastAt: now - 60000 }, now));
ok('read 5 min ago (stood down, asleep): the ordinary check reads it', !sharp.keepsFresh(on, { lastAt: now - 300000 }, now));
ok('never read: the ordinary check reads it', !sharp.keepsFresh(on, {}, now));
ok('lane off: the ordinary check always reads it', !sharp.keepsFresh({ ...on, sharpLane: false }, { lastAt: now - 1000 }, now));

// --- the wait before the PM goes ----------------------------------------
ok('lane off: no opinion, auto.js keeps 1-3 min', sharp.waitMs({ ...on, sharpLane: false }) === null);
ok('lane on: the floor is 25s', sharp.waitMs(on, () => 0) === 25000);
ok('lane on: the ceiling is 50s', sharp.waitMs(on, () => 1) === 50000);
ok('never under 10s, whatever is typed', sharp.waitMs({ ...on, sharpWaitMin: 0, sharpWaitMax: 0 }, () => 0) >= 10000);
ok('a max below the min is the min', sharp.waitMs({ ...on, sharpWaitMin: 40, sharpWaitMax: 5 }, () => 1) === 40000);
ok('auto.js uses the short wait when the lane runs', postAt(on, now, () => 0) === now + 25000 && postAt(on, now, () => 1) === now + 50000);
ok('and its own 1-3 min when it does not', postAt({ autoMode: true }, now, () => 0) === now + 60000 && postAt({ autoMode: true }, now, () => 1) === now + 180000);
ok('the words match the numbers', sharp.waitWords(on) === '25-50 sec' && sharp.waitWords({ ...on, sharpLane: false }) === '1-3 min');

// --- what "status" says --------------------------------------------------
ok('auto off: nothing to say', sharp.statusLine({ ...on, autoMode: false }) === '');
ok('running: says how often and when it last read', /ON/.test(sharp.statusLine(on, { lastAt: now - 30000 }, now)) && /30s ago/.test(sharp.statusLine(on, { lastAt: now - 30000 }, now)));
ok('stood down: says for how long', /standing down for 90 min/.test(sharp.statusLine(on, { backoffUntil: now + 90 * 60000 }, now)));
ok('off: says so', /off/.test(sharp.statusLine({ ...on, sharpLane: false }, {}, now)));
ok('feeds mode: says why not', /tabs mode/.test(sharp.statusLine({ ...on, readMode: 'feeds' }, {}, now)));

// --- moderators ----------------------------------------------------------
ok('a thread started by a staff account is never a lead', isExcludedThread({ threadId: '9', author: 'SomeMod', staff: true }, { excludeAuthors: [], excludeThreadIds: [] }) === true);
ok('an ordinary member still is', isExcludedThread({ threadId: '9', author: 'buyer', staff: false }, { excludeAuthors: [], excludeThreadIds: [] }) === false);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
