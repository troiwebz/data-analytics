import { getConfig, setConfig, DEFAULT_CONFIG } from '../config.js';
import { ping } from '../sync.js';
import { RATES } from '../claude.js';

const PLAIN = ['webhookUrl', 'sharedSecret', 'feedUrl', 'telegramChatId', 'sound', 'soundHot', 'brief', 'telegramSend', 'timezone',
              'nightStart', 'nightEnd'];
const NUM = ['pollMinutes', 'jitterSeconds', 'approvalPollMinutes', 'backfillHours', 'notifyScore', 'maxPostsPerDay',
            'minSecondsBetweenPosts', 'maxDmsPerDay', 'minSecondsBetweenDms', 'bhwUsername', 'announceMaxAgeHours',
            'stageScore', 'maxStagedTabs', 'stageTtlMinutes', 'soundVolume',
            'maxThreadReads', 'secondsBetweenThreadReads', 'telegramPollSeconds',
            'nightVetoMinutes', 'nightMinScore', 'nightMaxPosts', 'autoModeMinScore',
            'servicesPeakStartHour', 'servicesPeakEndHour'];
const BOOL = ['enabled', 'autoPost', 'aiSpecifics', 'telegramEnabled', 'soundEnabled', 'readThreads',
             'telegramApprovals', 'nightMode', 'nightSummary', 'autoMode'];
const JSONF = ['categories', 'boosts', 'excludes', 'excludeThreadIds', 'excludeAuthors',
              'templates', 'offers', 'dmTemplates', 'compliance', 'specifics',
              'serviceThreads', 'bumpTemplates'];
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
  if (!confirm('Reset all settings to defaults?\n\nYour Claude key is kept.')) return;
  const cfg = await getConfig();
  fill({ ...DEFAULT_CONFIG, webhookUrl: cfg.webhookUrl, sharedSecret: cfg.sharedSecret });
  status('Defaults loaded — press Save to apply. Your Claude key was not touched.');
});

$('bulkTrackBtn').addEventListener('click', async () => {
  const text = $('bulkTrack').value.trim();
  const bs = $('bulkTrackStatus');
  if (!text) { bs.style.color = '#dc2626'; bs.textContent = 'Paste at least one BHW thread link first.'; return; }
  bs.style.color = ''; bs.textContent = 'Reading each thread…';
  $('bulkTrackBtn').disabled = true;
  try {
    const r = await chrome.runtime.sendMessage({ cmd: 'batch-track-services', text });
    if (r?.error) { bs.style.color = '#dc2626'; bs.textContent = r.error; return; }
    const parts = [];
    if (r.added.length) parts.push(`${r.added.length} added`);
    if (r.already.length) parts.push(`${r.already.length} already tracked`);
    if (r.noTitle.length) parts.push(`${r.noTitle.length} could not be titled, added anyway`);
    bs.style.color = '';
    bs.textContent = parts.length ? parts.join(', ') + '.' : 'No BHW thread links found in that text.';
    if (r.added.length) {
      $('bulkTrack').value = '';
      $('serviceThreads').value = JSON.stringify((await getConfig()).serviceThreads, null, 2);
    }
  } finally {
    $('bulkTrackBtn').disabled = false;
  }
});

