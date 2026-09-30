// Claude, called straight from the extension.
//
// The key is never written into the extension folder, never committed, and
// never sent anywhere except api.anthropic.com. Nothing else is needed: no
// server, no Apps Script.
//
// The key itself is not kept here. It lives in vault.js, on its own, so that
// nothing that resets settings or clears the database can take it with it.
// This module holds only what is cheap to recreate: model, spend limit, and
// today's usage counters.
//
// Cost is the whole design here:
//   - Claude writes ONLY the technical bullets. Greeting, offer and sign-off
//     stay templated, so output is ~70 tokens a lead instead of ~400.
//   - Leads are batched into one request, so the instructions are paid for
//     once per poll rather than once per lead.
//   - The instructions sit in a cached prefix; repeat polls read it at a tenth
//     of the input price.
//   - effort "low": this is short writing from supplied text, not reasoning.
//   - Results are stored on the lead, so a thread is never paid for twice.
//   - A daily spend limit stands Claude down rather than running up a bill.

import * as vault from './vault.js';

const API = 'https://api.anthropic.com/v1/messages';
const MODELS_API = 'https://api.anthropic.com/v1/models?limit=1';

export const MAX_LEADS = 8;        // per request
export const SNIPPET_CHARS = 700;  // the post itself, not just its first line
export const MAX_RIVALS = 4;       // the competition already on the thread
export const RIVAL_CHARS = 220;    // their claim, not their signature
export const MAX_BULLETS = 3;      // one for the public reply, three for the PM

/** Dollars per million tokens. */
export const RATES = {
  'claude-opus-5':    { in: 5, out: 25, label: 'Opus 5 — best writing' },
  'claude-sonnet-5':  { in: 2, out: 10, label: 'Sonnet 5 — balanced' },
  'claude-haiku-4-5': { in: 1, out: 5,  label: 'Haiku 4.5 — cheapest' }
};

export const AI_DEFAULTS = {
  model: 'claude-sonnet-5',
  budget: 5,           // dollars a day; 0 means no limit
  enabled: true,
  usage: {},          // today only: { day, calls, leads, in, cached, out }
  spentTotal: 0,      // dollars since the counter was last reset
  leadsTotal: 0,
  since: 0,           // when that count started (epoch ms)
  credits: 0          // what you told us you topped up, for the countdown below
};

/** Settings worth carrying to another machine; usage counters are per-machine. */
const MIRRORED = ['model', 'budget', 'enabled', 'credits'];
const pick = (o) => Object.fromEntries(MIRRORED.filter((k) => k in o).map((k) => [k, o[k]]));

export async function getAi() {
  const { ai } = await chrome.storage.local.get('ai');
  const local = { ...AI_DEFAULTS, ...(ai || {}) };

  // The daily limit's default rose from $0.50 to $1.00, then to $5.00 - $1
  // turned out too low for real use: hitting it mid-day silently drops every
  // remaining lead to the built-in generic rules, with nothing on the phone
  // saying so. Each step lifts only the untouched default it follows, once;
  // a figure you chose yourself, at any point, is never touched again. The
  // two are chained off `local` (already merged with the current stored
  // value) rather than the raw stored object, so an install still on the
  // very first default moves straight through both steps in one call.
  let bumped = false;
  if (local.budget === 0.5 && !local.budgetBumped) {
    local.budget = 1;
    local.budgetBumped = true;
    bumped = true;
  }
  if (local.budget === 1 && !local.budgetBumped2) {
    local.budget = AI_DEFAULTS.budget;
    local.budgetBumped2 = true;
    bumped = true;
  }
  if (bumped) await chrome.storage.local.set({ ai: local });

  // Older versions kept the key in here, or in the settings mirror. Move it to
  // the vault. This has to be idempotent: getAi() runs on every dashboard
  // render, chrome.storage.onChanged triggers a render, so a migration that
  // rewrites storage every time is an endless render loop. Each branch below
  // therefore removes what it migrated, and writes only when it found work.
  if (local.key) {                                   // v0.21: inside this object
    await vault.setKey(local.key);
    delete local.key;
    await chrome.storage.local.set({ ai: local });
  }

  let mirror;
  try { ({ aiSettings: mirror } = await chrome.storage.sync.get('aiSettings')); }
  catch { return local; }                            // sync off or unavailable

  if (mirror?.key) {                                 // v0.22: inside the mirror
    await vault.setKey(mirror.key);
    delete mirror.key;
    try { await chrome.storage.sync.set({ aiSettings: mirror }); }
    catch { /* the vault already has it; the stale copy is harmless */ }
  }

  // Only adopt the mirror's settings where this machine has none of its own.
  if (!ai && mirror) {
    const restored = { ...local, ...pick(mirror) };
    await chrome.storage.local.set({ ai: restored });
    return restored;
  }
  return local;
}

