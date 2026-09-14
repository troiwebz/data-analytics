/**
 * Lints a draft against the BHW rules in Config.gs.
 * Returns { ok, errors: [], warnings: [] }. Never throws.
 */
function lintDraft_(draft) {
  const text = String(draft || '');
  const errors = [];
  const warnings = [];
  const rx = function (p) { return new RegExp(p, 'i'); };

  (COMPLIANCE.mustInclude || []).forEach(function (r) {
    if (!rx(r.pattern).test(text)) errors.push('missing: ' + (r.label || r.pattern));
  });
  (COMPLIANCE.mustAppearEarly || []).forEach(function (r) {
    const m = text.match(rx(r.pattern));
    if (!m) errors.push('missing: ' + (r.label || r.pattern));
    else if (m.index > (r.within || 150)) errors.push('not at top: ' + (r.label || r.pattern));
  });
  (COMPLIANCE.banned || []).forEach(function (p) {
    if (rx(p).test(text)) errors.push('banned phrase: "' + p + '"');
  });
  (COMPLIANCE.warn || []).forEach(function (p) {
    if (rx(p).test(text)) warnings.push('check: "' + p + '"');
  });

  return { ok: errors.length === 0, errors: errors, warnings: warnings };
}

function complianceSummary_(lint) {
  if (!lint) return '';
  const parts = [];
  if (lint.errors.length) parts.push('❌ ' + lint.errors.join(' · '));
  if (lint.warnings.length) parts.push('⚠️ ' + lint.warnings.join(' · '));
  return parts.join('\n');
}
