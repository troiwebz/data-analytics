// Posting while you are asleep.
//
// Everything else in this extension refuses to post without a tap. This is the
// one exception, and it is built to be the safest possible version of that
// exception rather than the most capable one.
//
// Four rules, and each exists because of something that has already gone wrong
// here:
//
//   1. YOU GET A VETO, NOT A REPORT. A lead is announced the moment it is
//      found - "posting in 20 minutes unless you tap Hold" - and only goes up
//      when that runs out. Awake, you stop anything you dislike. Asleep, it
//      happens. A message that only tells you afterwards is no use at 3am.
//
//   2. ONLY DRAFTS WORTH POSTING. "Crypto Runner" came back as wallet and
//      multi-chain operations because the draft was written from the title
//      alone. That reply going up unattended, in public, under your name, is
//      the worst thing this feature could do - so a draft written without the
//      thread body never qualifies, whatever it scores.
//
//   3. PUBLIC REPLIES ONLY. A reply is one post in a busy thread. An
//      unsolicited PM is the thing BHW moderators actually act on, and it is
//      not worth an account to save you typing.
//
//   4. A SEPARATE, SMALLER CAP. Your daily limits still apply, and on top of
//      them there is a cap on how many can go out unattended. Something wrong
//      at midnight should cost you two posts, not ten.

import { zoneOf } from './timefmt.js';

/** Minutes since midnight in your own zone, for "is it night" arithmetic. */
export function minutesNow(cfg, now = new Date()) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: zoneOf(cfg), hour: '2-digit', minute: '2-digit', hour12: false
  });
  const [h, m] = f.format(now).split(':').map(Number);
  return h * 60 + m;
}

const toMinutes = (hhmm, fallback) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return fallback;
  return (Number(m[1]) % 24) * 60 + (Number(m[2]) % 60);
};

/**
 * Is it night? The window normally crosses midnight (23:00 to 07:00), so it is
 * "after the start OR before the end" rather than a simple between.
 */
export function isNight(cfg, now = new Date()) {
  if (!cfg?.nightMode) return false;
  const start = toMinutes(cfg.nightStart, 23 * 60);
  const end = toMinutes(cfg.nightEnd, 7 * 60);
  const t = minutesNow(cfg, now);
  return start === end ? true : start < end ? (t >= start && t < end) : (t >= start || t < end);
}

/**
 * May this lead post itself? Returns null when it may, or the reason it may
 * not - which is what gets shown on the card and in the morning summary, so
 * "held" is never just silence.
 */
export function blockedReason(lead, cfg) {
  if (!lead?.draft || !lead.draft.trim()) return 'no reply drafted';
  if (['POSTED', 'SKIPPED', 'FAILED'].includes(lead.status)) return `already ${String(lead.status).toLowerCase()}`;
  // Rule 2: the thread has to have actually been read.
  if (!String(lead.body || '').trim()) return 'the post itself was never read, so the draft is from the title alone';
  if (!(lead.aiSpecifics?.tips?.length || lead.aiSpecifics?.length)) return 'the built-in rules wrote it, not Claude';
  if (lead.lint && lead.lint.ok === false) return `the compliance check failed: ${(lead.lint.errors || []).join('; ')}`;
  const min = Number(cfg.nightMinScore) || 0;
  if ((lead.score ?? 0) < min) return `scored ${lead.score ?? 0}, below your overnight bar of ${min}`;
  return null;
}

/** When a lead found now should go up, given your veto window. */
export const postAt = (cfg, now = Date.now()) =>
  now + Math.max(0, Number(cfg.nightVetoMinutes ?? 20)) * 60000;

/**
 * Leads whose veto window has run out. Held and decided ones drop out here
 * rather than being filtered at the point of posting, so the list is exactly
 * what is about to happen.
 */
export const dueNow = (leads, at = Date.now()) => (leads || []).filter((l) =>
  l.autoPostAt && !l.autoHeld && l.autoPostAt <= at &&
  !['POSTED', 'SKIPPED', 'FAILED'].includes(l.status));

/** Still counting down, for the morning summary and the dashboard. */
export const pending = (leads, at = Date.now()) => (leads || []).filter((l) =>
  l.autoPostAt && !l.autoHeld && l.autoPostAt > at &&
  !['POSTED', 'SKIPPED', 'FAILED'].includes(l.status));

/** How many have gone out unattended tonight, against your overnight cap. */
export function nightCount(leads, cfg, now = Date.now()) {
  // One night spans midnight, so "tonight" starts at the last time the window
  // opened, not at midnight.
  const start = toMinutes(cfg.nightStart, 23 * 60);
  const t = minutesNow(cfg, new Date(now));
  const since = now - ((t >= start ? t - start : t + (1440 - start)) * 60000);
  return (leads || []).filter((l) => l.autoPostedAt && new Date(l.autoPostedAt).getTime() >= since).length;
}
