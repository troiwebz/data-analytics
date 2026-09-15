// Claude, called straight from the extension.
//
// The key is never written into the extension folder, never committed, and
// never sent anywhere except api.anthropic.com. Nothing else is needed: no
// server, no Apps Script.
//
// It is kept in two places at once. chrome.storage.local is the working copy.
// chrome.storage.sync holds a mirror, which belongs to the Chrome profile
// rather than to this copy of the extension, so the key survives a reload, a
// `git pull`, removing and re-adding the folder, loading it from a new path
// (which gives the extension a new id and an empty local store), and a fresh
// machine signed into the same Chrome. getAi() re-fills local from the mirror
// whenever local has come up empty.
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

const API = 'https://api.anthropic.com/v1/messages';
const MODELS_API = 'https://api.anthropic.com/v1/models?limit=1';

export const MAX_LEADS = 8;        // per request
export const SNIPPET_CHARS = 400;  // enough to see the ask, not the whole post
export const MAX_BULLETS = 3;      // two or three lines, never more

/** Dollars per million tokens. */
export const RATES = {
  'claude-opus-5':    { in: 5, out: 25, label: 'Opus 5 — best writing' },
  'claude-sonnet-5':  { in: 2, out: 10, label: 'Sonnet 5 — balanced' },
  'claude-haiku-4-5': { in: 1, out: 5,  label: 'Haiku 4.5 — cheapest' }
};

export const AI_DEFAULTS = {
  key: '',
  model: 'claude-sonnet-5',
  budget: 0.5,        // dollars a day; 0 means no limit
  enabled: true,
  usage: {}           // { day, calls, leads, in, cached, out }
};

/** Fields worth mirroring: settings, not per-machine counters. */
const MIRRORED = ['key', 'model', 'budget', 'enabled'];
const pick = (o) => Object.fromEntries(MIRRORED.filter((k) => k in o).map((k) => [k, o[k]]));

