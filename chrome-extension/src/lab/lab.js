const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let showing = null;

$('back').addEventListener('click', () => { location.href = chrome.runtime.getURL('src/dashboard/dashboard.html'); });

try {
  $('url').value = localStorage.getItem('labUrl') || '';
  const f = JSON.parse(localStorage.getItem('labForm') || '{}');
  for (const k of ['copies', 'gets', 'features', 'targets', 'keywords', 'requirements', 'delivery']) if (f[k] != null && $(k)) $(k).value = f[k];
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
        copies: Number($('copies').value), gets: $('gets').value.trim(), features: $('features').value.trim(), targets: $('targets').value.trim(), keywords: $('keywords').value.trim(), requirements: $('requirements').value.trim(), delivery: $('delivery').value.trim() };
  if (mode === 'review' && !(opts.copies > 0)) return alert('Say how many free review copies you will give.');
  try { localStorage.setItem('labForm', JSON.stringify(opts)); } catch { /* fine */ }
  const r = await chrome.runtime.sendMessage({ cmd: 'lab-run', opts });
  if (r?.error) return alert(r.error);
  showing = null;
  render();
renderIdeas();
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
    put('targets', r.targets);
    put('keywords', (r.keywords || []).join(', '));
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

// ---------------------------------------------------------------- 20 ideas
let ideasShown = null;

