// The RSS feed gives neither reply counts nor a reliable thread-start time —
// XenForo's forum feed puts the LAST post's date in <pubDate>, so a bumped old
// thread looks brand new. Both come from the forum listing page instead (one
// request per poll), parsed with regex because MV3 service workers have no
// DOMParser.
//
// All markup assumptions live in these patterns.
const THREAD_SPLIT = /class="[^"]*\bstructItem--thread\b/;
const THREAD_ID    = /js-threadListItem-(\d+)/;
const REPLY_COUNT  = /<dt>\s*Replies\s*<\/dt>\s*<dd>\s*([\d.,]+\s*[KkMm]?)\s*<\/dd>/;
// The thread's own start date: <li class="structItem-startDate">…<time data-timestamp="…">
const TITLE_LINK   = /<div class="structItem-title"[\s\S]{0,600}?<a href="([^"]*\/threads\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/;
const AUTHOR       = /data-author="([^"]*)"/;
const START_BLOCK  = /structItem-startDate[\s\S]{0,400}?<\/li>/;
const LATEST_BLOCK = /structItem-latestDate[\s\S]{0,400}?(?:<\/li>|<\/div>)/;
const TIMESTAMP    = /data-timestamp="(\d+)"/;
const DATETIME     = /datetime="([^"]+)"/;

function text(html) {
  return String(html || '').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

function num(s) {
  const m = String(s).replace(/,/g, '').match(/([\d.]+)\s*([KkMm])?/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const mul = /k/i.test(m[2] || '') ? 1000 : /m/i.test(m[2] || '') ? 1e6 : 1;
  return Math.round(n * mul);
}

/** ISO string from a XenForo <time> element, or null. */
function timeOf(block) {
  if (!block) return null;
  const ts = block.match(TIMESTAMP);
  if (ts) {
    const ms = parseInt(ts[1], 10) * 1000;
    if (isFinite(ms) && ms > 0) return new Date(ms).toISOString();
  }
  const dt = block.match(DATETIME);
  if (dt) {
    const d = new Date(dt[1]);
    if (!isNaN(d)) return d.toISOString();
  }
  return null;
}

/** { [threadId]: { replyCount, startedAt, lastActivityAt } } for the listing page. */
export function parseListing(html) {
  const out = {};
  for (const b of html.split(THREAD_SPLIT).slice(1)) {
    const id = b.match(THREAD_ID);
    if (!id) continue;
    const rc = b.match(REPLY_COUNT);
    const link = b.match(TITLE_LINK);
    const author = b.match(AUTHOR);
    out[id[1]] = {
      threadId: id[1],
      replyCount: rc ? num(rc[1]) : null,
      startedAt: timeOf((b.match(START_BLOCK) || [])[0]),
      lastActivityAt: timeOf((b.match(LATEST_BLOCK) || [])[0]),
      title: link ? text(link[2]) : '',
      author: author ? text(author[1]) : '',
      url: link ? new URL(link[1], 'https://www.blackhatworld.com').href : ''
    };
  }
  return out;
}

/** Overlay the listing page's facts: true thread-start time, replies, last activity. */
export function withListing(item, info) {
  if (!info) return item;
  return {
    ...item,
    replyCount: info.replyCount ?? item.replyCount ?? null,
    postedAt: info.startedAt || item.postedAt,
    postedAtSource: info.startedAt ? 'listing' : (item.postedAtSource || 'feed'),
    lastActivityAt: info.lastActivityAt || item.lastActivityAt || null
  };
}

export async function fetchListing(forumUrl) {
  try {
    const res = await fetch(forumUrl, { credentials: 'include', cache: 'no-store' });
    if (!res.ok) return {};
    const html = await res.text();
    if (!/structItem--thread/.test(html)) return {};   // challenge page or theme change
    return parseListing(html);
  } catch {
    return {};   // listing data is nice-to-have; never fail a poll over it
  }
}

/**
 * Walk several listing pages. Returns one merged map plus the raw per-thread
 * rows, so a deep backfill can reach threads the RSS feed no longer carries.
 * Pages are fetched one at a time with a pause — this is a bulk read of a
 * forum, not a burst.
 */
export async function fetchListingPages(forumUrl, pages = 1, { delayMs = 1200, onPage } = {}) {
  const merged = {};
  for (let page = 1; page <= Math.max(1, pages); page++) {
    const url = page === 1 ? forumUrl : `${forumUrl.replace(/\/$/, '')}/page-${page}`;
    const one = await fetchListing(url);
    const found = Object.keys(one).length;
    Object.assign(merged, one);
    if (onPage) await onPage(page, found, Object.keys(merged).length);
    if (!found) break;                      // past the last page
    if (page < pages) await new Promise((r) => setTimeout(r, delayMs));
  }
  return merged;
}

/** Derive the listing URL from the feed URL. */
export function forumUrlFromFeed(feedUrl) {
  return String(feedUrl).replace(/index\.rss.*$/, '');
}