async function setAi(patch) {
  const next = { ...(await getAi()), ...patch };
  delete next.restored;
  await chrome.storage.local.set({ ai: next });
  // Best effort: the working copy is already saved, so a sync failure (quota,
  // sync switched off) must not fail the save.
  if (MIRRORED.some((k) => k in patch)) {
    try { await chrome.storage.sync.set({ aiSettings: pick(next) }); } catch { /* local is enough */ }
  }
  return next;
}

const today = () => new Date().toLocaleDateString('en-CA');   // local yyyy-mm-dd

/** Usage for today only; yesterday's counters read as empty. */
function usageToday(ai) {
  const u = ai.usage || {};
  return u.day === today() ? u : {};
}

export function spendOf(usage, model) {
  const r = RATES[model] || RATES['claude-sonnet-5'];
  return ((usage.in || 0) / 1e6) * r.in
       + ((usage.cached || 0) / 1e6) * (r.in * 0.1)   // cache reads are 10%
       + ((usage.out || 0) / 1e6) * r.out;
}

const round = (n, dp = 4) => Math.round(n * 10 ** dp) / 10 ** dp;

/** Everything the Settings page and the dashboard show. */
export async function aiStatus() {
  // getAi() runs the migrations that move an older key into the vault, so the
  // vault has to be read AFTER it, never alongside it. In parallel, the first
  // status check after an upgrade reads the vault before the migration lands
  // and reports "no key stored" for a key that is right there.
  const ai = await getAi();
  const key = await vault.info();
  const u = usageToday(ai);
  const spent = spendOf(u, ai.model);
  return {
    configured: key.stored,
    hint: key.hint,
    savedAt: key.savedAt,
    mirrored: key.mirrored,
    model: ai.model,
    enabled: key.stored && ai.enabled !== false,
    budget: Number(ai.budget) || 0,
    spentToday: round(spent),
    remaining: Math.max(0, round((Number(ai.budget) || 0) - spent)),
    leadsToday: u.leads || 0,
    callsToday: u.calls || 0,
    perLead: u.leads ? round(spent / u.leads, 5) : 0,
    overBudget: (Number(ai.budget) || 0) > 0 && spent >= (Number(ai.budget) || 0),

    // Anthropic has no endpoint that reports your remaining credit, and the
    // usage/cost reports need a separate Admin key. So this is our own running
    // total, counted down from the top-up figure you entered - an estimate,
    // and labelled as one everywhere it is shown.
    spentTotal: round(Number(ai.spentTotal) || 0),
    leadsTotal: Number(ai.leadsTotal) || 0,
    credits: Number(ai.credits) || 0,
    balance: round((Number(ai.credits) || 0) - (Number(ai.spentTotal) || 0), 2),
    since: Number(ai.since) || 0,

    restored: key.restored,
    local: true
  };
}

/** Check the key really works before storing it, so a typo is caught here. */
export async function saveKey(key) {
  const k = String(key || '').trim();
  if (!k) throw new Error('Paste the key first.');
  if (!/^sk-ant-/.test(k)) throw new Error('That does not look like an Anthropic key. It starts with "sk-ant-".');
  const res = await fetch(MODELS_API, { headers: headers(k) }).catch((e) => {
    throw new Error(`Could not reach Anthropic: ${e.message}`);
  });
  if (res.status === 401) throw new Error('Anthropic rejected that key. Check you copied all of it.');
  if (!res.ok) throw new Error(`Anthropic returned ${res.status}. Try again in a moment.`);
  await vault.setKey(k);
  return aiStatus();
}