export async function getAi() {
  const { ai } = await chrome.storage.local.get('ai');
  const local = { ...AI_DEFAULTS, ...(ai || {}) };
  if (local.key) return local;

  // Local came up empty: a new extension id, a cleared profile, a fresh
  // machine. Restore from the profile mirror rather than asking again.
  let mirror = {};
  try { ({ aiSettings: mirror = {} } = await chrome.storage.sync.get('aiSettings')); }
  catch { return local; }                       // sync off or unavailable
  if (!mirror.key) return local;
  const restored = { ...local, ...pick(mirror) };
  await chrome.storage.local.set({ ai: restored });
  // The flag is for this reply only — it says "just now", not "at some point".
  return { ...restored, restored: true };
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
  const ai = await getAi();
  const u = usageToday(ai);
  const spent = spendOf(u, ai.model);
  return {
    configured: !!ai.key,
    hint: ai.key ? ai.key.slice(0, 11) + '…' + ai.key.slice(-4) : '',
    model: ai.model,
    enabled: !!ai.key && ai.enabled !== false,
    budget: Number(ai.budget) || 0,
    spentToday: round(spent),
    remaining: Math.max(0, round((Number(ai.budget) || 0) - spent)),
    leadsToday: u.leads || 0,
    callsToday: u.calls || 0,
    perLead: u.leads ? round(spent / u.leads, 5) : 0,
    overBudget: (Number(ai.budget) || 0) > 0 && spent >= (Number(ai.budget) || 0),
    restored: !!ai.restored,
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
  await setAi({ key: k });
  return aiStatus();
}

export async function clearKey() {
  await setAi({ key: '' });
  try { await chrome.storage.sync.remove('aiSettings'); } catch { /* nothing mirrored */ }
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

const SYSTEM = [
  'You write the middle of a reply to a job post on a freelancer forum.',
  'The rest of the reply (greeting, pricing offer, sign-off) is already written; you write ONLY the bullet points.',
  '',
  'For each thread write exactly 2 bullets, or 3 only if the post genuinely needs a third.',
  'These prove the writer read that specific post.',
  'Rules:',
  '- Name the actual deliverable, platform, market or constraint the poster asked for.',
  '- Concrete and checkable. "Manual submissions to directories that index in the UAE" beats "high quality citations".',
  '- No praise, no restating their request back to them, no filler.',
  '- Plain words. Never use an em dash, en dash or bullet glyph. Use ordinary hyphens and full stops.',
  '- Never promise a specific price, a discount, free work, a guarantee, or a ranking result.',
  '- Under 100 characters each. Short is better.',
  '- British or neutral English, lower-key than marketing copy.',
  '',
  'Return ONLY a JSON object mapping each thread id to its array of bullet strings.',
  'Example: {"1847904":["...","..."],"1847910":["..."]}'
].join('\n');

/**
 * leads: [{ threadId, title, snippet, category }]
 * returns { specifics: { [threadId]: [bullet, ...] }, note }
 * Never throws: on any failure the caller falls back to the built-in rules.
 */
export async function writeSpecifics(leads) {
  const ai = await getAi();
  if (!ai.key) return { specifics: {}, note: 'no Claude key set' };
  if (ai.enabled === false) return { specifics: {}, note: 'Claude switched off' };
  if (!leads || !leads.length) return { specifics: {} };

  const budget = Number(ai.budget) || 0;
  if (budget > 0 && spendOf(usageToday(ai), ai.model) >= budget) {
    return { specifics: {}, note: `daily limit of $${budget.toFixed(2)} reached; using built-in rules until tomorrow` };
  }

  const batch = leads.slice(0, MAX_LEADS);
  const threads = batch.map((l) => [
    `id: ${l.threadId}`,
    `service area: ${l.category || 'unknown'}`,
    `title: ${String(l.title || '').slice(0, 200)}`,
    `post: ${String(l.snippet || '').replace(/\s+/g, ' ').slice(0, SNIPPET_CHARS)}`
  ].join('\n')).join('\n\n---\n\n');

  const body = {
    model: ai.model,
    max_tokens: 70 * batch.length + 60,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: threads }]
  };

  let res, data;
  try {
    res = await fetch(API, { method: 'POST', headers: headers(ai.key), body: JSON.stringify(body) });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    return { specifics: {}, note: `could not reach Anthropic: ${e.message}` };
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
    const bullets = (Array.isArray(obj[id]) ? obj[id] : [])
      .map((b) => String(b)
        .replace(/[–—]/g, '-')     // en/em dash
        .replace(/•/g, '-')             // bullet glyph
        .replace(/^[\s\-*]+/, '')
        .replace(/\s+/g, ' ')
        .trim())
      .filter((b) => b.length > 15 && b.length <= 160)
      .filter((b) => !/\b(guarantee|guaranteed|free trial|discount|\d+% off)\b/i.test(b))
      .slice(0, MAX_BULLETS);
    if (bullets.length) out[String(id)] = bullets;
  }
  return out;
}

async function recordUsage(usage, leadCount) {
  if (!usage) return;
  const ai = await getAi();
  const day = today();
  const prev = ai.usage && ai.usage.day === day ? ai.usage : { day, calls: 0, leads: 0, in: 0, cached: 0, out: 0 };
  await setAi({ usage: {
    day,
    calls: prev.calls + 1,
    leads: prev.leads + leadCount,
    in: prev.in + (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0),
    cached: prev.cached + (usage.cache_read_input_tokens || 0),
    out: prev.out + (usage.output_tokens || 0)
  } });
}

/**
 * One real call on a sample thread, so "is this actually Claude?" can be
 * answered by looking rather than by trusting. Costs a fraction of a cent.
 */
export async function testCall() {
  const before = await aiStatus();
  if (!before.configured) return { ok: false, error: 'No key stored. Paste one and press Save key first.' };
  const started = Date.now();
  const { specifics, note } = await writeSpecifics([{
    threadId: 'test',
    category: 'seo',
    title: 'Need local citation building for a Dubai clinic, also ranking in the UK',
    snippet: 'We have a clinic in Dubai and a second location in Manchester. Need consistent NAP '
           + 'across directories that actually get indexed locally, plus GMB cleanup. Budget $400.'
  }]);
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
