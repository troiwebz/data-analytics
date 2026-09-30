const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let showing = null;

$('back').addEventListener('click', () => { location.href = chrome.runtime.getURL('src/dashboard/dashboard.html'); });

try {
  $('url').value = localStorage.getItem('labUrl') || '';
  const f = JSON.parse(localStorage.getItem('labForm') || '{}');
  for (const k of ['copies', 'gets', 'features', 'requirements', 'delivery']) if (f[k] != null && $(k)) $(k).value = f[k];
} catch { /* no storage */ }
function modeUi() {
  const main = document.querySelector('input[name=mode]:checked').value === 'main';
  $('reviewFields').hidden = main; $('frcBox').hidden = main; $('mainBoxes').hidden = !main;
}
document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', modeUi));
modeUi();

$('run').addEventListener('click', async () => {
  const url = $('url').value.trim();
  if (!/blackhatworld\.com\//i.test(url)) return alert('Paste the link to your BHW service thread first.');
  try { localStorage.setItem('labUrl', url); } catch { /* fine */ }
  const mode = document.querySelector('input[name=mode]:checked').value;
  const opts = mode === 'main'
    ? { mode, url, pages: Number($('pages').value), open: Number($('open').value), reviewCopies: $('rc').checked, ownSection: $('own').checked }
    : { mode, url, pages: Number($('pages').value), open: Number($('open').value), alsoFrc: $('frc').checked,
        copies: Number($('copies').value), gets: $('gets').value.trim(), features: $('features').value.trim(), requirements: $('requirements').value.trim(), delivery: $('delivery').value.trim() };
  if (mode === 'review' && !(opts.copies > 0)) return alert('Say how many free review copies you will give.');
  try { localStorage.setItem('labForm', JSON.stringify(opts)); } catch { /* fine */ }
  const r = await chrome.runtime.sendMessage({ cmd: 'lab-run', opts });
  if (r?.error) return alert(r.error);
  showing = null;
  render();
});

$('fill').addEventListener('click', async () => {
  const url = $('url').value.trim();
  if (!/blackhatworld\.com\//i.test(url)) return alert('Paste the link to your BHW service thread first.');
  const b = $('fill'); b.disabled = true; b.textContent = 'Reading your thread…';
  $('fillMsg').textContent = 'Opening your thread in a background tab, then one short Claude call…';
  try {
    const r = await chrome.runtime.sendMessage({ cmd: 'lab-fill', url });
    if (r?.error) { $('fillMsg').textContent = `Could not fill: ${r.error}`; return; }
    const put = (id, v) => { if (v && (!$(id).value.trim() || confirm(`Replace what is in "${id}" with what your thread says?`))) $(id).value = v; };
    put('features', (r.features || []).join('\n'));
    put('gets', (r.gets || []).join('\n'));
    put('requirements', r.requirements);
    put('delivery', r.delivery);
    $('fillMsg').textContent = `Filled from "${String(r.title || '').slice(0, 60)}" - check and edit, then Run the Lab. Cost $${Number(r.cost || 0).toFixed(4)}.`;
    showSpend();
  } finally { b.disabled = false; b.textContent = '✨ Fill these from my thread'; }
});

/** Claude's spend today, the daily limit, and what is left - the same figures as the dashboard. */
async function showSpend() {
  const ai = await chrome.runtime.sendMessage({ cmd: 'ai-status' }).catch(() => null);
  if (!ai) return;
  $('spend').textContent = !ai.configured ? 'Claude: no key saved'
    : `Claude today: $${Number(ai.spentToday || 0).toFixed(3)}${ai.budget > 0 ? ` of $${Number(ai.budget).toFixed(2)} · $${Number(ai.remaining || 0).toFixed(3)} left` : ''}`
      + (ai.credits > 0 ? ` · balance ~$${Number(ai.balance).toFixed(2)}` : '');
}
showSpend();

function copyBox(label, text) {
  const id = 'c' + Math.random().toString(36).slice(2);
  return `<div class="copy"><div class="sub" style="margin-bottom:4px">${esc(label)}</div><pre id="${id}">${esc(text)}</pre>
    <div class="acts"><button data-copy="${id}">📋 Copy</button></div></div>`;
}

function reviewReport(r) {
  const comp = (r.competitors || []).map((c) => `<tr><td>${c.viral ? '🔥 ' : ''}<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.title)}</a></td>
      <td class="n">${c.replies ?? '?'}</td><td class="n">${c.rpd}</td></tr>`).join('');
  const meas = (r.measured?.features || []).map((f) => `<tr><td>${esc(f.label)}</td>
      <td class="n"><b>${f.top}%</b></td><td class="n">${f.rest}%</td>
      <td><div class="bar"><i style="width:${f.top}%;background:${f.top > f.rest + 15 ? '#16a34a' : f.top + 15 < f.rest ? '#dc2626' : '#94a3b8'}"></i></div></td></tr>`).join('');
  return `
  ${(r.problems || []).length ? `<div class="warn"><b>Check before posting:</b><ul>${r.problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
  <div class="card"><h2>Your review-copy thread</h2>
    <div class="sub">For <b>${esc(r.mine?.title)}</b> · ${r.copies} free review copies · studied ${r.scanned} threads in ${esc((r.sources || []).join(' + '))} · ${new Date(r.at).toLocaleString()} · Claude $${Number(r.cost || 0).toFixed(3)}</div>
    ${r.titlePattern ? `<div class="sub" style="margin-top:10px">Title pattern: <code>${esc(r.titlePattern)}</code></div>` : ''}
    ${(r.titles || []).map((t, i) => copyBox(`Title ${i + 1}`, t)).join('')}
    ${copyBox('Post (paste as the first post)', r.description)}
    <p class="sub">Post it in <a href="https://www.blackhatworld.com/forums/service-reviews-beta-testers-help-wanted.165/post-thread" target="_blank" rel="noopener">Service Reviews &amp; Beta Testers → Post thread</a>. Do not bump it - the section rules forbid it.</p>
  </div>

  <div class="card"><h2>The success formula</h2>
    <ol>${(r.formula || []).map((f) => `<li><b>${esc(f.rule)}</b><br><span class="sub">${esc(f.evidence)}</span></li>`).join('')}</ol>
    ${(r.postSkeleton || []).length ? `<div class="sub" style="margin:12px 0 4px">Post skeleton the winners use</div><ol>${r.postSkeleton.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
    <div class="sub" style="margin:14px 0 4px">Measured on the titles: top 10 by replies/day vs the rest</div>
    <table><thead><tr><th>The title…</th><th>Top 10</th><th>Rest</th><th></th></tr></thead><tbody>${meas}
      <tr><td>average length</td><td class="n"><b>${r.measured?.topLength}</b></td><td class="n">${r.measured?.restLength}</td><td class="sub">characters</td></tr></tbody></table>
  </div>

  <div class="card"><h2>Section rules check</h2>
    <table><tbody>${(r.rulesCheck || []).map((x) => `<tr><td>${x.ok ? '<span class="okc">✓</span>' : '<span class="bad">✗</span>'}</td><td>${esc(x.rule)}<div class="sub">${esc(x.note || '')}</div></td></tr>`).join('')}</tbody></table>
  </div>

  <div class="card"><h2>Why the winners get replies</h2>
    <div class="sub" style="margin:0 0 4px">The irresistible offer</div><div>${esc(r.irresistibleOffer)}</div>
    <div class="sub" style="margin:12px 0 4px">Opening lines in their register</div><ol>${(r.hooks || []).map((h) => `<li>${esc(h)}</li>`).join('')}</ol>
    <div class="sub" style="margin:12px 0 4px">Phrases they share</div><div class="chips win">${(r.keywords?.winning || []).map((k) => `<span>${esc(k)}</span>`).join('')}</div>
    <div class="sub" style="margin:10px 0 4px">Missing from yours</div><div class="chips miss">${(r.keywords?.missing || []).map((k) => `<span>${esc(k)}</span>`).join('') || '<span>none</span>'}</div>
    ${(r.gaps || []).length ? `<div class="sub" style="margin:12px 0 4px">What your offer is missing</div><ol>${r.gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ol>` : ''}
    <div class="sub" style="margin:14px 0 4px">Threads studied - viral only: 🔥 = at least ${r.viralBar ?? '?'} replies/day, twice the section's median of ${r.median ?? '?'}</div>
    <table><thead><tr><th>Thread</th><th>Replies</th><th>Per day</th></tr></thead><tbody>${comp}</tbody></table>
  </div>`;
}

function report(r) {
  if (r.mode === 'review') return reviewReport(r);
  const comp = (r.competitors || []).map((c) => `<tr><td><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.title)}</a>
      <div class="sub">${esc(c.forum || '')}${(c.shared || []).length ? ` · shares: ${esc(c.shared.join(', '))}` : ''}</div></td>
      <td class="n">${c.replies ?? '?'}</td><td class="n">${c.rpd}</td><td class="n">${Math.round((c.sim || 0) * 100)}%</td></tr>`).join('');
  return `
  <div class="card"><h2>Your thread</h2>
    <div><b>${esc(r.mine?.title)}</b></div>
    <div class="sub">${esc(r.mine?.section || r.mine?.forum || '')} · studied ${r.scanned} threads from ${esc((r.sources || []).join(' + '))} (${r.pages} page(s) each), ${r.relevant} relevant · ${new Date(r.at).toLocaleString()} · Claude $${Number(r.cost || 0).toFixed(3)}</div>
    ${(r.gaps || []).length ? `<h2 style="margin-top:12px">What yours is missing</h2><ol>${r.gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ol>` : ''}
  </div>

  <div class="card"><h2>2. Your new copy</h2>
    ${(r.titles || []).map((t, i) => copyBox(`Title ${i + 1}`, t)).join('')}
    ${copyBox('Description (opening post)', r.description)}
    ${r.reviewCopy ? copyBox('Review-copy offer (for the Free Review Copies forum)', r.reviewCopy) : ''}
  </div>

  <div class="card"><h2>3. What wins in this niche</h2>
    <div class="sub" style="margin:6px 0 4px">The irresistible offer</div><div>${esc(r.irresistibleOffer)}</div>
    <div class="sub" style="margin:12px 0 4px">Pain angles</div><ol>${(r.painAngles || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ol>
    <div class="sub" style="margin:12px 0 4px">Hooks</div><ol>${(r.hooks || []).map((h) => `<li>${esc(h)}</li>`).join('')}</ol>
    <div class="sub" style="margin:12px 0 4px">Keywords the winners use</div><div class="chips win">${(r.keywords?.winning || []).map((k) => `<span>${esc(k)}</span>`).join('')}</div>
    <div class="sub" style="margin:10px 0 4px">Missing from yours</div><div class="chips miss">${(r.keywords?.missing || []).map((k) => `<span>${esc(k)}</span>`).join('') || '<span>none</span>'}</div>
  </div>

  <div class="card"><h2>4. The competition</h2>
    ${(r.clusters || []).length ? `<div class="sub" style="margin-bottom:8px">Clusters: ${r.clusters.map((g) => `<b>${esc(g.label)}</b> (${g.size} threads, ${g.replies} replies)`).join(' · ')}</div>` : ''}
    <table><thead><tr><th>Thread</th><th>Replies</th><th>Per day</th><th>Match</th></tr></thead><tbody>${comp}</tbody></table>
    ${teardownList(r)}
  </div>`;
}

function teardownList(r) {
  const list = r.teardown || [];
  if (!list.length) return '';
  return `<div class="sub" style="margin:14px 0 4px">Why each one gets replies</div><ul>${list.map((c) => {
    const row = (r.competitors || []).find((x) => String(x.threadId) === String(c.id));
    return `<li><b>${esc(row ? row.title : c.id)}</b><br>Offer: ${esc(c.offer)}<br>Hook: ${esc(c.hook)}<br>Pain: ${esc(c.pain)}<br><span class="sub">${esc(c.why)}</span></li>`;
  }).join('')}</ul>`;
}

async function render() {
  const { labRun: run, labHistory: hist = [] } = await chrome.storage.local.get(['labRun', 'labHistory']);
  const running = run?.status === 'running';
  $('run').disabled = running;
  $('run').textContent = running ? 'Running…' : 'Run the Lab';
  $('progress').hidden = !run || (!running && run.status !== 'error');
  if (run) {
    $('steps').innerHTML = (run.steps || []).map((s) => `<div>${new Date(s.t).toLocaleTimeString()} · ${esc(s.m)}</div>`).join('')
      + (run.status === 'error' ? `<div class="err">Stopped: ${esc(run.error)}</div>`
        + (run.raw ? `<details style="margin-top:6px"><summary class="sub">What Claude sent back</summary><pre style="white-space:pre-wrap;font-size:12px">${esc(run.raw)}</pre></details>` : '') : '');
    $('progress').querySelector('h2').textContent = running ? 'Working…' : 'Last run';
  }
  const r = showing || (run?.status === 'done' ? run.result : null);
  $('out').innerHTML = r ? report(r) : '';
  $('histCard').hidden = !hist.length;
  $('hist').innerHTML = hist.map((h, i) => `<button data-hist="${i}">${esc(String(h.mine?.title || '').slice(0, 50))} · ${new Date(h.at).toLocaleDateString()}</button>`).join('');
}

document.addEventListener('click', async (e) => {
  const c = e.target.closest('[data-copy]');
  if (c) { await navigator.clipboard.writeText($(c.dataset.copy).textContent); c.textContent = '✅ Copied'; setTimeout(() => { c.textContent = '📋 Copy'; }, 1500); return; }
  const h = e.target.closest('[data-hist]');
  if (h) { const { labHistory = [] } = await chrome.storage.local.get('labHistory'); showing = labHistory[Number(h.dataset.hist)]; render(); window.scrollTo(0, 0); }
});
chrome.storage.onChanged.addListener((ch) => { if (ch.labRun || ch.labHistory) render(); if (ch.ai) showSpend(); });
render();