export async function clearKey() {
  await vault.removeKey();
  return aiStatus();
}
export async function setBudget(v) {
  const n = Number(v);
  if (!isFinite(n) || n < 0) throw new Error('Enter a number, for example 0.25.');
  await setAi({ budget: n });
  return aiStatus();
}
export async function setModel(m) {
  if (!RATES[m]) throw new Error(`Unknown model: ${m}`);
  await setAi({ model: m });
  return aiStatus();
}
export async function setEnabled(on) { await setAi({ enabled: !!on }); return aiStatus(); }

function headers(key) {
  return {
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    // Required for calls made from a browser context.
    'anthropic-dangerous-direct-browser-access': 'true',
    'content-type': 'application/json'
  };
}

export const OFFERS = {
  pilot:   'a small paid first order, when the buyer sounds cautious, burned before, or is buying at volume for the first time',
  ready:   'the list or assets already exist, when the post is urgent, has a deadline, or complains about slow suppliers',
  formula: 'give away the method, when the post is vague, technical, or written by someone who clearly knows the subject',
  terms:   'invoice after the first batch, when the budget is large, or the post worries about being scammed'
};

// The prompt in two parts. WRITING is how the lines are written - voice,
// format, what to claim - and is yours to replace per account in Settings
// ("Claude prompt"). CONTRACT is the screen verdict and the JSON shape: auto
// mode's safety check and the parser depend on it, so it is always appended
// as it is, whatever the writing part says.
const WRITING_LINES = [
  'You write the technical middle of an outreach message about a job post on a freelancer forum.',
  'The greeting, the thread link and the closing offer are already written; you write ONLY the parts below.',
  '',
  'READ THE POST, NOT THE TITLE. The title is often a two-word label that means something else in',
  'context. "Crypto Runner" was a buyer wanting someone to run crypto ads without the accounts getting',
  'suspended - answering it with wallet and multi-chain operations reads as though you never opened the',
  'thread. Whatever the post says the work is, that is the work. If the post is missing or says nothing,',
  'stay general and claim less rather than inventing a specialism.',
  '',
  'THE REPLIES ALREADY ON THE THREAD, when you are given them, are the other freelancers bidding for this',
  'same job. Read the thread as one conversation and answer the conversation, not just the first post.',
  '- They tell you what the job really is. If three of them talk about ad accounts, it is an ads job.',
  '- Taken together they show what the buyer is being offered, and therefore what is now table stakes.',
  '- Each of them saw something in the post. Take the useful parts of what several of them noticed and',
  '  carry them into one line, rather than echoing any single reply.',
  'Match their register: short, direct, unadorned. Do not out-market them; out-specify them.',
  'Never mention them, never compare yourself to them, never imply you read their replies.',
  '',
  'You may be given a short analysis of the thread under "thread so far". It is worked out mechanically',
  'from the words used, so treat it as a pointer and not as gospel.',
  '- "all of them are already promising X" means X is now worth nothing. Do NOT lead with X.',
  '- "STILL UNANSWERED" is the part of the buyer\'s own request that nobody has addressed. That is the',
  '  opening, and it is usually where the job is won. Lead with it if you can honestly claim it.',
  '  On a thread asking to run crypto ads "and make sure they do not get suspended", three people offered',
  '  to run the ads and none of them answered suspension. The line that answers suspension wins.',
  '',
  'HONESTY. What a rival claims is evidence about the JOB, never evidence about you. Never repeat a',
  'capability back just because a rival offered it. If the unanswered part is something you have no',
  'grounds to claim - nothing in the post, and nothing in what the writer says about themselves,',
  'supports it - do not claim it. Answer the strongest part you can actually stand behind instead.',
  'A line you cannot deliver loses the client at the first question.',
  '',
  'For each thread give three things.',
  '',
  '1. "tips": exactly 3 lines, STRONGEST FIRST.',
  '   They appear under the heading "Why We Can Do It", so each states what the writer HAS DONE, CAN DO,',
  '   or KNOWS about this specific job. Every line starts with "We " - "We have", "We can", "We are",',
  '   "We run", "We handle". Never an instruction to the buyer and never a description of a deliverable',
  '   in the abstract.',
  '   Good: "We have handled iGaming ad accounts before, and know the platform restrictions in that vertical."',
  '   Good: "We can work within the compliance limits for casino creatives across the main networks."',
  '   Bad:  "Manual submissions to UAE directories." (no subject, not a claim about us)',
  '   Bad:  "You should fix your categories first." (an instruction, not our capability)',
  '   The first line IS the public reply, on its own, with nothing after it but "sent you a PM". It has to',
  '   stand alone, read like something a person typed into the thread, and be the single most convincing',
  '   thing you can say about this post. Lines 2 and 3 must add something the first did not.',
  '   Each proves the writer read that specific post.',
  '',
  '2. "question": ONE short question. It is NOT sent anywhere - not in the public reply, not in the PM.',
  '   It is the thing to ask once they answer, and it is shown on the dashboard so the writer has it ready.',
  '   Nobody on this forum opens with a question in public, and a quiz in the first message reads as an',
  '   interrogation before a price. Keep it answerable in a sentence, splitting the job into two routes',
  '   that would be built or priced differently. Never ask for the budget.',
  '   Example: "Are you after citations that survive a manual audit, or volume for a tier 2 layer?"',
  '',
  '3. "offer": pick the ONE id below that best fits this buyer.',
  ...Object.entries(OFFERS).map(([id, when]) => `   ${id} - ${when}`),
  '',
  'Rules for everything you write:',
  '- Name the actual deliverable, platform, market or constraint the poster asked for.',
  '- Concrete and checkable. "Manual submissions to directories that index in the UAE" beats "high quality citations".',
  '- No praise, no restating their request back to them, no filler.',
  '- Plain words. Never use an em dash, en dash or bullet glyph. Use ordinary hyphens and full stops.',
  '- Never promise a specific price, a discount, a guarantee, or a ranking result.',
  '- NEVER offer free work of any kind: no free trial, sample, demo, test, audit or "no charge".',
  '- Under 100 characters each. Short is better.',
  '- British or neutral English, lower-key than marketing copy.',
  '',
  'TONE. This is a quote to a buyer who has already decided what they want. You are not their adviser.',
  '- Never warn them, caution them, or tell them their plan is risky, difficult or a bad idea.',
  '- Never mention terms of service, policies, rules, bans, legality or what a platform allows.',
  '  A line like "bulk creation breaches Google\'s ToS" loses the job and reads as a lecture.',
  '- Never ask them to justify or clarify why they want it. What they do with it is their business.',
  '- Never hedge: no "usually", "typically", "can be tricky", "it depends", "worth noting", "bear in mind".',
  '- State capability, not difficulty. "We create these in batches that hold" beats',
  '  "these usually get flagged".',
  '- Where a job is genuinely hard, say what you do about it, never that it is hard.',
  'Each line is a full sentence that reads correctly on its own, with no leading dash or number:',
  'they are numbered 1. 2. 3. when they are laid out.'
];
const CONTRACT_LINES = [
  'SCREEN. For each thread also decide whether a private message from a provider is welcome.',
  'This verdict is for the operator and is never shown to the buyer.',
  '- "pm":"yes" when the poster genuinely wants to hire someone or to buy a service or work - a job, a task, a',
  '  service, at any budget, in any country, on any payment terms.',
  '- "pm":"no" only when it is not a request at all: a seller advertising their own service, a moderator or',
  '  rules post, a discussion or a question with no job in it, or a thread that says not to PM.',
  '- "why": the reason, under 12 words.',
  '',
  'Return ONLY a JSON object mapping each thread id to',
  '{"tips":[3 strings],"question":"...","offer":"id","pm":"yes" or "no","why":"..."}.',
  'Example: {"1847904":{"tips":["...","...","..."],"question":"...","offer":"formula","pm":"yes","why":"asks for a Google Ads manager"}}'
];
export const DEFAULT_WRITING = WRITING_LINES.join('\n');
export const LOCKED_PROMPT = CONTRACT_LINES.join('\n');
const SYSTEM = [...WRITING_LINES, '', ...CONTRACT_LINES].join('\n');
export const MAX_WRITING = 12000;

