// The sharp lane: while auto mode is on, the Hire a Freelancer page - and only
// that page - is read every 75 seconds or so instead of every six minutes, so
// a buyer's PM arrives a minute or two after they post rather than ten.
//
// Four rules:
//
//   ONE PAGE. The watched forums and the site-wide feed stay on the slow
//   check. The ordinary check skips its own HAF read while this lane is
//   keeping it fresh, so the page is never read twice in a row.
//
//   ONLY WITH AUTO MODE, ONLY IN TABS MODE. With auto mode off nothing is
//   waiting on the minute, so there is no reason to read faster. The old
//   feeds mode is what got the address rate-limited; it never runs sharp.
//
//   A WALL STOPS IT. One Cloudflare page and the lane stands down for two
//   hours - far longer than the 30-minute pause everything else takes - and
//   says so on Telegram. Reading faster is the first thing to give up.
//
//   SAME GATES. It only FINDS threads sooner. Whether a PM goes is still
//   auto.js: Claude's screen, the daily cap, the gap between PMs, the
//   duplicate check against your own message list.
//
// Pure functions: no chrome API and no network.

export const SHARP_ALARM = 'haf-sharp';
export const SHARP_KEY = 'sharpLane';            // { lastAt, backoffUntil, runs, found }
export const WALL_BACKOFF_MS = 2 * 3600000;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Seconds between two reads of the page. Never under a minute. */
export const everySeconds = (cfg) => clamp(Math.round(Number(cfg?.sharpSeconds) || 75), 60, 600);

/** Is the lane meant to be running at all? */
export const wanted = (cfg) => !!(cfg && cfg.enabled !== false && cfg.autoMode && cfg.sharpLane === true && cfg.readMode !== 'feeds');

/** A little randomness on top, so reads are never on the clock. */
export const jitterMs = (cfg, rand = Math.random) => Math.round(rand() * 20000);

/**
 * Why this tick reads nothing, or '' when it should read.
 * `state` is what is stored under SHARP_KEY; `wallUntil` is the shared pause.
 */
export function skipReason(cfg, { now = Date.now(), state = {}, wallUntil = 0, asleep = false, busy = false } = {}) {
  if (!cfg || cfg.enabled === false) return 'the watcher is paused';
  if (!cfg.autoMode) return 'auto mode is off';
  if (cfg.sharpLane !== true) return 'the sharp lane is switched off';
  if (cfg.readMode === 'feeds') return 'feeds mode never runs sharp';
  if (asleep) return 'asleep';
  if (wallUntil && wallUntil > now) return 'BHW is paused after a wall';
  if (state.backoffUntil && state.backoffUntil > now) return 'standing down after a wall';
  if (busy) return 'another check is still running';
  // Two alarms close together (a reload, a settings save) are one read, not two.
  if (state.lastAt && now - state.lastAt < 45000) return 'read a moment ago';
  return '';
}

/** Has the lane read the page recently enough that the slow check need not? */
export const keepsFresh = (cfg, state = {}, now = Date.now()) =>
  wanted(cfg) && !!state.lastAt && now - state.lastAt < 2.5 * everySeconds(cfg) * 1000;

/**
 * How long a found thread waits before its PM goes: long enough for the card
 * to reach your phone with its Hold button, short enough to be first.
 * Null when the lane is off - auto.js then keeps its own 1-3 minutes.
 */
export function waitMs(cfg, rand = Math.random) {
  if (!wanted(cfg)) return null;
  const lo = clamp(Number(cfg.sharpWaitMin ?? 25) || 0, 10, 600);
  const hi = clamp(Number(cfg.sharpWaitMax ?? 50) || 0, lo, 600);
  return Math.round((lo + rand() * (hi - lo)) * 1000);
}

/** "25-50 sec" or "1-3 min", for the log line and the Telegram message. */
export function waitWords(cfg) {
  if (!wanted(cfg)) return '1-3 min';
  const lo = clamp(Number(cfg.sharpWaitMin ?? 25) || 0, 10, 600);
  const hi = clamp(Number(cfg.sharpWaitMax ?? 50) || 0, lo, 600);
  return `${lo}-${hi} sec`;
}

/** One line for "status" and the auto report. */
export function statusLine(cfg, state = {}, now = Date.now()) {
  if (!cfg?.autoMode) return '';
  if (cfg.sharpLane !== true) return '🎯 Sharp lane: off - Hire a Freelancer is read on the ordinary check';
  if (cfg.readMode === 'feeds') return '🎯 Sharp lane: not running - it needs tabs mode';
  if (state.backoffUntil && state.backoffUntil > now) {
    return `🎯 Sharp lane: standing down for ${Math.ceil((state.backoffUntil - now) / 60000)} min after a BHW wall`;
  }
  const ago = state.lastAt ? `${Math.max(0, Math.round((now - state.lastAt) / 1000))}s ago` : 'not yet';
  return `🎯 Sharp lane: ON - Hire a Freelancer read every ~${everySeconds(cfg)}s (last ${ago}), PM ${waitWords(cfg)} after a thread is found`;
}
