// The dashboard: one sortable table. Click a column header to sort by it,
// click again to reverse. Click a row to open the reply, the PM and the
// actions for that lead.
import { getConfig } from '../config.js';
import { renderDm } from '../templates.js';
import { getLeads, getLog, getRateState, getStaged } from '../store.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Times are always shown in the viewer's own zone.
const when = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};
const ago = (iso) => {
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return '';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};
const time = (v) => { const t = new Date(v).getTime(); return isFinite(t) ? t : 0; };

/** BHW direct-message compose page; `to` is form-encoded so spaces are '+'. */
const dmLink = (l) => l.dmUrl ||
  'https://www.blackhatworld.com/direct-messages/add?to=' +
  encodeURIComponent(l.author || '').replace(/%20/g, '+') +
  (l.dmTitle ? '&title=' + encodeURIComponent(l.dmTitle).replace(/%20/g, '+') : '');

/**
 * The stored status values are terse and a couple were actively misleading:
 * "SENT" meant "sent to your Telegram", which reads as "reply sent". These are
 * what the table shows instead. The stored values are untouched.
 */
const STATUS = {
  SENT:     { label: 'To do',    hint: 'Found and drafted. Nothing posted yet.' },
  NEW:      { label: 'To do',    hint: 'Found and drafted. Nothing posted yet.' },
  APPROVED: { label: 'Queued',   hint: 'You tapped Post. It posts within a minute.' },
  POSTED:   { label: 'Posted',   hint: 'Your reply is live on the thread.' },
  SKIPPED:  { label: 'Skipped',  hint: 'You decided against this one.' },
  FAILED:   { label: 'Failed',   hint: 'Posting did not work. Open it and try again.' },
  BACKFILL: { label: 'History',  hint: 'Loaded from the past, not new.' },
  EXPIRED:  { label: 'Too late', hint: 'Too many replies already; the buyer has likely chosen.' },
};
const statusOf = (s) => STATUS[s] || { label: String(s || 'to do').toLowerCase(), hint: '' };

/** `matched` is an array locally but comma-joined when it comes from the Sheet. */
const tags = (v) => Array.isArray(v) ? v.map(String)
  : typeof v === 'string' ? v.split(',').map((t) => t.trim()).filter(Boolean) : [];

// ---- the columns. `get` feeds the sort; `cell` renders. -------------------
const COLS = [
  { key: 'posted',  label: 'Posted',   sortable: true,  dir: -1, get: (l) => time(l.postedAt),
    cell: (l) => `<div>${when(l.postedAt)}${l.postedAtSource && l.postedAtSource !== 'listing' ? ' <span class="approx">~</span>' : ''}</div><div class="sub">${ago(l.postedAt)}</div>` },
  { key: 'replies', label: 'Replies',  sortable: true,  dir: 1,  num: true,
    get: (l) => l.replyCount == null ? Number.MAX_SAFE_INTEGER : l.replyCount,
    cell: (l) => l.replyCount == null ? '<span class="sub">?</span>'
      : `<span class="${l.replyCount >= 8 ? 'stale' : ''}">${l.replyCount}</span><div class="sub">#${l.replyCount + 1}</div>` },
  { key: 'score',   label: 'Score',    sortable: true,  dir: -1, num: true, get: (l) => l.score ?? 0,
    cell: (l) => `<b>${l.score ?? 0}</b>` },
  { key: 'title',   label: 'Thread',   sortable: false,
    cell: (l) => `${l.status === 'POSTED' ? '✅ ' : ''}<a class="t" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title || '(no title)')}</a>` +
      `<div class="sub">${esc(l.author || '')}${l.categoryLabel ? ' · ' + esc(l.categoryLabel) : ''}` +
      `${tags(l.matched).length ? ' · ' + esc(tags(l.matched).slice(0, 4).join(', ')) : ''}</div>` },
  { key: 'budget',  label: 'Budget',   sortable: true,  dir: -1, num: true, get: (l) => l.budgetAmount ?? 0,
    cell: (l) => l.budget ? esc(l.budget) : '<span class="sub">—</span>' },
  { key: 'status',  label: 'Status',   sortable: true,  dir: 1,  get: (l) => l.status || '',
    cell: (l) => {
      const st = statusOf(l.status);
      return `<span class="st ${esc(l.status || 'SENT')}" title="${esc(st.hint)}">${esc(st.label)}</span>` +
             (l.pmSent ? ' <span class="st POSTED" title="Private message sent">PM sent</span>' : '');
    } },
];

