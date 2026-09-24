// Threads that must never become a lead at all - a mod's "how to post here"
// thread being the exact complaint: a mod bumping it made it look like a
// fresh lead every time, over and over, however often it was skipped.
import { isExcludedThread } from '../src/matcher.js';
import { parseListing } from '../src/listing.js';

let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + '  ' + e); } };

const cfg = { excludeThreadIds: ['951769'], excludeAuthors: ['modaccount'] };

ok('an ordinary thread is not excluded',
   !isExcludedThread({ threadId: '123', author: 'buyer1' }, cfg));
ok('a thread id on the list is excluded, whatever it is about',
   isExcludedThread({ threadId: '951769', author: 'anyone', title: 'Need SEO help' }, cfg));
ok('the check is on the string, not the type', isExcludedThread({ threadId: 951769, author: 'x' }, cfg));
ok('an author on the list is excluded, whatever thread they post',
   isExcludedThread({ threadId: '999999', author: 'ModAccount' }, cfg));  // case-insensitive
ok('a thread the listing marked sticky is excluded',
   isExcludedThread({ threadId: '222', author: 'buyer2', sticky: true }, cfg));
ok('none of the gates fire on a normal thread by a normal author',
   !isExcludedThread({ threadId: '222', author: 'buyer2', sticky: false }, cfg));
ok('a missing item is never excluded', !isExcludedThread(null, cfg));
ok('an empty exclude list excludes nothing but sticky/known ids',
   !isExcludedThread({ threadId: '1', author: 'a' }, { excludeThreadIds: [], excludeAuthors: [] }));

// --- the listing itself marks a pinned thread -------------------------------
const LISTING = `<html>
  <div class="structItem structItem--thread structItem--sticky js-threadListItem-951769">
    <div class="structItem-title"><a href="/threads/rules-posting-in-hire-a-freelancer.951769/">Rules for posting in Hire a Freelancer</a></div>
    <a href="/members/staffmember.1/" data-author="staffmember" class="username">staffmember</a>
    <time class="structItem-startDate" data-timestamp="1000000"></time>
    <dd>0</dd>
  </div>
  <div class="structItem structItem--thread js-threadListItem-1900001">
    <div class="structItem-title"><a href="/threads/need-seo-help.1900001/">Need SEO help</a></div>
    <a href="/members/buyer1.1/" data-author="buyer1" class="username">buyer1</a>
    <time class="structItem-startDate" data-timestamp="1000001"></time>
    <dd>0</dd>
  </div>
</html>`;

const parsed = parseListing(LISTING);
ok('the pinned thread is flagged sticky', parsed['951769'].sticky === true, JSON.stringify(parsed['951769']));
ok('an ordinary thread right next to it is not', parsed['1900001'].sticky === false, JSON.stringify(parsed['1900001']));
ok('and isExcludedThread agrees, from the listing alone',
   isExcludedThread(parsed['951769'], { excludeThreadIds: [], excludeAuthors: [] }));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
