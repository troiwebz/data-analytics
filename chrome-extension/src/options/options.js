import { getConfig, setConfig, DEFAULT_CONFIG } from '../config.js';
import { ping, saveAiKey, clearAiKey, aiKeyStatus, setAiBudget } from '../sync.js';

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

  if (patch.enabled && !patch.webhookUrl) return status('Set the Apps Script URL before enabling.', true);

  await setConfig(patch);
  await chrome.runtime.sendMessage({ cmd: 'reschedule' });
  status('Saved.');
}

$('save').addEventListener('click', save);

$('test').addEventListener('click', async () => {
  status('testing…');
  try {
    const cfg = await getConfig();
    const r = await ping({ ...cfg, webhookUrl: $('webhookUrl').value.trim(), sharedSecret: $('sharedSecret').value.trim() });
    status(`Connected. Sheet: ${r.sheet || 'ok'}`);
  } catch (e) { status(e.message, true); }
});

$('poll').addEventListener('click', async () => {
  status('polling…');
  const r = await chrome.runtime.sendMessage({ cmd: 'poll-now' });
  if (r?.error) status(r.error, true);
  else if (r?.skipped) status('Watcher is disabled — tick "Watcher enabled" at the top and Save first.', true);
  else if (r?.seeded != null) status(`First run: ${r.seeded} threads seen, ${r.backfilled} from the last 48h recorded in the Sheet. Watching starts now.`);
  else status(`${r?.new ?? 0} new thread(s), ${r?.matched ?? 0} sent.`);
});

$('reset').addEventListener('click', async () => {
  if (!confirm('Reset all settings to defaults?')) return;
  const cfg = await getConfig();
  fill({ ...DEFAULT_CONFIG, webhookUrl: cfg.webhookUrl, sharedSecret: cfg.sharedSecret });
  status('Defaults loaded — press Save to apply.');
});

// ---- Anthropic key: entered here, stored in Apps Script, never held locally
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
    `Key stored in Apps Script (<b>${esc(r.hint)}</b>) · model <b>${esc(r.model)}</b> · ` +
    (r.enabled ? '<span style="color:#16a34a">active</span>' : '<span style="color:#dc2626">switched off</span>') + '<br>' +
    `Today: <b>${r.leadsToday || 0}</b> leads in ${r.callsToday || 0} call(s) · spent <b>${money(r.spentToday)}</b>` +
    (r.perLead ? ` (${money(r.perLead)} per lead)` : '') + '<br>' +
    (r.budget > 0
      ? `Limit <b>$${Number(r.budget).toFixed(2)}/day</b> · <b>${money(r.remaining)}</b> left` +
        (r.overBudget ? ' · <span style="color:#dc2626">limit reached, using built-in rules until tomorrow</span>' : '')
      : 'No daily limit set.');
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function refreshAi() {
  try { showAi(await aiKeyStatus(await getConfig())); }
  catch (e) { showAi(null, /unknown action/i.test(e.message)
    ? 'Update the Apps Script code to enable this (it needs the newest Code.gs).' : e.message); }
}

$('saveKey').addEventListener('click', async () => {
  const key = $('aiKey').value.trim();
  if (!key) return showAi(null, 'Paste the key first.');
  $('saveKey').textContent = 'Saving…';
  try {
    const r = await saveAiKey(await getConfig(), key);
    $('aiKey').value = '';                 // never keep it in the extension
    showAi(r);
  } catch (e) { showAi(null, e.message); }
  $('saveKey').textContent = 'Save key';
});

$('saveBudget').addEventListener('click', async () => {
  const v = Number($('aiBudget').value);
  if (!isFinite(v) || v < 0) return showAi(null, 'Enter a number, for example 0.25.');
  try { showAi(await setAiBudget(await getConfig(), v)); } catch (e) { showAi(null, e.message); }
});

$('clearKey').addEventListener('click', async () => {
  if (!confirm('Remove the stored Anthropic key? Replies fall back to the built-in rules.')) return;
  try { showAi(await clearAiKey(await getConfig())); } catch (e) { showAi(null, e.message); }
});

getConfig().then(fill).then(refreshAi);
