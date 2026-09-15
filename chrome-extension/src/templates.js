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

/**
 * What Claude returned for a lead: three tips, a public question, and which of
 * the five closes to use. Falls back to the built-in rules and an offer picked
 * from the thread id, so a lead without Claude still reads like the others.
 */
export function partsFor(lead, cfg) {
  const ai = lead.aiSpecifics;
  const obj = Array.isArray(ai) ? { tips: ai } : (ai && typeof ai === 'object' ? ai : {});
  const tips = obj.tips?.length ? obj.tips.slice() : specificsBlock(lead, cfg)
    .split('\n').map((l) => l.replace(/^[\s\-*]+/, '').trim()).filter(Boolean);

  const ids = Object.keys(cfg.offers || {});
  const offer = ids.includes(obj.offer) ? obj.offer
    : ids[Math.floor(seeded(`f${lead.threadId}`)() * ids.length)] || '';
  return { tips, question: obj.question || '', offer };
}

/** Kept for callers that only want the technical lines. */
export const tipsFor = (lead, cfg) => partsFor(lead, cfg).tips;

/**
 * Numbered, always: 1. 2. 3.
 *
 * This used to rotate between dashes, numbers and prose to avoid every message
 * sharing a skeleton. Numbers were chosen instead because they read as steps in
 * an order rather than as a feature list, which is what the lines actually are.
 * Variation now lives entirely in the wording, the openers and the five closes.
 */
export function layTips(tips) {
  if (!tips.length) return '';
  if (tips.length === 1) return tips[0].replace(/\.?$/, '.');
  return tips.map((t, i) => `${i + 1}. ${t.replace(/\.$/, '')}`).join('\n');
}

/**
 * The public forum reply: one technical line, one question, then the PM.
 *
 * The question is the whole point of posting publicly. An answer to it lands on
 * the thread where everyone can see the buyer talking to you, and it is easier
 * to answer than to ignore. The offer stays in the PM, out of sight of the
 * other freelancers reading the same thread.
 */
export function renderReply(lead, cfg) {
  const { tips, question } = partsFor(lead, cfg);
  return render({ ...lead,
    tip: tips[0] ? tips[0].replace(/\.?$/, '.') : '',
    question, specifics: tips[0] || '' },
    cfg.templates[lead.category] || cfg.templates.generic || Object.values(cfg.templates)[0],
    `r${lead.threadId}`);
}

/**
 * The private message:
 *   Hi <author> → "saw your HAF thread: <url>" → three technical lines →
 *   samples and portfolio.
 * The top and bottom are common to every PM; the middle is this thread's.
 */
export function renderDm(lead, cfg) {
  const seed = `d${lead.threadId}`;
  const t = cfg.dmTemplates || {};
  const { tips, offer } = partsFor(lead, cfg);
  const offerText = spin(cfg.offers?.[offer] || '', `o${lead.threadId}`);
  return render({ ...lead, tips: layTips(tips.slice(0, 3)), offer: offerText },
    t[lead.category] || t.generic || Object.values(t)[0], seed);
}

/** Which of the five closes a lead uses, for the dashboard. */
export const offerOf = (lead, cfg) => partsFor(lead, cfg).offer;

/**
 * Drop the bold markers. The draft keeps them so the BHW editor can render a
 * real heading; anything copied, shown in a textarea or sent to Telegram wants
 * the plain words, not the asterisks.
 */
export const plain = (text) => String(text ?? '').replace(/\*\*([^*]+)\*\*/g, '$1');

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
    question: lead.question || '',
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
