// BHW Traffic ("Pulse") - how many people are on BlackHatWorld, every half hour,
// and when the busy hours are (1.15.0).
//
// Separate from everything else: its own storage key (pulseSamples), its own
// page, its own Telegram messages. It reads one small page, BHW's own
// "members online" page, every 30 minutes in a real tab at the usual pace, and
// never touches leads, HAF, Radar or the older bump-timing samples.
//
// Labels are relative: each half hour is High / Medium / Low against the last
// 28 days of readings, so "High" keeps meaning "high for BHW as it is now".

export const ONLINE_URL = 'https://www.blackhatworld.com/online/';
export const KEEP_DAYS = 90;
export const WINDOW_DAYS = 28;          // the comparison window for High / Medium / Low
export const EVERY_MS = 30 * 60000;

/** BHW's "Online statistics" box, read off the rendered text. Runs inside the page: no closure, data only. */
export function extractOnline() {
  const t = String(document.title || '');
  const text = String((document.body && (document.body.innerText || document.body.textContent)) || '').replace(/\s+/g, ' ');
  if (/just a moment|access denied|attention required|rate limited|error 429|too many requests/i.test(t)
      || /you have been rate limited|access denied|has been blocked|verify you are human/i.test(text.slice(0, 3000))) {
    return { blocked: `BHW blocked the page: ${t.slice(0, 80)}` };
  }
  const grab = (label) => { const m = text.match(new RegExp(label.replace(/ /g, '\\s+') + '\\s*:?\\s*([\\d,]+)', 'i')); return m ? parseInt(m[1].replace(/,/g, ''), 10) : null; };
  let members = grab('Members online'), guests = grab('Guests online'), total = grab('Total visitors') ?? grab('Total');
  // The other wording XenForo uses: "Total: 2,452 (members: 312, guests: 2,140)".
  const alt = text.match(/Total:?\s*([\d,]+)\s*\(\s*members:?\s*([\d,]+),\s*guests:?\s*([\d,]+)\s*\)/i);
  if (alt) { total = parseInt(alt[1].replace(/,/g, ''), 10); members = parseInt(alt[2].replace(/,/g, ''), 10); guests = parseInt(alt[3].replace(/,/g, ''), 10); }
  if (members == null && total == null) return { missing: true, sample: text.slice(0, 200) };
  return { members, guests, total: total ?? ((members || 0) + (guests || 0)) };
}

/** One reading added, the list kept to 90 days, never two readings inside 20 minutes. */
export function addSample(samples, s, now = Date.now()) {
  const list = (samples || []).filter((x) => now - x.ts <= KEEP_DAYS * 86400000);
  if (list.length && now - list[list.length - 1].ts < 20 * 60000) return list;
  list.push({ ts: now, members: s.members ?? null, guests: s.guests ?? null, total: s.total ?? null });
  return list;
}

// ------------------------------------------------------------- time, in your zone

const fmtCache = {};
const fmt = (tz) => (fmtCache[tz] ||= new Intl.DateTimeFormat('en-GB', { timeZone: tz || undefined, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }));
/** { date: 'YYYY-MM-DD', hour, minute, dow (0 = Monday) } for a timestamp in a zone. */
export function partsOf(ts, tz) {
  const p = {}; for (const x of fmt(tz).formatToParts(new Date(ts))) p[x.type] = x.value;
  const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute), dow: dow < 0 ? 0 : dow };
}
export const slotOf = (ts, tz) => { const p = partsOf(ts, tz); return p.hour * 2 + (p.minute >= 30 ? 1 : 0); };
export const dateKey = (ts, tz) => partsOf(ts, tz).date;
/** The Monday that starts the week holding `date` ('YYYY-MM-DD'). */
export function weekStart(date) {
  const d = new Date(`${date}T00:00:00Z`); const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow); return d.toISOString().slice(0, 10);
}
export const shiftDate = (date, days) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const slotLabel = (slot) => `${String(Math.floor(slot / 2)).padStart(2, '0')}:${slot % 2 ? '30' : '00'}`;

// ------------------------------------------------------------- labels

/** Low / high cut points from the last 28 days of members-online readings (tertiles). */
export function thresholds(samples, now = Date.now()) {
  const vals = (samples || []).filter((s) => s.members != null && now - s.ts <= WINDOW_DAYS * 86400000).map((s) => s.members).sort((a, b) => a - b);
  if (vals.length < 48) return { ready: false, n: vals.length, low: 0, high: 0 };   // one day of readings before a label means anything
  const at = (q) => vals[Math.min(vals.length - 1, Math.floor(q * vals.length))];
  return { ready: true, n: vals.length, low: at(1 / 3), high: at(2 / 3) };
}
export const labelOf = (v, thr) => (!thr?.ready || v == null ? '' : v >= thr.high ? 'High' : v >= thr.low ? 'Medium' : 'Low');

