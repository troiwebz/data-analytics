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
  // Her copy (1.24.2): every PM is Audit, Plan or Specialist. Any other saved or passed style (the old
  // Points / Paragraph / Steps / Classic, or an angle's format) falls back to the per-thread pick.
  const id = HER_STYLES.includes(cfg.dmStyle) ? cfg.dmStyle : pickStyle(lead, cfg);
  const out = renderStyled(lead, cfg, DM_STYLES[id]);
  // log 1.26.0: a Want to Buy thread is not a Hire a Freelancer request
  return lead.board === 'WTB' ? out.replace(/your Hire a Freelancer request/g, 'your WTB thread').replace(/Hire a Freelancer/g, 'Want to Buy') : out;
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
export const DM_STYLES = {};   // her copy: the old Points / Paragraph / Steps formats are not shipped
export const HER_STYLES = ['audit', 'plan', 'specialist'];

// ---- 1.24 (her copy): Audit / Plan / Specialist, picked per thread --------------------------
//
// Audit: the thread links a site -> "two things stood out". Plan: a vague request -> two steps and one
// question before quoting. Specialist: an SEO request -> "SEO is what I do", one key point. The thread link
// is always in the first line. The middle is the thread's own points (Claude's screen), never invented results.
DM_STYLES.audit = {
  label: 'Audit', summary: 'site linked: two points that jump out, the order to fix them, then a written list with a price', layout: 'audit',
  tpl: `{{author}} - {re:|about this one:|your Hire a Freelancer request:} {{url}}

{I read through your post|I went over your post properly|I went through your post carefully}, "{{topic}}", {including what you linked|and looked at what you shared}. {Two points jump out straight away|A couple of points stand out before anything else}. First, {{t1}} Second, {{t2}}

{Those two matter because they shape everything that comes after|Both of those sit underneath everything else, so they come first}. {Once they are sorted,|After that,} I would {move on to|turn to} {{t3}} {That order keeps the work from being redone later|Doing it in that order means nothing has to be redone further down the line}, and you {see each part finished before the next starts|see each piece land before the next one begins}.

{There are a few more points on my list|I noted a few smaller points as well}. {If you like, I can put the full set in writing with a price to sort them|Glad to write the full set out, with a clear price for fixing them}. {One question that helps me scope it|One thing that helps me size it}: {{question}}`,
  offers: {}, payment: ''
};
DM_STYLES.plan = {
  label: 'Plan', summary: 'vague request: how she would go about it, three steps, then one question before quoting', layout: 'plan',
  tpl: `{{author}} - {re:|about this one:|your Hire a Freelancer request:} {{url}}

{Thanks for laying out|Good detail in|Clear brief in} "{{topic}}". {Before quoting, I like to set out how I would actually go about it, letting you weigh the approach rather than a number|Rather than throw a number at you, here is how I would actually go about it, letting you weigh the approach first}.

{Where I'd begin is|The starting point is} {{t1}} {That tells me quickly what is worth spending on|That shows early on where the effort is worth it}. Next, {{t2}} {Then|After that,} {{t3}} {Every step is visible to you while it happens|Every step is something you'll be able to verify yourself}.

{One thing first, so I quote it right|Before I put a number on it|To size it properly}: {{question}} {Once I have that, I'll send a scope and a price|As soon as I know, I'll come back with a scope and a price}.`,
  offers: {}, payment: ''
};
DM_STYLES.specialist = {
  label: 'Specialist', summary: 'SEO request: her specialty, the deciding part for their case, what else she would handle', layout: 'specialist',
  tpl: `{{author}} - {re:|about this one:|your Hire a Freelancer request:} {{url}}

{{specialty}} {What you described|The job you posted}, "{{topic}}", {sits right in that lane|is squarely the kind of work I take on}. {Where yours is concerned, it comes down to|For yours, it comes down to|With yours, the deciding part is} {{t1}}

{Most of the result depends on getting that right first|That is the piece the rest depends on}. {Alongside it I'd handle|Around it, I'd also take care of} {{t2bare}}, {and|as well as} {{t3}} {It is all done by me, so you deal with one person from start to finish|You deal with me directly the whole way, with no handoffs}.

{Shall I lay out how I'd tackle it, step by step?|I can lay out how I'd tackle it step by step, if useful.|Say the word and I'll lay out how I'd tackle it step by step.} {One question that helps|Useful to know first}: {{question}}`,
  offers: {}, payment: ''
};
Object.assign(LAYOUT, {
  audit: (tips) => tips.slice(0, 2).map((t) => `- ${t.replace(/\.$/, '')}`).join('\n'),
  plan: (tips) => tips.length >= 2
    ? `Where I'd begin: ${lc(tips[0])}. Next, ${lc(tips[1])}.`
    : `Where I'd begin: ${lc(tips[0] || 'what you have in place now')}.`,
  specialist: (tips) => lc(tips[0] || 'getting the basics right before anything else').replace(/\.?$/, '.')
});
function lc(t) { const x = String(t || '').trim().replace(/\.$/, ''); return x ? x[0].toLowerCase() + x.slice(1) : x; }

