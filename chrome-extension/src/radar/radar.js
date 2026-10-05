// The Reply Radar page: what is waiting, what you replied to, what matched no
// word, and the settings. It only talks to the background; nothing here reads
// or posts on BHW.
import { GROUP_LABELS, KIND, ago } from '../radar.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const send = (msg) => chrome.runtime.sendMessage(msg);
const clock = (t) => (t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '–');
const lastAgo = (iso) => { const h = (Date.now() - new Date(iso || 0).getTime()) / 3600000; return !iso ? '' : h < 1 ? 'under 1h ago' : h < 48 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)} days ago`; };

let S = null, tab = 'queue';

function briefHtml(b) {
  if (!b) return '';
  const said = b.said && b.said.length ? b.said.map((x) => `${esc(x.point)} (${x.n})`).join('; ') : '';
  return `<div class="brief">${b.asked ? `<div><b>Asked:</b> ${esc(b.asked)}</div>` : ''}${said ? `<div><b>Already said:</b> ${said}</div>` : ''}${b.back ? `<div><b>Starter asked again:</b> ${esc(b.back)}</div>` : ''}${b.gap ? `<div><b>Missing:</b> ${esc(b.gap)}</div>` : ''}</div>`;
}

function render() {
  const { cfg, state, today, nextAt, wallUntil } = S;
  const q = Object.values(state.queue || {});
  const rank = { A: 0, B: 1, C: 2, G: 3 };
  q.sort((a, b) => (rank[a.tier] - rank[b.tier]) || (new Date(b.lastActivityAt) - new Date(a.lastActivityAt)));
  $('toggle').textContent = cfg.on ? 'Radar is ON' : 'Radar is OFF';
  $('toggle').className = cfg.on ? 'on' : 'off';
  $('today').textContent = `${today} of ${cfg.dailyTarget}`;
  $('t-today').classList.toggle('warn', today >= cfg.dailyTarget);
  $('waiting').textContent = q.length;
  $('waiting-s').textContent = q.length ? `${q.filter((x) => x.tier !== 'G').length} in your niche` : 'nothing yet - press Check BHW now';
  $('last').textContent = clock(state.lastBatch?.at);
  $('last-s').textContent = state.lastBatch?.at ? `${state.lastBatch.ids.length} card(s) to Telegram` : 'no batch sent yet';
  $('next').textContent = !cfg.on ? 'Off' : wallUntil ? 'Paused' : state.lastBatch?.at ? clock(nextAt) : 'Within a minute';
  $('next-s').textContent = !cfg.on ? 'switch Radar on to start' : wallUntil ? `BHW showed a wall; reading resumes at ${clock(wallUntil)}` : `every ${cfg.everyMinutes} minutes`;

  $('p-queue').innerHTML = q.length ? `<table><thead><tr><th>Kind</th><th>Thread</th><th>Section</th><th>Started</th><th>Replies</th><th>Last reply</th><th></th></tr></thead><tbody>${q.map((x) => `
    <tr><td><span class="chip ${x.tier}">${esc(KIND[x.tier] || x.tier)}</span></td>
    <td><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>${x.shown ? ` <span class="sub">· sent ${x.shown}×</span>` : ''}${briefHtml(x.brief)}</td>
    <td>${esc(x.section)}</td><td class="n">${esc(ago(x.startedAt))}</td><td class="n">${x.replyCount ?? ''}</td><td class="n">${esc(lastAgo(x.lastActivityAt))}</td>
    <td class="n"><button class="mini" data-do="replied" data-id="${esc(x.threadId)}">✅ I replied</button> <button class="mini" data-do="hidden" data-id="${esc(x.threadId)}">⏭ Not relevant</button></td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">No threads waiting. Press “Check BHW now” to read the sections.</div>';

  const rep = Object.entries(state.replied || {}).map(([id, r]) => ({ id, ...r })).sort((a, b) => b.at - a.at).slice(0, 80);
  $('p-replied').innerHTML = rep.length ? `<table><thead><tr><th>Thread</th><th>Section</th><th>Marked</th><th>Counted today</th><th></th></tr></thead><tbody>${rep.map((r) => `
    <tr><td>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title || r.url)}</a>` : esc(r.title || r.id)}</td><td>${esc(r.section || '')}</td>
    <td class="n">${new Date(r.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td><td>${state.counted?.[r.id] ? 'Yes' : ''}</td>
    <td class="n"><button class="mini" data-do="undo" data-id="${esc(r.id)}">Undo</button></td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">Threads you replied to appear here, so they are never suggested again.</div>';

  const un = state.unmatched || [];
  $('p-unmatched').innerHTML = un.length ? `<div class="sub" style="margin-bottom:8px">These threads were on the pages Radar read but matched none of your words. See one that should have matched? Add its word in “Settings and words”.</div>
    <table><thead><tr><th>Thread</th><th>Section</th><th>Replies</th><th>Last reply</th></tr></thead><tbody>${un.map((u) => `
    <tr><td><a href="${esc(u.url)}" target="_blank" rel="noopener">${esc(u.title)}</a></td><td>${esc(u.section)}</td><td class="n">${u.replies ?? ''}</td><td class="n">${esc(lastAgo(u.lastActivityAt))}</td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">Nothing read yet.</div>';
}

function fillSettings() {
  const { cfg } = S;
  $('s-every').value = cfg.everyMinutes; $('s-per').value = cfg.perBatch; $('s-target').value = cfg.dailyTarget;
  $('s-briefs').checked = cfg.briefs !== false; $('s-general').checked = cfg.general !== false;
  $('words').innerHTML = Object.keys(GROUP_LABELS).map((k) => `<label class="f">${esc(GROUP_LABELS[k])}<textarea data-group="${k}">${esc((cfg.words[k] || []).join(', '))}</textarea></label>`).join('');
}

async function load({ settings = false } = {}) {
  const got = await send({ cmd: 'radar-status' }).catch(() => null);
  if (!got || !got.cfg) { $('msg').hidden = false; $('msg').textContent = 'Could not reach the extension. Reload this page.'; return; }
  S = got; $('msg').hidden = true;
  render();
  if (settings) fillSettings();
}

for (const b of document.querySelectorAll('[role=tab]')) b.addEventListener('click', () => {
  tab = b.dataset.tab;
  for (const x of document.querySelectorAll('[role=tab]')) x.setAttribute('aria-selected', String(x === b));
  for (const p of ['queue', 'replied', 'unmatched', 'settings']) $(`p-${p}`).hidden = p !== tab;
});

document.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-do]');
  if (!b) return;
  b.disabled = true;
  S = await send({ cmd: 'radar-mark', what: b.dataset.do, threadId: b.dataset.id });
  render();
});

$('toggle').addEventListener('click', async () => { S = await send({ cmd: 'radar-save', patch: { on: !S.cfg.on } }); render(); });
$('plus').addEventListener('click', async () => { S = await send({ cmd: 'radar-mark', what: 'count', n: S.today + 1 }); render(); });
$('minus').addEventListener('click', async () => { S = await send({ cmd: 'radar-mark', what: 'count', n: Math.max(0, S.today - 1) }); render(); });
$('back').addEventListener('click', () => { location.href = chrome.runtime.getURL('src/dashboard/dashboard.html'); });

async function run(btn, sendCards) {
  btn.disabled = true; const label = btn.textContent; btn.textContent = 'Reading BHW… about 2 minutes';
  $('msg').hidden = true;
  const before = S?.state?.sweptAt || 0;
  await send({ cmd: 'radar-run', send: sendCards });
  for (let i = 0; i < 60; i++) {                       // the run is its own job; watch for it to land
    await new Promise((r) => setTimeout(r, 4000));
    await load();
    if (S && ((S.state.sweptAt || 0) > before || S.wallUntil) && !S.state.running) break;
  }
  btn.disabled = false; btn.textContent = label;
}
$('refresh').addEventListener('click', () => run($('refresh'), false));
$('send').addEventListener('click', () => run($('send'), true));

$('save').addEventListener('click', async () => {
  const words = {};
  for (const t of document.querySelectorAll('#words textarea')) words[t.dataset.group] = t.value.split(/[,\n]/).map((w) => w.trim()).filter(Boolean);
  S = await send({ cmd: 'radar-save', patch: { everyMinutes: Number($('s-every').value), perBatch: Number($('s-per').value), dailyTarget: Number($('s-target').value),
    briefs: $('s-briefs').checked, general: $('s-general').checked, words } });
  render(); fillSettings();
  $('saved').hidden = false; setTimeout(() => { $('saved').hidden = true; }, 2500);
});
$('reset').addEventListener('click', async () => { S = await send({ cmd: 'radar-save', patch: { resetWords: true } }); render(); fillSettings(); });

load({ settings: true });
setInterval(() => { if (tab !== 'settings') load(); }, 30000);