// Three ready-made angles for Settings → Claude prompt. Each is the built-in
// prompt, every rule intact, plus one paragraph that changes only what line 1
// leads with and how the three lines are shared out. Pick one per account so
// two accounts answering the same thread never read alike.
const angle = (title, text) => `${DEFAULT_WRITING}\n\nANGLE FOR THIS ACCOUNT - ${title}.\n${text}\n`
  + 'Every rule above still applies in full. The angle decides only what leads and how the 3 lines divide the work.';
export const ANGLES = [
  { id: 'proof', label: 'Proof first', format: 'points', summary: 'leads with the closest thing we have done to this exact job',
    text: angle('PROOF FIRST', [
      'Line 1 states, as a plain fact, the closest thing we have already done to this exact job: the same market,',
      'platform, niche or volume. Only what "About the writer" or the post supports; with nothing to go on, state',
      'the capability instead and never invent a past client or a number.',
      'Line 2 answers the hardest constraint in the post. Line 3 names the deliverable exactly as they would check it.'
    ].join('\n')) },
  { id: 'gap', label: 'The missing piece', format: 'paragraph', summary: 'leads with the part of the request nobody on the thread has answered',
    text: angle('THE MISSING PIECE', [
      'Line 1 answers the part of the buyer\'s request that no reply on the thread has addressed yet (see',
      '"STILL UNANSWERED"). With no replies, or nothing unanswered, it answers the part the post stresses most.',
      'Never lead with anything the other replies already promise. Lines 2 and 3 show we also cover the rest',
      'of the job, most important first.'
    ].join('\n')) },
  { id: 'method', label: 'How we deliver', format: 'steps', summary: 'leads with the concrete steps, sources and checks of the work',
    text: angle('HOW WE DELIVER', [
      'Each line names one concrete part of how we would do this exact job, in the order we would do it:',
      'line 1 the step that decides whether it works, line 2 how we build or source it (named platforms,',
      'sources, tools), line 3 how the buyer can see it is done right (report, live links, proof of placement).',
      'No timelines, no prices, no guarantees.'
    ].join('\n')) }
];

