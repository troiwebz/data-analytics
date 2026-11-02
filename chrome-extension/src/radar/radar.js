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
  $('waiting-s').textContent = q.length ? `${q.filter((x) => x.tier !== 'G').length} in your niche · ${Object.keys(state.sent || {}).length} sent so far, never repeated` : 'nothing yet - press Check BHW now';
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
  $('s-muted').value = (cfg.muted || []).join(', ');
  $('s-families').value = Object.entries(cfg.families || {}).map(([k, v]) => `${k}: ${v.join(', ')}`).join('\n');
  $('words').innerHTML = Object.keys(GROUP_LABELS).map((k) => `<label class="f">${esc(GROUP_LABELS[k])}<textarea data-group="${k}">${esc((cfg.words[k] || []).join(', '))}</textarea></label>`).join('');
}

function fillFams() {
  const { cfg } = S; const fams = S.fams || [];
  $('s-famevery').value = cfg.familyEvery || 20; $('s-famon').checked = cfg.familiesOn !== false; $('s-gate').checked = cfg.gate !== false;
  $('fams').innerHTML = fams.map((f, i) => `<div class="card fam" data-i="${i}" style="margin-bottom:10px">
    <div class="grid"><label class="f">Id<input type="text" class="f-id" value="${esc(f.id)}"></label><label class="f">Name<input type="text" class="f-name" value="${esc(f.name || f.id)}"></label><label class="f">Emoji<input type="text" class="f-emoji" value="${esc(f.emoji || '🔎')}"></label>
    <label class="chk" style="margin-top:22px"><input type="checkbox" class="f-pin" ${f.pinned ? 'checked' : ''}> Pinned (at least hourly)</label></div>
    <label class="f" style="margin-top:8px">Meaning (for the Claude gate)<input type="text" class="f-meaning" value="${esc(f.meaning || '')}"></label>
    <label class="f" style="margin-top:8px">Terms (${(f.terms || []).length})<textarea class="f-terms" style="min-height:64px">${esc((f.terms || []).join(', '))}</textarea></label>
    <label class="f" style="margin-top:8px">Home boards<textarea class="f-boards" style="min-height:48px">${esc((f.boards || []).map((b) => `${b.id}: ${b.name}${b.filter ? ' [family]' : ''}`).join('\n'))}</textarea></label>
    <div class="sub" style="margin-top:4px">${f.lastRun ? `last run ${new Date(f.lastRun).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ` : 'not run yet · '}${f.held || 0} held</div>
    <div class="row"><button class="mini" data-runfam="${esc(f.id)}">Run now</button><button class="mini" data-delfam="${i}">Remove</button></div></div>`).join('') || '<div class="empty">No families.</div>';
}
function readFams() {
  return [...document.querySelectorAll('#fams .fam')].map((c) => ({ id: c.querySelector('.f-id').value.trim(), name: c.querySelector('.f-name').value.trim(), emoji: c.querySelector('.f-emoji').value.trim(), pinned: c.querySelector('.f-pin').checked, meaning: c.querySelector('.f-meaning').value.trim(),
    terms: c.querySelector('.f-terms').value.split(/[,\n]/).map((t) => t.trim()).filter(Boolean),
    boards: c.querySelector('.f-boards').value.split('\n').map((l) => l.match(/^\s*(\d+)\s*:\s*([^\[]+?)\s*(?:\[(family)\])?\s*$/i)).filter(Boolean).map((m) => ({ id: Number(m[1]), name: m[2].trim(), ...(m[3] ? { filter: 'family' } : {}) })) }));
}
function fillHeld() {
  const held = S.state.held || {}; const fams = Object.fromEntries((S.fams || []).map((f) => [f.id, f]));
  const rows = Object.entries(held).flatMap(([fid, list]) => (list || []).map((c) => ({ ...c, fam: fams[fid] })));
  $('held').innerHTML = rows.length ? `<table><thead><tr><th>Family</th><th>Thread</th><th>Board</th><th>Replies</th><th>Last reply</th><th>Fit</th><th></th></tr></thead><tbody>${rows.map((c) => `
    <tr><td>${esc(c.fam ? `${c.fam.emoji || ''} ${c.fam.name}` : '')}</td><td><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.title)}</a></td><td>${esc(c.section)}</td><td class="n">${c.replyCount ?? ''}</td><td class="n">${esc(lastAgo(c.lastActivityAt))}</td><td class="n">${c.score != null ? `${c.score}/10` : ''}</td>
    <td class="n"><button class="mini" data-sendheld="${esc(c.threadId)}">Send to Telegram</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nothing held. Every run’s extras appear here.</div>';
}
document.addEventListener('click', async (e) => {
  const rf = e.target.closest('button[data-runfam]'); const df = e.target.closest('button[data-delfam]'); const sh = e.target.closest('button[data-sendheld]');
  if (rf) { rf.disabled = true; rf.textContent = 'Running…'; await send({ cmd: 'radar-run', family: rf.dataset.runfam }); setTimeout(async () => { await load(); fillFams(); }, 90000); }
  if (df) { const fams = readFams(); fams.splice(Number(df.dataset.delfam), 1); S.fams = fams; fillFams(); }
  if (sh) { sh.disabled = true; S = await send({ cmd: 'radar-send-held', threadId: sh.dataset.sendheld }); fillHeld(); }
});

