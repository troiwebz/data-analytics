// Thread Studio page. Reads and shows; the research itself runs in the
// background (startStudio), so this page can be closed and reopened mid-run.
import { plainBody } from '../studio.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let runs = {}, key = '', cur = 1, tab = 'thread';

$('back').addEventListener('click', () => { location.href = chrome.runtime.getURL('src/dashboard/dashboard.html'); });
try { $('service').value = localStorage.getItem('studioService') || ''; } catch {}

$('intake').addEventListener('submit', async (e) => {
  e.preventDefault();
  const opts = { niche: $('niche').value.trim(), service: $('service').value.trim(), days: Number($('days').value), name: $('pname').value.trim() };
  try { localStorage.setItem('studioService', opts.service); } catch {}
  $('msg').textContent = '';
  const r = await chrome.runtime.sendMessage({ cmd: 'studio-run', opts }).catch((err) => ({ error: err.message }));
  if (r?.error) { $('msg').innerHTML = `<span class="err">${esc(r.error)}</span>`; return; }
  $('msg').textContent = 'Started. You can leave this page open or come back later.';
  load();
});

const planName = (p) => p.name || `${p.niche} · ${String(p.at || '').slice(0, 10)}`;
const when = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const day = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString([], { day: 'numeric', month: 'short' }); };
const usedOf = (p) => (p.threads || []).filter((t) => t.used).length;
function savedList() {
  const list = Object.entries(runs).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at)));
  $('saved').hidden = !list.length;
  $('plans').innerHTML = list.map(([k, v]) => `<tr class="${k === key ? 'cur' : ''}">
    <td><button type="button" class="plink" data-open="${esc(k)}">${esc(planName(v))}</button></td>
    <td>${esc(v.niche)}</td><td class="n" style="text-align:left">${esc(when(v.at))}</td>
    <td>${usedOf(v) ? `<span class="used">✓ ${usedOf(v)}/${v.threads.length} used</span>` : `<span class="unused">0/${(v.threads || []).length}</span>`}</td>
    <td class="sub">${esc(String(v.service || '').slice(0, 110))}${String(v.service || '').length > 110 ? '…' : ''}</td>
    <td class="n"><button type="button" class="mini" data-ren="${esc(k)}">Rename</button> <button type="button" class="mini" data-del="${esc(k)}">Delete</button></td></tr>`).join('');
}
$('plans').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.open) {
    // Click a plan to open it; click the open one again to close it.
    if (key === b.dataset.open) { key = ''; savedList(); showResult(); return; }
    key = b.dataset.open; cur = runs[key].threads[0]?.id || 1; tab = 'thread'; savedList(); showResult(); $('result').scrollIntoView({ behavior: 'smooth', block: 'start' }); return;
  }
  const { studioRuns = {} } = await chrome.storage.local.get('studioRuns');
  if (b.dataset.ren) {
    const k = b.dataset.ren; if (!studioRuns[k]) return;
    const name = prompt('Plan name', planName(studioRuns[k]));
    if (name == null || !name.trim()) return;
    studioRuns[k] = { ...studioRuns[k], name: name.trim().slice(0, 80) };
  } else if (b.dataset.del) {
    const k = b.dataset.del; if (!studioRuns[k]) return;
    if (!confirm(`Delete the plan "${planName(studioRuns[k])}"? This cannot be undone.`)) return;
    delete studioRuns[k];
    if (key === k) key = '';
  } else return;
  await chrome.storage.local.set({ studioRuns });
});

function showProgress(run) {
  const on = run && (run.status === 'running' || run.status === 'error');
  $('progress').hidden = !on;
  if (!on) return;
  $('ptitle').innerHTML = run.status === 'error' ? `<span class="err">Stopped: ${esc(run.error)}</span>` : `Researching "${esc(run.opts?.niche)}"… about 10 minutes`;
  $('steps').innerHTML = (run.steps || []).map((s) => `<div>${new Date(s.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${esc(s.m)}</div>`).join('');
  $('run').disabled = run.status === 'running';
}

function showResult() {
  const r = runs[key];
  $('result').hidden = !r;
  if (!r) return;
  $('rtitle').textContent = `${planName(r)} · niche "${r.niche}" · made ${when(r.at)}`;
  $('rsub').textContent = `${r.how ? 'Via ' + r.how + ' · ' : ''}${r.scanned} threads read · ${r.recent.length} recent (last ${r.days} days) and ${r.viral.length} older on-niche threads${r.seconds ? ' · ' + r.seconds + 's' : ''} · Claude $${Number(r.cost || 0).toFixed(3)}${r.service ? ' · Service: ' + r.service.slice(0, 140) : ''}`;
  $('pains').innerHTML = (r.pains || []).map((p) => `<tr><td>${esc(p.pain)}${p.evidence?.length ? `<div class="sub">${p.evidence.map(esc).join(' · ')}</div>` : ''}</td><td class="n">${p.threads}</td><td class="n">${p.replies}</td><td><span class="fit ${esc(p.fit)}">${esc(p.fit || '–')}</span></td></tr>`).join('') || '<tr><td colspan="4" class="sub">No pains returned.</td></tr>';
  renderPlan();
}