// ------------------------------------------------------------- bars

const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** 48 half-hour bars for one date: { slot, label, members, guests, n }. Empty slots stay null (a gap, never a zero). */
export function dayBars(samples, date, tz) {
  const buckets = Array.from({ length: 48 }, () => ({ m: [], g: [] }));
  for (const s of samples || []) { if (dateKey(s.ts, tz) !== date) continue; const b = buckets[slotOf(s.ts, tz)]; if (s.members != null) b.m.push(s.members); if (s.guests != null) b.g.push(s.guests); }
  return buckets.map((b, slot) => ({ slot, label: slotLabel(slot), members: avg(b.m), guests: avg(b.g), n: b.m.length }));
}

/** One bar per day between two dates (inclusive): { date, dow, avg, peak, peakAt, low, n }. */
export function dayRange(samples, from, to, tz) {
  const by = {};
  for (const s of samples || []) { if (s.members == null) continue; const d = dateKey(s.ts, tz); if (d < from || d > to) continue; (by[d] ||= []).push({ v: s.members, slot: slotOf(s.ts, tz) }); }
  const out = [];
  for (let d = from; d <= to; d = shiftDate(d, 1)) {
    const xs = by[d] || [];
    const peak = xs.reduce((p, x) => (x.v > p.v ? x : p), { v: -1, slot: 0 });
    out.push({ date: d, dow: DOW[(new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7], avg: avg(xs.map((x) => x.v)), peak: xs.length ? peak.v : null, peakAt: xs.length ? slotLabel(peak.slot) : '', low: xs.length ? Math.min(...xs.map((x) => x.v)) : null, n: xs.length });
  }
  return out;
}
export const weekBars = (samples, monday, tz) => dayRange(samples, monday, shiftDate(monday, 6), tz);
export function monthBars(samples, ym, tz) {
  const [y, m] = ym.split('-').map(Number); const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return dayRange(samples, `${ym}-01`, `${ym}-${String(days).padStart(2, '0')}`, tz);
}

/** The average of the bars on screen, and the busiest / quietest among them. */
export function statsOf(bars, key = 'members') {
  const xs = bars.filter((b) => b[key] != null);
  if (!xs.length) return { avg: null, max: null, min: null, n: 0 };
  const max = xs.reduce((p, b) => (b[key] > p[key] ? b : p)); const min = xs.reduce((p, b) => (b[key] < p[key] ? b : p));
  return { avg: avg(xs.map((b) => b[key])), max, min, n: xs.length };
}

/** Hour-of-week averages: grid[dow][hour] = average members, or null. */
export function weekGrid(samples, tz, now = Date.now(), days = WINDOW_DAYS) {
  const b = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => []));
  for (const s of samples || []) { if (s.members == null || now - s.ts > days * 86400000) continue; const p = partsOf(s.ts, tz); b[p.dow][p.hour].push(s.members); }
  return b.map((row) => row.map(avg));
}

/** Best and worst hours of the week, from the grid. */
export function bestHours(grid, thr, n = 3) {
  const cells = [];
  grid.forEach((row, dow) => row.forEach((v, hour) => { if (v != null) cells.push({ dow: DOW[dow], hour, v, label: labelOf(v, thr) }); }));
  cells.sort((a, b) => b.v - a.v);
  return { best: cells.slice(0, n), worst: cells.slice(-n).reverse(), hoursSeen: cells.length };
}

/** Average by hour of day across all days (the shape of a typical day). */
export function hourShape(samples, tz, now = Date.now(), days = WINDOW_DAYS) {
  const b = Array.from({ length: 24 }, () => []);
  for (const s of samples || []) { if (s.members == null || now - s.ts > days * 86400000) continue; b[partsOf(s.ts, tz).hour].push(s.members); }
  return b.map(avg);
}

// ------------------------------------------------------------- messages

const fmtN = (n) => (n == null ? '–' : Number(n).toLocaleString('en-US'));
const hh = (hour) => `${String(hour).padStart(2, '0')}:00`;

