// The single source of truth for "should this lead go to Telegram right now".
//
// This used to be several near-identical copies of the same rule, scattered
// across background.js: an array of "decided" statuses re-typed in
// announceNew, again in statusReport, again in todayLine; an age cutoff
// computed inline; a "too old" sentinel string written in one place and
// compared in another. Three copies of one rule are three chances for them to
// drift, and every one of the "old thread bumped again" bugs this week was a
// different copy going stale in a different way - not the same bug twice.
//
// Everything that decides whether a lead is announceable now lives here,
// once. Pure functions, no chrome API and no network, so the actual rule -
// the part that has been wrong four times - can be proven with a plain array
// of objects and read in one place without chasing it through the rest of the
// extension.

/** A lead in one of these states has already been decided; never re-queue it. */
export const SILENT_STATUSES = ['POSTED', 'SKIPPED', 'EXPIRED', 'BACKFILL'];

/** Sentinel values stored in tgSentAt for a lead that was never really sent. */
export const TOO_OLD = 'too old to announce';
export const BASELINE = 'already in the table before this version';

/** Has this lead already been decided, one way or another? */
export const isDecided = (lead) => SILENT_STATUSES.includes(lead?.status);

/**
 * Would this lead currently qualify to reach Telegram, ignoring age?
 *
 * tgSentAt is the only gate that matters long-term: once set - to a real
 * timestamp, or to either sentinel above - a lead can never be reconsidered.
 * That is deliberate. The alternative (re-deriving "already handled" from
 * status + other fields on every check) is exactly the kind of rule that
 * quietly stops matching reality after the code around it changes.
 */
export function isCandidate(lead) {
  if (!lead) return false;
  if (lead.tgSentAt) return false;
  if (isDecided(lead)) return false;
  if (String(lead.threadId) === 'sample') return false;
  return true;
}

/** The age cutoff in ms, or 0 for "no limit" - cfg.announceMaxAgeHours, 12 by default. */
export function maxAgeMs(cfg) {
  const hours = Math.max(0, Number(cfg?.announceMaxAgeHours ?? 12));
  return hours * 3600000;
}

/**
 * Is this lead older than the cutoff? False when there is no cutoff.
 *
 * Measured from when the THREAD was actually posted (postedAt, read off the
 * forum listing's own start date), not from when we happened to find it
 * (foundAt). Those two only differ when a thread sat off the listing's first
 * page or out of the RSS window until something bumped it back into view -
 * exactly a thread from yesterday getting a reply today. foundAt for that
 * thread is "just now", so the age check on foundAt alone let it straight
 * through looking brand new, which is the whole bug: "previous day bumped
 * thread" reaching Telegram as if it were recent. postedAt does not move when
 * a thread is bumped, so this is the number that actually answers "is this
 * recent" rather than "did we only just notice it".
 */
export function isTooOld(lead, cfg, now = Date.now()) {
  const max = maxAgeMs(cfg);
  if (!max) return false;
  const at = lead?.postedAt || lead?.foundAt || 0;
  return now - new Date(at).getTime() >= max;
}

/**
 * The whole decision, in one call: what should be sent to Telegram right now,
 * and what should be marked too old rather than re-examined on every future
 * check. Newest first, because a thread posted minutes ago is worth more than
 * one from yesterday and whatever does not fit waits for the next check
 * either way.
 */
export function selectQueue(leads, cfg, now = Date.now()) {
  const candidates = (leads || []).filter(isCandidate);
  const send = [];
  const stale = [];
  for (const l of candidates) (isTooOld(l, cfg, now) ? stale : send).push(l);
  send.sort((a, b) => new Date(b.postedAt || b.foundAt || 0) - new Date(a.postedAt || a.foundAt || 0));
  return { send, stale };
}

/**
 * How things stand, for the status report and the self-test: how many are
 * queued right now, and how many are being held back as too old in total
 * (both leads about to be marked, and leads already carrying that mark from an
 * earlier check).
 */
export function queueCounts(leads, cfg, now = Date.now()) {
  const { send, stale } = selectQueue(leads, cfg, now);
  const alreadyStale = (leads || []).filter((l) => l.tgSentAt === TOO_OLD).length;
  return { queued: send.length, stale: stale.length + alreadyStale };
}
