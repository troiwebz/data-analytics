// Reading your BHW message list to tick off what was already sent.
//
// The rule this file mostly exists to hold down: a conversation is only proof
// you pitched a job if YOU started it and its subject is that job. The earlier
// version accepted any conversation with that person whose timestamp was later
// than when the thread was found - and since XenForo puts the LAST message's
// time in that field, a buyer messaging you about something else, or a
// year-old chat getting one reply, both read as "already sent". Leads nobody
// had contacted were struck off, the Telegram tap refused them as duplicates,
// and each one charged a slot to the daily PM cap.
import { parseConversations, parseMe, matchLead, norm, normTitle, titlesMatch } from '../src/messages.js';

let fails = 0;
const ok = (n, c, e='') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + ' ' + e); } };

const ME = 'bargainbed';
const ts = (d) => Math.floor(new Date(d).getTime() / 1000);

// `starter` is the point of this helper: data-author is who opened the
// conversation, and it decides everything below.
const row = (id, title, people, when, starter) => `
  <div class="structItem structItem--conversation" data-author="${starter || people[0]}">
    <div class="structItem-title">
      <a href="/direct-messages/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${id}/">${title}</a>
    </div>
    <div class="structItem-minor">
      <ul class="listInline listInline--comma">
        ${people.map((p) => `<li><a href="/members/${p.toLowerCase()}.99/" class="username">${p}</a></li>`).join('')}
      </ul>
    </div>
    <div class="structItem-cell--latest"><time data-timestamp="${ts(when)}"></time></div>
  </div>`;

const nav = `<div class="p-navgroup-user"><span class="p-navgroup-user-linkText">${ME}</span></div>`;

const html = '<html>' + nav + '<div class="structItemContainer">' + [
  // You started this one, about that job: proof.
  row(101, 'Re: Bulk GMB Listings', ['Yeon G Mallah', ME], '2026-09-15T10:00:00Z', ME),
  // Old, yours: history.
  row(102, 'Some old chat about hosting', ['rankonserp', ME], '2025-02-01T09:00:00Z', ME),
  // THEY started it, and it is recent. The old code called this "sent".
  row(103, 'looking for gmail creator tool', ['AFFMUS', ME], '2026-09-15T17:30:00Z', 'AFFMUS'),
  // Yours, recent, but about something else entirely.
  row(104, 'invoice for the march work', ['seospecialist', ME], '2026-09-15T18:00:00Z', ME)
].join('') + '</div></html>';

const convs = parseConversations(html);
ok('every conversation is found', convs.length === 4, String(convs.length));
ok('the title is read', convs[0].title === 'Re: Bulk GMB Listings', convs[0].title);
ok('the id is read', convs[0].id === '101');
ok('the link is absolute', convs[0].url.startsWith('https://www.blackhatworld.com/direct-messages/'), convs[0].url);
ok('participants are found', convs[0].people.includes(norm('Yeon G Mallah')), JSON.stringify(convs[0].people));
ok('a display name with spaces matches its slug', norm('Yeon G Mallah') === 'yeongmallah');
ok('the date is read', convs[0].at.startsWith('2026-09-15'), convs[0].at);
ok('who opened it is read, which is the whole basis of the check',
   convs[0].startedBy === norm(ME) && convs[2].startedBy === norm('AFFMUS'),
   `${convs[0].startedBy} / ${convs[2].startedBy}`);
ok('nothing is invented from an empty page', parseConversations('<html></html>').length === 0);

ok('your own username is read off the page', parseMe(html) === norm(ME), parseMe(html));
ok('and a page without it does not guess one', parseMe('<html></html>') === '');

// --- what counts as proof ---------------------------------------------------
const byTitle = matchLead(
  { author: 'Yeon G Mallah', title: 'Looking for Bulk GMB Listings', dmTitle: 'Bulk GMB Listings',
    foundAt: '2026-09-15T09:00:00Z' }, convs, ME);
ok('a conversation you started, with that subject, is sent', byTitle?.sent === true, JSON.stringify(byTitle));
ok('and says why', /you started/.test(byTitle.why), byTitle.why);
ok('and carries the date and a link to read it',
   byTitle.at.startsWith('2026-09-15') && /direct-messages/.test(byTitle.url), JSON.stringify(byTitle));

// --- the bug, held down -----------------------------------------------------
const theyStarted = matchLead(
  { author: 'AFFMUS', title: 'Totally different wording here', dmTitle: 'Totally different wording here',
    foundAt: '2026-09-15T16:00:00Z' }, convs, ME);
