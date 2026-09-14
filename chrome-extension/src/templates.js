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
  const tpl = cfg.templates[lead.category] || Object.values(cfg.templates)[0];
  if (!tpl) return '';

  const budgetLine = lead.budget
    ? `• Your stated budget of ${lead.budget} works for this scope\n`
    : '';

  const vars = {
    author: lead.author || 'there',
    title: lead.title || '',
    budget: lead.budget || '',
    budgetLine,
    category: (lead.categoryLabel || lead.category || 'this').toLowerCase(),
    link: lead.url || ''
  };

  let out = spin(tpl);
  out = out.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? vars[k] : ''));
  return out.replace(/\n{3,}/g, '\n\n').trim();
}