function ideasTable(e) {
  const rows = e.ideas.map((i) => `<tr><td class="n">${i.n}</td><td>${esc(i.title)}${i.flags.length ? ` <span class="sub" style="color:#b45309">(${esc(i.flags.join(', '))})</span>` : ''}</td>
    <td class="sub">${esc((i.benefits || []).join(' + '))}</td><td>${esc(i.niche)}</td><td>${esc(i.country)}</td><td class="sub">${esc(i.keyword)}</td><td class="n">${i.chars}</td>
    <td><button data-copytext="${esc(i.title)}" style="padding:3px 8px;font-size:12px">📋</button></td></tr>`).join('');
  const countries = new Set(e.ideas.flatMap((i) => (i.countries && i.countries.length ? i.countries : [i.country]).map((c) => String(c).toLowerCase()))).size;
  const paired = e.ideas.filter((i) => (i.countries || []).length > 1).length;
  const niches = new Set(e.ideas.map((i) => i.niche.toLowerCase())).size;
  return `<div class="sub" style="margin:12px 0 6px">For <a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a> · ${e.ideas.length} ideas across ${countries} countries (${paired} paired) and ${niches} niches · ${new Date(e.at).toLocaleString()} · Claude $${Number(e.cost || 0).toFixed(3)}</div>
    ${(e.benefits || []).length ? `<div class="sub" style="margin:0 0 4px">Benefits found in the thread</div><div class="chips win" style="margin-bottom:8px">${e.benefits.map((b) => `<span>${esc(b)}</span>`).join('')}</div>` : ''}
    <div class="row" style="margin:0 0 8px"><button id="ideasCsv">⬇ Download CSV</button><button id="ideasCopy">📋 Copy all titles</button></div>
    <table><thead><tr><th>#</th><th>Title</th><th>Benefits</th><th>Niche</th><th>Countries</th><th>Long-tail keyword</th><th>Chars</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

async function renderIdeas() {
  const { labIdeas = [] } = await chrome.storage.local.get('labIdeas');
  const e = ideasShown || labIdeas[0];
  $('ideasOut').innerHTML = e ? ideasTable(e)
    + (labIdeas.length > 1 ? `<div class="hist" style="margin-top:10px">${labIdeas.map((x, k) => `<button data-ideas="${k}">${esc(String(x.title || '').slice(0, 45))}</button>`).join('')}</div>` : '') : '';
}

$('ideasRun').addEventListener('click', async () => {
  const url = ($('ideasUrl').value.trim() || $('url').value.trim());
  if (!/blackhatworld\.com\//i.test(url)) return alert('Paste a BHW main thread link.');
  const b = $('ideasRun'); b.disabled = true; b.textContent = 'Reading the thread…';
  $('ideasMsg').textContent = 'Opening the thread in a background tab, then one Claude call - about 20-40 seconds.';
  try {
    const r = await chrome.runtime.sendMessage({ cmd: 'lab-ideas', url, brand: $('ideasBrand').value.trim(),
      targets: ($('targets')?.value || '').trim(), keywords: ($('keywords')?.value || '').trim() });
    if (r?.error) { $('ideasMsg').textContent = `Could not get ideas: ${r.error}`; return; }
    ideasShown = r;
    $('ideasMsg').textContent = `${r.ideas.length} ideas ready.`;
    await renderIdeas(); showSpend();
  } finally { b.disabled = false; b.textContent = '📋 Get 20 ideas'; }
});

async function currentIdeas() {
  const { labIdeas = [] } = await chrome.storage.local.get('labIdeas');
  return ideasShown || labIdeas[0];
}

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
    ${(r.keywordTargets || []).length ? `<div class="sub" style="margin:10px 0 4px">Long-tail keywords the titles target</div><div class="chips win">${r.keywordTargets.map((k) => `<span title="${esc(k.why || '')}">${esc(k.phrase)}</span>`).join('')}</div>` : ''}
    ${(r.titles || []).map((t, i) => copyBox(`Title ${i + 1} · ${t.length} characters`, t)).join('')}
    ${copyBox('Post (paste as the first post)', r.description)}
    <p class="sub">Post it in <a href="https://www.blackhatworld.com/forums/service-reviews-beta-testers-help-wanted.165/post-thread" target="_blank" rel="noopener">Service Reviews &amp; Beta Testers → Post thread</a>. Do not bump it - the section rules forbid it.</p>
  </div>

  <div class="card"><h2>The success formula</h2>
    <ol>${(r.formula || []).map((f) => `<li><b>${esc(f.rule)}</b><br><span class="sub">${esc(f.evidence)}</span></li>`).join('')}</ol>
    ${(r.postSkeleton || []).length ? `<div class="sub" style="margin:12px 0 4px">Post skeleton the winners use</div><ol>${r.postSkeleton.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
    ${(r.longTails || []).length ? `<div class="sub" style="margin:14px 0 4px">Long-tail phrases the viral titles are built on</div><div class="chips">${r.longTails.map((k) => `<span>${esc(k.phrase)}</span>`).join('')}</div>` : ''}
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
  if (e.target.id === 'ideasCsv') {
    const cur = await currentIdeas(); if (!cur) return;
    const { ideasCsv } = await import('../lab.js');
    const blob = new Blob([ideasCsv(cur.ideas, { thread: cur.url })], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `title-ideas-${String(cur.brand || cur.title || 'thread').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return;
  }
  if (e.target.id === 'ideasCopy') {
    const cur = await currentIdeas(); if (!cur) return;
    await navigator.clipboard.writeText(cur.ideas.map((i) => i.title).join('\n'));
    e.target.textContent = '✅ Copied'; setTimeout(() => { e.target.textContent = '📋 Copy all titles'; }, 1500);
    return;
  }
  const ct = e.target.closest('[data-copytext]');
  if (ct) { await navigator.clipboard.writeText(ct.dataset.copytext); ct.textContent = '✅'; setTimeout(() => { ct.textContent = '📋'; }, 1200); return; }
  const ib = e.target.closest('[data-ideas]');
  if (ib) { const { labIdeas = [] } = await chrome.storage.local.get('labIdeas'); ideasShown = labIdeas[Number(ib.dataset.ideas)]; renderIdeas(); return; }
  const c = e.target.closest('[data-copy]');
  if (c) { await navigator.clipboard.writeText($(c.dataset.copy).textContent); c.textContent = '✅ Copied'; setTimeout(() => { c.textContent = '📋 Copy'; }, 1500); return; }
  const h = e.target.closest('[data-hist]');
  if (h) { const { labHistory = [] } = await chrome.storage.local.get('labHistory'); showing = labHistory[Number(h.dataset.hist)]; render(); window.scrollTo(0, 0); }
});
chrome.storage.onChanged.addListener((ch) => { if (ch.labRun || ch.labHistory) render(); if (ch.ai) showSpend(); });
render();
renderIdeas();
