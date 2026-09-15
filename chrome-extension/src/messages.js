// Your direct-message list on BHW, read as the source of truth for what has
// actually been sent.
//
// The dashboard's own record only knows about PMs it saw you send. Anything
// sent from your phone, from another machine, or before this extension existed
// is invisible to it, which is how a thread you already contacted still sits on
// the to-do list. https://www.blackhatworld.com/direct-messages/ knows.
//
// The request carries your BHW cookies because the extension holds host
// permission for the domain, so no login and no credentials are involved.
// Nothing is ever posted or opened here; this only reads.
//
// Regex, not DOMParser, because MV3 service workers have no DOMParser. All
// markup assumptions live in the patterns below.

const ROW_SPLIT   = /class="[^"]*\bstructItem--conversation\b/;
const CONV_LINK   = /<a href="([^"]*\/direct-messages\/[^"]*?\.(\d+)\/?[^"]*)"[^>]*>([\s\S]*?)<\/a>/;
const STARTER     = /data-author="([^"]*)"/;
// "Participants: alice, bob" sits in the row's minor line as linked usernames.
const USERNAME_ANY = /<a[^>]+href="[^"]*\/members\/([^."\/]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
const TIMESTAMP   = /data-timestamp="(\d+)"/;

const strip = (h) => String(h || '').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

/** Usernames compare loosely: display name vs url slug vs what we stored. */
export const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Titles compare on words, so "Re: " and punctuation do not matter. */
export const normTitle = (s) => String(s || '').toLowerCase()
  .replace(/^re:\s*/, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** One conversation per row: who is in it, what it is called, when it moved. */
export function parseConversations(html) {
  const out = [];
  const chunks = String(html || '').split(ROW_SPLIT).slice(1);
  for (const chunk of chunks) {
    const link = chunk.match(CONV_LINK);
    if (!link) continue;
    const people = new Set();
    const starter = chunk.match(STARTER);
    if (starter) people.add(norm(starter[1]));
    for (const m of chunk.matchAll(USERNAME_ANY)) {
      people.add(norm(m[1]));
      if (strip(m[2])) people.add(norm(strip(m[2])));
    }
    const ts = chunk.match(TIMESTAMP);
    out.push({
      id: link[2],
      title: strip(link[3]),
      url: link[1].startsWith('http') ? link[1] : 'https://www.blackhatworld.com' + link[1],
      people: [...people].filter(Boolean),
      at: ts ? new Date(parseInt(ts[1], 10) * 1000).toISOString() : null
    });
  }
  return out;
}

/**
 * Walk the conversation list. Page 1 is usually enough; more only helps if a
 * lot has been sent since the last check.
 */
export async function fetchConversations(pages = 2) {
  const all = [];
  for (let p = 1; p <= pages; p++) {
    const url = p === 1 ? 'https://www.blackhatworld.com/direct-messages/'
                        : `https://www.blackhatworld.com/direct-messages/page-${p}`;
    const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
    if (!res.ok) throw new Error(`direct-messages page ${p} returned ${res.status}`);
    const html = await res.text();
    if (/\/login\b/.test(html) && !ROW_SPLIT.test(html)) {
      throw new Error('not logged in to BlackHatWorld in this Chrome profile');
    }
    const rows = parseConversations(html);
    all.push(...rows);
    if (rows.length === 0) break;
  }
  return all;
}

/**
 * Decide, for one lead, whether a conversation proves the PM went.
 *
 * Two levels, because the author's name alone is not proof: you may have
 * spoken to them a year ago about something else, and marking a fresh lead
 * done on that basis would hide work you have not done.
 *
 *   sent          the conversation's title matches the thread, or it is with
 *                 that author and started after we found the thread
 *   priorContact  a conversation with that author exists, but older. Worth
 *                 knowing before pitching, not proof of this pitch.
 */
export function matchLead(lead, conversations) {
  const author = norm(lead.author);
  if (!author) return null;
  const mine = conversations.filter((c) => c.people.includes(author));
  if (!mine.length) return null;

  const wanted = normTitle(lead.dmTitle || lead.title);
  const found = new Date(lead.foundAt || 0).getTime();

  const titled = wanted && mine.find((c) => {
    const t = normTitle(c.title);
    return t && (t === wanted || t.includes(wanted) || wanted.includes(t));
  });
  if (titled) return { sent: true, at: titled.at, url: titled.url, why: 'subject matches the thread' };

  const after = mine.find((c) => c.at && new Date(c.at).getTime() >= found - 60000);
  if (after) return { sent: true, at: after.at, url: after.url, why: 'started after the thread was found' };

  const newest = mine.slice().sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))[0];
  return { sent: false, at: newest.at, url: newest.url, why: 'you have spoken to them before' };
}
