// BHW rule check, run in the extension so the rules live in one place
// (Options) and the Apps Script relay never needs to change.
// Returns { ok, errors: [], warnings: [] }; never throws.
/**
 * Text that belongs to the bot, not to a buyer.
 *
 * The editor card on Telegram carries a line saying what is being edited and
 * how to copy it, and the draft sits underneath. Tapping the code block copies
 * only the draft - but long-pressing the message and choosing Copy takes the
 * whole thing, instructions included. Pasted back, that became the draft, and
 * a buyer received "Editing the DM - Tap the text to copy it, paste it back"
 * above the pitch.
 *
 * Every one of these is text this extension wrote for you to read. None of it
 * can ever be right in a message to a buyer, so its presence is treated as
 * proof that something was copied that should not have been.
 */
export const BOT_MARKERS = [
  /\u270f\ufe0f?\s*Editing the (DM|post)\b/i,
  /Tap the text to copy it/i,
  /\(tap to copy\)/i,
  /Send \/cancel to leave it/i,
  /Leave it as it is/i,
  /paste it back, change what you like and send/i,
  /^\s*\u{1F4CB}\s*Public reply/imu,
  /\u2709\ufe0f?\s*PM to /i,
  /Your BHW inbox/i,
  /\u{1F319}\s*Night mode:/iu,
  /Might already be a duplicate/i,
  /full text is on the dashboard/i
];

/**
 * Strip the bot's own wrapper off text pasted back from Telegram.
 *
 * Only ever removes whole lines that are unmistakably ours, so a buyer-facing
 * line is never touched. Returns what is left and what was taken, because a
 * silent repair of something this wrong would hide the mistake rather than
 * surface it.
 */
export function stripBotText(text) {
  const lines = String(text || '').split('\n');
  const removed = [];
  const kept = lines.filter((line) => {
    const hit = BOT_MARKERS.some((re) => re.test(line));
    if (hit) removed.push(line.trim());
    return !hit;
  });
  return { text: kept.join('\n').replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n').trim(), removed };
}

/**
 * The last gate before anything leaves for a buyer.
 *
 * Deliberately not part of lintDraft's configurable rules: those are yours to
 * tune and can be switched off, and this must not be. It is not an opinion
 * about wording - it is a hard stop on sending the extension's own interface
 * to a customer.
 */
export function botTextIn(text) {
  const t = String(text || '');
  for (const re of BOT_MARKERS) {
    const m = t.match(re);
    if (m) return m[0].trim().slice(0, 60);
  }
  return '';
}

export function lintDraft(text, rules = {}) {
  const t = String(text || '');
  const errors = [], warnings = [];
  const rx = (p) => new RegExp(p, 'i');
  for (const r of rules.mustInclude || []) if (!rx(r.pattern).test(t)) errors.push(`missing: ${r.label || r.pattern}`);
  for (const r of rules.mustAppearEarly || []) {
    const m = t.match(rx(r.pattern));
    if (!m) errors.push(`missing: ${r.label || r.pattern}`);
    else if (m.index > (r.within || 150)) errors.push(`not at top: ${r.label || r.pattern}`);
  }
  for (const p of rules.banned || []) if (rx(p).test(t)) errors.push(`banned phrase: "${p}"`);
  for (const p of rules.warn || []) if (rx(p).test(t)) warnings.push(`check: "${p}"`);
  return { ok: errors.length === 0, errors, warnings };
}

export function lintSummary(lint) {
  if (!lint) return '';
  const parts = [];
  if (lint.errors?.length) parts.push('❌ ' + lint.errors.join(' · '));
  if (lint.warnings?.length) parts.push('⚠️ ' + lint.warnings.join(' · '));
  return parts.join('\n');
}
