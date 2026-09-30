import { canonicalThreadUrl } from './feed.js';
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
  const style = DM_STYLES[cfg.dmStyle];
  if (style) return renderStyled(lead, cfg, style);
  const seed = `d${lead.threadId}`;
  const t = cfg.dmTemplates || {};
  const { tips, offer, question } = partsFor(lead, cfg);
  // No close carries the question any more - it read as an interrogation
  // dropped into a quote. The substitution below still runs twice and question
  // is still passed, so a template of your own can use it if you want it.
  const offerText = spin(cfg.offers?.[offer] || '', `o${lead.threadId}`);

  // When they pay, named against the actual work. Skipped when the "terms"
  // close is the one chosen, because that close already says it and saying it
  // twice in six lines reads as protesting rather than reassuring.
  const terms = cfg.paymentTerms || {};
  const payment = offer === 'terms'
    ? ''
    : spin(terms[lead.category] || terms.generic || '', `y${lead.threadId}`);

  return render({ ...lead, tips: layTips(tips.slice(0, 3)), question, offer: offerText, payment },
    t[lead.category] || t.generic || Object.values(t)[0], seed);
}

// ---- PM formats -----------------------------------------------------------
//
// Two accounts sending the same skeleton - same greeting, same heading, same
// numbered list, same close, same sign-off - read as one owner to a moderator
// however different the three lines are. So each account can pick a FORMAT:
// its own greeting, layout, closes, payment line and sign-off. Every format
// keeps the method (their name, their thread link, the three lines, one close,
// nothing upfront, a reply ask) and the rules (no free work, no price, no
// guarantee, plain punctuation). '' / 'classic' is your own dmTemplates.
const PROOF = {
  seo: 'the first links are live and you have checked them',
  ads: 'the ads are live and you can see them running',
  design: 'you have the first files',
  social: 'the first posts are up',
  web: 'you have clicked through the first build',
  content: 'you have read the first pieces',
  generic: 'you have seen the first part done'
};
const also = (t) => t
  .replace(/^We (can|are|will|do) /, 'We $1 also ')
  .replace(/^We have (\w+ed) /, 'We have also $1 ')
  .replace(/^We (?!can |are |will |do |have also |can also |are also |will also |do also )(\w+) /, 'We also $1 ');
