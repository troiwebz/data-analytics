// BHW Traffic (1.15.0): the online-page reader, the half-hour samples, labels
// against the last 28 days, the bars per day / week / month, the averages that
// follow the bars on screen, and the Telegram messages.
import { extractOnline, addSample, thresholds, labelOf, dayBars, weekBars, monthBars, statsOf, weekGrid, bestHours, hourShape, nowLine, dailyReport, weeklyReport, todayReport, csv, partsOf, weekStart, shiftDate, KEEP_DAYS } from '../src/pulse.js';

let fails = 0;
const ok = (n, c, e) => { if (!c) fails++; console.log(`${c ? '  ok' : 'FAIL'}  ${n}${c || e === undefined ? '' : `  -> ${JSON.stringify(e).slice(0, 300)}`}`); };
const TZ = 'Asia/Kolkata';

// --- the reader, on the two wordings BHW's page has used -------------------------------
{
  const { JSDOM } = await import('jsdom');
  const run = (html) => { const dom = new JSDOM(html); globalThis.document = dom.window.document; const r = extractOnline(); delete globalThis.document; return r; };
  ok('the "Online statistics" box is read: members, guests, total', JSON.stringify(run('<html><head><title>Members online | BlackHatWorld</title></head><body><div class="block"><h3>Online statistics</h3><dl><dt>Members online</dt><dd>312</dd></dl><dl><dt>Guests online</dt><dd>2,140</dd></dl><dl><dt>Total visitors</dt><dd>2,452</dd></dl></div></body></html>')) === JSON.stringify({ members: 312, guests: 2140, total: 2452 }));
  ok('the other XenForo wording is read too', JSON.stringify(run('<html><body><p>Total: 1,980 (members: 240, guests: 1,740)</p></body></html>')) === JSON.stringify({ members: 240, guests: 1740, total: 1980 }));
  ok('a Cloudflare wall is reported, never stored as a reading', /blocked/.test(run('<html><head><title>Just a moment...</title></head><body></body></html>').blocked || ''));
  ok('a page without the box says so', run('<html><body>Hello</body></html>').missing === true);
}

// --- samples ------------------------------------------------------------------------------
const T0 = Date.parse('2026-10-01T00:00:00Z');
let samples = [];
// 28 days of half-hour readings with a clear daily shape: evenings (IST) busiest, early morning quiet.
for (let i = 0; i < 28 * 48; i++) {
  const ts = T0 + i * 30 * 60000; const p = partsOf(ts, TZ);
  const base = 600 + 1400 * Math.max(0, Math.sin(((p.hour - 8) / 16) * Math.PI)) + ((p.hour * 7 + i) % 40);   // peak around 16:00 IST, low at night, never flat
  const weekend = p.dow >= 5 ? 0.85 : 1;
  samples = addSample(samples, { members: Math.round(base * weekend), guests: Math.round(base * 6), total: Math.round(base * 7) }, ts);
}
ok('one reading per half hour, 28 days kept', samples.length === 28 * 48, samples.length);
ok('two readings inside 20 minutes are not both kept', addSample(samples, { members: 1 }, samples[samples.length - 1].ts + 60000).length === samples.length);
ok('readings older than 90 days fall off', addSample(samples, { members: 1 }, T0 + (KEEP_DAYS + 30) * 86400000).length === 1);

// --- labels follow the traffic ----------------------------------------------------------------
const now = T0 + 28 * 86400000;
const thr = thresholds(samples, now);
ok('after 28 days there are low and high cut points', thr.ready && thr.low > 600 && thr.high > thr.low && thr.high < 2000, thr);
ok('a busy evening reading is High, a night reading is Low', labelOf(1900, thr) === 'High' && labelOf(590, thr) === 'Low' && labelOf(Math.round((thr.low + thr.high) / 2), thr) === 'Medium');
ok('with under a day of readings there is no label yet', !thresholds(samples.slice(0, 30), now).ready && labelOf(1900, thresholds(samples.slice(0, 30), now)) === '');
const doubled = samples.map((s) => ({ ...s, members: s.members * 2 }));
ok('when traffic doubles, the cut points double: High stays "high for BHW now"', Math.abs(thresholds(doubled, now).high - 2 * thr.high) <= 2);

