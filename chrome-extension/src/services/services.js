// Your own BHW service threads: a page of its own, deliberately separate
// from the HAF leads dashboard. Those are other people's buyer threads;
// these are yours, tracked for BHW's own bump rule (24h genuine / 72h promo).
// Nothing here reads or writes a single row of the leads table.
import { getConfig } from '../config.js';
import { isBumpEligible, hoursUntilEligible } from '../services.js';

const $ = (id) => document.getElementById(id);

const relTime = (iso) => {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.round(ms / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

async function render() {
  const cfg = await getConfig();
  const threads = cfg.serviceThreads || [];
  const list = $('list');
  if (!threads.length) {
    list.innerHTML = '<div class="empty">No service threads tracked yet — paste a link above to add one.</div>';
    return;
  }
  list.innerHTML = '';
  for (const t of threads) {
    const ready = isBumpEligible(t);
    const el = document.createElement('div');
    el.className = 'thread';
    el.innerHTML = `
      <div class="top">
        <span class="label">${escHtml(t.label || t.id)}</span>
        <span class="pill ${ready ? 'ready' : 'wait'}">${ready ? '🔔 eligible now' : `⏳ eligible in ${hoursUntilEligible(t)}h`}</span>
      </div>
      ${t.url ? `<a href="${escHtml(t.url)}" target="_blank" rel="noopener">${escHtml(t.url)}</a>` : ''}
      <div class="meta">Last bumped: ${relTime(t.lastBumpedAt)}</div>
      <div class="idea"></div>
      <div class="acts">
        <button data-act="idea">💡 Get idea</button>
        <button data-act="bumped">✅ Mark bumped</button>
        <button data-act="untrack">🗑️ Untrack</button>
      </div>`;
    el.querySelector('[data-act="idea"]').addEventListener('click', (e) => onIdea(e, t));
    el.querySelector('[data-act="bumped"]').addEventListener('click', (e) => onBumped(e, t));
    el.querySelector('[data-act="untrack"]').addEventListener('click', (e) => onUntrack(e, t));
    list.appendChild(el);
  }
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function onIdea(e, t) {
  const btn = e.currentTarget;
  const box = btn.closest('.thread').querySelector('.idea');
  btn.disabled = true;
  const r = await chrome.runtime.sendMessage({ cmd: 'bump-idea', label: t.label || t.id });
  btn.disabled = false;
  if (!r?.ok) { box.style.display = 'block'; box.textContent = 'Could not build a suggestion for this thread.'; return; }
  box.style.display = 'block';
  box.textContent = r.text;
}

async function onBumped(e, t) {
  e.currentTarget.disabled = true;
  await chrome.runtime.sendMessage({ cmd: 'mark-bumped-thread', label: t.label || t.id });
  await render();
}

async function onUntrack(e, t) {
  if (!confirm(`Stop tracking "${t.label || t.id}"?`)) return;
  e.currentTarget.disabled = true;
  await chrome.runtime.sendMessage({ cmd: 'untrack-service-thread', label: t.label || t.id });
  await render();
}

$('bulkTrackBtn').addEventListener('click', async () => {
  const text = $('bulkTrack').value.trim();
  const bs = $('bulkTrackStatus');
  if (!text) { bs.className = 'msg err'; bs.textContent = 'Paste at least one BHW thread link first.'; return; }
  bs.className = 'msg'; bs.textContent = 'Reading each thread…';
  $('bulkTrackBtn').disabled = true;
  try {
    const r = await chrome.runtime.sendMessage({ cmd: 'batch-track-services', text });
    if (r?.error) { bs.className = 'msg err'; bs.textContent = r.error; return; }
    const parts = [];
    if (r.added.length) parts.push(`${r.added.length} added`);
    if (r.already.length) parts.push(`${r.already.length} already tracked`);
    if (r.noTitle.length) parts.push(`${r.noTitle.length} could not be titled, added anyway`);
    bs.className = 'msg' + (r.added.length ? ' ok' : '');
    bs.textContent = parts.length ? parts.join(', ') + '.' : 'No BHW thread links found in that text.';
    if (r.added.length) { $('bulkTrack').value = ''; await render(); }
  } finally {
    $('bulkTrackBtn').disabled = false;
  }
});

$('back').addEventListener('click', () => {
  location.href = chrome.runtime.getURL('src/dashboard/dashboard.html');
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.config) render();
});

render();
