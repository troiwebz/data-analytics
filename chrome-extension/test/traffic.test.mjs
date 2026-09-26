// Real BHW traffic, learned from the /online/ page - proven directly, no
// chrome API, no network. parseOnlineCounts is tested against the exact
// wording confirmed from a live screenshot of that page.
import { parseOnlineCounts, hourlyAverages, isHighTrafficNow, hourOf, MIN_SAMPLES } from '../src/traffic.js';

let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + '  ' + e); } };

// --- parsing the real page ---------------------------------------------------
const PAGE = `<html><body>
  <div class="block--online"><h3>Online statistics</h3>
    <dl><dt>Members online:</dt><dd>472</dd></dl>
    <dl><dt>Guests online:</dt><dd>15,404</dd></dl>
    <dl><dt>Total visitors:</dt><dd>15,876</dd></dl>
  </div>
</body></html>`;
const parsed = parseOnlineCounts(PAGE);
ok('members online parsed as a real number', parsed.members === 472, JSON.stringify(parsed));
ok('a comma-formatted number parses correctly', parsed.guests === 15404, JSON.stringify(parsed));
ok('total visitors too', parsed.total === 15876, JSON.stringify(parsed));

// Robust to markup, since it reads the rendered text, not classes - a totally
// different structure with the same wording still parses.
const DIFFERENT_MARKUP = `<table><tr><td>Members online:</td><td><b>10</b></td></tr>
  <tr><td>Guests online:</td><td>20</td></tr><tr><td>Total visitors:</td><td>30</td></tr></table>`;
ok('survives a completely different markup structure',
   JSON.stringify(parseOnlineCounts(DIFFERENT_MARKUP)) === JSON.stringify({ members: 10, guests: 20, total: 30 }));

// A page that doesn't look right (login wall, error page, theme change that
// dropped the wording) is null, not a wrong number.
ok('an unrelated page parses to nulls, not zeros or garbage',
   JSON.stringify(parseOnlineCounts('<html>Please log in</html>')) === JSON.stringify({ members: null, guests: null, total: null }));

// --- hourly averages ---------------------------------------------------------
const cfg = { timezone: 'UTC' };
const at = (h) => new Date(Date.UTC(2026, 8, 20, h)).getTime();
const samples = [
  { ts: at(10), members: 100 }, { ts: at(10), members: 120 },   // hour 10: avg 110
  { ts: at(22), members: 20 }                                    // hour 22: avg 20
];
const avgs = hourlyAverages(samples, cfg);
ok('hour 10 averages its two samples', avgs[10] === 110, JSON.stringify(avgs));
ok('hour 22 has just the one', avgs[22] === 20, JSON.stringify(avgs));
ok('an hour with no samples has no entry', !(5 in avgs));
ok('hourOf reads the right hour in the configured zone', hourOf(at(10), cfg) === 10);

// --- deciding "is now busier than usual" -------------------------------------
ok('not ready with too little data', isHighTrafficNow(samples, cfg).ready === false);

// Build a real day's worth: busy at 10am, quiet at 10pm, repeated enough to
// clear the minimum sample count.
const busyDay = [];
for (let i = 0; i < MIN_SAMPLES; i++) {
  busyDay.push({ ts: at(10) + i * 60000, members: 100 });
  busyDay.push({ ts: at(22) + i * 60000, members: 10 });
}
const nowBusy = at(10) + 5000;
const busyResult = isHighTrafficNow(busyDay, cfg, nowBusy);
ok('ready once there is enough data', busyResult.ready === true, JSON.stringify(busyResult));
ok('10am is correctly called busier than the day average', busyResult.high === true, JSON.stringify(busyResult));

const nowQuiet = at(22) + 5000;
const quietResult = isHighTrafficNow(busyDay, cfg, nowQuiet);
ok('10pm is correctly called quieter than the day average', quietResult.high === false, JSON.stringify(quietResult));

// An hour with no observations at all is treated as not-busy, not a crash.
const noDataHour = isHighTrafficNow(busyDay, cfg, at(3) + 5000);
ok('an hour never observed is not treated as busy', noDataHour.ready === true && noDataHour.high === false,
   JSON.stringify(noDataHour));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
