// Reply counts are not in the RSS feed, so once per poll we fetch the forum
// listing page (one request) and pull them out of the HTML with regex — MV3
// service workers have no DOMParser.
//
// All markup assumptions live in these three patterns.
const THREAD_SPLIT = /class="[^"]*\bstructItem--thread\b/;
const THREAD_ID    = /js-threadListItem-(\d+)/;
const REPLY_COUNT  = /<dt>\s*Replies\s*<\/dt>\s*<dd>\s*([\d.,]+\s*[KkMm]?)\s*<\/dd>/;

function num(s) {
  const m = String(s).replace(/,/g, '').match(/([\d.]+)\s*([KkMm])?/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const mul = /k/i.test(m[2] || '') ? 1000 : /m/i.test(m[2] || '') ? 1e6 : 1;
  return Math.round(n * mul);
}

/** { [threadId]: replyCount } for every thread on the listing page. */
export function parseReplyCounts(html) {
  const out = {};
  const blocks = html.split(THREAD_SPLIT).slice(1);
  for (const b of blocks) {
    const id = b.match(THREAD_ID);
    const rc = b.match(REPLY_COUNT);
    if (id && rc) out[id[1]] = num(rc[1]);
  }
  return out;
}

export async function fetchReplyCounts(forumUrl) {
  try {
    const res = await fetch(forumUrl, { credentials: 'include', cache: 'no-store' });
    if (!res.ok) return {};
    const html = await res.text();
    if (!/structItem--thread/.test(html)) return {};   // challenge page or theme change
    return parseReplyCounts(html);
  } catch {
    return {};   // reply counts are nice-to-have; never fail a poll over them
  }
}

/** Derive the listing URL from the feed URL. */
export function forumUrlFromFeed(feedUrl) {
  return String(feedUrl).replace(/index\.rss.*$/, '');
}