let sortKey = 'posted', sortDir = -1;     // newest first
let openRow = null;
let edited = {}, editedDm = {};

// ---------------------------------------------------------------- rendering

async function render() {
  try { await renderInner(); }
  catch (e) {
    $('rows').innerHTML = `<tr><td colspan="${COLS.length}"><div class="empty" style="color:var(--red)">` +
      `<b>The table failed to render.</b><br>${esc(e && e.message ? e.message : e)}<br><br>` +
      `<span class="sub">Press <b>Update now</b>; if it persists open DevTools (⌥⌘I) → Console and send me the red line.</span>` +
      `</div></td></tr>`;
    console.error('[HAF dashboard]', e);
  }
}

async function renderInner() {
  const [cfg, leads, log, rate, staged] = await Promise.all(
    [getConfig(), getLeads(), getLog(), getRateState(), getStaged()]);
  // Cheap and cached by the service worker; never blocks the table.
  const ai = await chrome.runtime.sendMessage({ cmd: 'ai-status' }).catch(() => ({}));

  $('ver').textContent = 'v' + chrome.runtime.getManifest().version;
  $('dot').className = 'dot' + (cfg.enabled ? ' on' : '');
  $('state').textContent = cfg.enabled ? `Watching the forum · checking every ${cfg.pollMinutes} min` : 'Not watching · turn it on in Settings';
  $('rate').textContent = `${rate.count}/${cfg.maxPostsPerDay} posts today`;
  // Apps Script is optional; hide what needs it rather than failing on a click.
  for (const id of ['approvals', 'sync']) $(id).hidden = !cfg.webhookUrl;

  const today = leads.filter((l) => time(l.foundAt) > Date.now() - 86400000);
  const n = (s) => leads.filter((l) => l.status === s).length;
  const tiles = [
    [leads.length, 'in database'], [today.length, 'found today'],
    [n('POSTED'), 'posted'], [n('SKIPPED'), 'skipped'], [Object.keys(staged).length, 'staged']
  ];
  if (ai?.configured) {
    const spent = '$' + Number(ai.spentToday || 0).toFixed(3);
    tiles.push([spent, ai.budget > 0 ? `claude · ${'$' + Number(ai.remaining).toFixed(2)} left` : 'claude today']);
  } else if (cfg.aiSpecifics) {
    tiles.push(['off', 'claude · add a key']);
  }
  $('stats').innerHTML = tiles
    .map(([v, k]) => `<div class="k"${String(k).startsWith('claude') && ai.overBudget ? ' style="border-color:#fecaca"' : ''}><b>${v}</b><span>${k}</span></div>`)
    .join('');

  // header
  $('head').innerHTML = COLS.map((c) => {
    if (!c.sortable) return `<th>${c.label}</th>`;
    const on = sortKey === c.key;
    return `<th class="s${on ? ' on' : ''}${c.num ? ' num' : ''}" data-sort="${c.key}">` +
           `${c.label} <span class="ar">${on ? (sortDir < 0 ? '▼' : '▲') : '⇅'}</span></th>`;
  }).join('');

  // rows
  const q = $('q').value.trim().toLowerCase();
  const hide = $('hidedone').checked;
  const fs = $('fstatus').value;
  let list = leads.filter((l) => {
    if (fs && (l.status || 'SENT') !== fs) return false;
    if (hide && ['POSTED', 'SKIPPED', 'EXPIRED'].includes(l.status)) return false;
    if (!q) return true;
    return `${l.title} ${l.author} ${tags(l.matched).join(' ')} ${l.category}`.toLowerCase().includes(q);
  });

  const col = COLS.find((c) => c.key === sortKey) || COLS[0];
  list.sort((a, b) => {
    const x = col.get(a), y = col.get(b);
    const r = x < y ? -1 : x > y ? 1 : 0;
    return (sortDir < 0 ? -r : r) || time(b.postedAt) - time(a.postedAt);
  });
  $('count').textContent = list.length === leads.length ? `${leads.length} leads` : `${list.length} of ${leads.length}`;

  $('rows').innerHTML = list.length
    ? list.map((l) => row(l, staged, cfg)).join('')
    : `<tr><td colspan="${COLS.length}"><div class="empty">No threads here yet.<br>` +
      `New ones appear on their own within ${cfg.pollMinutes} minutes. To see past threads now, press <b>Load last 48h</b>.</div></td></tr>`;

  $('log').innerHTML = log.slice(0, 12)
    .map((e) => `<div class="${e.level}">${when(e.t).split(', ')[1] || ''} ${esc(e.msg)}</div>`).join('');
}

