import { specificsBlock } from './specifics.js';
// Reply rendering: spintax + variable substitution.

/** {a|b|c} -> one of a, b, c. Handles nesting by repeated passes. */
export function spin(text) {
  let out = text;
  for (let i = 0; i < 8 && /\{[^{}]*\|[^{}]*\}/.test(out); i++) {
    out = out.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, group) => {
      const opts = group.split('|');
      return opts[Math.floor(Math.random() * opts.length)];
    });
  }
  return out;
}

export function renderReply(lead, cfg) {
  // Claude's bullets when we have them, the built-in rules when we don't.
  const block = lead.aiSpecifics?.length
    ? lead.aiSpecifics.map((b) => `- ${b}`).join('\n')
    : specificsBlock(lead, cfg);
  return render({ ...lead, specifics: block },
                cfg.templates[lead.category] || cfg.templates.generic || Object.values(cfg.templates)[0]);
}

/**
 * The private message to the thread author:
 *   Hi <author> → "I just saw your HAF thread: <url>" → the public reply
 *   verbatim → the shared offer.
 * Reuses lead.draft when present so the PM quotes exactly what was posted.
 */
export function renderDm(lead, cfg) {
  const t = cfg.dmTemplates || {};
  const reply = forPm(lead.draft || renderReply(lead, cfg));
  const offer = spin(cfg.dmOffer || '');
  return render({ ...lead, reply, offer }, t[lead.category] || t.generic || Object.values(t)[0]);
}

/**
 * The public reply, trimmed for quoting inside a PM: its greeting is a
 * duplicate of the PM's own, and "PMing you now" makes no sense in the PM.
 */
function forPm(reply) {
  return String(reply)
    // The PM has its own greeting.
    .replace(/^\s*(hi|hey|hello)\b[^\n]*\n+/i, '')
    // "PMing you now" makes no sense to someone reading the PM.
    .replace(/\s*\b(dropping you a pm|sending (?:you )?a pm|pming you(?: the details| now)?)\b[^.\n]*\.?/gi, '')
    // The PM closes with the portfolio offer — don't say it twice.
    .replace(/^[^\n]*\b(portfolio|samples|case studies|client results|live examples)\b[^\n]*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Subject line for the DM. */
export function renderDmTitle(lead, cfg) {
  const t = render(lead, cfg.dmTitle || '{{threadTitle}}').trim();
  return (t || lead.title || 'Your thread').slice(0, 90);
}

function render(lead, tpl) {
  if (!tpl) return '';

  const budgetLine = lead.budget
    ? `- Your stated budget of ${lead.budget} works for this scope\n`
    : '';

  const vars = {
    author: lead.author || 'there',
    title: lead.title || '',
    budget: lead.budget || '',
    budgetLine,
    category: (lead.categoryLabel || lead.category || 'this').toLowerCase(),
    threadTitle: lead.title || '',
    url: lead.url || '',
    link: lead.url || '',
    reply: lead.reply || '',
    offer: lead.offer || '',
    specifics: lead.specifics || ''
  };

  let out = spin(tpl);
  out = out.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? vars[k] : ''));
  return out.replace(/\n{3,}/g, '\n\n').trim();
}
