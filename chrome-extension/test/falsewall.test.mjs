// 1.27.3: a thread title with "has been blocked" / "access denied" on a normal BHW page is not a wall.
import { extractRadarListing } from '../src/radar.js';
let fails = 0; const ok = (n, c) => { console.log(`${c ? '  ok ' : '  FAIL'} ${n}`); if (!c) fails++; };
const fakeDoc = ({ title, text, bhw, err = '' }) => ({
  title, body: { innerText: text },
  querySelector: (s) => (/p-pageWrapper/.test(s) && bhw ? {} : /blockMessage--error/.test(s) && err ? { innerText: err } : null),
  querySelectorAll: () => [], documentElement: { getAttribute: () => 'true' }
});
globalThis.location = { href: 'https://x' };
const run = (d) => { globalThis.document = fakeDoc(d); return extractRadarListing(); };
ok('normal BHW page, title "My account has been blocked" in the list: not a wall',
  !run({ title: 'Access denied on Search Console | BlackHatWorld', text: 'My Facebook account has been blocked - help\nAccess denied', bhw: true }).blocked);
ok('Cloudflare page (no BHW layout): a wall', !!run({ title: 'Just a moment...', text: 'Verify you are human', bhw: false }).blocked);
ok('BHW rate-limit error box: a wall', !!run({ title: 'Error | BlackHatWorld', text: 'x', bhw: true, err: 'You have been rate limited.' }).blocked);
console.log(fails ? `${fails} FAILED` : 'all passed');
