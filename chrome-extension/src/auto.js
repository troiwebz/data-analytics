// "Auto mode": post the public reply to a qualifying thread by itself, a
// short random delay after it was found - no tap needed. Off by default.
//
// Deliberately the same shape as night.js, and the same safety rule for the
// same reason: PUBLIC REPLIES ONLY. An unsolicited PM is the thing BHW
// moderators actually act on, so a PM always waits for your tap, in auto
// mode or not - see src/background.js's postLead vs sendDm.
//
// Unlike night mode there is no time window: a qualifying thread counts down
// whenever it is found. Everything else - a real draft, a body that was
// actually read, Claude's own lines rather than the built-in rules, a
// passing compliance check - is the same bar night mode already proved.

/** May this lead post itself, ignoring timing? Null means yes. */
export function blockedReason(lead, cfg) {
  if (!lead?.draft || !lead.draft.trim()) return 'no reply drafted';
  if (['POSTED', 'SKIPPED', 'FAILED'].includes(lead.status)) return `already ${String(lead.status).toLowerCase()}`;
  if (!String(lead.body || '').trim()) return 'the post itself was never read, so the draft is from the title alone';
  if (!(lead.aiSpecifics?.tips?.length || lead.aiSpecifics?.length)) return 'the built-in rules wrote it, not Claude';
  if (lead.lint && lead.lint.ok === false) return `the compliance check failed: ${(lead.lint.errors || []).join('; ')}`;
  const min = Number(cfg.autoModeMinScore) || 0;
  if ((lead.score ?? 0) < min) return `scored ${lead.score ?? 0}, below your auto-mode bar of ${min}`;
  return null;
}

/**
 * 1 to 3 minutes from now, randomised so a whole poll's worth of new threads
 * does not all fire on the same tick.
 */
export const postAt = (cfg, now = Date.now(), rand = Math.random) => now + (60 + rand() * 120) * 1000;

/** Leads whose countdown has run out and were not held. */
export const dueNow = (leads, at = Date.now()) => (leads || []).filter((l) =>
  l.autoSendAt && !l.autoSendHeld && l.autoSendAt <= at &&
  !['POSTED', 'SKIPPED', 'FAILED'].includes(l.status));

/** Still counting down, for the status report. */
export const pending = (leads, at = Date.now()) => (leads || []).filter((l) =>
  l.autoSendAt && !l.autoSendHeld && l.autoSendAt > at &&
  !['POSTED', 'SKIPPED', 'FAILED'].includes(l.status));
