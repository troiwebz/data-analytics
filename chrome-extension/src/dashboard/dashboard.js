// The dashboard: one sortable table. Click a column header to sort by it,
// click again to reverse. Click a row to open the reply, the PM and the
// actions for that lead.
import { getConfig } from '../config.js';
import { stamp, partsIn, todayKey } from '../timefmt.js';
import { renderDm, partsFor, offerOf, plain } from '../templates.js';
import { getLeads, getLog, getRateState, getStaged } from '../store.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Times are rendered in the zone set in Settings, on a 12 hour clock. The
// config arrives before the first render; until then fall back to the default.
let tz = {};
const when = (iso) => stamp(iso, tz);
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
    // The title opens the draft, because that is what a click on a row is for.
    // Going to the thread on BHW is the arrow next to it, deliberately small.
    cell: (l) => `<span class="ch">${openRow === String(l.threadId) ? '▾' : '▸'}</span>` +
      `<span class="t">${esc(l.title || '(no title)')}</span>` +
      doneTag(l) +
      ` <a class="ext" href="${esc(l.url)}" target="_blank" rel="noopener" title="Open this thread on BlackHatWorld">↗</a>` +
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

let rendering = false, rerun = false;
async function render() {
  // Never re-enter: a nested render spins. But a render asked for while one is
  // running (a click landing mid-refresh) must not be dropped either, or the
  // row would not open - so remember it and run once more at the end.
  if (rendering) { rerun = true; return; }
  rendering = true;
  try { await renderInner(); }
  catch (e) {
    $('rows').innerHTML = `<tr><td colspan="${COLS.length}"><div class="empty" style="color:var(--red)">` +
      `<b>The table failed to render.</b><br>${esc(e && e.message ? e.message : e)}<br><br>` +
      `<span class="sub">Press <b>Update now</b>; if it persists open DevTools (⌥⌘I) → Console and send me the red line.</span>` +
      `</div></td></tr>`;
    console.error('[HAF dashboard]', e);
  } finally {
    rendering = false;
    if (rerun) { rerun = false; render(); }
  }
}

