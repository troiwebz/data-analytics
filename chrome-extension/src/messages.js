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
// Who you are, read off the page's own navigation. Needed because a
// conversation only proves you pitched if YOU started it - a message the buyer
// sent you is not evidence of your PM, and treating it as such is what marked
// leads you had never touched as done.
// Who you are, from the page's own navigation. These are a fallback now, not
// the basis: the second of the two never matched anything, because real
// XenForo writes the href BEFORE the class
// (<a href="/members/name.123/" class="...p-navgroup-link--user">) and this
// looked for it after. With both patterns missing and the check failing
// closed, nothing was ever marked sent and "check the inbox" reported 0 for
// ever - indistinguishable from there being nothing to do. Hence peopleInEvery
// below, which needs no knowledge of the theme at all.
const ME = [
  /class="[^"]*p-navgroup-user-linkText[^"]*"[^>]*>([\s\S]*?)</,
  /<a[^>]+href="[^"]*\/members\/([^."\/]+)[^"]*"[^>]*class="[^"]*p-navgroup-link--user/,
  /<a[^>]+class="[^"]*p-navgroup-link--user[^"]*"[^>]+href="[^"]*\/members\/([^."\/]+)/,
  /data-logged-in="true"[\s\S]{0,4000}?\/account\/[\s\S]{0,400}?\/members\/([^."\/]+)/
];

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
      // The row's own starter, kept apart from the participant list: this is
      // the only field that says who opened the conversation.
      startedBy: starter ? norm(starter[1]) : '',
      // NOT when it started - XenForo puts the LAST message's time here. The
      // old code read this as a start date and called any bumped conversation
      // proof of a fresh PM, which is the bug this whole file now guards.
      at: ts ? new Date(parseInt(ts[1], 10) * 1000).toISOString() : null
    });
  }
  return out;
}

/**
 * The one name in every conversation.
 *
 * You are a participant in every conversation you have, so the username that
 * appears in all of them is you. That is true of any forum, in any theme, and
 * survives markup changes entirely - which is why it is tried first. Two rows
 * could coincide on a second shared person, so three are wanted before it is
 * trusted, and a tie means no answer rather than a guess.
 */
export function peopleInEvery(rows) {
  const list = (rows || []).filter((r) => r.people?.length);
  if (list.length < 3) return '';
  const counts = new Map();
  for (const r of list) for (const p of new Set(r.people)) counts.set(p, (counts.get(p) || 0) + 1);
  const all = [...counts.entries()].filter(([, n]) => n === list.length).map(([p]) => p);
  return all.length === 1 ? all[0] : '';
}

/**
 * Your own BHW username.
 *
 * Order matters: the conversations themselves first, because that cannot be
 * broken by a theme; then the navigation markup; and a name you typed in
 * Settings beats both, because if you have told us, guessing is absurd.
 */
export function parseMe(html, rows, told = '') {
  if (told) return norm(told);
  const fromRows = peopleInEvery(rows);
  if (fromRows) return fromRows;
  for (const re of ME) {
    const m = String(html || '').match(re);
    const name = norm(strip(m?.[1]));
    if (name) return name;
  }
  return '';
}

/**
 * Do two subjects describe the same thread?
 *
 * The old test was `a.includes(b) || b.includes(a)`, which after punctuation is
 * stripped makes a conversation called "SEO" a match for "Looking for SEO
 * expert" - and so marks a lead done because you once used the word SEO. This
 * asks instead how much of the shorter subject the longer one actually
 * accounts for, and wants most of it plus more than one word in common, so a
 * single shared keyword is never enough.
 */
export function titlesMatch(a, b) {
  const A = normTitle(a), B = normTitle(b);
  if (!A || !B) return false;
  if (A === B) return true;
  const wa = new Set(A.split(' ').filter((w) => w.length > 2));
  const wb = new Set(B.split(' ').filter((w) => w.length > 2));
  if (!wa.size || !wb.size) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  const smaller = Math.min(wa.size, wb.size);
  return shared >= 2 && shared / smaller >= 0.6;
}