// ---- Anthropic key: entered here, kept on this machine, used by the worker
function showAi(r, err) {
  const el = $('aiStatus');
  if (err) { el.innerHTML = esc(err); el.style.color = '#dc2626'; return; }
  el.style.color = '#334155';
  if (!r?.configured) {
    el.style.color = '#b45309';
    el.innerHTML = '<b>No key stored.</b> Replies are being written from the built-in rules, not by Claude. ' +
                   'Paste a key above and press Save key.';
    return;
  }
  if (r.budget != null) $('aiBudget').value = r.budget;
  const money = (n) => '$' + Number(n || 0).toFixed(4);
  el.innerHTML =
    `<span style="color:#16a34a">✓ Key stored</span> (<b>${esc(r.hint)}</b>)` +
    (r.savedAt ? ` <span class="hint">saved ${new Date(r.savedAt).toLocaleDateString()}</span>` : '') + '<br>' +
    '<span class="hint">Held on its own, away from the settings. A reset, a reload, an update or reinstalling ' +
    'the folder will not remove it' + (r.mirrored ? ', and it is backed up to your Chrome profile' : '') +
    '. Only the Remove button deletes it.</span>' +
    (r.restored ? '<br><span style="color:#16a34a">Restored from your Chrome profile just now.</span>' : '') + '<br>' +
    `Model <b>${esc(r.model)}</b> · ` +
    (r.enabled ? '<span style="color:#16a34a">active</span>' : '<span style="color:#dc2626">switched off</span>') + '<br>' +
    `Today: <b>${r.leadsToday || 0}</b> leads in ${r.callsToday || 0} call(s) · spent <b>${money(r.spentToday)}</b>` +
    (r.perLead ? ` (${money(r.perLead)} per lead)` : '') + '<br>' +
    (r.budget > 0
      ? `Limit <b>$${Number(r.budget).toFixed(2)}/day</b> · <b>${money(r.remaining)}</b> left` +
        (r.overBudget ? ' · <span style="color:#dc2626">limit reached, using built-in rules until tomorrow</span>' : '')
      : 'No daily limit set.') + '<br>' +
    `All time: <b>$${Number(r.spentTotal || 0).toFixed(2)}</b> over ${r.leadsTotal || 0} lead(s)` +
    (r.since ? ` since ${new Date(r.since).toLocaleDateString()}` : '') +
    (r.credits > 0
      ? `<br>Topped up <b>$${Number(r.credits).toFixed(2)}</b>, so roughly <b>$${Number(r.balance).toFixed(2)}</b> left. ` +
        '<span class="hint">Our own count, not Anthropic\'s: there is no API that reports your real balance. ' +
        'Check console.anthropic.com for the true figure.</span>'
      : '<br><span class="hint">Enter what you topped up below and this becomes a balance countdown.</span>');
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

$('copyKey').addEventListener('click', async () => {
  const { key } = await ai('ai-reveal');
  if (!key) return showAi(null, 'Nothing stored to copy.');
  await navigator.clipboard.writeText(key);
  status('Key copied. Paste it somewhere safe, such as your password manager.');
});

$('addCredits').addEventListener('click', async () => {
  const r = await ai('ai-credits', { amount: Number($('aiCredits').value) });
  if (r?.error) return showAi(null, r.error);
  $('aiCredits').value = '';
  showAi(r);
  status(`Recorded. Counting down from $${Number(r.credits).toFixed(2)}.`);
});

$('resetSpend').addEventListener('click', async () => {
  if (!confirm('Start the spend count again from zero?\n\nThis only resets what this extension counts. It does not change anything at Anthropic, and your key is untouched.')) return;
  showAi(await ai('ai-reset-spend'));
});

$('clearKey').addEventListener('click', async () => {
  if (!confirm('Remove the stored Anthropic key?\n\nThis is the only thing that deletes it. Replies fall back to the built-in rules, and you would need the key again from console.anthropic.com or your password manager.')) return;
  showAi(await ai('ai-clear-key'));
});

$('testAi').addEventListener('click', async () => {
  const out = $('aiTest');
  $('testAi').disabled = true; $('testAi').textContent = 'Asking Claude…';
  const r = await ai('ai-test');
  if (r?.ok) {
    out.innerHTML = '<div style="border:1px solid #bbf7d0;background:#f0fdf4;border-radius:8px;padding:10px 12px">' +
      `<b style="color:#16a34a">Claude answered in ${(r.ms / 1000).toFixed(1)}s</b> ` +
      `<span class="hint">${esc(r.model)} · this call cost $${Number(r.cost).toFixed(5)}</span>` +
      '<div class="hint" style="margin:8px 0 4px">Sample thread: <i>"Need local citation building for a Dubai clinic, also ranking in the UK"</i></div>' +
      '<ul style="margin:4px 0 0 18px;padding:0;line-height:1.6">' +
        r.bullets.map((b) => `<li>${esc(b)}</li>`).join('') + '</ul>' +
      '<div class="hint" style="margin-top:8px">These are the lines Claude puts in the middle of your reply and PM. ' +
      'If they name Dubai, the UK, NAP or GMB, they were written for this thread, not picked from a template.</div></div>';
  } else {
    out.innerHTML = '<div style="border:1px solid #fecaca;background:#fef2f2;border-radius:8px;padding:10px 12px;color:#b91c1c">' +
      esc(r?.error || r?.note || 'Claude did not answer.') + '</div>';
  }
  $('testAi').disabled = false; $('testAi').textContent = 'Test Claude now';
  refreshAi();
});

// ---- Telegram: token in the vault, chat id in settings, both used from here
function showTg(r, err) {
  const el = $('tgStatus');
  if (err) { el.innerHTML = esc(err); el.style.color = '#dc2626'; return; }
  el.style.color = '#334155';
  if (!r?.stored) {
    el.style.color = '#b45309';
    // Two different situations, and telling everyone to send /newbot puts the
    // person who already HAS a bot into a second one - so their "hi" goes to
    // one bot while the token belongs to another, and nothing ever connects.
    el.innerHTML = '<b>No bot token saved.</b> New threads will not reach your phone.<br>'
      + '<b>Already made a bot?</b> Message <b>@BotFather</b>, send <b>/mybots</b>, pick it, '
      + 'tap <b>API Token</b>, and paste that above. Do not send /newbot — that makes a second bot, '
      + 'and your messages would go to the wrong one.<br>'
      + '<b>No bot yet?</b> Message <b>@BotFather</b>, send <b>/newbot</b>, and paste the token it gives you.';
    return;
  }
  // A missing chat id is exactly as fatal as a missing token - nothing can be
  // sent without it - so it is said just as loudly. Buried in grey as "no chat
  // id yet" it read like a detail, and every send failed with nothing on
  // screen to explain it.
  // Name the bot. The extension is called HAF Watcher; the bot is whatever you
  // called it in @BotFather, and you cannot search Telegram for a name you do
  // not know.
  const who = r.bot
    ? `<span style="color:#16a34a">✓ Token stored</span> for <b>@${esc(r.bot)}</b> — that is the bot to `
      + `search for in Telegram. <a href="https://t.me/${esc(r.bot)}" target="_blank" rel="noopener">Open it</a>.`
    : `<span style="color:#16a34a">✓ Token stored</span> (<b>${esc(r.hint)}</b>)`;
  if (!r.chatId) {
    el.style.color = '#b45309';
    el.innerHTML = who + '<br><b>No chat id saved, so nothing can be sent.</b> '
      + `Open ${r.bot ? `<b>@${esc(r.bot)}</b>` : 'your bot'} in Telegram, send it any message, `
      + 'then press <b>Find it for me</b> above.';
    return;
  }
  el.innerHTML = who + ` · chat id <b>${esc(r.chatId)}</b><br>` +
    (r.enabled ? 'New threads are sent here automatically as they are found.'
               : '<span style="color:#b45309">Sending is switched off - tick the box above and Save.</span>');
}

async function refreshTg() { const r = await ai('tg-status'); showTg(r, r?.error); }

$('saveTg').addEventListener('click', async () => {
  const token = $('tgToken').value.trim();
  if (!token) return showTg(null, 'Paste the token first.');
  const r = await ai('tg-save-token', { token });
  if (r?.error) return showTg(null, r.error);
  $('tgToken').value = '';                 // cleared from the box once stored
  showTg(r);
});

$('clearTg').addEventListener('click', async () => {
  if (!confirm('Remove the stored Telegram bot token? Your Claude key is not affected.')) return;
  showTg(await ai('tg-clear-token'));
});

$('sampleTg').addEventListener('click', async () => {
  const b = $('sampleTg');
  b.disabled = true; b.textContent = 'Building and sending…';
  const r = await ai('tg-sample');
  if (r?.error) {
    showTg(null, `Sent the ${(r.sent || []).join(' and ') || 'nothing'}. Telegram refused the rest: ${r.error}`);
  } else {
    status(`Sent the ${(r.sent || []).join(' and ')} to Telegram` +
      (r.usedClaude ? ', with lines written by Claude for that thread.' : '. Claude did not run, so the built-in rules wrote it.'));
    refreshTg();
  }
  b.disabled = false; b.textContent = 'Send a sample lead';
});

$('findChat').addEventListener('click', async () => {
  const b = $('findChat');
  b.disabled = true; b.textContent = 'Looking…';
  const r = await ai('tg-findchat');
  if (r?.error) showTg(null, r.error);
  else {
    $('telegramChatId').value = r.chatId;
    // Save it here rather than filling the box and waiting for a second click.
    // A found value is not a typed one, and leaving it unsaved put the page in
    // a state where the box showed an id and the line under it still read "no
    // chat id saved" - both true, and impossible to make sense of.
    await setConfig({ telegramChatId: r.chatId });
    await chrome.runtime.sendMessage({ cmd: 'reschedule' });
    const who = (r.chats || []).find((c) => c.id === r.chatId);
    status(`Found and saved chat ${r.chatId}${who?.name ? ` (${who.name})` : ''}. `
         + 'Now press "Send a test message" — your phone should buzz.');
    await refreshTg();
    await showBackup();
  }
  b.disabled = false; b.textContent = 'Find it for me';
});

// ---- moving to another machine -------------------------------------------
async function showBackup() {
  const r = await ai('backup-status');
  const el = $('backupState');
  if (!el) return;
  el.innerHTML = r?.at
    ? `<span style="color:#16a34a">✓ ${r.keys} setting(s) mirrored to Chrome sync</span>, last on `
      + `<b>${new Date(r.at).toLocaleString()}</b>.`
    : '<span style="color:#b45309">Nothing mirrored yet.</span> Press Save anywhere on this page, or '
      + '"Back up now", and a new machine signed into this Chrome will come up already set up.';
}

$('backupNow').addEventListener('click', async () => {
  const b = $('backupNow');
  b.disabled = true; b.textContent = 'Backing up…';
  const r = await ai('backup-now');
  if (r?.error) status(`Could not mirror to sync: ${r.error}`, true);
  else status(`Mirrored ${r.saved} setting(s) to Chrome sync.`
    + (r.tooBig?.length ? ` ${r.tooBig.join(', ')} were too large for sync — use the file for those.` : ''));
  await showBackup();
  b.disabled = false; b.textContent = 'Back up now';
});

$('exportCfg').addEventListener('click', async () => {
  const withSecrets = $('exportSecrets').checked;
  if (withSecrets && !confirm('The file will contain your live Claude key and bot token.\n\n'
      + 'Anyone who opens it can spend your Claude credit and post as your bot. Continue?')) return;
  const data = await ai('backup-export', { secrets: withSecrets });
  if (data?.error) return status(data.error, true);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `haf-watcher-settings-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  status(`Saved a settings file${withSecrets ? ' including your keys — keep it somewhere private.' : '.'}`);
});

$('importCfg').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = '';                                  // so the same file can be picked twice
  let data;
  try { data = JSON.parse(await file.text()); }
  catch { return status('That file is not readable JSON.', true); }
  if (!confirm('Restore settings from this file?\n\nEverything on this page is replaced by what is in it.')) return;
  const r = await ai('backup-import', { data });
  if (r?.error) return status(r.error, true);
  status(`Restored ${r.settings} setting(s)${r.secrets?.length ? ` and the ${r.secrets.join(' and ')} key(s)` : ''}.`);
  fill(await getConfig());
  refreshTg(); showBackup();
});

// --- automatic setup via Chrome Sync ----------------------------------------

async function showSync() {
  const el = $('syncState');
  if (!el) return;
  const r = await ai('sync-status');
  if (!r || r.error) { el.innerHTML = `<b style="color:#dc2626">✗ ${esc(r?.error || 'could not check')}</b>`; return; }
  const idLine = `Extension id: <code>${esc(r.extensionId || '?')}</code> — the same on every machine `
    + 'this version is unpacked on. If a machine ever shows a different id here, that install did not get '
    + 'this version\'s fixed identity and Sync cannot match it up.';
  if (!r.available) {
    el.innerHTML = `<b style="color:#b45309">⚠ Chrome Sync is off in this profile.</b> `
      + `Turn it on (chrome://settings/syncSetup) and sign in, or use the file below instead.<br>${idLine}`;
    return;
  }
  el.innerHTML = (r.hasSecrets
    ? `<b style="color:#16a34a">✓ Your keys are in Chrome Sync</b> — saved `
      + `${r.savedAt ? new Date(r.savedAt).toLocaleString() : 'previously'}. Any machine signed in to this `
      + 'same Google account, with this version installed, already has them.'
    : `<b>No keys in Chrome Sync yet.</b> Save your Claude key and bot token below, on this machine, and `
      + 'they will appear here — and on every other machine signed in to this account.')
    + `<br>${idLine}`;
}

$('syncCheck')?.addEventListener('click', () => busy('syncCheck', 'Checking…', showSync));

// --- the seed file ----------------------------------------------------------

async function showSeed() {
  const el = $('seedState');
  if (!el) return;
  const r = await ai('seed-status');
  if (!r || r.error) { el.innerHTML = `<b style="color:#dc2626">✗ ${esc(r?.error || 'could not check')}</b>`; return; }
  if (!r.present) {
    el.innerHTML = '<b>No <code>haf-secrets.json</code> in the extension folder.</b> '
      + 'Press the button below and drop the file in beside <code>manifest.json</code>.';
    return;
  }
  const has = [r.has?.anthropic && 'the Claude key', r.has?.telegram && 'the bot token',
               r.has?.chatId && 'your chat id'].filter(Boolean).join(', ');
  el.innerHTML = `<b style="color:#16a34a">✓ <code>haf-secrets.json</code> is in the folder</b>`
    + ` — it carries ${esc(has || 'no keys')}${r.settings ? ` and ${r.settings} setting(s)` : ''}.`
    + (r.applied ? ' Already read in.' : ' <b>Not read in yet</b> — press "Read the file now", or just reload the extension.');
}

$('seedMake').addEventListener('click', async () => {
  if (!confirm('This file will contain your live Claude key and bot token.\n\n'
    + 'It is meant to sit inside the extension folder so a new machine sets itself up. '
    + 'Anyone who gets the folder gets both keys. Continue?')) return;
  const data = await ai('backup-export', { secrets: true });
  if (data?.error) return status(data.error, true);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'haf-secrets.json';                        // already the name it needs
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  status('Saved haf-secrets.json. Move it into the extension folder next to manifest.json, '
    + 'then delete it from Downloads.');
});

$('seedApply').addEventListener('click', async () => {
  const r = await ai('seed-apply', { force: true });
  if (r?.error) return status(r.error, true);
  if (r?.none) return status(`No ${r.file || 'haf-secrets.json'} in the extension folder yet.`, true);
  status(`Read it in: ${r.secrets?.length ? `the ${r.secrets.join(' and ')} key(s)` : 'no keys'}`
    + `${r.settings ? ` and ${r.settings} setting(s)` : ''}.`);
  fill(await getConfig());
  refreshTg(); showSeed();
});

$('unhook').addEventListener('click', async () => {
  const b = $('unhook');
  b.disabled = true; b.textContent = 'Removing…';
  const r = await ai('tg-unhook');
  if (r?.error) showTg(null, `Could not remove it: ${r.error}`);
  else if (!r.had) status('There is no webhook on this bot — nothing to remove.');
  else if (r.gone) status(`Webhook removed (it was ${r.was}). The bot is yours now — press "Find it for me", then Save.`);
  else status(`It came straight back (${r.back}). Something is still setting it — turn off the Apps Script `
            + `triggers first: Apps Script → Triggers → delete, then Deploy → Manage deployments → Archive.`, true);
  b.disabled = false; b.textContent = 'Remove the webhook';
});

$('selfTest').addEventListener('click', async () => {
  const b = $('selfTest');
  b.disabled = true; b.textContent = 'Testing…';
  const before = Date.now();
  const r = await ai('tg-selftest');
  const lines = (r?.checks || []).map(([m, t]) => `${m} ${t}`);
  $('tgStatus').innerHTML = lines.join('<br>') || 'No answer from the service worker.';
  $('tgStatus').style.color = r?.ok ? '#334155' : '#b45309';

  // The tap is the only half this side cannot prove, so wait for it rather
  // than declaring success on a message having gone out.
  if (r?.awaitingTap) {
    b.textContent = 'Waiting for your tap…';
    for (let i = 0; i < 40; i++) {                 // ~2 minutes
      await new Promise((s) => setTimeout(s, 3000));
      const t = await ai('tg-taps');
      const seen = await ai('tg-selftest-seen');
      if (seen?.at > before) {
        $('tgStatus').innerHTML = lines.concat('✓ <b>Your tap reached Chrome. Everything works.</b>').join('<br>');
        $('tgStatus').style.color = '#15803d';
        break;
      }
      if (i === 39) {
        $('tgStatus').innerHTML = lines.concat(
          '✗ <b>No tap came back in two minutes.</b> The message went out, so sending works and receiving '
          + 'does not — usually a webhook on the bot. Press "Why is nothing arriving?".').join('<br>');
      }
    }
  }
  b.disabled = false; b.textContent = '🧪 Test everything';
});

$('tgCheck').addEventListener('click', async () => {
  const b = $('tgCheck');
  b.disabled = true; b.textContent = 'Checking…';
  const r = await ai('tg-check');
  const lines = (r?.checks || []).map(([mark, text]) => `${mark} ${text}`).join('<br>');
  $('tgStatus').innerHTML = lines || 'No answer from the service worker.';
  $('tgStatus').style.color = r?.ok ? '' : '#b45309';
  b.disabled = false; b.textContent = 'Why is nothing arriving?';
});

$('tapsNow').addEventListener('click', async () => {
  const b = $('tapsNow');
  b.disabled = true; b.textContent = 'Checking…';
  const r = await ai('tg-taps');
  if (r?.error) showTg(null, `Could not read your taps: ${r.error}`);
  else if (r?.skipped === 'off') status('Approval buttons are switched off — tick the box above and press Save first.', true);
  else if (!r?.taps) status('Nothing waiting. Tap a button in Telegram, then press this again.');
  else status(`Found ${r.taps} tap(s) and acted on ${r.done}. Check Telegram — the message should say what happened.`);
  b.disabled = false; b.textContent = 'Check for taps now';
});

$('testTg').addEventListener('click', async () => {
  $('testTg').disabled = true; $('testTg').textContent = 'Sending…';
  const r = await ai('tg-test');
  if (r?.error) showTg(null, r.error);
  else { status(`Sent. Check Telegram - the message is from @${r.bot}.`); refreshTg(); }
  $('testTg').disabled = false; $('testTg').textContent = 'Send a test message';
});

// ---- Sound -------------------------------------------------------------
const SOUNDS = {
  chime: 'Chime - two rising notes',
  ping:  'Ping - one short note',
  knock: 'Knock - two low taps',
  alert: 'Alert - three rising notes',
  none:  'Silent'
};
for (const id of ['sound', 'soundHot']) {
  for (const [v, label] of Object.entries(SOUNDS)) {
    $(id).insertAdjacentHTML('beforeend', `<option value="${v}">${label}</option>`);
  }
}

const showVol = () => { $('volLabel').textContent = Math.round($('soundVolume').value * 100) + '%'; };
$('soundVolume').addEventListener('input', showVol);

async function preview(which) {
  $('soundMsg').textContent = '';
  const sound = $(which).value;
  if (sound === 'none') { $('soundMsg').textContent = 'That one is set to silent.'; return; }
  // Preview what is on screen, not what was last saved.
  const r = await chrome.runtime.sendMessage({ cmd: 'play-sound', sound });
  if (r?.error) { $('soundMsg').style.color = '#dc2626'; $('soundMsg').textContent = r.error; }
  else { $('soundMsg').style.color = '#64748b'; $('soundMsg').textContent = 'Played. Press Save at the bottom to keep these settings.'; }
}
$('testAlert').addEventListener('click', async () => {
  const b = $('testAlert');
  b.disabled = true; b.textContent = 'Sending…';
  const r = await chrome.runtime.sendMessage({ cmd: 'test-alert' });
  const el = $('soundMsg');
  const bannerOk = r?.banner?.ok, soundOk = r?.sound?.ok !== false && !r?.sound?.error;
  if (bannerOk && soundOk) {
    el.style.color = '#16a34a';
    el.innerHTML = 'Sent. You should have heard the hot-lead sound and seen a banner in the top right. '
                 + 'Click the banner to check it opens the dashboard.';
  } else {
    el.style.color = '#b45309';
    el.innerHTML = (soundOk ? 'Sound played. ' : `Sound failed: ${esc(r?.sound?.error || 'unknown')}. `)
      + (bannerOk
          ? 'Banner sent - if nothing appeared, macOS is blocking it. See the note below.'
          : `Banner failed: ${esc(r?.banner?.error || 'Chrome would not show it')}. See the note below.`);
  }
  b.disabled = false; b.textContent = 'Test the banner and sound';
});

$('playSound').addEventListener('click', () => preview('sound'));
$('playHot').addEventListener('click', () => preview('soundHot'));

getConfig().then(fill).then(showVol).then(refreshAi).then(refreshTg).then(showBackup).then(showSeed).then(showSync);