const LAYOUT = {
  dash: (tips) => tips.map((t) => `- ${t.replace(/\.$/, '')}`).join('\n'),
  steps: (tips) => tips.map((t, i) => `Step ${i + 1}: ${t.replace(/\.?$/, '.')}`).join('\n'),
  prose: (tips, rnd) => tips.map((t, i) => {
    const s = t.replace(/\.?$/, '.');
    if (i === 1) return also(s);
    if (i === 2 && rnd() < 0.5) return s.replace(/^We /, 'And we ');
    return s;
  }).join(' ')
};
export const DM_STYLES = {
  points: {
    label: 'Points', summary: 'casual greeting, a short bullet list, "Cheers" close', layout: 'dash',
    tpl: `{Hey|Hi|Hello} {{author}},

{Saw your HAF post|Just saw your post on HAF|Saw your thread on HAF}: {{url}}

{We do this kind of work every week|This is the kind of job we do every week|We handle jobs like this all the time}. {A few things we can bring|Here is what we can do|What we can do for you}:
{{tips}}

{{offer}}
{{payment}}

{Want me to send over how we would handle it?|Happy to send a short plan for yours.|Want a quick plan for yours?} {Just reply here.|Reply here and I will send it.|Drop me a reply.}

{Cheers|Thanks|Best}`,
    offers: {
      pilot: '{You can start with one small order|Happy to start with a small order}, {so you see the work before going bigger|and scale up from there}.',
      ready: '{We already have everything set up for this|Our side is already set up}, {so we can start right away|so there is no waiting on setup}.',
      formula: '{We do it in that order, that is what makes it work|Doing it in that order is what makes it hold}.',
      terms: '{We can invoice after the first batch|Fine to pay after the first batch}, {so you see it done first|so you are paying for finished work}.'
    },
    payment: '{No upfront payment|Nothing upfront}. {You pay once {{proof}}|You only pay after {{proof}}}.'
  },
  paragraph: {
    label: 'Paragraph', summary: 'no heading, no list - one flowing message, no sign-off', layout: 'prose',
    tpl: `{{author}}, {saw your thread on HAF|just read your post on HAF|came across your request on HAF}: {{url}}

{{tips}} {{offer}}

{{payment}} {If that works for you, reply and we will go through the details.|Reply if you want to go through yours.|Happy to go over the specifics if you reply.}`,
    offers: {
      pilot: '{Most people start with one small order|You can start with one small order}, {so you see the quality before you commit to more|and go bigger once you are happy}.',
      ready: '{Everything is already set up on our side|We have the setup ready already}, {so we can start on your job straight away|so there is no delay getting started}.',
      formula: '{Doing it in that order is what makes it work|We always do it in that order, it saves a lot of rework}.',
      terms: '{We can bill after the first batch|Billing after the first batch is fine by us}, {so you are paying for finished work|so you see it done before paying}.'
    },
    payment: '{You do not pay anything upfront|There is no upfront payment}, {the bill comes after {{proof}}|you pay once {{proof}}}.'
  },
  steps: {
    label: 'Steps', summary: 'reads like a work plan: Step 1, Step 2, Step 3, then terms', layout: 'steps',
    tpl: `Hi {{author}},

Re your HAF thread: {{url}}

{Here is how we would run it|This is how we would handle yours|Our plan for this one}:

{{tips}}

{{payment}}
{{offer}}

{Reply and I will send examples of this exact setup.|Send a reply and I will share examples from similar jobs.|If you reply I will send a couple of examples from jobs like this.}

{Thanks|Thank you|Speak soon}`,
    offers: {
      pilot: '{Happy to start with one small order at the normal rate|We can begin with a single small order}, {then build up from there|and scale from there}.',
      ready: '{Our lists and accounts are already built|The setup is already done on our side}, {so we can begin straight away|so there is no waiting}.',
      formula: '{Those steps, in that order, are the whole method|The order of those steps is the method}.',
      terms: '{Billing can wait until the first batch is delivered|We can invoice after the first batch}.'
    },
    payment: '{Payment: nothing upfront, only after {{proof}}|No upfront payment. You pay after {{proof}}}.'
  }
};
export const dmStyleList = () => [
  { id: '', label: 'Classic', summary: 'your own PM template (Settings → Private message)' },
  ...Object.entries(DM_STYLES).map(([id, v]) => ({ id, label: v.label, summary: v.summary }))
];

function renderStyled(lead, cfg, style) {
  const { tips, offer, question } = partsFor(lead, cfg);
  const rnd = seeded(`p${lead.threadId}`);
  const proof = PROOF[lead.category] || PROOF.generic;
  const offerText = spin(style.offers[offer] || '', `o${lead.threadId}`);
  const payment = offer === 'terms' ? '' : spin(style.payment.replace(/\{\{proof\}\}/g, proof), `y${lead.threadId}`);
  return render({ ...lead, tips: LAYOUT[style.layout](tips.slice(0, 3), rnd), question, offer: offerText, payment },
    style.tpl, `d${lead.threadId}`);
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
    url: canonicalThreadUrl(lead.url || ''),
    link: canonicalThreadUrl(lead.url || ''),
    tip: lead.tip || '',
    tips: lead.tips || '',
    question: lead.question || '',
    payment: lead.payment || '',
    offer: lead.offer || '',
    specifics: lead.specifics || ''
  };

  let out = spin(tpl, seed);
  // Twice: a close is substituted in as {{offer}}, and the close itself can
  // carry {{question}}. One pass would leave that inner slot showing.
  for (let i = 0; i < 2; i++) out = out.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? vars[k] : ''));
  return out
    .replace(/[–—]/g, '-')     // en/em dash: the clearest AI tell there is
    .replace(/•/g, '-')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