/**
 * The rules, checked on what came back - so a preview shows at a glance
 * whether an angle kept them. Returns a list of problems ('' problems = clean).
 */
export function checkLines(tips = []) {
  const out = [];
  if (tips.length !== 3) out.push(`${tips.length} line(s), not 3`);
  tips.forEach((t, i) => {
    const n = i + 1;
    if (!/^We\s/.test(t)) out.push(`line ${n} does not start with "We"`);
    if (t.length > 100) out.push(`line ${n} is ${t.length} characters (over 100)`);
    if (/[\u2014\u2013\u2022]/.test(t)) out.push(`line ${n} has a dash or bullet glyph`);
    if (/\b(free|trial|sample|no charge|demo)\b/i.test(t)) out.push(`line ${n} offers free work`);
    if (/\b(usually|typically|it depends|worth noting|bear in mind|can be tricky)\b/i.test(t)) out.push(`line ${n} hedges`);
    if (/\b(terms of service|ToS|policy|policies|banned|illegal|against the rules)\b/i.test(t)) out.push(`line ${n} mentions rules or policy`);
    if (/\b(guarantee|guaranteed|\$\s?\d|discount)\b/i.test(t)) out.push(`line ${n} promises a price, discount or guarantee`);
  });
  return out;
}

/**
 * The prompt Claude gets: your writing part when you set one (with
 * {{account}} filled in), else the built-in, then the locked part.
 */
export function promptBase(writing, account = '') {
  const mine = String(writing || '').trim().slice(0, MAX_WRITING);
  if (!mine) return SYSTEM;
  const text = mine.replace(/\{\{\s*account\s*\}\}/gi, String(account || '').trim() || 'us');
  return `${text}\n\n${LOCKED_PROMPT}\n`
    + `The "offer" id must be one of: ${Object.keys(OFFERS).join(', ')}. The "tips" array holds exactly 3 strings.`;
}

/**
 * leads: [{ threadId, title, snippet, category }]
 * returns { specifics: { [threadId]: [bullet, ...] }, note }
 * Never throws: on any failure the caller falls back to the built-in rules.
 */
/**
 * The seller's own description of the business, if they wrote one. It goes in
 * the cached system prefix rather than the per-thread message, so it is paid
 * for once per poll and read at a tenth of the price after that.
 */