function renderPlan() {
  const r = runs[key]; if (!r) return;
  const th = r.threads.find((t) => t.id === cur) || r.threads[0];
  $('rail').innerHTML = [1, 2, 3, 4].map((w) => `<div><h3>Week ${w}</h3>${r.threads.filter((t) => t.week === w).map((t) => `<button type="button" class="tb ${t.used ? 'done' : ''}" data-id="${t.id}" aria-current="${t.id === th.id}"><span>${t.used ? '<span class="tick" title="Used">✓</span>' : ''}${esc(t.title)}</span><span><span class="chip t">${esc(t.type)}</span><span class="chip">${esc(t.section)}</span></span></button>`).join('')}</div>`).join('');
  for (const b of $('tabs').querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.t === tab));
  const v = $('view');
  if (tab === 'thread') {
    const body = th.body.map((b) => Array.isArray(b) ? `<ol>${b.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : `<p>${esc(b)}</p>`).join('') + (th.question ? `<p class="q">${esc(th.question)}</p>` : '');
    v.innerHTML = `<article class="forum"><div class="crumb">Forums › ${esc(th.section)}</div><div class="ftitle">${esc(th.title)}</div>
      <div class="post"><div class="user"><div class="ava">B</div><span class="uname">bargainbed</span><span class="sub" style="color:var(--fmute)">Elite Member · Jr. VIP</span></div>
      <div class="fbody">${body}<div class="sig">your signature</div></div></div></article>
      <div class="row"><button class="pri" id="cpT">Copy title</button><button id="cpB">Copy body</button>
        <button id="useT">${th.used ? `✓ Used on ${esc(day(th.used))} · undo` : 'Mark as used'}</button><span class="sub" id="cpM" aria-live="polite"></span></div>`;
    const copy = async (t, l) => { try { await navigator.clipboard.writeText(t); $('cpM').textContent = l + ' copied.'; } catch { $('cpM').textContent = 'Copy blocked - select the text and copy it.'; } };
    $('cpT').onclick = () => copy(th.title, 'Title');
    $('cpB').onclick = () => copy(plainBody(th), 'Body');
    $('useT').onclick = async () => {
      const { studioRuns = {} } = await chrome.storage.local.get('studioRuns');
      const plan = studioRuns[key]; if (!plan) return;
      plan.threads = plan.threads.map((t) => (t.id === th.id ? { ...t, used: t.used ? '' : new Date().toISOString() } : t));
      await chrome.storage.local.set({ studioRuns });
    };
  } else if (tab === 'replies') {
    v.innerHTML = `<div class="sub" style="margin-bottom:8px">Example replies from members (made up) and the answer to give back: one new point, then a question.</div>`
      + th.replies.map((x) => `<div class="reply ${x.you ? 'you' : ''}"><b>${x.you ? 'You (bargainbed)' : esc(x.who)}</b>${esc(x.text)}</div>`).join('');
  } else if (tab === 'rules') {
    v.innerHTML = th.checks.map((c) => `<div class="rule"><span class="pass ${c.pass ? '' : 'fail'}">${c.pass ? 'PASS' : 'FIX'}</span><div><b>${esc(c.rule)}</b> · ${esc(c.what)}</div></div>`).join('')
      + `<div class="sub">Checked against BHW Terms and rules. A FIX means: edit that line before posting.</div>`;
  } else {
    const rows = [...r.recent, ...r.viral].filter((x) => (th.basedOn || []).some((b) => x.title && (x.title.includes(b) || b.includes(x.title))));
    const list = rows.length ? rows : r.recent.slice(0, 5);
    v.innerHTML = `<div class="sub" style="margin-bottom:8px">${rows.length ? 'The BHW threads this one is based on' : 'Top recent threads from the research'}, as read on ${esc(String(r.at).slice(0, 10))}.</div>
      <div style="overflow-x:auto"><table><thead><tr><th>Thread</th><th>Section</th><th>Started</th><th>Replies</th><th>Views</th></tr></thead><tbody>${list.map((x) => `<tr><td><a href="${esc(x.url)}" target="_blank">${esc(x.title)}</a></td><td>${esc(x.forum)}</td><td class="n">${esc(String(x.startedAt || '').slice(0, 10))}</td><td class="n">${x.replies ?? '–'}</td><td class="n">${x.views ?? '–'}</td></tr>`).join('')}</tbody></table></div>`;
  }
}
$('rail').addEventListener('click', (e) => { const b = e.target.closest('.tb'); if (!b) return; cur = Number(b.dataset.id); renderPlan(); });
$('tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; tab = b.dataset.t; renderPlan(); });

async function load() {
  const { studioRun, studioRuns = {} } = await chrome.storage.local.get(['studioRun', 'studioRuns']);
  runs = studioRuns;
  savedList();
  showProgress(studioRun);
  if (key && !runs[key]) key = '';              // the open plan was deleted
  if (key && runs[key] && !runs[key].threads.some((t) => t.id === cur)) cur = runs[key].threads[0]?.id || 1;
  $('run').disabled = studioRun?.status === 'running';
  showResult();
}
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local' || !(ch.studioRun || ch.studioRuns)) return;
  if (ch.studioRun?.newValue?.status === 'done') key = ch.studioRun.newValue.key;
  load();
});
load();