const SITE_LINK = /https?:\/\/(?!(?:www\.)?blackhatworld\.com)[^\s)]+|\b[a-z0-9-]+\.(?:com|net|org|io|co|in|th|uk|de|shop|store)\b/i;
export const SEO_WORDS = /\b(seo|backlinks?|link ?building|rank(?:ing|ings)?|serp|on-?page|off-?page|technical audit|site audit|local seo|gbp|google business profile|citations?|keyword research|organic traffic|guest posts?)\b/i;
/** Which of the three a thread gets: site linked -> audit; SEO asked -> specialist; else plan. */
export function pickStyle(lead) {
  const text = `${lead.title || ''} ${lead.snippet || ''} ${lead.body || ''}`;
  if (SITE_LINK.test(text)) return 'audit';
  if (SEO_WORDS.test(text)) return 'specialist';
  return 'plan';
}

export const dmStyleList = () => [
  { id: 'auto', label: 'Auto (Audit / Plan / Specialist)', summary: 'picked per thread: site linked = Audit, SEO request = Specialist, anything else = Plan' },
  ...HER_STYLES.map((id) => ({ id, label: DM_STYLES[id].label, summary: DM_STYLES[id].summary }))
];

/** Her lines are the thing itself, in her own voice: never "We have handled X" / "Our X" (same rule as claude.js). */
export function herLine(b) {
  let t = String(b || '').trim().replace(/^[\s\-*\d.]+/, '');
  if (!t || /^(you|your)\b/i.test(t)) return '';
  t = t.replace(/^(we|i)\s+(have\s+)?(already\s+)?(handled|handle|done|do|run|ran|built|build|can|could|will|know|are|am|also)\s+(how\s+to\s+)?/i, '')
       .replace(/^(our|my)\s+/i, '').replace(/^we\s+/i, '');
  t = t.replace(/\bwe\b/gi, 'I').replace(/\bour\b/gi, 'my').replace(/\bus\b/g, 'me');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

function renderStyled(lead, cfg, style) {
  const parts = partsFor(lead, cfg);
  const tips = parts.tips.map(herLine).filter(Boolean);
  const { offer, question } = parts;
  const rnd = seeded(`p${lead.threadId}`);
  const proof = PROOF[lead.category] || PROOF.generic;
  const offerText = spin(style.offers[offer] || '', `o${lead.threadId}`);
  const payment = offer === 'terms' || !style.payment ? '' : spin(style.payment.replace(/\{\{proof\}\}/g, proof), `y${lead.threadId}`);
  const q = question || spin('{Is this one site or several?|How soon does it need to be live?|What has been tried on it so far?}', `q${lead.threadId}`);
  const fill = ['what is in place now and where it is losing ground', 'the pages that matter most for the money keywords', 'tracking, so you can see each change move the numbers'];
  const t = [0, 1, 2].map((k) => lc(tips[k] || fill[k]));
  const topic = String(lead.title || 'your request').replace(/["\[\]{}|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'your request';
  const specialty = cfg.specialty || 'Search is the only thing I work on.';
  return render({ ...lead, tips: LAYOUT[style.layout](tips.slice(0, 3), rnd), question: q, offer: offerText, payment, specialty,
    t1: `${t[0]}.`, t2: `${t[1]}.`, t3: `${t[2]}.`, t2bare: t[1], topic },
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
    specifics: lead.specifics || '',
    specialty: lead.specialty || '',
    t1: lead.t1 || '', t2: lead.t2 || '', t3: lead.t3 || '', t2bare: lead.t2bare || '', topic: lead.topic || ''
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
