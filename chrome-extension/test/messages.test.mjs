// Reading your BHW message list to tick off what was already sent.
import { parseConversations, matchLead, norm, normTitle } from '../src/messages.js';

let fails = 0;
const ok = (n, c, e='') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + ' ' + e); } };

const ts = (d) => Math.floor(new Date(d).getTime() / 1000);
const row = (id, title, people, when) => `
  <div class="structItem structItem--conversation" data-author="${people[0]}">
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

const html = '<html><div class="structItemContainer">' + [
  row(101, 'Re: Bulk GMB Listings', ['Yeon G Mallah', 'bargainbed'], '2026-09-15T10:00:00Z'),
  row(102, 'Some old chat about hosting', ['rankonserp', 'bargainbed'], '2025-02-01T09:00:00Z'),
  row(103, 'looking for gmail creator tool', ['AFFMUS', 'bargainbed'], '2026-09-15T17:30:00Z')
].join('') + '</div></html>';

const convs = parseConversations(html);
ok('every conversation is found', convs.length === 3, String(convs.length));
ok('the title is read', convs[0].title === 'Re: Bulk GMB Listings', convs[0].title);
ok('the id is read', convs[0].id === '101');
ok('the link is absolute', convs[0].url.startsWith('https://www.blackhatworld.com/direct-messages/'), convs[0].url);
ok('participants are found', convs[0].people.includes(norm('Yeon G Mallah')), JSON.stringify(convs[0].people));
ok('a display name with spaces matches its slug', norm('Yeon G Mallah') === 'yeongmallah');
ok('the date is read', convs[0].at.startsWith('2026-09-15'), convs[0].at);
ok('nothing is invented from an empty page', parseConversations('<html></html>').length === 0);

// A subject that matches the thread is proof the PM went.
const byTitle = matchLead(
  { author: 'Yeon G Mallah', title: 'Looking for Bulk GMB Listings', dmTitle: 'Bulk GMB Listings',
    foundAt: '2026-09-15T09:00:00Z' }, convs);
ok('a matching subject counts as sent', byTitle?.sent === true, JSON.stringify(byTitle));
ok('and says why', /subject/.test(byTitle.why));
ok('and carries the date', byTitle.at.startsWith('2026-09-15'));

// Same person, conversation started after we found the thread: also sent.
const byDate = matchLead(
  { author: 'AFFMUS', title: 'Totally different wording here', dmTitle: 'Totally different wording here',
    foundAt: '2026-09-15T16:00:00Z' }, convs);
ok('a conversation after the thread counts as sent', byDate?.sent === true, JSON.stringify(byDate));
ok('and says why', /after the thread/.test(byDate.why));

// Same person, but the conversation predates the thread: NOT proof, just history.
const old = matchLead(
  { author: 'rankonserp', title: 'finland guest post', dmTitle: 'finland guest post',
    foundAt: '2026-09-15T00:00:00Z' }, convs);
ok('an older chat is not treated as this pitch', old?.sent === false, JSON.stringify(old));
ok('but is reported as prior contact', /spoken to them before/.test(old.why));

// Someone never messaged is left alone.
ok('a stranger matches nothing',
   matchLead({ author: 'nobody123', title: 'x', foundAt: '2026-09-15T00:00:00Z' }, convs) === null);
ok('a lead with no author matches nothing',
   matchLead({ author: '', title: 'x', foundAt: 0 }, convs) === null);

// Titles compare on words, so "Re:" and punctuation do not matter.
ok('Re: is ignored when comparing subjects', normTitle('Re: Bulk GMB Listings!') === 'bulk gmb listings');
ok('case and punctuation are ignored', normTitle('BULK-GMB, listings') === 'bulk gmb listings');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