// --- bars and the average that moves with them ------------------------------------------------
const d1 = '2026-10-07';
const day = dayBars(samples, d1, TZ);
ok('48 half-hour bars for a day, each with members and guests', day.length === 48 && day.every((b) => b.members != null && b.guests != null) && day[0].label === '00:00' && day[47].label === '23:30');
const ds = statsOf(day, 'members');
ok('the day\'s average, busiest and quietest half hour', ds.n === 48 && /^16:/.test(ds.max.label) && ds.min.members < 700 && ds.avg > ds.min.members && ds.avg < ds.max.members, { max: ds.max.label, min: ds.min.label, avg: ds.avg });
const gapDay = dayBars(samples.filter((s) => !(dateKeyOf(s.ts) === d1 && partsOf(s.ts, TZ).hour >= 10 && partsOf(s.ts, TZ).hour < 12)), d1, TZ);
function dateKeyOf(ts) { return partsOf(ts, TZ).date; }
ok('a gap in the readings is an empty bar, not a zero, and does not drag the average down', gapDay.filter((b) => b.members == null).length === 4 && statsOf(gapDay, 'members').n === 44 && Math.abs(statsOf(gapDay, 'members').avg - ds.avg) <= 40);
const wk = weekBars(samples, weekStart(d1), TZ);
ok('7 bars for the week, Monday first, each with average, peak and peak time', wk.length === 7 && wk[0].dow === 'Mon' && wk[6].dow === 'Sun' && wk.every((b) => b.avg != null && b.peak >= b.avg && /:\d\d$/.test(b.peakAt)), wk[0]);
ok('weekend days are the quieter bars', wk[5].avg < wk[2].avg && wk[6].avg < wk[2].avg);
const ws = statsOf(wk, 'avg');
ok('the weekly average is the average of the 7 bars on screen, not of the month', ws.n === 7 && Math.abs(ws.avg - Math.round(wk.reduce((a, b) => a + b.avg, 0) / 7)) <= 1);
const mo = monthBars(samples, '2026-10', TZ);
ok('31 bars for October, days without readings empty', mo.length === 31 && mo[0].date === '2026-10-01' && mo[27].avg != null && mo[30].avg == null);
ok('the monthly average covers only days with readings', statsOf(mo, 'avg').n === 29);

// --- the week grid and the best hours ---------------------------------------------------------
const grid = weekGrid(samples, TZ, now);
ok('a 7 × 24 grid of hour averages', grid.length === 7 && grid.every((r) => r.length === 24 && r.every((v) => v != null)));
const bh = bestHours(grid, thr);
ok('best hours are the afternoon peak on weekdays, worst are the night', bh.best.every((c) => c.hour >= 14 && c.hour <= 18 && !/Sat|Sun/.test(c.dow)) && bh.worst.every((c) => c.hour <= 8 || c.hour >= 23), bh);
ok('the typical-day shape peaks at 16:00', hourShape(samples, TZ, now).indexOf(Math.max(...hourShape(samples, TZ, now))) === 16);

// --- messages -------------------------------------------------------------------------------------
ok('the live line', nowLine({ members: 1900, guests: 11400 }, thr) === '📈 BHW now: 1,900 members · 11,400 guests · High');
const dr = dailyReport(samples, d1, TZ, thr);
ok('the morning report: average, peak window and hour, quietest, readings', /Average online: <b>[\d,]+<\/b> members \((High|Medium|Low) day\)/.test(dr) && /Peak: 1[45]:00–1[78]:00 · [\d,]+ at 16:[03]0/.test(dr) && /Quietest: .* · \d+ at /.test(dr) && /Readings: 48 of 48/.test(dr), dr);
ok('a day with no readings says so', /No readings yesterday/.test(dailyReport(samples, '2026-12-01', TZ, thr)));
const wr = weeklyReport(samples, TZ, thr, now);
ok('the weekly grid: 7 rows of 24 letters and the best hours', (wr.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)  [HML·]{24}$/gm) || []).length === 7 && /Best hours to post: /.test(wr) && /Quietest: /.test(wr), wr);
ok('before a week of data the messages say labels are coming', /Labels start after a week/.test(weeklyReport(samples.slice(0, 20), TZ, thresholds(samples.slice(0, 20), now), now)) && /Labels start after a week/.test(dailyReport(samples.slice(0, 20), '2026-10-01', TZ, thresholds(samples.slice(0, 20), now))));
ok('"online": the live line, today so far, and what High means', /BHW now: /.test(todayReport(samples, TZ, thr, samples[samples.length - 1].ts + 60000)) && /Today so far: average/.test(todayReport(samples, TZ, thr, samples[samples.length - 1].ts + 60000)) && /High is [\d,]+\+ members/.test(todayReport(samples, TZ, thr, now)));
const c = csv(samples.slice(0, 3), TZ).split('\n');
ok('CSV: a header and one line per reading with date, slot, weekday and the three counts', c.length === 4 && c[0] === 'time,date,slot,weekday,members,guests,total' && /^2026-10-01T00:00:00.000Z,2026-10-01,05:30,Thu,\d+,\d+,\d+$/.test(c[1]), c[1]);
ok('week helpers: Monday of the week, date shifting', weekStart('2026-10-07') === '2026-10-05' && shiftDate('2026-10-31', 1) === '2026-11-01');

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
