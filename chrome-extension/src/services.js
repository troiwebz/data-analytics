// Bump-due tracking for your OWN BHW service/seller threads.
//
// Deliberately separate from announce.js and the HAF pipeline: HAF decides
// "is this stranger's thread new enough to tell you about"; this decides "is
// MY OWN thread due to bump, and is it worth interrupting you about it right
// now". Different question, different rule, different data - a thread here
// is one you configured by hand (there is no keyword matching to discover
// your own threads), and what it tracks is when YOU last bumped it, not when
// it was found.
//
// BHW's own rule, as confirmed directly against their posted forum rules: a
// bump that carries a genuine update or answers a real reply is fine every
// 24 hours; a bump with nothing behind it beyond "up" is capped at once
// every 72 hours. Every bump this file's own reminder produces is a
// self-only one, so it is always treated as the slower, safer 72h kind -
// earning the faster 24h cadence means answering a genuine reply on the
// thread, which is a separate, later piece of this feature, not this one.
import { partsIn } from './timefmt.js';

export const GENUINE_BUMP_HOURS = 24;
export const PROMO_BUMP_HOURS = 72;

/** When this thread may next be bumped. 0 (already eligible) if never bumped. */
export function nextEligibleAt(entry) {
  if (!entry?.lastBumpedAt) return 0;
  const hours = entry.lastBumpKind === 'genuine' ? GENUINE_BUMP_HOURS : PROMO_BUMP_HOURS;
  return new Date(entry.lastBumpedAt).getTime() + hours * 3600000;
}

export function isBumpEligible(entry, now = Date.now()) {
  return now >= nextEligibleAt(entry);
}

/** Hours left before it is eligible again, 0 if it already is. */
export function hoursUntilEligible(entry, now = Date.now()) {
  return Math.max(0, Math.round((nextEligibleAt(entry) - now) / 360000) / 10);
}

/**
 * Eligible threads, longest-overdue first - a thread that has been sitting
 * eligible the longest has been invisible on the listing the longest.
 */
export function dueThreads(threads, now = Date.now()) {
  return (threads || []).filter((t) => isBumpEligible(t, now))
    .sort((a, b) => nextEligibleAt(a) - nextEligibleAt(b));
}

/**
 * Already eligible, but you have already been told about THIS eligibility
 * window - re-notifying every poll would just be noise. Re-armed the moment
 * the thread is actually bumped (lastBumpedAt moves past the old notice).
 */
export function alreadyNotified(entry) {
  if (!entry?.bumpNotifiedAt) return false;
  return new Date(entry.bumpNotifiedAt).getTime() > new Date(entry.lastBumpedAt || 0).getTime();
}

/** Due, and not already told about it this window. */
export function newlyDue(threads, now = Date.now()) {
  return dueThreads(threads, now).filter((t) => !alreadyNotified(t));
}

/**
 * Is now inside your configured peak-traffic window, in your own timezone?
 * A bump held for a few hours until buyers are actually browsing is worth
 * more than one fired the instant it becomes technically eligible.
 */
export function isPeakHours(cfg, now = new Date()) {
  const start = Math.max(0, Math.min(23, Math.round(Number(cfg?.servicesPeakStartHour ?? 9))));
  const end = Math.max(0, Math.min(23, Math.round(Number(cfg?.servicesPeakEndHour ?? 22))));
  const h = partsIn(now, cfg).hour;
  return start === end ? true : start < end ? (h >= start && h < end) : (h >= start || h < end);
}
