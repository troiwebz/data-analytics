// "Yesterday's HAF threads are never messaged" (1.11.3).
//
// Signed in, BHW links a thread as …/slug.1850834/unread, which jumps to the
// first unread post - page 3 of a busy thread. The reader took the first post
// on that page as the buyer's post; it was a seller's reply, so Claude screened
// "GMB services Require for US Uk" and "Hiring Freelancer for High Authority
// Guest Posts" out as sellers advertising, and the PM never went.
const bag = {};
globalThis.chrome = { storage: { local: {
  get: async (k) => { const o = {}; for (const x of [].concat(k)) if (x in bag) o[x] = JSON.parse(JSON.stringify(bag[x])); return o; },
  set: async (o) => Object.assign(bag, JSON.parse(JSON.stringify(o))), remove: async () => {} } } };

const { canonicalThreadUrl, isJumpUrl, threadIdFromUrl } = await import('../src/feed.js');
const { opIsFirst } = await import('../src/browse.js');
const { repairJumpLinks, recordLeads, getLeads } = await import('../src/store.js');
const { renderDm } = await import('../src/templates.js');
const { DEFAULT_CONFIG } = await import('../src/config.js');

let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + '  ' + JSON.stringify(e)); } };
const B = 'https://www.blackhatworld.com/seo/gmb-services-require-for-us-uk.1850834';

for (const tail of ['/unread', '/latest', '/page-3', '/post-19283746', '/#post-19283746', '/?foo=1', '/', '']) {
  ok(`${tail || '(bare)'} -> page 1`, canonicalThreadUrl(B + tail) === `${B}/`, canonicalThreadUrl(B + tail));
}
ok('the thread id is unchanged', threadIdFromUrl(canonicalThreadUrl(B + '/unread')) === '1850834');
ok('jump links are recognised', isJumpUrl(B + '/unread') && isJumpUrl(B + '/page-2') && !isJumpUrl(B + '/'));
ok('a non-thread address is left alone', canonicalThreadUrl('https://www.blackhatworld.com/forums/hire-a-freelancer.76/') === 'https://www.blackhatworld.com/forums/hire-a-freelancer.76/');

ok('page 1, first post by the starter: the buyer\'s post', opIsFirst({ page: 1, starter: 'abbask', firstAuthor: 'abbask' }));
ok('page 3: never the buyer\'s post', !opIsFirst({ page: 3, starter: 'abbask', firstAuthor: 'seller9' }));
ok('page 1 but someone else first: not the buyer\'s post', !opIsFirst({ page: 1, starter: 'abbask', firstAuthor: 'seller9' }));
ok('page 1, starter unknown: trusted', opIsFirst({ page: 1, starter: '', firstAuthor: 'abbask' }));

// The stored leads, as they were on the MacBook.
bag.recentLeads = [
  { threadId: '1850834', url: B + '/unread', title: 'GMB services Require for US Uk', author: 'abbask', status: 'BACKFILL',
    body: 'I can handle US and UK Google Business Profile management…', replies: [{ text: 'x' }],
    aiSpecifics: { pm: 'no', why: 'seller advertising own GMB service', tips: ['a'] }, autoSendBlocked: 'Claude screened it out: seller advertising own GMB service', autoRules: 4 },
  { threadId: '1851266', url: 'https://www.blackhatworld.com/seo/claude-max-subscription.1851266/unread', status: 'SENT', pmSent: true, body: 'real', aiSpecifics: { pm: 'yes' } },
  { threadId: '1851999', url: 'https://www.blackhatworld.com/seo/x.1851999/', body: 'fine', aiSpecifics: { pm: 'yes' } },
  { threadId: '1852000', kind: 'thread', url: 'https://www.blackhatworld.com/seo/y.1852000/unread', body: 'other forum' }
];
const r = await repairJumpLinks();
const after = Object.fromEntries((await getLeads()).map((l) => [l.threadId, l]));
ok('every jump link is fixed', r.fixed === 3 && Object.values(after).every((l) => !isJumpUrl(l.url)), r);
ok('the misread HAF thread will be read again: post, verdict and refusal dropped',
  after['1850834'].body === '' && !after['1850834'].aiSpecifics && !after['1850834'].autoSendBlocked && r.reread === 1, after['1850834']);
ok('a thread already messaged keeps everything', after['1851266'].body === 'real' && after['1851266'].pmSent === true);
ok('a clean link is untouched', after['1851999'].body === 'fine');
ok('other forums keep their post (public replies only, never automated)', after['1852000'].body === 'other forum');
ok('and the repair runs once only', (await repairJumpLinks()).fixed === 0);

await recordLeads([{ threadId: '1853000', url: 'https://www.blackhatworld.com/seo/z.1853000/unread', title: 't' }]);
ok('new threads are stored with the page-1 link', (await getLeads()).find((l) => l.threadId === '1853000').url === 'https://www.blackhatworld.com/seo/z.1853000/');

const dm = renderDm({ threadId: '9', author: 'a', url: B + '/unread', category: 'seo', aiSpecifics: { tips: ['We do it.', 'We do more.', 'We check it.'], offer: 'pilot' } }, DEFAULT_CONFIG);
ok('the PM links the thread itself, not /unread', dm.includes(`${B}/`) && !dm.includes('/unread'), dm.slice(0, 160));

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
