// BHW rule check, run in the extension so the rules live in one place
// (Options) and the Apps Script relay never needs to change.
// Returns { ok, errors: [], warnings: [] }; never throws.
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
