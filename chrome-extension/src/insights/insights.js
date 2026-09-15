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

/**
 * Only a start time read off the forum listing counts.
 *
 * The RSS feed's date is the thread's LAST POST, so a year-old thread bumped
 * this evening arrives looking like it started this evening. Counting those as
 * launches is what turned a quiet forum into 27 threads a day with a spike at
 * whatever hour the bumps happened. A thread whose date could not be read at
 * all is excluded too, rather than being guessed at.
 */
const startedAt = (l) => {
  if (l.postedAtSource !== 'listing') return null;
  const t = new Date(l.postedAt);
  return isNaN(t) ? null : t;
};

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
  const dated = leads.map(startedAt).filter(Boolean).sort((a, b) => a - b);
  const unknown = leads.length - dated.length;
  const dayKey = (d) => partsIn(d, cfg).key;
  const today = todayKey(cfg);

  const stats = $('stats');
  if (!dated.length) {
    stats.innerHTML = '';
    $('note').innerHTML = 'No threads with a confirmed start time yet. The forum feed only says when a thread was '
      + 'last replied to, which is not the same thing. Press <b>Fill the last 7 days</b> to read the real dates off the forum.';
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

  $('range').textContent = `${days.length} day(s) · ${dated.length} threads with a confirmed start time`
    + (unknown ? ` · ${unknown} excluded` : '');
  const zone = cfg.timezone || 'this computer';
  const caveat = unknown
    ? ` <b>${unknown}</b> lead(s) are left out because the forum did not give a start time for them, or the only date we have is when they were last replied to.`
    : '';
  $('hourSub').innerHTML = `Times in <b>${esc(zone)}</b>. The tall bars are when it is worth being at the keyboard.`;
  $('note').innerHTML = enough
    ? `Counted from when each thread was started, shown in <b>${esc(zone)}</b>. Today is striped and left out of the averages.${caveat}`
    : `<b>Not enough history yet.</b> ${complete.length} complete day(s) recorded, which is too few to average or to read a weekday pattern from. ` +
      `Press <b>Fill the last 7 days</b> above and the charts fill themselves in.${caveat}`;

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

  const lines = tips(leads, dated, byHour, complete, seen, sum, cfg);
  $('tipsCard').hidden = lines.length === 0;
  $('tips').innerHTML = lines.map((t) => `<li>${t}</li>`).join('');

  if (byHour[hourPeak] > 0 && complete.length) {
    $('hourly').insertAdjacentHTML('afterbegin',
      `<p class="sub" style="margin:-8px 0 10px">Busiest hour so far: <b>${esc(hourLabel(hourPeak, cfg))}</b>.</p>`);
  }
}

/**
 * Plain conclusions, each one only drawn when the data behind it is there.
 * Nothing here is a rule of thumb: every line is computed from the threads in
 * the database, and the line is left out rather than guessed at.
 */
function tips(leads, dated, byHour, complete, seen, sum, cfg) {
  const out = [];
  const fmt = (h) => hourLabel(h, cfg);

  // The best three hours in a row: a window worth sitting at the keyboard for.
  if (dated.length >= 25) {
    let best = 0, bestAt = 0;
    for (let h = 0; h < 24; h++) {
      const run = byHour[h] + byHour[(h + 1) % 24] + byHour[(h + 2) % 24];
      if (run > best) { best = run; bestAt = h; }
    }
    const share = Math.round((best / dated.length) * 100);
    if (share >= 15) {
      out.push(`<b>${fmt(bestAt)} to ${fmt((bestAt + 3) % 24)}</b> is the busiest window: ${share}% of all threads start in those three hours.`);
    }
    const quiet = byHour.map((v, h) => ({ v, h })).filter((x) => x.v > 0).sort((a, b) => a.v - b.v)[0];
    if (quiet) out.push(`<b>${fmt(quiet.h)}</b> is the quietest hour with anything in it, so a reply posted then has the least competition on the page.`);
  }

  // Which day is worth clearing the diary for.
  if (complete.length >= 7) {
    const avgs = DAYS.map((name, i) => ({ name, v: seen[i] ? sum[i] / seen[i] : null })).filter((x) => x.v != null);
    if (avgs.length >= 5) {
      const top = avgs.slice().sort((a, b) => b.v - a.v)[0];
      const low = avgs.slice().sort((a, b) => a.v - b.v)[0];
      if (top.v >= low.v * 1.5) {
        out.push(`<b>${top.name}</b> is the busiest day (${top.v.toFixed(1)} threads) and <b>${low.name}</b> the quietest (${low.v.toFixed(1)}).`);
      }
    }
  }

  // How crowded a thread already is when we reach it: the answer to "how fast
  // do I have to be", and to "is it worth replying to this one at all".
  const withReplies = leads.filter((l) => Number.isFinite(Number(l.replyCount)) && startedAt(l));
  if (withReplies.length >= 10) {
    const fresh = withReplies.filter((l) => (Date.now() - startedAt(l).getTime()) < 2 * 3600000);
    const med = (xs) => { const a = xs.slice().sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
    if (fresh.length >= 5) {
      out.push(`A thread under two hours old has <b>${med(fresh.map((l) => Number(l.replyCount)))} replies</b> on average, so getting in early is worth a few minutes.`);
    }
    const old = withReplies.filter((l) => (Date.now() - startedAt(l).getTime()) > 24 * 3600000);
    if (old.length >= 5) {
      const m = med(old.map((l) => Number(l.replyCount)));
      out.push(`After a day they carry <b>${m} replies</b>. Past roughly ${Math.max(8, m)} the buyer has usually chosen, so those are worth a PM rather than a public reply.`);
    }
  }

  // What the watcher is actually catching.
  const today = todayKey(cfg);
  const todayCount = dated.filter((d) => partsIn(d, cfg).key === today).length;
  if (complete.length >= 3) {
    const avg = complete.reduce((a, d) => a + d.value, 0) / complete.length;
    if (todayCount > avg * 1.3) out.push(`Today is <b>busier than usual</b>: ${todayCount} so far against ${avg.toFixed(1)} on an average day.`);
    else if (todayCount < avg * 0.6) out.push(`Today is <b>quieter than usual</b>: ${todayCount} so far against ${avg.toFixed(1)} on an average day.`);
  }

  return out;
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