/** "BHW now: 312 members · 2,140 guests · High" */
export function nowLine(sample, thr) {
  if (!sample) return '';
  const l = labelOf(sample.members, thr);
  return `📈 BHW now: ${fmtN(sample.members)} members · ${fmtN(sample.guests)} guests${l ? ` · ${l}` : ''}`;
}

/** The morning message about yesterday. */
export function dailyReport(samples, date, tz, thr) {
  const bars = dayBars(samples, date, tz); const st = statsOf(bars, 'members');
  if (!st.n) return `📈 <b>BHW traffic, ${date}</b>\nNo readings yesterday (the server was off, or BHW was paused).`;
  const hours = Array.from({ length: 24 }, (_, h) => ({ h, v: avg(bars.slice(h * 2, h * 2 + 2).map((b) => b.members).filter((x) => x != null)) })).filter((x) => x.v != null);
  const top = [...hours].sort((a, b) => b.v - a.v).slice(0, 3).map((x) => x.h).sort((a, b) => a - b);
  const bottom = [...hours].sort((a, b) => a.v - b.v).slice(0, 3).map((x) => x.h).sort((a, b) => a - b);
  const span = (hs) => (hs.length ? `${hh(hs[0])}–${hh((hs[hs.length - 1] + 1) % 24)}` : '–');
  return [`📈 <b>BHW traffic, ${date}</b>`, '',
    `Average online: <b>${fmtN(st.avg)}</b> members${thr?.ready ? ` (${labelOf(st.avg, thr)} day)` : ''}`,
    `Peak: ${span(top)} · ${fmtN(st.max.members)} at ${st.max.label}`,
    `Quietest: ${span(bottom)} · ${fmtN(st.min.members)} at ${st.min.label}`,
    `Readings: ${st.n} of 48`,
    thr?.ready ? '' : `Labels start after a week of readings (High / Medium / Low): ${thr?.n || 0} so far.`].filter((l) => l !== '').join('\n');
}

/** Sunday's grid: one row per day, one letter per hour, and the best hours to post. */
export function weeklyReport(samples, tz, thr, now = Date.now()) {
  const grid = weekGrid(samples, tz, now, 7);
  const letter = (v) => (v == null ? '·' : ({ High: 'H', Medium: 'M', Low: 'L' })[labelOf(v, thr)] || '·');
  const rows = grid.map((row, d) => `${DOW[d]}  ${row.map(letter).join('')}`);
  const { best, worst, hoursSeen } = bestHours(weekGrid(samples, tz, now), thr);
  const lines = ['📈 <b>BHW traffic, this week</b>', '', '<pre>     0    4    8    12   16   20', ...rows, '</pre>'];
  if (thr?.ready && hoursSeen) {
    lines.push(`Best hours to post: ${best.map((c) => `${c.dow} ${hh(c.hour)} (${fmtN(c.v)})`).join(' · ')}`);
    lines.push(`Quietest: ${worst.map((c) => `${c.dow} ${hh(c.hour)} (${fmtN(c.v)})`).join(' · ')}`);
  } else lines.push(`Labels start after a week of readings: ${thr?.n || 0} so far.`);
  return lines.join('\n');
}

/** Today so far, on demand ("online"). */
export function todayReport(samples, tz, thr, now = Date.now()) {
  const latest = (samples || []).filter((s) => s.members != null).slice(-1)[0];
  const date = dateKey(now, tz); const st = statsOf(dayBars(samples, date, tz), 'members');
  return [nowLine(latest, thr) || '📈 No reading yet.', latest ? `Read ${Math.round((now - latest.ts) / 60000)} min ago` : '',
    st.n ? `Today so far: average ${fmtN(st.avg)} · peak ${fmtN(st.max.members)} at ${st.max.label} · low ${fmtN(st.min.members)} at ${st.min.label}` : 'No readings yet today.',
    thr?.ready ? `High is ${fmtN(thr.high)}+ members, Low is under ${fmtN(thr.low)} (last 28 days).` : `Labels start after a week of readings: ${thr?.n || 0} so far.`].filter(Boolean).join('\n');
}

/** The raw readings for Excel. */
export function csv(samples, tz) {
  const lines = ['time,date,slot,weekday,members,guests,total'];
  for (const s of samples || []) { const p = partsOf(s.ts, tz); lines.push(`${new Date(s.ts).toISOString()},${p.date},${slotLabel(slotOf(s.ts, tz))},${DOW[p.dow]},${s.members ?? ''},${s.guests ?? ''},${s.total ?? ''}`); }
  return lines.join('\n');
}
