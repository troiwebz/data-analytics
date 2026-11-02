// The Hunt page (log 1.26.0). The same file runs in two places:
//  - inside the extension (src/hunt/hunt.html): data from the background, with buttons that act;
//  - on the phone link (haf-mobile.vercel.app/hunt.html#k=...): data from the central database, read only.
// Names and topics mirror src/hunt.js CATEGORIES (a test keeps the two the same).

import { CATS } from './cats.js';

const $ = (id) => document.getElementById(id);
const EXT = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, (r) => res(r || {})));
const KEY = (() => { const m = location.hash.match(/k=([A-Za-z0-9_-]{32,128})/); return m ? m[1] : ''; })();
const HOUR = 3600000;
const t0 = (iso) => { const x = new Date(iso || 0).getTime(); return isFinite(x) && x > 0 ? x : 0; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const topicName = (cat, topic) => ((CATS.find((c) => c.id === cat) || CATS[6]).topics.find((t) => t[0] === topic) || [, ''])[1];

function ago(ms, now = Date.now()) {
  if (!ms) return '';
  const m = Math.max(0, Math.round((now - ms) / 60000));
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayLabel = (ms) => { const d = new Date(ms), n = new Date(); return d.toDateString() === n.toDateString() ? clock(ms) : `${d.getDate()} ${d.toLocaleString([], { month: 'short' })} ${clock(ms)}`; };

// ---------------------------------------------------------------- state (remembered per viewer)
const DEF = { cat: 'all', topic: '', who: 'buyer', age: '24', reps: '10', sort: 'score', q: '', ours: 'all' };
let F = { ...DEF };
try { F = { ...DEF, ...JSON.parse(localStorage.getItem('huntView') || '{}') }; } catch { /* first visit */ }
const save = () => { try { localStorage.setItem('huntView', JSON.stringify(F)); } catch { /* private window */ } };
let data = { items: [], picks: [], view: null };
let limit = 25;
let days = 2;

// ---------------------------------------------------------------- data
async function load() {
  if (EXT) {
    const v = await send({ cmd: 'hunt-view' });
    data = { items: Object.values(v.pool || {}), picks: v.picks || [], view: v };
  } else {
    if (!KEY) { $('banner').className = 'banner warn'; $('banner').textContent = 'This link has no code. Open it from the extension: Settings → Phone dashboard → Copy.'; return; }
    const r = await fetch(`/api/pool?k=${encodeURIComponent(KEY)}&days=${days}`, { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { $('banner').className = 'banner warn'; $('banner').textContent = j.error === 'bad key' ? 'This link is not valid.' : `Could not load: ${j.error || r.status}`; return; }
    const items = j.items || [];
    data = { items, picks: localPicks(items), view: { meta: j.meta, daysStored: j.days, loaded: j.loaded } };
  }
  render();
}
function localPicks(items) {
  const now = Date.now();
  return items.filter((i) => !i.status && (i.lane === 'buyer' || i.lane === 'expert') && (Number(i.replyCount) || 0) < 10 && now - (t0(i.startedAt) || i.firstSeen) < 72 * HOUR)
    .sort((a, b) => b.score - a.score).slice(0, 10).map((i) => i.id);
}

// ---------------------------------------------------------------- filters
function chips(el, opts, cur, set) {
  el.innerHTML = opts.map(([v, label, n]) => `<span class="chip${cur === v ? ' on' : ''}" data-v="${esc(v)}">${esc(label)}${n != null ? `<i>${n}</i>` : ''}</span>`).join(' ');
  for (const c of el.querySelectorAll('.chip')) c.onclick = () => { set(c.dataset.v); limit = 25; save(); render(); };
}
function passes(i, now, f = F, skip = '') {
  if (skip !== 'cat' && f.cat !== 'all' && i.cat !== f.cat) return false;
  if (skip !== 'topic' && f.topic && i.topic !== f.topic) return false;
  if (skip !== 'who' && f.who !== 'all' && i.lane !== f.who) return false;
  const start = t0(i.startedAt) || i.firstSeen || 0;
  if (skip !== 'age' && f.age !== 'any' && now - start > Number(f.age) * HOUR) return false;
  const rep = Number(i.replyCount) || 0;
  if (skip !== 'reps' && f.reps === '0' && rep !== 0) return false;
  if (skip !== 'reps' && f.reps === '10' && rep >= 10) return false;
  if (skip !== 'ours' && f.ours === 'open' && (i.haf === 'dm' || i.haf === 'posted')) return false;
  if (skip !== 'ours' && f.ours === 'ours' && !i.haf) return false;
  if (f.q) { const q = f.q.toLowerCase(); if (!`${i.title} ${i.author} ${i.forum}`.toLowerCase().includes(q)) return false; }
  return true;
}
const count = (pred) => data.items.filter(pred).length;

function labels(i, now) {
  const age = now - (t0(i.startedAt) || 0), rep = Number(i.replyCount) || 0;
  let out = '';
  if (age < 30 * 60000 && rep === 0) out += '<span class="shine">✨ BRAND NEW</span>';
  else if (age < 30 * 60000 && rep <= 4) out += '<span class="shine f5">🔥 FIRST 5</span>';
  if (i.lane === 'buyer' && i.budget) out += '<span class="shine gem">💵 BUDGET</span>';
  return out;
}
const OURS = { dm: ['ours', '🤖 DM sent by our system'], posted: ['ours', '✅ Replied by our system'], queued: ['queued', '⏳ In HAF queue'] };
const BOARD = (f) => (/hire a freelancer/i.test(f || '') ? 'HAF' : /want to buy/i.test(f || '') ? 'WTB' : '');
const catOf = (id) => CATS.find((c) => c.id === id) || CATS[CATS.length - 1];
const WHO = { buyer: ['buyer', 'BUYER'], expert: ['expert', 'QUESTION'], other: ['other', 'THREAD'] };

// ---------------------------------------------------------------- render
function render() {
  const now = Date.now();
  const v = data.view || {};
  // header + banner
  if (EXT) {
    $('dot').classList.toggle('on', !!v.on && !v.paused);
    $('next').textContent = v.nextAt ? (v.nextAt > now ? `${Math.floor((v.nextAt - now) / 60000)}:${String(Math.floor(((v.nextAt - now) % 60000) / 1000)).padStart(2, '0')}` : 'now') : '—';
    $('pages').textContent = `${v.pagesHour ?? 0} / ${v.pagesCap ?? 15}`;
    $('ver').textContent = `log v${chrome.runtime.getManifest().version} · SEO buyer hunter`;
    const b = $('banner'); const lu = v.lastUpdate;
    if (!v.on) { b.className = 'banner warn'; b.textContent = 'Hunt is off. Turn it on in Hunt settings below.'; }
    else if (v.paused) { b.className = 'banner warn'; b.textContent = `⏸ BHW showed a check. Reading pauses until ${clock(v.paused)}, then goes on slowly. Nothing is solved or bypassed.`; }
    else if (!v.fastDone) { b.className = 'banner load'; b.innerHTML = '⏳ <b>First start:</b> reading 3 pages of BHW now - the first threads show here in about 2 minutes.'; }
    else if (v.history?.started && !v.history.done && v.history.total) {
      const doneN = v.history.total - v.history.left;
      b.className = 'banner load';
      b.innerHTML = `📚 <b>Loading your history:</b> ${doneN} of ${v.history.total} pages · about ${Math.max(1, Math.round(v.history.left * 4))} min left. New threads keep coming meanwhile.<div class="bar"><i style="width:${Math.round(100 * doneN / v.history.total)}%"></i></div>`;
    } else if (lu) { b.className = 'banner'; b.innerHTML = `✅ <b>Last update ${clock(lu.at)}</b> · read ${lu.pages} page${lu.pages === 1 ? '' : 's'} of BHW what's-new (all forums) · <b>${lu.fresh} new threads</b> · ${v.gemsToday || 0} gem${v.gemsToday === 1 ? '' : 's'} sent today · ${v.pending || 0} waiting for the next summary${v.account ? ` · Account: ${esc(v.account)}` : ''}${v.pushErr ? ` · <span style="color:#b45309">central database: ${esc(v.pushErr)}</span>` : ''}`; }
    else { b.className = 'banner load'; b.textContent = 'Waiting for the first update…'; }
  } else {
    const m = v.meta || {};
    $('dot').classList.toggle('on', !!m.at && now - m.at < 40 * 60000);
    $('next').textContent = m.at ? `last ${ago(m.at, now)}` : '—';
    $('pages').textContent = '≤ 15';
    $('ver').textContent = `· SEO buyer hunter${m.account ? ` · ${esc(m.account)}` : ''}`;
    const b = $('banner');
    b.className = m.at && now - m.at < 40 * 60000 ? 'banner' : 'banner warn';
    b.innerHTML = `${m.at && now - m.at < 40 * 60000 ? '✅' : '⚠️'} Central database · ${data.items.length} threads from the last ${(v.loaded || []).length} day(s) of ${v.daysStored || 0} stored · updated ${m.at ? ago(m.at, now) : 'never'}`;
    $('phoneDays').innerHTML = [2, 7, 30].map((d) => `<button class="${d === days ? 'pri' : ''}" data-d="${d}">${d === 2 ? 'Today' : `${d} days`}</button>`).join(' ');
    for (const x of $('phoneDays').querySelectorAll('button')) x.onclick = () => { days = Number(x.dataset.d); load(); };
  }

  // categories
  const catCount = (id) => count((i) => passes(i, now, { ...F, cat: id, topic: '' }, ''));
  $('cats').innerHTML = [['all', 'All', '🧲'], ...CATS.map((c) => [c.id, c.name, c.icon])]
    .map(([id, name, icon]) => `<span class="cat${F.cat === id ? ' on' : ''}" data-c="${id}">${icon} ${esc(name)}<i>${id === 'all' ? count((i) => passes(i, now, F, 'cat')) : catCount(id)}</i></span>`).join('');
  for (const c of $('cats').querySelectorAll('.cat')) c.onclick = () => { F.cat = c.dataset.c; F.topic = ''; limit = 25; save(); render(); };

  // tiles
  const today = data.items.filter((i) => now - (i.firstSeen || 0) < 24 * HOUR && (F.cat === 'all' || i.cat === F.cat));
  const tiles = [
    [EXT ? (v.lastUpdate?.fresh ?? 0) : count((i) => now - (i.firstSeen || 0) < HOUR), EXT ? 'new this update' : 'new last hour', true],
    [today.length, `${F.cat === 'all' ? '' : `${(CATS.find((c) => c.id === F.cat) || {}).name} `}threads today`],
    [today.filter((i) => i.lane === 'buyer').length, 'buyers today'],
    [today.filter((i) => i.lane === 'expert').length, 'questions today'],
    [today.filter((i) => (Number(i.replyCount) || 0) < 10).length, 'under 10 replies'],
    [data.items.length, 'in database']
  ];
  if (EXT) tiles.push([v.gemsToday || 0, 'gems today']);
  $('stats').innerHTML = tiles.map(([n, l, hl]) => `<div class="k${hl ? ' hl' : ''}"><b>${n}</b><span>${esc(l)}</span></div>`).join('');

  // picks
  const byId = new Map(data.items.map((i) => [String(i.id), i]));
  const picks = (data.picks || []).map((id) => byId.get(String(id))).filter(Boolean);
  $('picks').innerHTML = picks.length ? picks.map((i) => `<li><span class="tag ${WHO[i.lane][0]}">${WHO[i.lane][1]}</span> <a class="t" href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a>${labels(i, now)} <span class="s">· ${catOf(i.cat).icon} ${esc(catOf(i.cat).name)} › ${esc(topicName(i.cat, i.topic))}${BOARD(i.forum) ? ` · ${BOARD(i.forum)}` : ''}${OURS[i.haf] ? ` · ${OURS[i.haf][1]}` : ''} · ${Number(i.replyCount) || 0} replies · ${ago(t0(i.startedAt) || i.firstSeen, now)}</span></li>`).join('') : '<li class="s">No picks yet - they appear after the first update.</li>';
  $('picksNote').textContent = 'best buyers and questions not acted on, under 10 replies, last 3 days';

  // filter rows
  const cat = CATS.find((c) => c.id === F.cat);
  $('topicLabel').textContent = F.cat === 'ads' ? 'Platform' : 'Topic';
  chips($('topics'), cat ? [['', `All ${cat.name}`, count((i) => passes(i, now, F, 'topic'))], ...cat.topics.map(([id, name]) => [id, name, count((i) => passes(i, now, { ...F, topic: id }))])]
    : [['', 'All categories']], F.topic, (x) => { F.topic = x; });
  chips($('who'), [['buyer', '💰 Buyers', count((i) => passes(i, now, { ...F, who: 'buyer' }))], ['expert', '🎓 Questions', count((i) => passes(i, now, { ...F, who: 'expert' }))], ['all', 'Everything', count((i) => passes(i, now, { ...F, who: 'all' }))]], F.who, (x) => { F.who = x; });
  chips($('age'), [['1', 'Last hour'], ['24', 'Today'], ['48', '48 h'], ['168', '7 days'], ['any', 'Any']], F.age, (x) => { F.age = x; });
  chips($('reps'), [['0', '0 only'], ['10', 'Under 10'], ['any', 'Any']], F.reps, (x) => { F.reps = x; });
  chips($('ours'), [['all', 'Everything'], ['open', 'Not handled yet', count((i) => passes(i, now, { ...F, ours: 'open' }))], ['ours', 'Handled by our system', count((i) => passes(i, now, { ...F, ours: 'ours' }))]], F.ours, (x) => { F.ours = x; });
  chips($('sort'), [['score', 'Best first'], ['new', 'Newest'], ['reps', 'Fewest replies']], F.sort, (x) => { F.sort = x; });
  if ($('q').value !== F.q) $('q').value = F.q;

  // table
  const list = data.items.filter((i) => passes(i, now));
  const st = (i) => t0(i.startedAt) || i.firstSeen || 0;
  list.sort(F.sort === 'new' ? (a, b) => st(b) - st(a) : F.sort === 'reps' ? (a, b) => (Number(a.replyCount) || 0) - (Number(b.replyCount) || 0) || st(b) - st(a) : (a, b) => b.score - a.score || st(b) - st(a));
  $('rows').innerHTML = list.slice(0, limit).map((i) => {
    const s = st(i);
    const ours = OURS[i.haf];
    const status = ours ? `<span class="tag ${ours[0]}">${ours[1]}</span>` : i.status === 'done' ? '✓ Done' : i.status === 'skip' ? 'Skipped' : 'To do';
    const c = catOf(i.cat), board = BOARD(i.forum);
    const acts = i.haf === 'dm' || i.haf === 'posted' ? '' : EXT && !i.status ? `<span class="act"><button data-a="done" data-id="${esc(i.id)}">✓ Done</button> <button data-a="skip" data-id="${esc(i.id)}">Skip</button></span>` : EXT ? `<span class="act"><button data-a="" data-id="${esc(i.id)}">Undo</button></span>` : '';
    return `<tr class="${i.status || i.haf === 'dm' || i.haf === 'posted' ? 'done' : ''}"><td>${s ? dayLabel(s) : '—'}<div class="s">${ago(s, now)}</div></td><td>${i.replyCount ?? '—'}</td>
      <td><b class="catn">${c.icon} ${esc(c.name)}</b><div><span class="tag topic">${esc(topicName(i.cat, i.topic).toUpperCase())}</span></div></td><td><span class="tag ${WHO[i.lane]?.[0] || 'other'}">${WHO[i.lane]?.[1] || ''}</span></td>
      <td><a class="t" href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a>${labels(i, now)}<div class="s">${esc(i.author || '')}</div></td>
      <td class="hide-m">${board ? `<span class="tag board">${board}</span> ` : ''}${esc(i.forum || '')}</td><td>${status}<div>${acts}</div></td></tr>`;
  }).join('') || '<tr><td colspan="7" class="s">Nothing matches these filters yet.</td></tr>';
  $('more').innerHTML = list.length > limit ? `<span class="s">Showing ${limit} of ${list.length}</span> · <button id="moreBtn">Show 25 more ▾</button>` : list.length ? `<span class="s">${list.length} thread${list.length === 1 ? '' : 's'}</span>` : '';
  if ($('moreBtn')) $('moreBtn').onclick = () => { limit += 25; render(); };
  for (const b of $('rows').querySelectorAll('button[data-id]')) b.onclick = async () => { await send({ cmd: 'hunt-mark', id: b.dataset.id, status: b.dataset.a }); load(); };

  if (EXT) renderSettings(v);
}

function renderSettings(v) {
  const focus = new Set(v.focus || []);
  $('setrow').innerHTML = `<label><input type="checkbox" id="sOn" ${v.on ? 'checked' : ''}> Hunt on</label>
    <span class="s">Gems and Telegram summaries for:</span> ${CATS.filter((c) => c.id !== 'other').map((c) => `<label><input type="checkbox" class="sF" value="${c.id}" ${focus.has(c.id) ? 'checked' : ''}> ${c.icon} ${esc(c.name)}</label>`).join('')}
    <div class="s" style="margin-top:6px">Up to 8 gems a day. A summary comes when 10 or more new threads are waiting. Phone link: ${v.phone ? `<a href="${esc(v.phone.replace('/#k=', '/hunt.html#k='))}" target="_blank" rel="noopener">open Hunt on the phone</a>` : 'turn it on under Settings → Phone dashboard'}.</div>`;
  $('sOn').onchange = async (e) => { await send({ cmd: 'hunt-save', huntOn: e.target.checked }); load(); };
  for (const x of document.querySelectorAll('.sF')) x.onchange = async () => { await send({ cmd: 'hunt-save', huntFocus: [...document.querySelectorAll('.sF')].filter((y) => y.checked).map((y) => y.value) }); load(); };
}

// ---------------------------------------------------------------- wiring
$('q').oninput = () => { F.q = $('q').value.trim(); limit = 25; save(); render(); };
for (const el of document.querySelectorAll('.ext')) el.hidden = !EXT;
if (!EXT) { $('back').hidden = true; }
if (EXT) {
  $('now').onclick = async () => { $('now').textContent = 'Updating…'; await send({ cmd: 'hunt-now' }); setTimeout(() => { $('now').textContent = 'Update now'; load(); }, 4000); };
  $('nextPicks').onclick = async () => { await send({ cmd: 'hunt-next' }); load(); };
  $('searchbtn').onclick = async () => {
    const q = prompt('Search BHW (last 7 days) for:', F.q || 'seo');
    if (!q) return;
    $('searchbtn').textContent = 'Searching…';
    const r = await send({ cmd: 'hunt-search', q, days: 7 });
    $('searchbtn').textContent = 'Search BHW';
    if (r.error) { alert(r.error); return; }
    F = { ...F, q: '', cat: 'all', topic: '', who: 'all', age: '168', reps: 'any' }; save();
    await load();
    alert(`${r.ids.length} threads found (${r.fresh} new) - they are in the list now.`);
  };
  chrome.storage.onChanged.addListener((ch) => { if (ch.huntPool || ch.hunt) load(); });
  setInterval(render, 1000 * 15);
}
setInterval(load, EXT ? 60000 : 30000);
load();