function fillBlocks() {
  const blocks = S.blocks || [];
  $('blocks').innerHTML = blocks.map((b, i) => `<div class="card" data-i="${i}" style="margin-bottom:10px">
    <div class="grid"><label class="f">Block id<input type="text" class="b-id" value="${esc(b.id)}"></label><label class="f">Name<input type="text" class="b-name" value="${esc(b.name)}"></label>
    <label class="f">Runs at minute (every hour)<input type="number" class="b-min" min="0" max="59" value="${Number(b.minute) || 0}"></label><label class="chk" style="margin-top:22px"><input type="checkbox" class="b-on" ${b.on !== false ? 'checked' : ''}> On</label></div>
    <label class="f" style="margin-top:8px">Boards<textarea class="b-boards" style="min-height:90px">${esc(b.boards.map((x) => `${x.id || x.slug}: ${x.name}${x.filter ? ` [${x.filter}]` : ''}`).join('\n'))}</textarea></label>
    <div class="sub" style="margin-top:4px">${b.boards.map((x) => `${esc(x.name)}: ${x.id ? (x.allowed ? `id ${x.id}` : 'refused') : 'id not found yet (read from BHW on the next run)'}`).join(' · ')}${b.lastRun ? ` · last run ${new Date(b.lastRun).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</div>
    <div class="row"><button class="mini" data-run="${esc(b.id)}">Run now</button><button class="mini" data-del="${i}">Remove</button></div></div>`).join('') || '<div class="empty">No blocks.</div>';
}
function readBlocks() {
  return [...document.querySelectorAll('#blocks .card')].map((c) => ({ id: c.querySelector('.b-id').value.trim(), name: c.querySelector('.b-name').value.trim(), minute: Number(c.querySelector('.b-min').value), on: c.querySelector('.b-on').checked,
    boards: c.querySelector('.b-boards').value.split('\n').map((l) => l.match(/^\s*([a-z0-9-]+)\s*:\s*([^\[]+?)\s*(?:\[(niche|adwords|all)\])?\s*$/i)).filter(Boolean).map((m) => ({ ...(/^\d+$/.test(m[1]) ? { id: Number(m[1]) } : { slug: m[1].toLowerCase() }), name: m[2].trim(), ...(m[3] && m[3].toLowerCase() !== 'all' ? { filter: m[3].toLowerCase() } : {}) })) }));
}
document.addEventListener('click', async (e) => {
  const run = e.target.closest('button[data-run]'); const del = e.target.closest('button[data-del]');
  if (run) { run.disabled = true; run.textContent = 'Running…'; await send({ cmd: 'radar-run', send: true, block: run.dataset.run }); setTimeout(async () => { await load(); fillBlocks(); }, 90000); }
  if (del) { const blocks = readBlocks(); blocks.splice(Number(del.dataset.del), 1); S.blocks = blocks; fillBlocks(); }
});

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
  for (const p of ['queue', 'replied', 'unmatched', 'families', 'held', 'blocks', 'settings']) $(`p-${p}`).hidden = p !== tab;
  if (tab === 'blocks') fillBlocks();
  if (tab === 'families') fillFams();
  if (tab === 'held') fillHeld();
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
  const muted = $('s-muted').value.split(/[,\n]/).map((w) => w.trim()).filter(Boolean);
  const families = {};
  for (const line of $('s-families').value.split('\n')) { const m = line.match(/^\s*([a-z0-9 .+-]+?)\s*:\s*(.+)$/i); if (m) families[m[1].toLowerCase().trim()] = m[2].split(',').map((w) => w.trim()).filter(Boolean); }
  S = await send({ cmd: 'radar-save', patch: { everyMinutes: Number($('s-every').value), perBatch: Number($('s-per').value), dailyTarget: Number($('s-target').value),
    briefs: $('s-briefs').checked, general: $('s-general').checked, words, muted, families } });
  render(); fillSettings();
  $('saved').hidden = false; setTimeout(() => { $('saved').hidden = true; }, 2500);
});
$('reset').addEventListener('click', async () => { S = await send({ cmd: 'radar-save', patch: { resetWords: true } }); render(); fillSettings(); });
$('save-fams').addEventListener('click', async () => { S = await send({ cmd: 'radar-save', patch: { fams: readFams(), familyEvery: Number($('s-famevery').value), familiesOn: $('s-famon').checked, gate: $('s-gate').checked } }); fillFams(); $('saved-fams').hidden = false; setTimeout(() => { $('saved-fams').hidden = true; }, 2500); });
$('add-fam').addEventListener('click', () => { S.fams = [...readFams(), { id: 'new', name: 'New family', emoji: '🔎', terms: [], boards: [], meaning: '' }]; fillFams(); });
$('reset-fams').addEventListener('click', async () => { S = await send({ cmd: 'radar-save', patch: { resetFams: true } }); fillFams(); });
$('save-blocks').addEventListener('click', async () => { S = await send({ cmd: 'radar-save', patch: { blocks: readBlocks() } }); fillBlocks(); $('saved-blocks').hidden = false; setTimeout(() => { $('saved-blocks').hidden = true; }, 2500); });
$('add-block').addEventListener('click', () => { S.blocks = [...readBlocks(), { id: 'new', name: 'New block', minute: 45, on: false, boards: [] }]; fillBlocks(); });
$('reset-blocks').addEventListener('click', async () => { S = await send({ cmd: 'radar-save', patch: { resetBlocks: true } }); fillBlocks(); });

load({ settings: true });
setInterval(() => { if (tab !== 'settings') load(); }, 30000);
