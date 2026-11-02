// Real BHW traffic, learned over time, so a bump reminder can eventually be
// timed to when buyers are actually online instead of a manually guessed
// window (src/services.js's servicesPeakStartHour/EndHour, which stays the
// fallback until there is enough real data).
//
// BHW's own /online/ page - confirmed from a live screenshot, not the page
// source - shows a small "Online statistics" box: "Members online: N",
// "Guests online: N", "Total visitors: N". Rather than depend on that box's
// CSS classes or markup, which a theme change could break silently, this
// strips all tags and searches the rendered TEXT for those exact labels -
// the same thing a person reads, so it survives a markup change that leaves
// the wording alone.
import { partsIn } from './timefmt.js';

export const ONLINE_URL = 'https://www.blackhatworld.com/online/';

// Roughly 10 hours of half-hourly checks - enough to say something real
// about which hours are actually busier, without waiting a full 14 days.
export const MIN_SAMPLES = 20;

function plainText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

/** { members, guests, total }, or null for whichever label was not found. */
export function parseOnlineCounts(html) {
  const text = plainText(html);
  const grab = (label) => {
    const m = text.match(new RegExp(label.replace(/ /g, '\\s+') + '\\s*:?\\s*([\\d,]+)', 'i'));
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
  };
  return { members: grab('Members online'), guests: grab('Guests online'), total: grab('Total visitors') };
}

/** Never throws: a failed traffic read is one missed data point, not a broken poll. */
export async function fetchOnlineCounts() {
  try {
    const res = await fetch(ONLINE_URL, { credentials: 'include', cache: 'no-store' });
    if (!res.ok) return null;
    const counts = parseOnlineCounts(await res.text());
    return counts.members == null ? null : counts;
  } catch {
    return null;
  }
}

/** Which hour (0-23) a sample belongs to, in your own configured timezone. */
export const hourOf = (ts, cfg) => partsIn(new Date(ts), cfg).hour;

/** Average members-online per hour-of-day, from whatever samples exist. */
export function hourlyAverages(samples, cfg) {
  const buckets = {};
  for (const s of samples || []) {
    if (s.members == null) continue;
    const h = hourOf(s.ts, cfg);
    (buckets[h] ||= []).push(s.members);
  }
  const out = {};
  for (const [h, vals] of Object.entries(buckets)) out[h] = vals.reduce((a, b) => a + b, 0) / vals.length;
  return out;
}

/**
 * Is the CURRENT hour genuinely busier than an average hour today, based on
 * what has actually been observed - not a single contiguous "peak window",
 * since real traffic can have more than one daily peak (lunch and evening,
 * say). `ready: false` until there are enough samples to say anything real,
 * at which point the caller falls back to the manual window instead.
 */
export function isHighTrafficNow(samples, cfg, now = Date.now()) {
  const all = (samples || []).filter((s) => s.members != null);
  if (all.length < MIN_SAMPLES) return { ready: false, high: false, samples: all.length };

  const avgs = hourlyAverages(all, cfg);
  const hourAvgs = Object.values(avgs);
  const dayAvg = hourAvgs.reduce((a, b) => a + b, 0) / hourAvgs.length;
  const h = hourOf(now, cfg);
  const hourAvg = avgs[h];
  if (hourAvg == null) return { ready: true, high: false, hourAvg: null, dayAvg, samples: all.length };
  return { ready: true, high: hourAvg >= dayAvg, hourAvg, dayAvg, samples: all.length };
}
