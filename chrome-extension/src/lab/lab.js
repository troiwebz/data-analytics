const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let showing = null;

$('back').addEventListener('click', () => { location.href = chrome.runtime.getURL('src/dashboard/dashboard.html'); });

try { $('url').value = localStorage.getItem('labUrl') || ''; } catch { /* no storage */ }

$('run').addEventListener('click', async () => {
  const url = $('url').value.trim();
  if (!/blackhatworld\.com\//i.test(url)) return alert('Paste the link to your BHW service thread first.');
  try { localStorage.setItem('labUrl', url); } catch { /* fine */ }
  const opts = { url, pages: Number($('pages').value), open: Number($('open').value), reviewCopies: $('rc').checked, ownSection: $('own').checked };
  const r = await chrome.runtime.sendMessage({ cmd: 'lab-run', opts });
  if (r?.error) return alert(r.error);
  showing = null;
  render();
});

function copyBox(label, text) {
  const id = 'c' + Math.random().toString(36).slice(2);
  return `<div class="copy"><div class="sub" style="margin-bottom:4px">${esc(label)}</div><pre id="${id}">${esc(text)}</pre>
    <div class="acts"><button data-copy="${id}">📋 Copy</button></div></div>`;
}

function report(r) {
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
      + (run.status === 'error' ? `<div class="err">Stopped: ${esc(run.error)}</div>` : '');
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
chrome.storage.onChanged.addListener((ch) => { if (ch.labRun || ch.labHistory) render(); });
render();
