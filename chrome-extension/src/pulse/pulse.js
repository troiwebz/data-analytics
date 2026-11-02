// The BHW Traffic page: bars by day, week and month, the patterns, and the
// CSV. It only reads what the background has stored; nothing here touches BHW.
import { dayBars, weekBars, monthBars, statsOf, labelOf, weekGrid, bestHours, hourShape, dateKey, weekStart, shiftDate, DOW, csv, slotLabel } from '../pulse.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const send = (msg) => chrome.runtime.sendMessage(msg);
const fmt = (n) => (n == null ? '–' : Number(n).toLocaleString('en-US'));
const COLOR = { High: '#16a34a', Medium: '#f59e0b', Low: '#94a3b8', '': '#cbd5e1' };

let S = null, tab = 'day', cursor = null;   // cursor: 'YYYY-MM-DD' (day / week Monday) or 'YYYY-MM'

function barChart(bars, { value, label, sub, avgValue, second, height = 240 }) {
  const W = 1100, H = height, padL = 54, padB = 34, padT = 12;
  const vals = bars.map((b) => b[value]).filter((v) => v != null);
  const max = Math.max(1, ...vals);
  // Guests are many times the members: they get their own scale (faint, behind), so the member bars keep the full height.
  const max2 = second ? Math.max(1, ...bars.map((b) => b[second] || 0)) : 1;
  const iw = (W - padL - 8) / bars.length, bw = Math.max(2, iw * 0.68);
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const y2 = (v) => padT + (H - padT - padB) * (1 - v / max2);
  const parts = [`<svg class="chart" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`];
  for (let i = 0; i <= 4; i++) { const v = (max / 4) * i; parts.push(`<line x1="${padL}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}" stroke="#f1f5f9"/><text x="${padL - 6}" y="${y(v) + 4}" font-size="11" text-anchor="end" fill="#64748b">${fmt(Math.round(v))}</text>`); }
  bars.forEach((b, i) => {
    const x = padL + i * iw + (iw - bw) / 2;
    if (second && b[second] != null) parts.push(`<rect x="${x - bw * 0.15}" y="${y2(b[second])}" width="${bw * 1.3}" height="${H - padB - y2(b[second])}" fill="#efe6ff"><title>${esc(label(b))}: ${fmt(b[second])} guests</title></rect>`);
    if (b[value] == null) parts.push(`<rect x="${x}" y="${H - padB - 3}" width="${bw}" height="3" fill="#e2e8f0"><title>${esc(label(b))}: no reading</title></rect>`);
    else parts.push(`<rect x="${x}" y="${y(b[value])}" width="${bw}" height="${H - padB - y(b[value])}" rx="2" fill="${COLOR[labelOf(b[value], S.thr)]}"><title>${esc(label(b))}: ${fmt(b[value])} members${sub ? ' · ' + esc(sub(b)) : ''}</title></rect>`);
    if (bars.length <= 31 || i % 4 === 0) parts.push(`<text x="${x + bw / 2}" y="${H - padB + 14}" font-size="10.5" text-anchor="middle" fill="#64748b">${esc(label(b))}</text>`);
  });
  if (avgValue != null) parts.push(`<line x1="${padL}" x2="${W - 8}" y1="${y(avgValue)}" y2="${y(avgValue)}" stroke="#0f172a" stroke-dasharray="6 5" stroke-width="1.5"/><text x="${W - 10}" y="${y(avgValue) - 5}" font-size="11" text-anchor="end" fill="#0f172a">avg ${fmt(avgValue)}</text>`);
  parts.push('</svg>');
  return parts.join('');
}

function renderChart() {
  const { samples, tz } = S;
  const today = dateKey(Date.now(), tz);
  let bars, st, title, html;
  if (tab === 'day') {
    cursor = cursor || today; bars = dayBars(samples, cursor, tz); st = statsOf(bars, 'members');
    title = `${cursor}${cursor === today ? ' (today)' : ''}`;
    html = barChart(bars, { value: 'members', second: 'guests', label: (b) => b.label, avgValue: st.avg });
    $('stat').innerHTML = st.n ? `Average <b>${fmt(st.avg)}</b> members online · busiest <b>${st.max.label}</b> (${fmt(st.max.members)}) · quietest <b>${st.min.label}</b> (${fmt(st.min.members)}) · ${st.n} of 48 readings` : 'No readings on this day.';
  } else if (tab === 'week') {
    cursor = cursor || weekStart(today); bars = weekBars(samples, cursor, tz); st = statsOf(bars, 'avg');
    title = `Week of ${cursor}`;
    html = barChart(bars, { value: 'avg', label: (b) => `${b.dow} ${b.date.slice(8)}`, sub: (b) => `peak ${fmt(b.peak)} at ${b.peakAt}`, avgValue: st.avg });
    $('stat').innerHTML = st.n ? `Average <b>${fmt(st.avg)}</b> · busiest day <b>${st.max.dow}</b> (${fmt(st.max.avg)}, peak ${fmt(st.max.peak)} at ${st.max.peakAt}) · quietest <b>${st.min.dow}</b> (${fmt(st.min.avg)}) · ${st.n} of 7 days` : 'No readings in this week.';
  } else {
    cursor = cursor || today.slice(0, 7); bars = monthBars(samples, cursor, tz); st = statsOf(bars, 'avg');
    title = cursor;
    html = barChart(bars, { value: 'avg', label: (b) => b.date.slice(8), sub: (b) => `${b.dow}, peak ${fmt(b.peak)} at ${b.peakAt}`, avgValue: st.avg });
    $('stat').innerHTML = st.n ? `Average <b>${fmt(st.avg)}</b> · busiest <b>${st.max.date}</b> (${fmt(st.max.avg)}) · quietest <b>${st.min.date}</b> (${fmt(st.min.avg)}) · ${st.n} days with readings` : 'No readings in this month.';
  }
  $('title').textContent = title;
  $('chart').innerHTML = bars.some((b) => (tab === 'day' ? b.members : b.avg) != null) ? html : '<div class="empty">No readings here yet.</div>';
}

