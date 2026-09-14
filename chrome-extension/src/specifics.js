// Turns a thread into the two or three lines that prove you read it.
//
// The category templates answer "what do you do"; these answer "have you done
// THIS". A thread asking for local citations in Dubai and the UK should not be
// met with "full audit, on-page fixes" — it should name directories, NAP
// consistency, and the fact that it is two markets, not one.

const rx = (p) => new RegExp(p, 'i');

/** Places named in the thread, in the order a human would list them. */
export function detectGeos(text, geoPatterns = []) {
  const found = [];
  for (const g of geoPatterns) {
    const m = String(text).match(rx(g.p));
    if (m) found.push({ label: g.label, at: m.index ?? 0 });
  }
  return found.sort((a, b) => a.at - b.at).map((g) => g.label);
}

/** "Dubai", "Dubai and the UK", "Dubai, the UK and Germany" */
export function geoPhrase(geos) {
  if (!geos.length) return '';
  if (geos.length === 1) return geos[0];
  return geos.slice(0, -1).join(', ') + ' and ' + geos[geos.length - 1];
}

/**
 * Bullets for this thread: the first matching rule wins, otherwise the
 * category's own default bullets. {{geo}} inside a bullet is replaced with the
 * places named in the thread, and a bullet that needs a geo is dropped when
 * none was named rather than shipping an empty phrase.
 */
export function buildSpecifics(lead, cfg) {
  const spec = cfg.specifics || {};
  const text = `${lead.title || ''}\n${lead.snippet || ''}`;
  const geos = detectGeos(text, spec.geoPatterns || []);
  const geo = geoPhrase(geos);

  let bullets = null;
  for (const rule of spec.rules || []) {
    if (rx(rule.p).test(text)) { bullets = rule.bullets; break; }
  }
  if (!bullets) bullets = (spec.defaults || {})[lead.category] || (spec.defaults || {}).generic || [];

  const out = bullets
    .filter((b) => geo || !b.includes('{{geo}}'))
    .map((b) => b.replace(/\{\{geo\}\}/g, geo));

  // Two markets is a different job from one; say so when they named both.
  if (geos.length > 1 && spec.multiGeoBullet) {
    out.push(spec.multiGeoBullet.replace(/\{\{geo\}\}/g, geo));
  }
  return out;
}

/** The bullets as a block, ready to drop into a template. */
export function specificsBlock(lead, cfg) {
  return buildSpecifics(lead, cfg).map((b) => `- ${b}`).join('\n');
}
