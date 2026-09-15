// When threads appear on the forum.
//
// Every chart here is one series - a count of threads - so there is no legend
// and no categorical palette to get wrong: one blue, validated against both
// surfaces. Identity lives on the axis, magnitude in the bar length.
//
// Drawn as inline SVG with no library: the extension fetches nothing at
// runtime, so there is no CDN to be blocked and nothing to keep up to date.
//
// The data is whatever is in the local database. It only knows about threads
// found since the extension started watching, so "Load older threads…" is the
// honest way to make these charts mean more.

import { getLeads } from '../store.js';
import { getConfig } from '../config.js';
import { partsIn, todayKey, hourLabel, dayLabel, longDay } from '../timefmt.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const when = (l) => { const t = new Date(l.postedAt); return isNaN(t) ? null : t; };

// ----------------------------------------------------------------- the chart

const tip = $('tip');
function showTip(e, html) {
  tip.innerHTML = html;
  tip.style.opacity = '1';
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(window.innerWidth - r.width - 8, Math.max(8, e.clientX - r.width / 2)) + 'px';
  tip.style.top = Math.max(8, e.clientY - r.height - 12) + 'px';
}
const hideTip = () => { tip.style.opacity = '0'; };

/**
 * One bar chart. bars: [{ label, value, tip, soft }].
 *
 * Marks sit on the baseline with 4px rounded tops and a 2px gap between
 * neighbours. Only the tallest bar is labelled directly - a number on every bar
 * is noise - and every bar has a hover target wider than the bar itself.
 */