function renderPatterns() {
  const { samples, tz, thr } = S;
  const shape = hourShape(samples, tz);
  $('shape').innerHTML = shape.some((v) => v != null) ? barChart(shape.map((v, h) => ({ members: v, h })), { value: 'members', label: (b) => `${String(b.h).padStart(2, '0')}:00`, avgValue: statsOf(shape.map((v) => ({ members: v })), 'members').avg, height: 200 }) : '<div class="empty">Nothing yet.</div>';
  const grid = weekGrid(samples, tz);
  $('grid').innerHTML = `<table><thead><tr><th></th>${Array.from({ length: 24 }, (_, h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${grid.map((row, d) => `<tr><td class="d">${DOW[d]}</td>${row.map((v) => `<td class="${v == null ? 'n' : (labelOf(v, thr) || 'n')[0]}" title="${v == null ? 'no reading' : fmt(v) + ' members'}">${v == null ? '·' : (labelOf(v, thr) || '·')[0]}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const bh = bestHours(grid, thr, 5);
  const li = (c) => `<li>${c.dow} ${String(c.hour).padStart(2, '0')}:00 · ${fmt(c.v)}</li>`;
  $('best').innerHTML = bh.best.map(li).join('') || '<li class="sub">After a week of readings.</li>';
  $('worst').innerHTML = bh.worst.map(li).join('') || '<li class="sub">After a week of readings.</li>';
  $('perday').innerHTML = grid.map((row, d) => { let best = -1; row.forEach((v, h) => { if (v != null && (best < 0 || v > row[best])) best = h; }); return best < 0 ? '' : `<li>${DOW[d]} · ${String(best).padStart(2, '0')}:00 (${fmt(row[best])})</li>`; }).join('') || '<li class="sub">After a week of readings.</li>';
}

function renderTiles() {
  const { samples, cfg, meta, thr, tz, wallUntil } = S;
  const last = meta.last || samples.slice(-1)[0];
  $('toggle').textContent = cfg.on ? 'Traffic is ON' : 'Traffic is OFF'; $('toggle').className = cfg.on ? 'on' : 'off';
  $('now').textContent = last ? fmt(last.members) : '–';
  $('now-s').textContent = last ? `members · ${fmt(last.guests)} guests · ${labelOf(last.members, thr) || 'no label yet'} · read ${Math.round((Date.now() - last.ts) / 60000)} min ago` : (wallUntil ? 'BHW paused (wall)' : meta.lastError ? meta.lastError : 'no reading yet');
  const st = statsOf(dayBars(samples, dateKey(Date.now(), tz), tz), 'members');
  $('today').textContent = st.n ? fmt(st.avg) : '–'; $('today-s').textContent = st.n ? `average · peak ${fmt(st.max.members)} at ${st.max.label}` : 'no readings yet today';
  $('hi').textContent = thr.ready ? `${fmt(thr.high)}+` : '–'; $('hi-s').textContent = thr.ready ? `Low is under ${fmt(thr.low)} · last 28 days` : `labels after a week · ${thr.n} readings so far`;
  $('n').textContent = fmt(samples.length); $('n-s').textContent = `every 30 min · ${tz}`;
  $('msg').hidden = !meta.lastError; $('msg').textContent = meta.lastError ? `Last read failed: ${meta.lastError}` : '';
}

async function load() {
  const got = await send({ cmd: 'pulse-status' }).catch(() => null);
  if (!got || !got.cfg) { $('msg').hidden = false; $('msg').textContent = 'Could not reach the extension. Reload this page.'; return; }
  S = got; renderTiles(); if (tab === 'patterns') renderPatterns(); else renderChart();
}

for (const b of document.querySelectorAll('[role=tab]')) b.addEventListener('click', () => {
  tab = b.dataset.tab; cursor = null;
  for (const x of document.querySelectorAll('[role=tab]')) x.setAttribute('aria-selected', String(x === b));
  $('p-chart').hidden = tab === 'patterns'; $('p-patterns').hidden = tab !== 'patterns';
  if (tab === 'patterns') renderPatterns(); else renderChart();
});
const step = (dir) => { if (tab === 'day') cursor = shiftDate(cursor, dir); else if (tab === 'week') cursor = shiftDate(cursor, 7 * dir); else { const [y, m] = cursor.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + dir, 1)); cursor = d.toISOString().slice(0, 7); } renderChart(); };
$('prev').addEventListener('click', () => step(-1));
$('next').addEventListener('click', () => step(1));
$('latest').addEventListener('click', () => { cursor = null; renderChart(); });
$('toggle').addEventListener('click', async () => { await send({ cmd: 'pulse-save', on: !S.cfg.on }); await load(); });
$('read').addEventListener('click', async () => { $('read').disabled = true; $('read').textContent = 'Reading…'; await send({ cmd: 'pulse-read' }); await load(); $('read').disabled = false; $('read').textContent = 'Read now'; });
$('csv').addEventListener('click', () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv(S.samples, S.tz)], { type: 'text/csv' })); a.download = `bhw-traffic-${dateKey(Date.now(), S.tz)}.csv`; a.click(); });
$('back').addEventListener('click', () => { location.href = chrome.runtime.getURL('src/dashboard/dashboard.html'); });
load();
setInterval(load, 60000);
