import { specificsBlock } from './specifics.js';
// Reply rendering: seeded spintax, variable substitution, layout variation.
//
// Two shapes, deliberately different from each other:
//
//   Public reply   one technical line, then straight to "PM sent". Short is
//                  what gets read on a busy thread, and it gives nothing away
//                  to the other freelancers reading it.
//   Private message  the common opener (saw your thread, with the link), the
//                  three technical lines, then samples and portfolio.
//
// Every render is varied and every render is stable. Varied: the wording, the
// sentence order and the layout are all chosen from the thread id, so no two
// threads come out alike. Stable: the same thread always renders the same, so
// pressing Rebuild does not silently rewrite a reply you already read.
//
// The thing that marks text as machine-written is not vocabulary, it is
// sameness: the same skeleton every time, the same punctuation, the same three
// bullets under the same one-line intro. So the layout itself moves - bullets,
// numbers or plain prose; greeting or none; tip before the pitch or after.

/** Small deterministic PRNG, so one thread id always gives one sequence. */
function seeded(seed) {
  let h = 2166136261 >>> 0;
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return () => {
    h += 0x6d2b79f5; h = Math.imul(h ^ (h >>> 15), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
  };
}

/** {a|b|c} -> one of a, b, c. Seeded when a seed is given, random otherwise. */
export function spin(text, seed) {
  const rnd = seed == null ? Math.random : seeded(seed);
  let out = text;
  for (let i = 0; i < 8 && /\{[^{}]*\|[^{}]*\}/.test(out); i++) {
    out = out.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, group) => {
      const opts = group.split('|');
      return opts[Math.floor(rnd() * opts.length)];
    });
  }
  return out;
}

/** The technical lines available for a lead, best first. */
export function tipsFor(lead, cfg) {
  if (lead.aiSpecifics?.length) return lead.aiSpecifics.slice();
  return specificsBlock(lead, cfg)
    .split('\n')
    .map((l) => l.replace(/^[\s\-*]+/, '').trim())
    .filter(Boolean);
}

/**
 * Lay tips out in one of several shapes. A list of three under a one-line
 * intro is the single most recognisable shape in machine-written outreach, so
 * it is one option among several rather than the only one.
 */
export function layTips(tips, rnd) {
  if (!tips.length) return '';
  if (tips.length === 1) return tips[0].replace(/\.?$/, '.');
  const shape = rnd();
  if (shape < 0.34) return tips.map((t) => `- ${t}`).join('\n');
  if (shape < 0.62) return tips.map((t, i) => `${i + 1}. ${t}`).join('\n');
  // Prose: the same substance with no list at all.
  return tips.map((t, i) => {
    const s = t.replace(/\.?$/, '.');
    return i === 0 ? s : s.charAt(0).toLowerCase() + s.slice(1);
  }).join(' ').replace(/\.\s+([a-z])/g, (m, c) => `. ${c.toUpperCase()}`);
}

/** The public forum reply: one technical line, then point at the PM. */
export function renderReply(lead, cfg) {
  const seed = `r${lead.threadId}`;
  const tips = tipsFor(lead, cfg);
  return render({ ...lead, tip: tips[0] ? tips[0].replace(/\.?$/, '.') : '', specifics: tips[0] || '' },
    cfg.templates[lead.category] || cfg.templates.generic || Object.values(cfg.templates)[0], seed);
}

/**
 * The private message:
 *   Hi <author> → "saw your HAF thread: <url>" → three technical lines →
 *   samples and portfolio.
 * The top and bottom are common to every PM; the middle is this thread's.
 */
export function renderDm(lead, cfg) {
  const seed = `d${lead.threadId}`;
  const rnd = seeded(seed);
  const t = cfg.dmTemplates || {};
  const tips = tipsFor(lead, cfg).slice(0, 3);
  return render({ ...lead, tips: layTips(tips, rnd), offer: spin(cfg.dmOffer || '', `o${lead.threadId}`) },
    t[lead.category] || t.generic || Object.values(t)[0], seed);
}

/** Subject line for the DM. */
export function renderDmTitle(lead, cfg) {
  const t = render(lead, cfg.dmTitle || '{{threadTitle}}', `t${lead.threadId}`).trim();
  return (t || lead.title || 'Your thread').slice(0, 90);
}

function render(lead, tpl, seed) {
  if (!tpl) return '';

  const vars = {
    author: lead.author || 'there',
    title: lead.title || '',
    budget: lead.budget || '',
    budgetLine: lead.budget ? `Your stated budget of ${lead.budget} works for this scope.` : '',
    category: (lead.categoryLabel || lead.category || 'this').toLowerCase(),
    threadTitle: lead.title || '',
    url: lead.url || '',
    link: lead.url || '',
    tip: lead.tip || '',
    tips: lead.tips || '',
    offer: lead.offer || '',
    specifics: lead.specifics || ''
  };

  let out = spin(tpl, seed);
  out = out.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? vars[k] : ''));
  return out
    .replace(/[–—]/g, '-')     // en/em dash: the clearest AI tell there is
    .replace(/•/g, '-')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
