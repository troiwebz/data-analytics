// One place that decides what a time looks like.
//
// The machine's own zone is not always the one you work in, and a forum thread
// posted "20:00" means nothing at a glance. Everything shown to you is in the
// zone set in Settings - Asia/Kolkata unless changed - and on a 12 hour clock.

export const DEFAULT_TZ = 'Asia/Kolkata';

/** '' means "use this computer's own zone", which Intl accepts as undefined. */
export const zoneOf = (cfg) => (cfg?.timezone === '' ? undefined : (cfg?.timezone || DEFAULT_TZ));

const opts = (cfg, extra) => ({ timeZone: zoneOf(cfg), ...extra });

/** 15 Sept, 6:45 pm */
export function stamp(iso, cfg) {
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleString('en-GB', opts(cfg, {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true
  })).replace(',', '');
}

/** 6:45 pm */
export const clock = (iso, cfg) => {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleTimeString('en-GB', opts(cfg, { hour: 'numeric', minute: '2-digit', hour12: true }));
};

/** 12 am, 1 am … 11 pm — for an axis, where minutes would be noise. */
export const hourLabel = (h, cfg) =>
  new Date(Date.UTC(2020, 0, 1, 12)).toLocaleTimeString('en-GB', { hour: 'numeric', hour12: true })
    .replace(/\d+/, String(h % 12 === 0 ? 12 : h % 12)).replace(/^\s+/, '')
    .replace(/(am|pm)/i, h < 12 ? 'am' : 'pm');

/** 15 Sept */
export const dayLabel = (d, cfg) =>
  d.toLocaleDateString('en-GB', opts(cfg, { day: 'numeric', month: 'short' }));

/** Wednesday 15 September */
export const longDay = (d, cfg) =>
  d.toLocaleDateString('en-GB', opts(cfg, { weekday: 'long', day: 'numeric', month: 'long' }));

/**
 * The parts of a moment *in the configured zone*. Date methods read the
 * machine's zone, so grouping by day or hour has to go through here or a
 * thread posted at 1am IST lands on the wrong day for anyone outside India.
 */
export function partsIn(date, cfg) {
  const f = new Intl.DateTimeFormat('en-GB', opts(cfg, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    weekday: 'short', hour12: false
  }));
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    key: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour) % 24,
    weekday: WD[p.weekday] ?? 0
  };
}

/** Today's date key in the configured zone. */
export const todayKey = (cfg) => partsIn(new Date(), cfg).key;