function barChart(host, bars, { height = 190, everyNthLabel = 1, unit = 'threads' } = {}) {
  if (!bars.length) { host.innerHTML = '<div class="empty">Nothing recorded yet.</div>'; return; }

  const W = 1000, H = height, padL = 34, padR = 8, padT = 18, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const max = Math.max(1, ...bars.map((b) => b.value));
  const step = plotW / bars.length;
  // 2px surface gap, and a ceiling so seven bars do not become slabs.
  const bw = Math.min(64, Math.max(3, step - 2));
  const off = (step - bw) / 2;                         // centre it in its slot
  const y = (v) => padT + plotH - (v / max) * plotH;
  const peak = bars.reduce((a, b, i) => (b.value > bars[a].value ? i : a), 0);

  // Grid at 0, half, max. Recessive, behind everything.
  const ticks = [0, Math.round(max / 2), max].filter((v, i, a) => a.indexOf(v) === i);
  const grid = ticks.map((v) =>
    `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/>`).join('');
  const tickText = ticks.map((v) =>
    `<text class="tick" x="${padL - 7}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('');

  const marks = bars.map((b, i) => {
    const x = padL + i * step + off;
    const h = Math.max(b.value > 0 ? 2 : 0, plotH - (y(b.value) - padT));
    const r = Math.min(4, bw / 2, h);
    return `<rect class="hit" x="${padL + i * step}" y="${padT}" width="${step}" height="${plotH}"
              data-i="${i}"></rect>` +
           `<rect class="bar" ${b.soft ? `style="fill:url(#part-${host.id})"` : ''} x="${x}" y="${y(b.value)}"
              width="${bw}" height="${h}" rx="${r}" ry="${r}"></rect>`;
  }).join('');

  const labels = bars.map((b, i) => (i % everyNthLabel === 0
    ? `<text class="tick" x="${padL + i * step + off + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(b.label)}</text>` : ''))
    .join('');

  const peakLabel = bars[peak].value > 0
    ? `<text class="val" x="${padL + peak * step + off + bw / 2}" y="${y(bars[peak].value) - 6}" text-anchor="middle">${bars[peak].value}</text>`
    : '';

  host.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(unit)} by ${esc(host.id)}">
       <defs>
         <pattern id="part-${host.id}" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
           <rect width="7" height="7" class="hatch-bg"/><line x1="0" y1="0" x2="0" y2="7" class="hatch-line"/>
         </pattern>
       </defs>
       <g class="grid">${grid}</g>${tickText}
       <g class="axis"><line x1="${padL}" x2="${W - padR}" y1="${y(0)}" y2="${y(0)}"/></g>
       ${marks}${peakLabel}${labels}
     </svg>` +
    `<details><summary>Show the numbers</summary><table><thead><tr><th>${esc(host.dataset.col || 'When')}</th><th class="n">${esc(unit)}</th></tr></thead><tbody>` +
    bars.map((b) => `<tr><td>${esc(b.full || b.label)}</td><td class="n">${b.value}</td></tr>`).join('') +
    `</tbody></table></details>`;

  host.querySelectorAll('.hit').forEach((el) => {
    const b = bars[Number(el.dataset.i)];
    el.addEventListener('mousemove', (e) => showTip(e, b.tip));
    el.addEventListener('mouseleave', hideTip);
  });
}

// ------------------------------------------------------------------ the data

function build(leads, cfg) {
  // Grouped in the configured zone, not the machine's: a thread posted at
  // 1am IST belongs to that IST day wherever the laptop happens to be.
  const dated = leads.map(when).filter(Boolean).sort((a, b) => a - b);
  const dayKey = (d) => partsIn(d, cfg).key;
  const today = todayKey(cfg);

  const stats = $('stats');
  if (!dated.length) {
    stats.innerHTML = '';
    $('note').textContent = 'No threads with a known start time yet. Press "Load older threads…" to fill this in.';
    for (const id of ['daily', 'hourly', 'weekly']) $(id).innerHTML = '<div class="empty">Nothing recorded yet.</div>';
    return;
  }

  // --- per day, every day between the first and today, gaps included as zero
  const first = new Date(dated[0]); first.setHours(0, 0, 0, 0);
  const counts = new Map();
  for (const d of dated) counts.set(dayKey(d), (counts.get(dayKey(d)) || 0) + 1);

  const days = [];
  for (let d = new Date(first); dayKey(d) <= today; d.setDate(d.getDate() + 1)) {
    const key = dayKey(d);
    days.push({ key, date: new Date(d), value: counts.get(key) || 0 });
  }
  const shown = days.slice(-30);

  const complete = days.filter((d) => d.key !== today);
  // Three whole days is the least that can honestly be called an average. Below
  // that the number is one day's count wearing a decimal point.
  const enough = complete.length >= 3;
  const avg = complete.length ? complete.reduce((a, d) => a + d.value, 0) / complete.length : 0;
  const busiest = complete.reduce((a, d) => (d.value > (a?.value ?? -1) ? d : a), null);

  $('range').textContent = `${days.length} day(s) recorded · ${dated.length} threads`;
  const zone = cfg.timezone || 'this computer';
  $('hourSub').innerHTML = `Times in <b>${esc(zone)}</b>. The tall bars are when it is worth being at the keyboard.`;
  $('note').innerHTML = enough
    ? `Counted from when each thread was started, shown in <b>${esc(zone)}</b>. Today is striped and left out of the averages.`
    : `<b>Not enough history yet.</b> ${complete.length} complete day(s) recorded, which is too few to average or to read a weekday pattern from. ` +
      `Press <b>Fill the last 7 days</b> above and the charts fill themselves in.`;

  stats.innerHTML = [
    [counts.get(today) || 0, 'launched today'],
    [enough ? avg.toFixed(1) : '—',
     enough ? `average a day · over ${complete.length} days` : 'average a day · need 3 days'],
    [busiest && busiest.value ? busiest.value : '—', busiest && busiest.value
      ? `busiest day · ${dayLabel(busiest.date, cfg)}` : 'busiest day'],
    [dated.length, 'threads recorded']
  ].map(([v, k]) => `<div class="k"><b>${esc(String(v))}</b><span>${esc(k)}</span></div>`).join('');

  $('daily').dataset.col = 'Day';
  barChart($('daily'), shown.map((d) => ({
    label: dayLabel(d.date, cfg),
    full: longDay(d.date, cfg),
    value: d.value,
    soft: d.key === today,
    tip: `<b>${d.value}</b> thread${d.value === 1 ? '' : 's'}<br>${esc(longDay(d.date, cfg))}${d.key === today ? '<br>today, still filling up' : ''}`
  })), { everyNthLabel: shown.length > 16 ? 3 : 1 });

  // --- per hour of the day
  const byHour = Array.from({ length: 24 }, () => 0);
  for (const d of dated) byHour[partsIn(d, cfg).hour]++;
  const hourPeak = byHour.indexOf(Math.max(...byHour));
  $('hourly').dataset.col = 'Hour';
  barChart($('hourly'), byHour.map((v, h) => ({
    label: hourLabel(h, cfg),
    full: `${hourLabel(h, cfg)} to ${hourLabel((h + 1) % 24, cfg)}`,
    value: v,
    tip: `<b>${v}</b> thread${v === 1 ? '' : 's'} started between<br>${esc(hourLabel(h, cfg))} and ${esc(hourLabel((h + 1) % 24, cfg))}`
  })), { everyNthLabel: 3 });

  // --- per weekday, averaged over how many of each weekday we actually have
  const seen = Array.from({ length: 7 }, () => 0);
  const sum = Array.from({ length: 7 }, () => 0);
  for (const d of complete) { const wd = partsIn(d.date, cfg).weekday; seen[wd]++; sum[wd] += d.value; }
  $('weekly').dataset.col = 'Day of the week';
  barChart($('weekly'), DAYS.map((name, i) => {
    const v = seen[i] ? +(sum[i] / seen[i]).toFixed(1) : 0;
    return {
      label: name.slice(0, 3), full: name, value: v,
      tip: seen[i]
        ? `<b>${v}</b> threads on an average ${name}<br>from ${seen[i]} ${name}${seen[i] === 1 ? '' : 's'} recorded`
        : `No ${name} recorded yet`
    };
  }), { unit: 'threads (average)' });

  if (byHour[hourPeak] > 0 && complete.length) {
    $('hourly').insertAdjacentHTML('afterbegin',
      `<p class="sub" style="margin:-8px 0 10px">Busiest hour so far: <b>${esc(hourLabel(hourPeak, cfg))}</b>.</p>`);
  }
}

// ------------------------------------------------------------------- the page

async function render() { build(await getLeads(), await getConfig()); }

$('back').addEventListener('click', () => {
  location.href = chrome.runtime.getURL('src/dashboard/dashboard.html');
});
$('more').addEventListener('click', () => fill(7));
$('more30').addEventListener('click', () => fill(30));

/** Cover whole days rather than a page count nobody can translate into time. */
async function fill(days) {
  for (const b of ['more', 'more30']) { $(b).disabled = true; }
  const label = $('more').textContent;
  $('more').textContent = 'Reading the forum…';
  const r = await chrome.runtime.sendMessage({ cmd: 'fill-days', days });
  for (const b of ['more', 'more30']) { $(b).disabled = false; }
  $('more').textContent = label;
  if (r?.error) return alert(`Could not read the forum: ${r.error}`);
  await render();
  alert(`Read ${r.pages} page(s) and reached back ${r.days} day(s).\n\n` +
        `${r.backfilled} thread(s) added to the database.`);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.recentLeads) render();
});
render();