ok('a message THEY sent you is never proof you pitched', theyStarted?.sent === false, JSON.stringify(theyStarted));
ok('but it is offered for you to look at', theyStarted?.maybe === true, JSON.stringify(theyStarted));
ok('and says it was them', /they have messaged you/.test(theyStarted.why), theyStarted.why);
ok('and links the conversation so the call is yours to make',
   /direct-messages/.test(theyStarted.url || ''), theyStarted.url);

const otherSubject = matchLead(
  { author: 'seospecialist', title: 'need a google ads guy for crypto', dmTitle: 'need a google ads guy for crypto',
    foundAt: '2026-09-15T12:00:00Z' }, convs, ME);
ok('your own chat about something else is not proof either', otherSubject?.sent === false, JSON.stringify(otherSubject));
ok('and is flagged as worth a look', otherSubject?.maybe === true, JSON.stringify(otherSubject));

// Without a username, authorship cannot be established - so nothing is sent.
// Failing closed the other way would mark every lead done the moment the page
// layout changed.
const noMe = matchLead(
  { author: 'Yeon G Mallah', title: 'Looking for Bulk GMB Listings', dmTitle: 'Bulk GMB Listings',
    foundAt: '2026-09-15T09:00:00Z' }, convs, '');
ok('with no username read, nothing is claimed as sent', noMe?.sent === false, JSON.stringify(noMe));

// --- history, not proof -----------------------------------------------------
const old = matchLead(
  { author: 'rankonserp', title: 'finland guest post', dmTitle: 'finland guest post',
    foundAt: '2026-09-15T00:00:00Z' }, convs, ME);
ok('an older chat is not treated as this pitch', old?.sent === false, JSON.stringify(old));
ok('nor as a possible duplicate', !old?.maybe, JSON.stringify(old));
ok('but is reported as prior contact', /spoken to them before/.test(old.why));

ok('a stranger matches nothing',
   matchLead({ author: 'nobody123', title: 'x', foundAt: '2026-09-15T00:00:00Z' }, convs, ME) === null);
ok('a lead with no author matches nothing',
   matchLead({ author: '', title: 'x', foundAt: 0 }, convs, ME) === null);

// The {rows, me} shape fetchConversations now returns is accepted directly.
ok('the fetched shape works without unpacking',
   matchLead({ author: 'Yeon G Mallah', dmTitle: 'Bulk GMB Listings', foundAt: '2026-09-15T09:00:00Z' },
             { rows: convs, me: ME }, ME)?.sent === true);

// --- subjects ---------------------------------------------------------------
ok('Re: is ignored when comparing subjects', normTitle('Re: Bulk GMB Listings!') === 'bulk gmb listings');
ok('case and punctuation are ignored', normTitle('BULK-GMB, listings') === 'bulk gmb listings');
ok('the same subject matches itself', titlesMatch('Bulk GMB Listings', 'Re: bulk gmb listings!'));
ok('and a real overlap matches', titlesMatch('Looking for Bulk GMB Listings', 'Bulk GMB Listings'));

// The old test was `a.includes(b) || b.includes(a)`, which made any short
// subject a match for anything containing it.
ok('one shared word is not a subject match', !titlesMatch('seo', 'Looking for SEO expert'), 'seo vs seo expert');
ok('nor is a single long word inside a longer title',
   !titlesMatch('crypto', 'need a crypto runner for continuous campaigns'));
ok('and unrelated subjects do not match',
   !titlesMatch('invoice for the march work', 'need a google ads guy for crypto'));
ok('an empty subject never matches', !titlesMatch('', 'anything') && !titlesMatch('anything', ''));

// One page only. The list is ordered by most recent activity, so a lead found
// today is on page one or it is not there at all - and a second page cost an
// extra request to the forum on every single check without ever changing an
// answer.
const asked = [];
globalThis.fetch = async (url) => {
  asked.push(String(url));
  return { ok: true, status: 200, text: async () => html };
};
const got = await (await import('../src/messages.js')).fetchConversations();
ok('the inbox is read with one request', asked.length === 1, JSON.stringify(asked));
ok('and it is page one', /\/direct-messages\/$/.test(asked[0]), asked[0]);
ok('no page-2 walk', !asked.some((u) => /page-/.test(u)), JSON.stringify(asked));
ok('the rows and your username come back together',
   got.rows.length === 4 && got.me === norm(ME), JSON.stringify({ n: got.rows.length, me: got.me }));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