async function renderInner() {
  const [cfg, leads, log, rate, staged] = await Promise.all(
    [getConfig(), getLeads(), getLog(), getRateState(), getStaged()]);
  // Cheap and cached by the service worker; never blocks the table.
  const ai = await chrome.runtime.sendMessage({ cmd: 'ai-status' }).catch(() => ({}));

  tz = cfg;                                  // every when() below uses this zone
  $('ver').textContent = 'v' + chrome.runtime.getManifest().version;
  $('dot').className = 'dot' + (cfg.enabled ? ' on' : '');
  $('state').textContent = cfg.enabled ? `Watching the forum` : 'Not watching · turn it on in Settings';
  // Two separate caps, so show two. A reply posted and a PM sent are different
  // things, and counting them together is what made the number look wrong.
  $('rate').innerHTML =
    meter('Replies', rate.count || 0, cfg.maxPostsPerDay) +
    meter('PMs', rate.dmCount || 0, cfg.maxDmsPerDay);
  // Apps Script is optional; hide what needs it rather than failing on a click.
  for (const id of ['approvals', 'sync']) $(id).hidden = !cfg.webhookUrl;

  const today = leads.filter((l) => time(l.foundAt) > Date.now() - 86400000);
  // Launched today means the thread was started today, which is not the same
  // as us noticing it today: a backfill finds old threads, and a thread found
  // at 00:05 was launched yesterday.
  // Only a start time read off the listing counts: the feed's date is the
  // thread's last reply, so a bumped old thread is not a launch.
  const startedToday = (() => {
    const key = todayKey(cfg);
    return leads.filter((l) => { if (l.postedAtSource !== 'listing') return false;
      const d = new Date(l.postedAt);
      return !isNaN(d) && partsIn(d, cfg).key === key; }).length;
  })();
  const n = (s) => leads.filter((l) => l.status === s).length;
  const tiles = [
    [leads.length, 'in database'], [startedToday, 'launched today'], [today.length, 'found today'],
    [n('POSTED'), 'replies posted'],
    [leads.filter((l) => l.pmSent).length, 'PMs sent'],
    [n('SKIPPED'), 'skipped'], [Object.keys(staged).length, 'staged']
  ];
  if (ai?.configured) {
    // Spend is exact. Balance is our own count-down from the top-up figure you
    // entered: Anthropic has no endpoint that reports remaining credit.
    tiles.push([`$${Number(ai.spentToday || 0).toFixed(3)}`,
                ai.budget > 0 ? `claude today · of $${Number(ai.budget).toFixed(2)}` : 'claude today']);
    if (ai.budget > 0) tiles.push([`$${Number(ai.remaining).toFixed(3)}`, 'left today']);
    tiles.push(ai.credits > 0
      ? [`$${Number(ai.balance).toFixed(2)}`, 'balance left (estimate)']
      : [`$${Number(ai.spentTotal || 0).toFixed(2)}`, 'claude, all time']);
  } else if (cfg.aiSpecifics) {
    tiles.push(['off', 'claude · add a key']);
  }
  $('stats').innerHTML = tiles
    .map(([v, k]) => {
      const warn = (String(k).startsWith('claude') && ai.overBudget)
                || (k === 'left today' && ai.overBudget)
                || (k.startsWith('balance') && Number(ai.balance) <= 1);
      return `<div class="k"${warn ? ' style="border-color:#fecaca"' : ''}><b>${v}</b><span>${k}</span></div>`;
    })
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

/**
 * What was actually done to a thread, said in words next to the title rather
 * than only as a strike through it. A strike alone is easy to miss on a long
 * list, and it does not distinguish a posted reply from a PM.
 */
function doneTag(l) {
  const posted = l.status === 'POSTED';
  if (!posted && !l.pmSent) return '';
  const label = posted && l.pmSent ? 'replied + PM sent' : posted ? 'reply posted' : 'PM sent';
  const from = l.pmFrom ? ` (found in ${l.pmFrom})` : '';
  return ` <span class="done" title="${esc(l.pmSentAt || '')}${esc(from)}">✓ ${label}</span>`;
}

/**
 * How much of a daily cap is used. Green while there is room, amber as it
 * closes, red at the cap, so the state is readable without doing the sum.
 */
function meter(label, used, cap) {
  // 0 means the limit is off, so there is nothing to fill: show the count and
  // leave the track empty rather than pretending the cap is 1 and sitting red.
  if (!(Number(cap) > 0)) {
    return `<span class="meter" title="${esc(label)}: no limit set">` +
           `<span class="mtop">${esc(label)} <b>${used}</b></span>` +
           `<span class="mbar"></span></span>`;
  }
  const pct = Math.min(100, Math.round((used / cap) * 100));
  const colour = pct >= 100 ? '#dc2626' : pct >= 80 ? '#f59e0b' : '#22c55e';
  return `<span class="meter" title="${esc(label)}: ${used} of ${cap} used today">` +
         `<span class="mtop">${esc(label)} <b>${used}/${cap}</b></span>` +
         `<span class="mbar"><i style="width:${pct}%;background:${colour}"></i></span></span>`;
}

function row(l, staged, cfg) {
  const id = esc(String(l.threadId));
  const tier = (l.score ?? 0) >= 15 ? 'hot' : (l.score ?? 0) >= 10 ? 'warm' : '';
  // Struck through once it has been actioned. Green for a posted reply, blue
  // for a PM sent: both are done, and which one it was should be readable
  // without opening the row.
  const state = l.status === 'POSTED' ? 'posted'
              : ['SKIPPED', 'EXPIRED'].includes(l.status) ? 'dim'
              : l.pmSent ? 'pmdone' : '';
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
  let parts = { tips: [], offer: '' };
  try { parts = partsFor(l, cfg); } catch { /* shown as built-in below */ }
  const byClaude = !!(l.aiSpecifics?.tips?.length || l.aiSpecifics?.length);
  const OFFER_LABEL = { pilot: 'small first order', ready: 'already built', formula: 'the method, given away',
                        terms: 'pay after the first batch', scope: 'fixed price today' };
  const who = byClaude
    ? `<div class="sub" style="margin-bottom:8px;color:#16a34a">Claude wrote the ${parts.tips.length} technical line(s):
        ${parts.tips.map((b) => `<span style="opacity:.85">"${esc(b)}"</span>`).join(' ')}
        ${parts.offer ? `<br>Close chosen: <b>${esc(OFFER_LABEL[parts.offer] || parts.offer)}</b>` : ''}</div>`
    : `<div class="sub" style="margin-bottom:8px;color:#b45309">Built-in rules wrote this one, not Claude.
        Add a key in Settings, then press "Rebuild drafts" to have Claude redo it.</div>`;
  return `<tr class="detail"><td colspan="${COLS.length}">
    ${l.snippet ? `<div class="snip">${esc(l.snippet)}</div>` : ''}
    ${who}
    ${l.priorContact && !l.pmSent ? `<div class="sub" style="margin-bottom:8px;color:#b45309">You have messaged ${esc(l.author || 'them')} before (${esc(l.priorContact)}). Worth a look before pitching again.</div>` : ''}
    ${staged[l.threadId] ? '<div class="sub" style="margin-bottom:8px">⚡ armed in a background tab — Post now fires instantly</div>' : ''}
    <div class="cols">
      <div>
        <div class="lbl">Public reply</div>
        <textarea data-draft="${id}" ${done ? 'readonly' : ''}>${esc(plain(edited[l.threadId] ?? l.draft ?? ''))}</textarea>
        <div class="acts">
          <button data-act="copy" data-id="${id}">📋 Copy</button>
          ${done ? `<button data-act="open" data-id="${id}">🔗 Thread</button>
                    <button data-act="undo" data-id="${id}" title="Put it back on the to-do list">↩︎ Undo</button>`
                 : `<button data-act="fill" data-id="${id}">📝 Open filled</button>`}
          ${done ? '' : `<button class="go" data-act="post" data-id="${id}">🚀 Post now</button>
          <button data-act="done" data-id="${id}">✅ I posted it</button>
          <button class="warn" data-act="skip" data-id="${id}">⏭ Skip</button>`}
        </div>
      </div>
      <div>
        <div class="lbl">✉️ Private message to ${esc(l.author || '')}</div>
        <textarea class="dm" data-dm="${id}">${esc(plain(dm))}</textarea>
        <div class="acts">
          ${l.pmSent ? `<span class="st POSTED">PM sent</span>
                        <button data-act="undopm" data-id="${id}" title="Mark the PM as not sent">↩︎ Undo</button>` : `
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
    <div class="msg${flash[id]?.ok === false ? ' err' : flash[id] ? ' ok' : ''}" id="msg-${id}">${esc(flash[id]?.text || '')}</div>
  </td></tr>`;
}

/**
 * A row's message has to survive the re-render that usually follows the action
 * that produced it, or the confirmation flashes away before it can be read.
 * It is held here and re-rendered with the row until it is cleared.
 */
const flash = {};
function say(id, text, ok) {
  clearTimeout(flash[id]?.t);          // before replacing it, or the old timer leaks
  flash[id] = { text, ok, t: setTimeout(() => { delete flash[id]; render(); }, 6000) };
  paint(id, text, ok);
}

function paint(id, text, ok) {
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

// Click anywhere on a row to open it; click again to close. Only real
// controls inside the row are exempt.
$('rows').addEventListener('click', (e) => {
  if (e.target.closest('a, button, textarea, input, select')) return;
  const id = e.target.closest('tr[data-row]')?.dataset.row;
  if (!id) return;
  openRow = openRow === id ? null : id;
  render();
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  rowAction(btn).catch((err) => {
    say(btn.dataset.id, `That did not work: ${err && err.message ? err.message : err}`, false);
    console.error('[HAF dashboard]', err);
  });
});

async function rowAction(btn) {
  const id = btn.dataset.id, act = btn.dataset.act;
  const cfg = await getConfig();
  const lead = (await getLeads()).find((l) => String(l.threadId) === String(id));
  if (!lead) return;
  const draft = edited[id] ?? lead.draft ?? '';
  let dm = editedDm[id] ?? lead.dm;
  if (dm == null) { try { dm = renderDm(lead, cfg); } catch { dm = ''; } }

  // Copying is how the reply actually gets posted most of the time, so it
  // counts as posting. Wrong copy? The row gets an Undo while it is open.
  if (act === 'copy') {
    await navigator.clipboard.writeText(plain(draft));
    await chrome.runtime.sendMessage({ cmd: 'mark', threadId: id, status: 'POSTED', detail: 'copied from the dashboard' });
    delete edited[id];
    say(id, 'Copied and marked as posted. Paste it into the thread.', true);
    return render();
  }
  if (act === 'open')  { chrome.tabs.create({ url: lead.url }); return; }
  if (act === 'fill') {
    btn.disabled = true;
    say(id, 'Opening the thread and typing the reply in…', true);
    const r = await chrome.runtime.sendMessage({ cmd: 'fill-thread', lead: { ...lead, draft } });
    btn.disabled = false;
    if (!r?.ok) return say(id, `Could not fill it: ${r?.error || 'unknown'}`, false);
    // Opening it filled means you are posting it, so the row is marked now
    // rather than waiting for a second click that is easy to forget. Undo is
    // on the row if you change your mind in the tab.
    await chrome.runtime.sendMessage({ cmd: 'mark', threadId: id, status: 'POSTED', detail: 'opened filled from the dashboard' });
    delete edited[id];
    say(id, 'Filled in and marked as posted. Press Post reply in the tab. Undo here if you change your mind.', true);
    return render();
  }
  if (act === 'copydm') {
    await navigator.clipboard.writeText(plain(dm));
    await chrome.runtime.sendMessage({ cmd: 'mark-pm', threadId: id });
    say(id, 'PM copied and marked as sent. Paste it on the PM page.', true);
    return render();
  }
  if (act === 'opendm') {
    // Open it filled in, not blank — the body cannot ride in the URL.
    await navigator.clipboard.writeText(plain(dm)).catch(() => {});
    say(id, 'Opening the DM page and filling it in…', true);
    const r = await chrome.runtime.sendMessage({ cmd: 'send-dm', lead: { ...lead, dm }, mode: 'fill' });
    if (!r?.ok) {
      return say(id, `Opened, but could not fill it: ${r?.error || 'unknown'} — the text is on your clipboard.`, false);
    }
    await chrome.runtime.sendMessage({ cmd: 'mark-pm', threadId: id });
    say(id, 'Filled in and marked as sent. Press Send direct message in the tab. Undo here if you change your mind.', true);
    return render();
  }
  if (act === 'pmsent') {
    await chrome.runtime.sendMessage({ cmd: 'mark-pm', threadId: id });
    delete editedDm[id];
    say(id, 'Marked as sent.', true);
    return render();
  }
  if (act === 'undo')   { await chrome.runtime.sendMessage({ cmd: 'unmark', threadId: id }); return render(); }
  if (act === 'undopm') { await chrome.runtime.sendMessage({ cmd: 'unmark-pm', threadId: id }); return render(); }
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
    say(id, act === 'done' ? 'Marked as posted.' : 'Skipped.', true);
    return render();
  }
}

const busy = async (id, label, fn) => {
  const b = $(id), old = b.textContent;
  b.textContent = label; b.disabled = true;
  // A manual check resets the alarm, so re-read the schedule rather than
  // letting the countdown run on toward a time that has moved.
  try { return await fn(); } finally { b.textContent = old; b.disabled = false; render(); refreshCountdown(); }
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
$('pmcheck').addEventListener('click', () => busy('pmcheck', 'Reading…', async () => {
  const r = await chrome.runtime.sendMessage({ cmd: 'sync-pms' });
  if (r?.error) return alert(`Could not read your message list: ${r.error}`);
  alert(`Read ${r.conversations} conversation(s) from your BHW message list.\n\n` +
    `${r.marked} thread(s) ticked off as already sent.\n` +
    `${r.known} more are with people you have spoken to before.`);
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
$('insights').addEventListener('click', () => {
  location.href = chrome.runtime.getURL('src/insights/insights.html');
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

// Re-render when the data behind the table changes. Two guards, because a
// storage write that happens *during* a render would otherwise re-trigger one
// and spin forever, leaving the page unresponsive to clicks:
//   - only keys the table is built from count as a change
//   - renders are coalesced, and one never starts while another is running
const WATCHED = ['recentLeads', 'config', 'rateState', 'staged', 'log'];
let pending = null;
// ---- the countdown to the next check ------------------------------------
//
// Ticks every second off chrome.alarms' own schedule, so it cannot drift from
// when the check will actually run. The alarm is the truth; this only reads it.

const cd = $('countdown');
let nextCheck = null;

const mmss = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function paintCountdown() {
  if (!nextCheck) { cd.hidden = true; return; }
  if (!nextCheck.enabled) {
    cd.hidden = false; cd.className = 'cd';
    cd.innerHTML = 'Not watching';
    return;
  }
  const left = nextCheck.at - Date.now();
  cd.hidden = false;
  // A check can take a few seconds, and the poll adds up to jitterSeconds on
  // top, so past zero say it is running rather than counting into the negative.
  if (left <= 0) {
    cd.className = 'cd now';
    cd.innerHTML = '<span class="pulse"></span>Checking the forum now…';
    return;
  }
  cd.className = 'cd' + (left < 30000 ? ' soon' : '');
  cd.innerHTML = `<span class="pulse"></span>Next check in <b>${mmss(left)}</b>`;
  cd.title = `Every ${nextCheck.everyMinutes} min` +
    (nextCheck.jitterSeconds ? `, plus up to ${nextCheck.jitterSeconds}s of jitter so it is not clockwork` : '') +
    (nextCheck.lastAt ? `\nLast check: ${when(new Date(nextCheck.lastAt).toISOString())}` : '');
}

async function refreshCountdown() {
  nextCheck = await chrome.runtime.sendMessage({ cmd: 'next-check' }).catch(() => null);
  paintCountdown();
}

setInterval(paintCountdown, 1000);        // the display
setInterval(refreshCountdown, 15000);     // re-read the real schedule
// A backgrounded tab is throttled, so the cached schedule is stale the moment
// it comes back. Re-read on focus rather than showing a number that is wrong
// for up to fifteen seconds.
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshCountdown(); });
window.addEventListener('focus', refreshCountdown);
refreshCountdown();

// Any choice from the menu closes it, and so does a click anywhere else.
$('menu').addEventListener('click', (e) => {
  if (e.target.closest('.panel button')) $('menu').open = false;
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#menu')) $('menu').open = false;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !Object.keys(changes).some((k) => WATCHED.includes(k))) return;
  clearTimeout(pending);
  pending = setTimeout(render, 150);
});
render();