function row(l, staged, cfg) {
  const id = esc(String(l.threadId));
  const tier = (l.score ?? 0) >= 15 ? 'hot' : (l.score ?? 0) >= 10 ? 'warm' : '';
  const state = l.status === 'POSTED' ? 'posted'
              : ['SKIPPED', 'EXPIRED'].includes(l.status) ? 'dim' : '';
  const cells = COLS.map((c) => {
    let html;
    try { html = c.cell(l); } catch { html = '<span class="sub">—</span>'; }
    return `<td class="${c.num ? 'num' : ''}">${html}</td>`;
  }).join('');
  return `<tr class="r ${tier} ${state}" data-row="${id}">${cells}</tr>` +
         (openRow === String(l.threadId) ? detail(l, staged, cfg) : '');
}

function detail(l, staged, cfg) {
  const id = esc(String(l.threadId));
  const done = ['POSTED', 'SKIPPED', 'EXPIRED'].includes(l.status);
  let dm = editedDm[l.threadId] ?? l.dm;
  if (dm == null) { try { dm = renderDm(l, cfg); } catch { dm = ''; } }
  // Say plainly who wrote the technical lines, so the drafts can be trusted
  // or challenged without opening the log.
  const byClaude = Array.isArray(l.aiSpecifics) && l.aiSpecifics.length;
  const who = byClaude
    ? `<div class="sub" style="margin-bottom:8px;color:#16a34a">Claude wrote the ${l.aiSpecifics.length} technical line(s) in this draft:
        ${l.aiSpecifics.map((b) => `<span style="opacity:.85">"${esc(b)}"</span>`).join(' ')}</div>`
    : `<div class="sub" style="margin-bottom:8px;color:#b45309">Built-in rules wrote this one, not Claude.
        Add a key in Settings, then press "Rebuild drafts" to have Claude redo it.</div>`;
  return `<tr class="detail"><td colspan="${COLS.length}">
    ${l.snippet ? `<div class="snip">${esc(l.snippet)}</div>` : ''}
    ${who}
    ${staged[l.threadId] ? '<div class="sub" style="margin-bottom:8px">⚡ armed in a background tab — Post now fires instantly</div>' : ''}
    <div class="cols">
      <div>
        <div class="lbl">Public reply</div>
        <textarea data-draft="${id}" ${done ? 'readonly' : ''}>${esc(edited[l.threadId] ?? l.draft ?? '')}</textarea>
        <div class="acts">
          <button data-act="copy" data-id="${id}">📋 Copy</button>
          ${done ? `<button data-act="open" data-id="${id}">🔗 Thread</button>`
                 : `<button data-act="fill" data-id="${id}">📝 Open filled</button>`}
          ${done ? '' : `<button class="go" data-act="post" data-id="${id}">🚀 Post now</button>
          <button data-act="done" data-id="${id}">✅ I posted it</button>
          <button class="warn" data-act="skip" data-id="${id}">⏭ Skip</button>`}
        </div>
      </div>
      <div>
        <div class="lbl">✉️ Private message to ${esc(l.author || '')}</div>
        <textarea class="dm" data-dm="${id}">${esc(dm)}</textarea>
        <div class="acts">
          ${l.pmSent ? '<span class="st POSTED">PM sent</span>' : `
          <button class="go" data-act="senddm" data-id="${id}">✉️ Send PM now</button>
          `}
          <button data-act="copydm" data-id="${id}">📋 Copy</button>
          <button data-act="opendm" data-id="${id}">📝 Open filled</button>
          ${l.pmSent ? '' : `<button data-act="pmsent" data-id="${id}">✅ I sent it</button>`}
        </div>
        ${l.pmError ? `<div class="msg err">${esc(l.pmError)}</div>` : ''}
      </div>
    </div>
    ${l.error ? `<div class="msg err">${esc(l.error)}</div>` : ''}
    ${l.postUrl ? `<div class="msg ok"><a href="${esc(l.postUrl)}" target="_blank" rel="noopener">view your reply</a></div>` : ''}
    <div class="msg" id="msg-${id}"></div>
  </td></tr>`;
}

