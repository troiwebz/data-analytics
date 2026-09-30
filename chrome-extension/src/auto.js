// "Auto mode": send the PRIVATE MESSAGE to a new Hire a Freelancer thread by
// itself, a short random delay after it was found. Off by default; "auto on"
// and "auto off" on Telegram switch it.
//
// Three rules, all of them yours:
//
//   PRIVATE MESSAGE ONLY. Nothing public is ever posted by itself. A public
//   reply is on the thread for everyone to read and cannot be taken back; it
//   always waits for your tap.
//
//   THE LAST 24 HOURS. Switching it on also sends the PMs still pending from
//   that window - the day's buyers - and nothing older.
//
//   CLAUDE'S SCREEN MUST PASS. Claude has to have read the actual post, said
//   "yes, this is someone asking to hire", and written the lines. No key, no
//   budget, an error, no verdict, or a "no": that thread is skipped, and it
//   is never tried again - it waits for you like any other lead.
//
// Pure functions: no chrome API and no network, so the rule can be read here
// and proven with a plain array of objects.

const has = (s) => !!String(s || '').trim();

/**
 * The first deal-breaker phrase found in the title or the post, as the words
 * that matched - so the reason on the card is "payment after delivery", not a
 * regex. A pattern that will not compile is skipped, never fatal.
 */
export function dealBreaker(lead, cfg) {
  const text = `${lead?.title || ''}\n${lead?.body || lead?.snippet || ''}`;
  for (const raw of cfg?.autoSkipPhrases || []) {
    const src = String(raw || '').trim();
    if (!src) continue;
    let rx;
    try { rx = new RegExp(src, 'i'); } catch { continue; }
    const m = text.match(rx);
    if (m && m[0].trim()) {
      // A few words either side, so the reason reads as the buyer wrote it.
      const i = Math.max(0, m.index - 12), j = Math.min(text.length, m.index + m[0].length + 24);
      return text.slice(i, j).replace(/\s+/g, ' ').trim();
    }
  }
  return '';
}
const screened = (lead) => !!(lead?.aiSpecifics?.tips?.length);

/** May this lead's PM send itself, ignoring timing? Null means yes. */
export function blockedReason(lead, cfg) {
  if (!lead) return 'no lead';
  if (lead.kind === 'thread') return 'not a Hire a Freelancer thread - those are public reply only';
  if (lead.pmSent) return 'the PM was already sent';
  if (['SKIPPED', 'FAILED', 'EXPIRED', 'BACKFILL'].includes(lead.status)) return `already ${String(lead.status).toLowerCase()}`;
  if (!has(lead.author)) return 'no author to message';
  if (!has(lead.dmApproved || lead.dm)) return 'no PM drafted';
  // Auto mode covers the last day: switching it on also clears the pending PMs
  // from that window. Older threads have moved on. "auto test" names one
  // thread on purpose, so its age is not a reason.
  const hours = Number(cfg?.autoBackfillHours) || 24;
  const at = new Date(lead.postedAt || lead.foundAt || 0).getTime();
  if (!lead.autoTest && at && Date.now() - at > hours * 3600000) return `older than ${hours} hours`;
  // The cheap rules first: your kind of work, no deal-breaker, enough budget.
  if (cfg?.autoRequireMatch === true && !has(lead.category)) return 'it does not match any of your services';   // off unless you switch it on
  const broke = dealBreaker(lead, cfg);
  if (broke) return `deal-breaker in the post: "${broke}"`;
  const minBudget = Number(cfg?.autoMinBudget) || 0;
  if (minBudget > 0 && Number(lead.budgetAmount) > 0 && Number(lead.budgetAmount) < minBudget) {
    return `the budget (${lead.budget || '$' + lead.budgetAmount}) is below your minimum of $${minBudget}`;
  }
  if (!has(lead.body)) return 'the post itself was never read, so there is nothing for Claude to have screened';
  // The Claude screen.
  if (!screened(lead)) {
    return `Claude did not screen this thread${lead.draftedByNote ? ` (${lead.draftedByNote})` : ''}`;
  }
  const verdict = String(lead.aiSpecifics.pm || '').toLowerCase();
  if (verdict === 'no') return `Claude screened it out${lead.aiSpecifics.why ? `: ${lead.aiSpecifics.why}` : ''}`;
  if (verdict !== 'yes') return 'Claude gave no verdict on this thread';
  if (lead.dmLint && lead.dmLint.ok === false) return `the compliance check failed: ${(lead.dmLint.errors || []).join('; ')}`;
  if (lead.priorContact) return `you have messaged ${lead.author} before (${lead.priorContact})`;
  if (lead.pmMaybe) return `might be a duplicate: ${lead.pmMaybe}`;
  const min = Number(cfg?.autoModeMinScore) || 0;
  if ((lead.score ?? 0) < min) return `scored ${lead.score ?? 0}, below your auto-mode bar of ${min}`;
  return null;
}

/**
 * 1 to 3 minutes from now, randomised so a whole poll's worth of new threads
 * does not all fire on the same tick.
 */
export const postAt = (cfg, now = Date.now(), rand = Math.random) => now + (60 + rand() * 120) * 1000;

const open = (l) => !l.pmSent && !['SKIPPED', 'FAILED', 'EXPIRED'].includes(l.status);

/** Leads whose countdown has run out and were not held. */
export const dueNow = (leads, at = Date.now()) => (leads || []).filter((l) =>
  l.autoSendAt && !l.autoSendHeld && l.autoSendAt <= at && open(l));

/** Still counting down, for the status report. */
export const pending = (leads, at = Date.now()) => (leads || []).filter((l) =>
  l.autoSendAt && !l.autoSendHeld && l.autoSendAt > at && open(l));
