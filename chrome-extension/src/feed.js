// RSS fetching + parsing.
//
// NOTE: MV3 service workers have no DOMParser, so this parses the feed with
// regex rather than XML APIs. XenForo's feed is machine-generated and stable,
// so this is safe in practice — but keep the parser tolerant.

const ITEM_RE = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;

function tag(block, name) {
  const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i');
  const m = block.match(re);
  if (!m) return '';
  return decode(m[1]);
}

function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** XenForo thread URLs end in /threads/<slug>.<id>/ */
export function threadIdFromUrl(url) {
  const m = String(url).match(/\/threads\/[^/]*?\.(\d+)/) || String(url).match(/\.(\d+)\/?$/);
  return m ? m[1] : null;
}

export function parseRss(xml) {
  const items = [];
  let m;
  ITEM_RE.lastIndex = 0;
  while ((m = ITEM_RE.exec(xml)) !== null) {
    const block = m[1];
    const link = tag(block, 'link') || tag(block, 'guid');
    const id = threadIdFromUrl(link);
    if (!id) continue;
    // XenForo's forum feed reports the LAST post's date here, so treat it as
    // last activity. The real thread-start time comes from the listing page.
    const pub = tag(block, 'pubDate');
    items.push({
      threadId: id,
      url: link,
      title: tag(block, 'title'),
      author: tag(block, 'dc:creator') || tag(block, 'author') || '',
      snippet: tag(block, 'description').slice(0, 1200),
      // A XenForo forum feed puts the LAST POST date in <pubDate>, so this is
      // when the thread was last active, not when it started. The listing page
      // overwrites it with the real start time; until it does, it is only good
      // enough to decide "is this new to us", never to count as a launch.
      postedAt: pub ? new Date(pub).toISOString() : new Date().toISOString(),
      lastActivityAt: pub ? new Date(pub).toISOString() : null,
      postedAtSource: 'feed'
    });
  }
  return items;
}

export async function fetchFeed(feedUrl) {
  const res = await fetch(feedUrl, {
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Accept': 'application/rss+xml, application/xml, text/xml' }
  });
  if (!res.ok) throw new Error(`feed HTTP ${res.status}`);
  const text = await res.text();
  // Cloudflare challenge pages come back as 200 HTML, not XML.
  if (!/<rss|<feed|<item\b/i.test(text)) {
    throw new Error('feed did not return RSS (Cloudflare challenge?) — open BlackHatWorld in a tab and retry');
  }
  return parseRss(text);
}