function say(id, text, ok) {
  const el = $(`msg-${id}`);
  if (el) { el.textContent = text; el.className = `msg ${ok ? 'ok' : 'err'}`; }
}

// ------------------------------------------------------------------ events

document.addEventListener('input', (e) => {
  const id = e.target.dataset?.draft;
  if (id) edited[id] = e.target.value;
  const dmId = e.target.dataset?.dm;
  if (dmId) editedDm[dmId] = e.target.value;
});

// Sort by clicking a column header; clicking the active one reverses it.
$('head').addEventListener('click', (e) => {
  const key = e.target.closest('th[data-sort]')?.dataset.sort;
  if (!key) return;
  if (sortKey === key) sortDir = -sortDir;
  else { sortKey = key; sortDir = (COLS.find((c) => c.key === key) || {}).dir ?? -1; }
  render();
});

// Click a row to open it; click again to close.
$('rows').addEventListener('click', (e) => {
  if (e.target.closest('a, button, textarea')) return;
  const id = e.target.closest('tr[data-row]')?.dataset.row;
  if (!id) return;
  openRow = openRow === id ? null : id;
  render();
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id, act = btn.dataset.act;
  const cfg = await getConfig();
  const lead = (await getLeads()).find((l) => String(l.threadId) === String(id));
  if (!lead) return;
  const draft = edited[id] ?? lead.draft ?? '';
  let dm = editedDm[id] ?? lead.dm;
  if (dm == null) { try { dm = renderDm(lead, cfg); } catch { dm = ''; } }

  if (act === 'copy')  { await navigator.clipboard.writeText(draft); return say(id, 'Copied — paste into the thread.', true); }
  if (act === 'open')  { chrome.tabs.create({ url: lead.url }); return; }
  if (act === 'fill') {
    btn.disabled = true;
    say(id, 'Opening the thread and typing the reply in…', true);
    const r = await chrome.runtime.sendMessage({ cmd: 'fill-thread', lead: { ...lead, draft } });
    btn.disabled = false;
    return say(id, r?.ok ? 'Filled in — check the tab and press Post reply. 🚀 also fires instantly now.'
                         : `Could not fill it: ${r?.error || 'unknown'}`, !!r?.ok);
  }
  if (act === 'copydm') { await navigator.clipboard.writeText(dm); return say(id, 'PM copied.', true); }
  if (act === 'opendm') {
    // Open it filled in, not blank — the body cannot ride in the URL.
    await navigator.clipboard.writeText(dm).catch(() => {});
    say(id, 'Opening the DM page and filling it in…', true);
    const r = await chrome.runtime.sendMessage({ cmd: 'send-dm', lead: { ...lead, dm }, mode: 'fill' });
    return say(id, r?.ok ? 'Filled in — check the tab and press Send direct message.'
                         : `Opened, but could not fill it: ${r?.error || 'unknown'} — the text is on your clipboard.`, !!r?.ok);
  }
  if (act === 'pmsent') { await chrome.runtime.sendMessage({ cmd: 'mark-pm', threadId: id }); delete editedDm[id]; return render(); }
  if (act === 'senddm') {
    if (!confirm(`Send this DM to ${lead.author} now?\n\nUnsolicited PMs are what BHW moderators act on — keep the volume low.`)) return;
    btn.disabled = true;
    say(id, 'Sending…', true);
    const r = await chrome.runtime.sendMessage({ cmd: 'send-dm', lead: { ...lead, dm }, mode: 'send' });
    btn.disabled = false;
    say(id, r?.ok ? 'DM sent ✅' : `Failed: ${r?.error || 'unknown'}`, !!r?.ok);
    if (r?.sent) delete editedDm[id];
    return render();
  }
  if (act === 'post') {
    if (!confirm(`Post this reply to "${lead.title}" now?`)) return;
    btn.disabled = true; say(id, 'Posting…', true);
    const r = await chrome.runtime.sendMessage({ cmd: 'post-direct', lead: { ...lead, draft }, edited: draft !== lead.draft });
    btn.disabled = false;
    say(id, r?.ok ? 'Posted ✅' : `Failed: ${r?.error || 'unknown'}`, !!r?.ok);
    delete edited[id];
    return render();
  }
  if (act === 'done' || act === 'skip') {
    await chrome.runtime.sendMessage({ cmd: 'mark', threadId: id,
      status: act === 'done' ? 'POSTED' : 'SKIPPED',
      detail: act === 'done' ? 'posted manually (dashboard)' : '' });
    delete edited[id];
    return render();
  }
});

