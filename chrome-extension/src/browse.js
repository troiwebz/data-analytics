// Reading BlackHatWorld the way a member does: in a real tab.
//
// A fetch() from the extension carries the cookies but not the rest - no
// page load, no assets, no JavaScript, a burst of requests in a second - and
// Cloudflare answered a morning of that with 429 for every feed. A background
// tab is the browser doing what it always does. One tab at a time, a pause
// while the page "is read", a random gap before the next. Slower on purpose.
//
// Everything that runs INSIDE the page is a plain function with no closure
// (chrome.scripting serialises it), and returns data only.

export const BHW = 'https://www.blackhatworld.com';
export const WHATS_NEW = `${BHW}/whats-new/posts/`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const between = (lo, hi) => lo + Math.random() * (hi - lo);

export function waitForTabLoad(tabId, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('tab load timeout')); }, timeoutMs);
    const onUpdated = (id, info) => { if (id === tabId && info.status === 'complete') { cleanup(); resolve(); } };
    const cleanup = () => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(onUpdated); };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

// ---------------------------------------------------------- inside the page

/** Is this a Cloudflare wall rather than the forum? Runs in the page. */
function blockedReason() {
  const t = String(document.title || '');
  const body = String((document.body && document.body.innerText) || '').slice(0, 3000);
  if (/just a moment|access denied|attention required|rate limited|error 429|too many requests/i.test(t)) return `BHW blocked the page: ${t.slice(0, 80)}`;
  if (/you have been rate limited|access denied|has been blocked|verify you are human/i.test(body)) return 'BHW blocked the page (Cloudflare)';
  return '';
}

/** Thread rows off a forum listing or the What's new page. Runs in the page. */
export function extractListing() {
  const t = String(document.title || '');
  const body = String((document.body && document.body.innerText) || '').slice(0, 3000);
  if (/just a moment|access denied|attention required|rate limited|error 429|too many requests/i.test(t)
      || /you have been rate limited|access denied|has been blocked|verify you are human/i.test(body)) {
    return { blocked: `BHW blocked the page: ${t.slice(0, 80)}` };
  }
  const iso = (el) => {
    const v = el && el.getAttribute('data-timestamp');
    const ms = v ? parseInt(v, 10) * 1000 : NaN;
    return isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
  };
  const num = (s) => {
    const m = String(s || '').replace(/,/g, '').match(/([\d.]+)\s*([KkMm])?/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    return Math.round(n * (/k/i.test(m[2] || '') ? 1000 : /m/i.test(m[2] || '') ? 1e6 : 1));
  };
  const rows = [];
  for (const el of document.querySelectorAll('.structItem--thread')) {
    const m = String(el.className).match(/js-threadListItem-(\d+)/);
    if (!m) continue;
    const a = el.querySelector('.structItem-title a[href*="/threads/"]') || el.querySelector('.structItem-title a');
    if (!a) continue;
    let forumA = null;
    for (const x of el.querySelectorAll('.structItem-cell--main a[href*="/forums/"]')) {
      if (/\/forums\/[a-z0-9-]+\.\d+\/?$/i.test(x.getAttribute('href') || '')) { forumA = x; break; }
    }
    let replies = null;
    for (const dl of el.querySelectorAll('.structItem-cell--meta dl')) {
      if (/repl/i.test(dl.textContent || '')) { const dd = dl.querySelector('dd'); replies = num(dd && dd.textContent); break; }
    }
    const href = forumA ? forumA.getAttribute('href') || '' : '';
    rows.push({
      threadId: m[1],
      url: new URL(a.getAttribute('href'), location.href).href,
      title: (a.textContent || '').trim(),
      author: el.getAttribute('data-author') || '',
      startedAt: iso(el.querySelector('.structItem-startDate time')),
      lastActivityAt: iso(el.querySelector('.structItem-latestDate time') || el.querySelector('.structItem-cell--latest time')),
      replyCount: replies,
      sticky: /structItem--sticky/.test(String(el.className)),
      forum: forumA ? (forumA.textContent || '').trim() : '',
      forumNode: ((href.match(/\.(\d+)\/?$/) || [])[1]) || ''
    });
  }
  const loggedIn = document.documentElement.getAttribute('data-logged-in') === 'true';
  const next = !!document.querySelector('a.pageNav-jump--next');
  return { rows, loggedIn, next, title: t, url: location.href };
}

/** The first post and every reply on a thread page. Runs in the page. */
export function extractThread() {
  const t = String(document.title || '');
  const bodyText = String((document.body && document.body.innerText) || '').slice(0, 3000);
  if (/just a moment|access denied|attention required|rate limited|error 429|too many requests/i.test(t)
      || /you have been rate limited|access denied|has been blocked|verify you are human/i.test(bodyText)) {
    return { blocked: `BHW blocked the page: ${t.slice(0, 80)}` };
  }
  const iso = (el) => {
    const v = el && el.getAttribute('data-timestamp');
    const ms = v ? parseInt(v, 10) * 1000 : NaN;
    return isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
  };
  const posts = [];
  for (const art of document.querySelectorAll('article.message--post')) {
    const wrap = art.querySelector('.bbWrapper');
    if (!wrap) continue;
    const clone = wrap.cloneNode(true);
    for (const n of clone.querySelectorAll('blockquote, script, style, .bbCodeBlock--quote')) n.remove();
    const text = String(clone.innerText || clone.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    posts.push({ author: art.getAttribute('data-author') || '', text, at: iso(art.querySelector('time[data-timestamp]')) });
  }
  // The page carries the breadcrumb twice (top and bottom); read the first.
  const crumbs = [];
  const bc = document.querySelector('.p-breadcrumbs');
  if (bc) for (const x of bc.querySelectorAll('[itemprop="name"]')) crumbs.push((x.textContent || '').trim());
  const keyEl = document.querySelector('[data-container-key^="node-"]');
  const forumNode = keyEl ? String(keyEl.getAttribute('data-container-key')).replace('node-', '') : '';
  const startEl = document.querySelector('.p-description time[data-timestamp]');
  const h1 = document.querySelector('h1.p-title-value');
  return {
    title: h1 ? (h1.textContent || '').trim() : '',
    body: posts.length ? posts[0].text : '',
    replies: posts.slice(1).map((p) => ({ author: p.author, text: p.text })),
    startedAt: iso(startEl) || (posts.length ? posts[0].at : null),
    forumNode,
    // "Home › Forums › Making Money › Pay Per Click › General PPC Discussion":
    // the breadcrumb ends at the forum; the thread title is the h1, not a crumb.
    forum: crumbs.length ? crumbs[crumbs.length - 1] : '',
    section: crumbs.slice(2).join(' › '),
    loggedIn: document.documentElement.getAttribute('data-logged-in') === 'true'
  };
}

// ----------------------------------------------------------- from outside

/**
 * Open a page in a background tab, let it load, pause like a reader would,
 * run `func` inside it, close the tab. Throws when the page is a wall.
 */
export async function readInTab(url, func, { settleMs, args = [] } = {}) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForTabLoad(tab.id);
    await sleep(settleMs ?? between(1500, 4000));
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args });
    const out = r && r.result;
    if (!out) throw new Error('the page gave nothing back');
    if (out.blocked) throw new Error(out.blocked);
    return out;
  } finally {
    setTimeout(() => { try { Promise.resolve(chrome.tabs.remove(tab.id)).catch(() => {}); } catch { /* already gone */ } }, between(400, 1500));
  }
}

