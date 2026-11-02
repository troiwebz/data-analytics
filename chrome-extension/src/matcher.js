// Keyword matching + lead scoring.

function rx(src) { return new RegExp(src, 'i'); }

/**
 * Is this a thread that should never become a lead at all - a mod/rules
 * sticky, or one you named yourself - rather than one that simply failed to
 * match a category (those still get recorded, with a generic draft).
 *
 * Three independent gates, any one of which is enough:
 *   - its thread id is in cfg.excludeThreadIds (the durable, exact way to
 *     silence one specific thread forever, however its content changes)
 *   - its author is in cfg.excludeAuthors (case-insensitive - staff/mod
 *     accounts that post the same kind of thread over and over)
 *   - the forum listing marked it sticky/pinned (structItem--sticky) - the
 *     general case, so a NEW mod thread is caught without you naming it
 */
export function isExcludedThread(item, cfg) {
  if (!item) return false;
  const ids = (cfg?.excludeThreadIds || []).map(String);
  if (ids.includes(String(item.threadId))) return true;
  const authors = (cfg?.excludeAuthors || []).map((a) => String(a).toLowerCase());
  if (item.author && authors.includes(String(item.author).toLowerCase())) return true;
  if (item.sticky) return true;
  return false;
}

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

  // A pattern is either a bare regex string or { p, w } with a weight. Weights
  // let a strong signal outrank an ambiguous word: "TikTok USA Poster" is
  // someone posting from US accounts, not a print job, so \btiktok\b (w:3)
  // has to beat "poster".
  const hitCategories = [];
  const matched = [];
  for (const cat of cfg.categories) {
    let weight = 0;
    const hits = [];
    for (const raw of cat.patterns) {
      const src = typeof raw === 'string' ? raw : raw.p;
      const w = typeof raw === 'string' ? 1 : (raw.w ?? 1);
      const m = text.match(rx(src));
      if (m) { hits.push(m); weight += w; }
    }
    if (hits.length) {
      hitCategories.push({ key: cat.key, label: cat.label, hits: hits.length, weight });
      // Record the text that actually matched, not the regex source — the
      // regex is unreadable in a card ("\\bda\\s?\\d+" vs "DA40").
      matched.push(...hits.slice(0, 3).map((m) => m[0].trim()));
    }
  }
  if (!hitCategories.length) return null;

  // Heaviest category wins and picks the template; keyword count breaks ties.
  hitCategories.sort((a, b) => b.weight - a.weight || b.hits - a.hits);
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
