import { getConfig } from '../config.js';
import { getLeads, getLog, getRateState } from '../store.js';

const $ = (id) => document.getElementById(id);

function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

async function render() {
  const [cfg, leads, log, rate] = await Promise.all([getConfig(), getLeads(), getLog(), getRateState()]);

  $('dot').style.background = cfg.enabled ? '#22c55e' : '#64748b';
  $('state').textContent = cfg.enabled ? `Watching · every ${cfg.pollMinutes}m` : 'Paused';
  $('rate').textContent = `${rate.count}/${cfg.maxPostsPerDay} today`;

  const staged = await chrome.runtime.sendMessage({ cmd: 'staged' }).catch(() => ({}));
  const day = Date.now() - 86400000;
  const today = leads.filter((l) => new Date(l.foundAt).getTime() > day);
  const n = (s) => today.filter((l) => l.status === s).length;
  $('stats').innerHTML = [
    [today.length, 'seen'], [n('POSTED'), 'posted'], [n('FAILED'), 'failed'],
    [Object.keys(staged || {}).length, 'staged']
  ].map(([v, k]) => `<div class="k"><b>${v}</b><span>${k}</span></div>`).join('');

  $('leads').innerHTML = leads.length
    ? leads.slice(0, 12).map((l) => `
        <div class="lead">
          <span class="s">${l.score}</span>
          <a class="t" href="${l.url}" target="_blank">${escapeHtml(l.title).slice(0, 70)}</a>
          <div class="m">
            <span class="st ${l.status || ''}">${l.status || 'sent'}</span>${l.staged ? ' <span class="st STAGED">armed</span>' : ''}${l.replyCount != null ? ` · 💬 ${l.replyCount}` : ''}
            ${escapeHtml(l.categoryLabel || '')} · ${l.budget ? escapeHtml(l.budget) + ' · ' : ''}${ago(l.foundAt)}
            ${l.error ? `<br><span style="color:#b91c1c">${escapeHtml(l.error).slice(0, 90)}</span>` : ''}
          </div>
        </div>`).join('')
    : '<div class="empty">No leads yet. They appear here and in your inbox.</div>';

  $('log').innerHTML = log.slice(0, 12)
    .map((l) => `<div style="${l.level === 'error' ? 'color:#b91c1c' : ''}">${l.t.slice(11, 16)} ${escapeHtml(l.msg)}</div>`)
    .join('');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

$('poll').addEventListener('click', async () => {
  $('poll').textContent = '…';
  await chrome.runtime.sendMessage({ cmd: 'poll-now' });
  $('poll').textContent = 'Poll now';
  render();
});
$('approvals').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ cmd: 'approvals-now' });
  render();
});
$('opts').addEventListener('click', () => chrome.runtime.openOptionsPage());

render();
