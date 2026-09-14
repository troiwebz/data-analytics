// Keyword matching + lead scoring.

function rx(src) { return new RegExp(src, 'i'); }

/** Pull a budget out of free text. Returns { raw, amount } or null. */
export function parseBudget(text) {
  const patterns = [
    /\$\s?([\d,]+(?:\.\d+)?)\s?(k\b)?/i,
    /\b([\d,]+)\s?(?:usd|dollars?)\b/i,
    /budget[^.\n]{0,20}?([\d,]+)/i
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (!m) continue;
    let amount = parseFloat(m[1].replace(/,/g, ''));
    if (!isFinite(amount)) continue;
    if (m[2] && /k/i.test(m[2])) amount *= 1000;
    if (amount < 5 || amount > 1_000_000) continue; // junk numbers
    return { raw: m[0].trim(), amount };
  }
  return null;
}

/**
 * Score one feed item against the config.
 * Returns null when the item should be ignored entirely.
 */
export function matchLead(item, cfg) {
  const text = `${item.title}\n${item.snippet}`;

  for (const ex of cfg.excludes) {
    if (rx(ex).test(text)) return null;
  }

  const hitCategories = [];
  const matched = [];
  for (const cat of cfg.categories) {
    // Record the text that actually matched, not the regex source — the regex
    // is unreadable in an email ("\\bda\\s?\\d+" vs "DA40").
    const hits = cat.patterns.map((p) => text.match(rx(p))).filter(Boolean);
    if (hits.length) {
      hitCategories.push({ key: cat.key, label: cat.label, hits: hits.length });
      matched.push(...hits.slice(0, 3).map((m) => m[0].trim()));
    }
  }
  if (!hitCategories.length) return null;

  // Category with the most keyword hits wins and picks the template.
  hitCategories.sort((a, b) => b.hits - a.hits);
  const primary = hitCategories[0];

  let score = 3 + Math.min(primary.hits, 4);          // base + keyword density
  if (hitCategories.length > 1) score += 1;            // multi-service job

  for (const b of cfg.boosts) {
    if (rx(b.pattern).test(text)) { score += b.weight; matched.push(b.label); }
  }

  const budget = parseBudget(text);
  if (budget) {
    score += budget.amount >= 1000 ? 5 : budget.amount >= 300 ? 3 : 1;
    matched.push(`budget:${budget.raw}`);
  }

  // Freshness matters more than anything on a job board.
  const ageMin = (Date.now() - new Date(item.postedAt).getTime()) / 60000;
  if (ageMin <= 10) score += 3;
  else if (ageMin <= 30) score += 2;
  else if (ageMin <= 120) score += 1;

  return {
    ...item,
    score,
    category: primary.key,
    categoryLabel: primary.label,
    allCategories: hitCategories.map((c) => c.key),
    matched: [...new Set(matched)].slice(0, 10),
    budget: budget ? budget.raw : '',
    budgetAmount: budget ? budget.amount : 0
  };
}