/** Lines that carry no information about the post: contact handles, bare links. */
const NOISE = new RegExp([
  '^\\s*(telegram|skype|whatsapp|discord|email|gmail|e-?mail|contact|pm me|dm me|website|site)\\b',
  '^\\s*https?://', '^\\s*@\\w+\\s*$', '^[\\W_]{0,4}$'
].join('|'), 'i');
const clean = (text) => String(text || '').split('\n').filter((l) => l.trim() && !NOISE.test(l)).join('\n').trim();

/** One thread, read in a tab. Same shape thread.js gives, never throws on an unreadable page. */
export async function readThreadTab(url) {
  try {
    const got = await readInTab(url, extractThread);
    return { ...got, body: clean(got.body), replies: (got.replies || []).map((r) => ({ author: r.author, text: clean(r.text) })).filter((r) => r.text) };
  } catch (e) {
    if (/blocked/i.test(e.message)) throw e;            // a wall is news; an odd page is not
    return { body: '', replies: [] };
  }
}

/**
 * Several threads, one tab at a time, a human gap between them. `onOne` sees
 * each result as it lands. Stops early on a wall and says so in `blocked`.
 */
export async function readThreadsInTabs(leads, { max = 5, gapMs = 6000, onOne } = {}) {
  const out = {};
  const list = leads.slice(0, max);
  let blocked = '';
  for (let i = 0; i < list.length; i++) {
    const l = list[i];
    if (!l || !l.url) continue;
    let got;
    try { got = await readThreadTab(l.url); }
    catch (e) { blocked = e.message; break; }
    if (got.body || (got.replies && got.replies.length)) out[l.threadId] = got;
    if (onOne) onOne(l, got);
    if (i < list.length - 1) await sleep(between(gapMs * 0.6, gapMs * 1.6));
  }
  return blocked ? Object.assign(out, { __blocked: blocked }) : out;
}

/** A listing page (a forum, or What's new) as rows. Throws on a wall. */
export const readListingTab = (url) => readInTab(url, extractListing);

/** Several pages of one listing, as { [threadId]: row }, a human gap between pages. */
export async function readListingPages(url, pages = 1, { gapMs = 5000, onPage } = {}) {
  const out = {};
  for (let p = 1; p <= pages; p++) {
    const u = p === 1 ? url : `${url}${url.includes('?') ? '&' : '?'}page=${p}`;
    const got = await readListingTab(u);
    for (const r of got.rows) out[r.threadId] = r;
    if (onPage) onPage(p, got.rows.length, Object.keys(out).length);
    if (!got.next) break;
    if (p < pages) await sleep(between(gapMs * 0.6, gapMs * 1.6));
  }
  return out;
}
