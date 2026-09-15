import { getConfig, setConfig, DEFAULT_CONFIG } from '../config.js';
import { ping } from '../sync.js';
import { RATES } from '../claude.js';

const PLAIN = ['webhookUrl', 'sharedSecret', 'feedUrl', 'dmOffer'];
const NUM = ['pollMinutes', 'jitterSeconds', 'approvalPollMinutes', 'backfillHours', 'notifyScore', 'maxPostsPerDay',
            'minMinutesBetweenPosts', 'stageScore', 'maxStagedTabs', 'stageTtlMinutes'];
const BOOL = ['enabled', 'autoPost', 'aiSpecifics'];
const JSONF = ['categories', 'boosts', 'excludes', 'templates', 'dmTemplates', 'compliance', 'specifics'];
const $ = (id) => document.getElementById(id);

function fill(cfg) {
  PLAIN.forEach((k) => ($(k).value = cfg[k] ?? ''));
  NUM.forEach((k) => ($(k).value = cfg[k] ?? 0));
  BOOL.forEach((k) => ($(k).checked = !!cfg[k]));
  JSONF.forEach((k) => ($(k).value = JSON.stringify(cfg[k], null, 2)));
}

function status(msg, bad = false) {
  $('status').textContent = msg;
  $('status').style.color = bad ? '#dc2626' : '#16a34a';
}

async function save() {
  const patch = {};
  PLAIN.forEach((k) => (patch[k] = $(k).value.trim()));
  NUM.forEach((k) => (patch[k] = Number($(k).value)));
  BOOL.forEach((k) => (patch[k] = $(k).checked));
  for (const k of JSONF) {
    try { patch[k] = JSON.parse($(k).value); }
    catch (e) { return status(`${k}: invalid JSON — ${e.message}`, true); }
  }
  // Fail fast on a bad regex rather than at 3am during a poll.
  try {
    patch.categories.forEach((c) => c.patterns.forEach((p) => new RegExp(p, 'i')));
    patch.boosts.forEach((b) => new RegExp(b.pattern, 'i'));
    patch.excludes.forEach((e) => new RegExp(e, 'i'));
    for (const k of ['mustInclude', 'mustAppearEarly']) (patch.compliance[k] || []).forEach((r) => new RegExp(r.pattern, 'i'));
    for (const k of ['banned', 'warn']) (patch.compliance[k] || []).forEach((p) => new RegExp(p, 'i'));
    (patch.specifics.rules || []).forEach((r) => new RegExp(r.p, 'i'));
    (patch.specifics.geoPatterns || []).forEach((g) => new RegExp(g.p, 'i'));
  } catch (e) { return status(`bad regex: ${e.message}`, true); }


  await setConfig(patch);
  await chrome.runtime.sendMessage({ cmd: 'reschedule' });
  status('Saved.');
}

$('save').addEventListener('click', save);

$('test').addEventListener('click', async () => {
  status('testing…');
  try {
    const cfg = await getConfig();
    const url = $('webhookUrl').value.trim();
    if (!url) return status('No Apps Script URL set, so there is nothing to test. That is fine: leads stay on this Mac and Claude is called from here.');
    const r = await ping({ ...cfg, webhookUrl: url, sharedSecret: $('sharedSecret').value.trim() });
    status(`Connected. Sheet: ${r.sheet || 'ok'}`);
  } catch (e) { status(e.message, true); }
});

$('poll').addEventListener('click', async () => {
  status('polling…');
  const r = await chrome.runtime.sendMessage({ cmd: 'poll-now' });
  if (r?.error) status(r.error, true);
  else if (r?.skipped) status('Watcher is disabled — tick "Watcher enabled" at the top and Save first.', true);
  else if (r?.seeded != null) status(`First run: ${r.seeded} threads seen, ${r.backfilled} from the last 48h recorded. Watching starts now.`);
  else status(`${r?.new ?? 0} new thread(s), ${r?.matched ?? 0} drafted. Open the dashboard to see them.`);
});

$('reset').addEventListener('click', async () => {
  if (!confirm('Reset all settings to defaults?')) return;
  const cfg = await getConfig();
  fill({ ...DEFAULT_CONFIG, webhookUrl: cfg.webhookUrl, sharedSecret: cfg.sharedSecret });
  status('Defaults loaded — press Save to apply.');
});

// ---- Anthropic key: entered here, kept on this machine, used by the worker
function showAi(r, err) {
  const el = $('aiStatus');
  if (err) { el.innerHTML = esc(err); el.style.color = '#dc2626'; return; }
  el.style.color = '#334155';
  if (!r?.configured) {
    el.style.color = '#64748b';
    el.textContent = 'No key stored yet. Paste one above and press Save key. Until then replies use the built-in rules.';
    return;
  }
  if (r.budget != null) $('aiBudget').value = r.budget;
  const money = (n) => '$' + Number(n || 0).toFixed(4);
  el.innerHTML =
    `Key stored on this Mac (<b>${esc(r.hint)}</b>) · model <b>${esc(r.model)}</b> · ` +
    (r.enabled ? '<span style="color:#16a34a">active</span>' : '<span style="color:#dc2626">switched off</span>') + '<br>' +
    `Today: <b>${r.leadsToday || 0}</b> leads in ${r.callsToday || 0} call(s) · spent <b>${money(r.spentToday)}</b>` +
    (r.perLead ? ` (${money(r.perLead)} per lead)` : '') + '<br>' +
    (r.budget > 0
      ? `Limit <b>$${Number(r.budget).toFixed(2)}/day</b> · <b>${money(r.remaining)}</b> left` +
        (r.overBudget ? ' · <span style="color:#dc2626">limit reached, using built-in rules until tomorrow</span>' : '')
      : 'No daily limit set.');
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The worker owns the key; the page only ever asks it for status. */
const ai = (cmd, extra = {}) => chrome.runtime.sendMessage({ cmd, ...extra });

for (const [id, r] of Object.entries(RATES)) {
  $('aiModel').insertAdjacentHTML('beforeend', `<option value="${id}">${r.label} · $${r.in}/$${r.out} per Mtok</option>`);
}

async function refreshAi() {
  const r = await ai('ai-status');
  if (r?.model) $('aiModel').value = r.model;
  showAi(r, r?.error);
}

$('saveKey').addEventListener('click', async () => {
  const key = $('aiKey').value.trim();
  if (!key) return showAi(null, 'Paste the key first.');
  $('saveKey').textContent = 'Checking…';
  const r = await ai('ai-save-key', { key });
  if (r?.error) showAi(null, r.error);
  else { $('aiKey').value = ''; showAi(r); }   // cleared from the box once stored
  $('saveKey').textContent = 'Save key';
});

$('aiModel').addEventListener('change', async () => {
  const r = await ai('ai-model', { model: $('aiModel').value });
  showAi(r, r?.error);
});

$('saveBudget').addEventListener('click', async () => {
  const r = await ai('ai-budget', { budget: Number($('aiBudget').value) });
  showAi(r, r?.error);
});

$('clearKey').addEventListener('click', async () => {
  if (!confirm('Remove the stored Anthropic key? Replies fall back to the built-in rules.')) return;
  showAi(await ai('ai-clear-key'));
});

getConfig().then(fill).then(refreshAi);
