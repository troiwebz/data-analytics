import { getConfig } from '../config.js';
import { renderDm } from '../templates.js';
import { getLeads, getLog, getRateState, getStaged } from '../store.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// All times in the viewer's local zone — never UTC.
const fmtAbs = (iso) => iso ? new Date(iso).toLocaleString(undefined, {
  day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';
const fmtTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
function ago(iso) {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

let edited = {};    // threadId -> public reply edited in the box
let editedDm = {};  // threadId -> PM edited in the box

async function render() {
  const [cfg, leads, log, rate, staged] = await Promise.all([getConfig(), getLeads(), getLog(), getRateState(), getStaged()]);

  $('dot').className = 'dot' + (cfg.enabled ? ' on' : '');
  $('state').textContent = cfg.enabled ? `Watching · every ${cfg.pollMinutes} min` : 'Paused — enable in Settings';
  $('rate').textContent = `${rate.count}/${cfg.maxPostsPerDay} 🚀 posts today`;

  const day = Date.now() - 86400000;
  const today = leads.filter((l) => new Date(l.foundAt).getTime() > day);
  const n = (s) => leads.filter((l) => l.status === s).length;
  $('stats').innerHTML = [
    [leads.length, 'in database'], [today.length, 'found today'],
    [n('POSTED'), 'posted'], [n('SKIPPED'), 'skipped'],
    [Object.keys(staged).length, 'staged tabs']
  ].map(([v, k]) => `<div class="k"><b>${v}</b><span>${k}</span></div>`).join('');

  // ---- filter / sort
  const q = $('q').value.trim().toLowerCase();
  const fs = $('fstatus').value;
  const hide = $('hidedone').checked;
  let list = leads.filter((l) => {
    if (fs && l.status !== fs) return false;
    if (hide && ['POSTED', 'SKIPPED', 'EXPIRED'].includes(l.status)) return false;
    if (q && !`${l.title} ${l.author} ${(l.matched || []).join(' ')} ${l.category}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const sort = $('fsort').value;
  list.sort((a, b) =>
    sort === 'score' ? b.score - a.score :
    sort === 'replies' ? (a.replyCount ?? 999) - (b.replyCount ?? 999) :
    sort === 'posted' ? new Date(b.postedAt) - new Date(a.postedAt) :
    new Date(b.foundAt) - new Date(a.foundAt));

  $('leads').innerHTML = list.length ? list.map((l) => card(l, staged, cfg)).join('')
    : `<div class="empty">Nothing here yet.<br>New HAF threads appear within ${cfg.pollMinutes} minutes of being posted. Click <b>Backfill 48h</b> to load recent history.</div>`;

  $('log').innerHTML = log.slice(0, 15)
    .map((e) => `<div class="${e.level}">${fmtTime(e.t)} ${esc(e.msg)}</div>`).join('');
}

function card(l, staged, cfg) {
  // Leads saved before PMs existed have no dm — render one now.
  const dmText = editedDm[l.threadId] ?? l.dm ?? renderDm(l, cfg);
  const tier = l.score >= 15 ? 'hot' : l.score >= 10 ? 'warm' : '';
  const isStaged = !!staged[l.threadId];
  const done = ['POSTED', 'SKIPPED', 'EXPIRED'].includes(l.status);
  const replies = l.replyCount == null ? '?' : l.replyCount;
  const stale = l.replyCount != null && l.replyCount >= 8;
  return `
  <div class="lead ${tier}" data-id="${esc(l.threadId)}">
    <div>
      <span class="score">${l.score}</span>
      <a class="t" href="${esc(l.url)}" target="_blank">${esc(l.title)}</a>
      <div class="meta">
        <span class="st ${esc(l.status || '')}">${esc(l.status || 'sent')}</span>
        ${isStaged ? '<span class="st APPROVED">armed in tab</span>' : ''}
        <span>👤 <b>${esc(l.author)}</b></span>
        <span class="${stale ? 'stale' : ''}">💬 <b>${replies}</b> replies${l.replyCount != null ? ` · you'd be #${l.replyCount + 1}` : ''}</span>
        <span>🕒 posted <b>${fmtAbs(l.postedAt)}</b> (${ago(l.postedAt)})</span>
        <span>🔎 found ${fmtAbs(l.foundAt)}</span>
        ${l.budget ? `<span>💰 <b>${esc(l.budget)}</b></span>` : ''}
        ${l.categoryLabel ? `<span>${esc(l.categoryLabel)}</span>` : ''}
      </div>
      <div class="snip" id="snip-${esc(l.threadId)}">${esc(l.snippet)}</div>
      <button class="more" data-more="${esc(l.threadId)}">show more</button>
      <div class="tags">${(l.matched || []).map(esc).join(' · ')}</div>
      ${l.error ? `<div class="msg err">${esc(l.error)}</div>` : ''}
      ${l.postUrl ? `<div class="msg ok"><a href="${esc(l.postUrl)}" target="_blank">view your reply</a></div>` : ''}
    </div>
    <div class="side">
      <div class="lbl">Public reply</div>
      <textarea data-draft="${esc(l.threadId)}" ${done ? 'readonly' : ''}>${esc(edited[l.threadId] ?? l.draft)}</textarea>
      <div class="acts">
        <button data-act="copy" data-id="${esc(l.threadId)}">📋 Copy reply</button>
        <button data-act="open" data-id="${esc(l.threadId)}">🔗 Open thread</button>
        ${done ? '' : `
        <button class="go" data-act="post" data-id="${esc(l.threadId)}">🚀 Post now</button>
        <button data-act="done" data-id="${esc(l.threadId)}">✅ I posted it</button>
        <button class="warn" data-act="skip" data-id="${esc(l.threadId)}">⏭ Skip</button>`}
      </div>
      <div class="lbl">✉️ Private message to ${esc(l.author)}${l.pmSent ? ' <span class="st POSTED">PM sent</span>' : ''}</div>
      <textarea class="dm" data-dm="${esc(l.threadId)}">${esc(dmText)}</textarea>
      <div class="acts">
        <button data-act="copydm" data-id="${esc(l.threadId)}">📋 Copy PM</button>
        <button data-act="opendm" data-id="${esc(l.threadId)}">✉️ Open PM page</button>
        <button data-act="pmsent" data-id="${esc(l.threadId)}">✅ I sent the PM</button>
      </div>
      <div class="msg" id="msg-${esc(l.threadId)}"></div>
    </div>
  </div>`;
}

function say(id, text, ok) {
  const el = $(`msg-${id}`);
  if (el) { el.textContent = text; el.className = `msg ${ok ? 'ok' : 'err'}`; }
}

document.addEventListener('input', (e) => {
  const id = e.target.dataset?.draft;
  if (id) edited[id] = e.target.value;
  const dmId = e.target.dataset?.dm;
  if (dmId) editedDm[dmId] = e.target.value;
});

document.addEventListener('click', async (e) => {
  const more = e.target.dataset?.more;
  if (more) { $(`snip-${more}`).classList.toggle('open'); e.target.textContent = $(`snip-${more}`).classList.contains('open') ? 'show less' : 'show more'; return; }

  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id, act = btn.dataset.act;
  const leads = await getLeads();
  const lead = leads.find((l) => String(l.threadId) === String(id));
  if (!lead) return;
  const draft = edited[id] ?? lead.draft;

  if (act === 'copy') {
    await navigator.clipboard.writeText(draft);
    say(id, 'Copied — paste it into the thread.', true);
    return;
  }
  if (act === 'open') { chrome.tabs.create({ url: lead.url }); return; }

  const cfgNow = await getConfig();
  const dm = editedDm[id] ?? lead.dm ?? renderDm(lead, cfgNow);
  if (act === 'copydm') {
    await navigator.clipboard.writeText(dm);
    say(id, 'PM copied — open the PM page and paste.', true);
    return;
  }
  if (act === 'opendm') {
    await navigator.clipboard.writeText(dm).catch(() => {});
    chrome.tabs.create({ url: lead.dmUrl || `https://www.blackhatworld.com/conversations/add?to=${encodeURIComponent(lead.author)}` });
    say(id, 'PM page opened with the recipient filled in; the PM text is on your clipboard — paste and send.', true);
    return;
  }
  if (act === 'pmsent') {
    await chrome.runtime.sendMessage({ cmd: 'mark-pm', threadId: id });
    delete editedDm[id];
    return render();
  }

  if (act === 'post') {
    if (!confirm(`Post this reply to "${lead.title}" now?`)) return;
    btn.disabled = true; say(id, 'Posting… (opens the thread in a background tab)', true);
    const r = await chrome.runtime.sendMessage({ cmd: 'post-direct', lead: { ...lead, draft }, edited: draft !== lead.draft });
    say(id, r?.ok ? 'Posted ✅' : `Failed: ${r?.error || 'unknown'}`, !!r?.ok);
    btn.disabled = false;
    delete edited[id];
    return render();
  }
  if (act === 'done' || act === 'skip') {
    const status = act === 'done' ? 'POSTED' : 'SKIPPED';
    await chrome.runtime.sendMessage({ cmd: 'mark', threadId: id, status, detail: act === 'done' ? 'posted manually (dashboard)' : '' });
    delete edited[id];
    return render();
  }
});

$('poll').addEventListener('click', async () => {
  $('poll').textContent = 'Polling…';
  const r = await chrome.runtime.sendMessage({ cmd: 'poll-now' });
  $('poll').textContent = 'Poll now';
  if (r?.error) alert(r.error);
  else if (r?.skipped) alert('Watcher is disabled — enable it in Settings.');
  render();
});
$('approvals').addEventListener('click', async () => { await chrome.runtime.sendMessage({ cmd: 'approvals-now' }); render(); });
$('sync').addEventListener('click', async () => {
  $('sync').textContent = 'Syncing…';
  const r = await chrome.runtime.sendMessage({ cmd: 'sync' });
  $('sync').textContent = 'Sync from Sheet';
  if (r?.error) alert(r.error);
  render();
});
$('backfill').addEventListener('click', async () => {
  if (!confirm('Record the last 48 hours of HAF threads in your Sheet? Nothing is sent to Telegram.')) return;
  $('backfill').textContent = '…';
  const r = await chrome.runtime.sendMessage({ cmd: 'backfill' });
  $('backfill').textContent = 'Backfill 48h';
  if (r?.error) alert(r.error); else alert(`Recorded ${r?.backfilled ?? 0} threads from the last 48h.`);
  render();
});
$('regen').addEventListener('click', async () => {
  $('regen').textContent = '…';
  const r = await chrome.runtime.sendMessage({ cmd: 'regen' });
  $('regen').textContent = 'Rebuild PMs';
  alert(`Rebuilt PM drafts for ${r?.updated ?? 0} lead(s).`);
  render();
});
$('opts').addEventListener('click', () => chrome.runtime.openOptionsPage());
['q', 'fstatus', 'fsort', 'hidedone'].forEach((id) => $(id).addEventListener('input', render));

$('ver').textContent = 'v' + chrome.runtime.getManifest().version;

// Refresh when the service worker changes anything.
chrome.storage.onChanged.addListener(() => render());
render();