/**
 * Read the conversation list.
 *
 * One page, by default and in practice always. The list is ordered by most
 * recent activity, so a lead found today is on page one or it is not there at
 * all - and anything further back is by definition older than the threads
 * being worked. Walking more pages cost extra requests to the forum on every
 * check and never once changed an answer.
 *
 * Returns the rows and who you are, because deciding whether a conversation
 * proves anything needs both and the username is on the same page.
 */
export async function fetchConversations(pages = 1, { told = '' } = {}) {
  const all = [];
  let firstHtml = '';
  for (let p = 1; p <= pages; p++) {
    const url = p === 1 ? 'https://www.blackhatworld.com/direct-messages/'
                        : `https://www.blackhatworld.com/direct-messages/page-${p}`;
    const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
    if (!res.ok) throw new Error(`direct-messages page ${p} returned ${res.status}`);
    const html = await res.text();
    if (/\/login\b/.test(html) && !ROW_SPLIT.test(html)) {
      throw new Error('not logged in to BlackHatWorld in this Chrome profile');
    }
    if (p === 1) firstHtml = html;
    const rows = parseConversations(html);
    all.push(...rows);
    if (rows.length === 0) break;
  }
  // Worked out AFTER parsing, because the rows are the best evidence of who
  // you are and they only exist once the page is read.
  return { rows: all, me: parseMe(firstHtml, all, told) };
}

/**
 * Decide, for one lead, what the message list actually proves.
 *
 * Three answers, because the old two collapsed cases that are not alike:
 *
 *   sent    you started a conversation with that person whose subject is this
 *           thread. That is a PM you sent about this job.
 *   maybe   a conversation with them has moved recently, but either they
 *           started it or the subject is something else. Worth showing you
 *           before you pitch again; not proof you already did.
 *   prior   a conversation exists but it is old. Context, nothing more.
 *
 * What changed and why: the previous version returned `sent: true` for any
 * conversation with that person whose timestamp was later than when we found
 * the thread. XenForo puts the LAST message's time in that field, so a buyer
 * messaging you about something else, or a year-old thread getting one reply,
 * both read as "you already pitched this" - and the lead was struck off, the
 * Telegram tap refused as a duplicate, and a slot charged to your daily cap,
 * for a PM that never existed.
 *
 * Timing is no longer proof of anything on its own. `me` is your username;
 * without it authorship cannot be checked, so nothing is treated as sent.
 */
export function matchLead(lead, conversations, me = '') {
  const author = norm(lead.author);
  if (!author) return null;
  const rows = Array.isArray(conversations) ? conversations : conversations?.rows || [];
  const mine = rows.filter((c) => c.people.includes(author));
  if (!mine.length) return null;

  const who = norm(me);
  const found = new Date(lead.foundAt || 0).getTime();
  const byNewest = (a, b) => new Date(b.at || 0) - new Date(a.at || 0);
  const iStarted = (c) => Boolean(who) && c.startedBy === who;

  // Proof: your conversation, this subject.
  const proven = mine.filter(iStarted)
    .find((c) => titlesMatch(c.title, lead.dmTitle || lead.title));
  if (proven) {
    return { sent: true, at: proven.at, url: proven.url, title: proven.title,
             why: 'you started a conversation with this subject' };
  }

  // Not proof, but you should see it before pitching again.
  const recent = mine.slice().sort(byNewest)
    .find((c) => c.at && new Date(c.at).getTime() >= found - 60000);
  if (recent) {
    return { sent: false, maybe: true, at: recent.at, url: recent.url, title: recent.title,
             why: iStarted(recent)
               ? 'you have a conversation with them about something else'
               : 'they have messaged you recently' };
  }

  const newest = mine.slice().sort(byNewest)[0];
  return { sent: false, at: newest.at, url: newest.url, title: newest.title,
           why: 'you have spoken to them before' };
}
