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
export const SNIPPET_CHARS = 400;  // enough to see the ask, not the whole post
export const MAX_BULLETS = 3;      // one for the public reply, three for the PM

/** Dollars per million tokens. */
export const RATES = {
  'claude-opus-5':    { in: 5, out: 25, label: 'Opus 5 — best writing' },
  'claude-sonnet-5':  { in: 2, out: 10, label: 'Sonnet 5 — balanced' },
  'claude-haiku-4-5': { in: 1, out: 5,  label: 'Haiku 4.5 — cheapest' }
};

export const AI_DEFAULTS = {
  model: 'claude-sonnet-5',
  budget: 0.5,        // dollars a day; 0 means no limit
  enabled: true,
  usage: {}           // { day, calls, leads, in, cached, out }
};

/** Settings worth carrying to another machine; usage counters are per-machine. */
const MIRRORED = ['model', 'budget', 'enabled'];
const pick = (o) => Object.fromEntries(MIRRORED.filter((k) => k in o).map((k) => [k, o[k]]));

export async function getAi() {
  const { ai } = await chrome.storage.local.get('ai');
  const local = { ...AI_DEFAULTS, ...(ai || {}) };

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

const SYSTEM = [
  'You write the technical middle of an outreach message about a job post on a freelancer forum.',
  'The greeting, the thread link and the closing offer are already written; you write ONLY the technical lines.',
  '',
  'For each thread write exactly 3 lines, STRONGEST FIRST.',
  'The first line is used on its own in a short public reply, so it must stand alone and be the single most',
  'convincing thing you can say about this specific post. Lines 2 and 3 are used together with it in a private',
  'message, so they must add something the first did not.',
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
  'Each line is a full sentence that reads correctly on its own, with no leading dash or number:',
  'they get laid out as a list, as numbers or as running prose depending on the thread.',
  '',
  'Return ONLY a JSON object mapping each thread id to its array of 3 strings.',
  'Example: {"1847904":["...","..."],"1847910":["..."]}'
].join('\n');

/**
 * leads: [{ threadId, title, snippet, category }]
 * returns { specifics: { [threadId]: [bullet, ...] }, note }
 * Never throws: on any failure the caller falls back to the built-in rules.
 */
export async function writeSpecifics(leads) {
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
  const threads = batch.map((l) => [
    `id: ${l.threadId}`,
    `service area: ${l.category || 'unknown'}`,
    `title: ${String(l.title || '').slice(0, 200)}`,
    `post: ${String(l.snippet || '').replace(/\s+/g, ' ').slice(0, SNIPPET_CHARS)}`
  ].join('\n')).join('\n\n---\n\n');

  const body = {
    model: ai.model,
    max_tokens: 90 * batch.length + 60,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: threads }]
  };

  let res, data;
  try {
    res = await fetch(API, { method: 'POST', headers: headers(key), body: JSON.stringify(body) });
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

/** The stored key, for copying into a password manager. Never logged. */
export const revealKey = () => vault.getKey();

/** Wipe settings and the local database; the Claude key is kept. */
export const factoryReset = () => vault.resetKeepingVault();