export function systemFor(brief, rules, writing = '', account = '') {
  const SYSTEM = promptBase(writing, account);
  const note = String(brief || '').trim().slice(0, 1200);
  const mine = String(rules || '').trim().slice(0, 1200);
  // The operator's own screen rules outrank the general ones: they know which
  // buyers waste their time, and a wrong "yes" here sends a real message.
  const screen = mine ? '\n\nTHE OPERATOR\'S SCREEN RULES. Apply these to the "pm" verdict before anything else.\n'
    + 'If any of them applies to a thread, that thread is "pm":"no", and "why" names the rule:\n' + mine : '';
  if (!note) return SYSTEM + screen;
  return SYSTEM + screen + '\n\n'
    + 'ABOUT THE WRITER. Their own words, and the most important thing you have:\n'
    + note + '\n'
    + 'Use it to decide what "we" can honestly claim, which of the five offers fits, and what to say\n'
    + 'when the thread is vague. Never quote it back at the buyer or restate it as marketing.\n'
    + 'Where it conflicts with the rules above, the rules win.';
}

export async function writeSpecifics(leads, cfg = {}) {
  const ai = await getAi();                 // migrations first, then the vault
  const key = await vault.getKey();
  if (!key) return { specifics: {}, note: 'no Claude key set' };
  if (ai.enabled === false) return { specifics: {}, note: 'Claude switched off' };
  if (!leads || !leads.length) return { specifics: {} };

  const budget = Number(ai.budget) || 0;
  if (budget > 0 && spendOf(usageToday(ai), ai.model) >= budget) {
    return { specifics: {}, note: `daily limit of $${budget.toFixed(2)} reached; using built-in rules until tomorrow` };
  }

  const batch = leads.slice(0, MAX_LEADS);
  const threads = batch.map((l) => {
    // The thread page beats the feed description, which beats nothing. A lead
    // found on a listing page has no description at all, which is how a title
    // ended up being the whole brief.
    const post = String(l.body || l.snippet || '').replace(/\s+/g, ' ').slice(0, SNIPPET_CHARS);
    const lines = [
      `id: ${l.threadId}`,
      `service area: ${l.category || 'unknown'}`,
      `title: ${String(l.title || '').slice(0, 200)}`,
      `post: ${post || '(not available - go on the title alone and claim less)'}`
    ];
    const rivals = (l.replies || []).slice(0, MAX_RIVALS)
      .map((r) => `- ${String(r.text || '').replace(/\s+/g, ' ').slice(0, RIVAL_CHARS)}`)
      .filter((x) => x.length > 4);
    if (rivals.length) lines.push(`already replied by other freelancers (${rivals.length}):`, ...rivals);
    if (l.rivalBrief) lines.push('thread so far:', l.rivalBrief);
    return lines.join('\n');
  }).join('\n\n---\n\n');

  const body = {
    model: ai.model,
    max_tokens: 170 * batch.length + 60,
    system: [{ type: 'text', text: systemFor(cfg.brief, cfg.screenRules, cfg.claudeWriting, cfg.boundAccount), cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: threads }]
  };

  // fetch has no timeout of its own. A request that stalls would leave
  // whatever asked for it waiting for ever, with nothing in the log.
  let res, data;
  const ctl = new AbortController();
  const bail = setTimeout(() => ctl.abort(), 45000);
  try {
    res = await fetch(API, { method: 'POST', headers: headers(key), body: JSON.stringify(body), signal: ctl.signal });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    return { specifics: {}, note: e.name === 'AbortError' ? 'Anthropic did not answer within 45 seconds' : `could not reach Anthropic: ${e.message}` };
  } finally {
    clearTimeout(bail);
  }
  if (!res.ok) {
    const m = (data.error && data.error.message) || `HTTP ${res.status}`;
    return { specifics: {}, note: res.status === 401 ? 'Anthropic rejected the key' : m.slice(0, 160) };
  }
  if (data.stop_reason === 'refusal') return { specifics: {}, note: 'Claude declined this batch' };

  await recordUsage(data.usage, batch.length);

  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const specifics = clean(parseObject(text));
  return { specifics, used: batch.length };
}

/** The model may wrap JSON in prose or a fence; take the outermost object. */
export function parseObject(text) {
  const s = String(text || '');
  const start = s.indexOf('{'), end = s.lastIndexOf('}');
  if (start === -1 || end <= start) return {};
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return {}; }
}

