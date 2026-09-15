// The chart tooltip, driven by a real cursor in a real browser.
//
// jsdom cannot do this: it has no layout, so it cannot tell you which element
// the pointer would actually land on. The tooltip blinking in and out was
// exactly a hit-testing bug - the bar was painted over its own hover target -
// and every jsdom assertion passed straight through it.
//
// Skipped when playwright-core is not installed, like the jsdom suites.
import { mkdirSync, rmSync, cpSync, readFileSync, writeFileSync } from 'node:fs';

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('  SKIP  playwright-core not installed'); process.exit(0); }

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SRC = new URL('../src/', import.meta.url).pathname;
const T = '/tmp/haf-hover-test';

// A page that actually runs: the extension's own files, plus a chrome stub
// defined before the module loads.
rmSync(T, { recursive: true, force: true });
mkdirSync(T + '/src/insights', { recursive: true });
for (const f of ['timefmt.js', 'store.js', 'config.js']) cpSync(SRC + f, `${T}/src/${f}`);
cpSync(SRC + 'insights/insights.js', T + '/src/insights/insights.js');

const stub = `<script>
(function () {
  const leads = []; let id = 0;
  for (let back = 9; back >= 0; back--) {
    const d = new Date(Date.now() - back * 86400000);
    for (let i = 0; i < 8 + (back % 5); i++) {
      leads.push({ threadId: String(++id), title: 't' + id, postedAtSource: 'listing', replyCount: 5,
        postedAt: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), (9 + i % 10) - 5, -30)).toISOString(),
        foundAt: new Date().toISOString() });
    }
  }
  window.chrome = {
    runtime: { getURL: (p) => p, sendMessage: async () => ({}) },
    storage: { local: { get: async (k) => (k === 'recentLeads' ? { recentLeads: leads }
                        : k === 'config' ? { config: { timezone: 'Asia/Kolkata' } } : {}), set: async () => {} },
               onChanged: { addListener: () => {} } }
  };
})();
</script>`;
writeFileSync(T + '/src/insights/index.html',
  readFileSync(SRC + 'insights/insights.html', 'utf8')
    .replace('<script type="module" src="insights.js"></script>', stub + '<script type="module" src="insights.js"></script>'));

let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + ' ' + e); } };

// file:// module imports need this flag, or nothing runs and every check
// "passes" against a blank page.
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
let pageError = null;
page.on('pageerror', (e) => { pageError = e.message; });
await page.goto(`file://${T}/src/insights/index.html`);
await page.waitForFunction(() => document.querySelectorAll('#daily rect.hit').length > 0, null, { timeout: 15000 });
ok('the page ran without error', !pageError, String(pageError));

const tip = page.locator('#tip');
const hits = page.locator('#daily rect.hit');
const n = await hits.count();
ok('every bar has a hit target', n >= 8, String(n));

const boxes = [];
for (let i = 0; i < n; i++) boxes.push(await hits.nth(i).boundingBox());

// Settle past the tooltip's fade, or the first reading measures the fade.
await page.mouse.move(boxes[0].x + boxes[0].width / 2, boxes[0].y + boxes[0].height * 0.7);
await page.waitForTimeout(220);

// Walk each bar at five points, including the middle where the bar body is.
// That is where it used to vanish: the bar took the pointer off its target.
const blanks = [], seen = new Set();
for (let i = 0; i < n; i++) {
  for (const frac of [0.1, 0.35, 0.5, 0.75, 0.95]) {
    await page.mouse.move(boxes[i].x + boxes[i].width * frac, boxes[i].y + boxes[i].height * 0.7);
    await page.waitForTimeout(40);
    const o = Number(await tip.evaluate((el) => getComputedStyle(el).opacity));
    if (o < 0.5) blanks.push(`bar ${i} at ${frac}`);
    else seen.add((await tip.textContent()).trim().split('\n')[0]);
  }
}
ok('the tooltip never blinks out while over a bar', blanks.length === 0, blanks.join(', '));
ok('each bar shows its own count', seen.size === n, `${seen.size} distinct of ${n}`);
ok('the tooltip says how many threads', [...seen].every((t) => /\d+ thread/.test(t)), [...seen][0]);

await page.mouse.move(boxes[3].x + boxes[3].width / 2, boxes[3].y + boxes[3].height * 0.7);
await page.waitForTimeout(80);
ok('exactly one bar is highlighted', await page.locator('#daily rect.bar.on').count() === 1);
ok('and it is the one under the cursor',
   await page.locator('#daily rect.bar').nth(3).evaluate((el) => el.classList.contains('on')));

await page.mouse.move(boxes[0].x, boxes[0].y - 140);
await page.waitForTimeout(160);
ok('leaving the chart clears the highlight', await page.locator('#daily rect.bar.on').count() === 0);
ok('and hides the tooltip', Number(await tip.evaluate((el) => getComputedStyle(el).opacity)) < 0.5);

await browser.close();
rmSync(T, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
