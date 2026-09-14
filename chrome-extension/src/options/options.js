import { getConfig, setConfig, DEFAULT_CONFIG } from '../config.js';
import { ping } from '../sync.js';

const PLAIN = ['webhookUrl', 'sharedSecret', 'feedUrl'];
const NUM = ['pollMinutes', 'jitterSeconds', 'approvalPollMinutes', 'notifyScore', 'maxPostsPerDay',
            'minMinutesBetweenPosts', 'stageScore', 'maxStagedTabs', 'stageTtlMinutes'];
const BOOL = ['enabled', 'autoPost'];
const JSONF = ['categories', 'boosts', 'excludes', 'templates'];
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
  else if (r?.seeded) status(`Seeded ${r.seeded} existing threads — real watching starts now.`);
  else status(`${r?.new ?? 0} new thread(s), ${r?.matched ?? 0} matched.`);
});

$('reset').addEventListener('click', async () => {
  if (!confirm('Reset all settings to defaults?')) return;
  const cfg = await getConfig();
  fill({ ...DEFAULT_CONFIG, webhookUrl: cfg.webhookUrl, sharedSecret: cfg.sharedSecret });
  status('Defaults loaded — press Save to apply.');
});

getConfig().then(fill);