const busy = async (id, label, fn) => {
  const b = $(id), old = b.textContent;
  b.textContent = label; b.disabled = true;
  try { return await fn(); } finally { b.textContent = old; b.disabled = false; render(); }
};

$('poll').addEventListener('click', () => busy('poll', 'Checking…', async () => {
  const r = await chrome.runtime.sendMessage({ cmd: 'poll-now' });
  if (r?.error) alert(r.error);
  else if (r?.skipped) alert('The watcher is switched off. Turn on "Watcher enabled" in Settings and save.');
}));
$('update').addEventListener('click', () => busy('update', 'Looking…', async () => {
  const r = await chrome.runtime.sendMessage({ cmd: 'check-update' });
  if (r?.reloading) return;
  alert(r?.error || `Already on v${r?.version}. Copy the command below into Terminal first, then press Install update again.`);
}));
$('approvals').addEventListener('click', () => busy('approvals', 'Posting…', () => chrome.runtime.sendMessage({ cmd: 'approvals-now' })));
$('sync').addEventListener('click', () => busy('sync', 'Loading…', async () => {
  const r = await chrome.runtime.sendMessage({ cmd: 'sync' });
  if (r?.error) alert(r.error);
}));
$('regen').addEventListener('click', () => busy('regen', 'Rebuilding…', async () => {
  const r = await chrome.runtime.sendMessage({ cmd: 'regen' });
  alert(`Rebuilt ${r?.updated ?? 0} draft(s).` +
    (r?.ai ? `\nClaude wrote fresh technical lines for ${r.ai} of them.` : '') +
    (r?.pending ? `\n${r.pending} still on the built-in rules — add a Claude key in Settings, or the daily spend limit was reached.` : ''));
}));
$('backfill').addEventListener('click', async () => {
  if (!confirm('Record the last 48 hours of HAF threads? Nothing is sent to Telegram.')) return;
  await busy('backfill', 'Loading…', async () => {
    const r = await chrome.runtime.sendMessage({ cmd: 'backfill' });
    alert(r?.error ? r.error : `Recorded ${r?.backfilled ?? 0} thread(s).`);
  });
});
$('deep').addEventListener('click', async () => {
  const pages = parseInt(prompt('How many listing pages to walk? (20 threads each)', '5'), 10);
  if (!isFinite(pages) || pages < 1) return;
  const days = parseInt(prompt('Only threads started in the last N days? (0 = no limit)', '30'), 10);
  await busy('deep', 'Scraping…', async () => {
    const r = await chrome.runtime.sendMessage({ cmd: 'deep-backfill', opts: { pages, sinceDays: isFinite(days) ? days : 0 } });
    alert(r?.error ? r.error
      : `Scanned ${r.scanned}, recorded ${r.backfilled} new.\n\nListing rows carry no post body, so these are scored on the title alone.`);
  });
});
$('opts').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('cmd').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('cmd').textContent.trim());
  $('cmdmsg').textContent = 'copied';
  setTimeout(() => ($('cmdmsg').textContent = ''), 3000);
});
$('q').addEventListener('input', render);
$('fstatus').addEventListener('input', render);
$('hidedone').addEventListener('input', render);

chrome.storage.onChanged.addListener(() => render());
render();