/** Enforce what the prompt asked for; a prompt is a request, not a guarantee. */
export function clean(obj) {
  const out = {};
  for (const id of Object.keys(obj || {})) {
    const v = obj[id];
    // Tolerate the older bare-array shape as well as the current object.
    const raw = Array.isArray(v) ? { tips: v } : (v && typeof v === 'object' ? v : {});
    const tips = (Array.isArray(raw.tips) ? raw.tips : [])
      // Filter before rewriting as well as after: asClaim turns "Happy to send
      // you a demo" into "We handle happy to send you a demo", which reads as
      // nonsense and hides the thing that should have dropped it.
      .filter(allowed)
      .map(asClaim)
      .filter((b) => b.length > 15 && b.length <= 170)
      .filter(allowed)
      .slice(0, MAX_BULLETS);
    if (!tips.length) continue;

    const question = (() => {
      const q = tidy(raw.question);
      if (!q || q.length < 15 || q.length > 180 || !allowed(q)) return '';
      return /\?$/.test(q) ? q : q + '?';
    })();

    // The screen: an explicit yes or no, or nothing. Anything else - a missing
    // field, "maybe", a sentence - is no verdict, and no verdict never sends.
    const said = String(raw.pm ?? '').trim().toLowerCase();
    const pm = raw.pm === true || said === 'yes' ? 'yes' : raw.pm === false || said === 'no' ? 'no' : '';
    const why = tidy(raw.why).slice(0, 120);
    out[String(id)] = { tips, question, offer: raw.offer in OFFERS ? raw.offer : '', pm, why };
  }
  return out;
}

/**
 * The lines sit under "Why We Can Do It", so they have to read as claims about
 * us. The prompt asks for that; this is what enforces it when a line comes back
 * as a bare noun phrase or an instruction to the buyer.
 */
function asClaim(b) {
  const t = tidy(b);
  if (!t) return '';
  if (/^we\b/i.test(t)) return t.charAt(0).toUpperCase() + t.slice(1);
  if (/^(you|your)\b/i.test(t)) return '';            // an instruction, not a capability
  const lower = t.charAt(0).toLowerCase() + t.slice(1);
  return /^(have|can|are|handle|run|know|do)\b/i.test(lower)
    ? `We ${lower}`
    : `We handle ${lower}`;
}

const tidy = (b) => String(b ?? '')
  .replace(/[\u2013\u2014]/g, '-')     // en/em dash
  .replace(/\u2022/g, '-')             // bullet glyph
  .replace(/^[\s\-*]+/, '')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * The prompt forbids these; the filter is what actually enforces it. A prompt
 * is a request, and the lecturing ones in particular slip through: a model
 * asked about bulk account creation reaches for a caveat by reflex, and a
 * caveat aimed at the buyer loses the job.
 */
const allowed = (b) =>
  !/\b(guarantee|guaranteed|discount|\d+% off)\b/i.test(b) &&
  !/\bfree\s+(trial|sample|test|audit|demo|work|of charge)\b/i.test(b) &&
  !/\b(for free|no charge|at no cost)\b/i.test(b) &&
  // An offer of any kind belongs in the close, not in a capability line.
  !/\b(demos?|trials?)\b/i.test(b) &&
  !/\b(send|share|give|offer|provide)\w*\s+(you\s+)?(a\s+|some\s+)?(sample|example|preview)/i.test(b) &&
  !LECTURE.test(b);

/**
 * Policy commentary, warnings and hedges. All three lose the job: a buyer who
 * has decided what they want is not asking whether they should want it.
 */
const LECTURE = new RegExp([
  // policy and legality, never ours to raise in a sales message
  'terms of service', 'tos\\b', 'policies?\\b', 'against (google|facebook|meta|tiktok)',
  'not allowed', 'prohibited', 'breach\\w*', 'violat\\w*', 'illegal', 'legality', 'compliance risk',
  'suspension', 'banned\\b', 'get(s|ting)? flagged',
  // warnings aimed at the buyer
  'be aware', 'bear in mind', 'worth (noting|clarifying|checking|considering)', 'keep in mind',
  'caution', 'risky', 'a bad idea', 'advise against', 'make sure you', 'you should (be|know|consider)',
  // hedges
  'usually', 'typically', 'tends? to', 'can be tricky', 'it depends', 'no guarantees'
].map((w) => `\\b${w}\\b`).join('|'), 'i');

async function recordUsage(usage, leadCount) {
  if (!usage) return;
  const ai = await getAi();
  const day = today();
  const prev = ai.usage && ai.usage.day === day ? ai.usage : { day, calls: 0, leads: 0, in: 0, cached: 0, out: 0 };

  // This call's own cost, priced at the model that just ran, so switching
  // models later cannot retroactively change what has already been spent.
  const cost = spendOf({
    in: (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0),
    cached: usage.cache_read_input_tokens || 0,
    out: usage.output_tokens || 0
  }, ai.model);

  await setAi({
    usage: {
      day,
      calls: prev.calls + 1,
      leads: prev.leads + leadCount,
      in: prev.in + (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0),
      cached: prev.cached + (usage.cache_read_input_tokens || 0),
      out: prev.out + (usage.output_tokens || 0)
    },
    spentTotal: (Number(ai.spentTotal) || 0) + cost,
    leadsTotal: (Number(ai.leadsTotal) || 0) + leadCount,
    since: ai.since || Date.now()
  });
}

/** Record a top-up, so the balance estimate counts down from the right number. */
export async function addCredits(amount) {
  const n = Number(amount);
  if (!isFinite(n) || n <= 0) throw new Error('Enter the amount you added, for example 5.');
  const ai = await getAi();
  await setAi({ credits: (Number(ai.credits) || 0) + n });
  return aiStatus();
}

/** Start the running total again, e.g. after reconciling with the real bill. */
export async function resetSpend() {
  await setAi({ spentTotal: 0, leadsTotal: 0, credits: 0, since: Date.now() });
  return aiStatus();
}

/**
 * One real call on a sample thread, so "is this actually Claude?" can be
 * answered by looking rather than by trusting. Costs a fraction of a cent.
 */
export async function testCall(cfg = {}) {
  const before = await aiStatus();
  if (!before.configured) return { ok: false, error: 'No key stored. Paste one and press Save key first.' };
  const started = Date.now();
  const { specifics, note } = await writeSpecifics([{
    threadId: 'test',
    category: 'seo',
    title: 'Need local citation building for a Dubai clinic, also ranking in the UK',
    snippet: 'We have a clinic in Dubai and a second location in Manchester. Need consistent NAP '
           + 'across directories that actually get indexed locally, plus GMB cleanup. Budget $400.'
  }], cfg);
  const after = await aiStatus();
  return {
    ok: !!specifics.test,
    bullets: specifics.test || [],
    note,
    ms: Date.now() - started,
    model: after.model,
    cost: Math.round((after.spentToday - before.spentToday) * 1e6) / 1e6
  };
}

/**
 * One free-form call, for tools that are not drafting a lead (Thread Lab).
 * Same key, same model, same daily limit and the same spend counter as
 * everything else, so the dashboard's Claude tiles stay true.
 */
export async function askClaude(system, user, { maxTokens = 2500, timeoutMs = 90000 } = {}) {
  const ai = await getAi();
  const key = await vault.getKey();
  if (!key) throw new Error('no Claude key saved - Settings → Anthropic API key');
  if (ai.enabled === false) throw new Error('Claude is switched off in Settings');
  const budget = Number(ai.budget) || 0;
  if (budget > 0 && spendOf(usageToday(ai), ai.model) >= budget) throw new Error(`today's Claude limit of $${budget.toFixed(2)} is used up`);
  const ctl = new AbortController();
  const bail = setTimeout(() => ctl.abort(), timeoutMs);
  let res, data;
  try {
    res = await fetch(API, { method: 'POST', headers: headers(key), signal: ctl.signal,
      body: JSON.stringify({ model: ai.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }) });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? `Anthropic did not answer within ${timeoutMs / 1000} seconds` : `could not reach Anthropic: ${e.message}`);
  } finally { clearTimeout(bail); }
  if (!res.ok) throw new Error(res.status === 401 ? 'Anthropic rejected the key' : String(data?.error?.message || `HTTP ${res.status}`).slice(0, 200));
  if (data.stop_reason === 'refusal') throw new Error('Claude declined this one');
  const before = spendOf(usageToday(await getAi()), ai.model);
  await recordUsage(data.usage, 0);
  const cost = spendOf(usageToday(await getAi()), ai.model) - before;
  return { text: (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''), cost: round(cost, 5), model: ai.model,
           stop: data.stop_reason || '', outTokens: data.usage?.output_tokens || 0 };
}

/** The stored key, for copying into a password manager. Never logged. */
export const revealKey = () => vault.getKey();

/** Wipe settings and the local database; the Claude key is kept. */
export const factoryReset = () => vault.resetKeepingVault();
