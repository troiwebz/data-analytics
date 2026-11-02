// The struck-through title, judged by a real browser.
//
// jsdom has no specificity-correct cascade for the `text-decoration`
// shorthand: `.t{text-decoration:none}` later in the sheet wins over
// `tr.posted .t{text-decoration:line-through}`, so it reports "none" for a
// row Chrome strikes through. It also hands colours back unnormalised.
// Both are jsdom gaps, not the dashboard's, so the visual claim is proved
// here against the dashboard's own stylesheet and Chrome's own cascade.
// dash.test.mjs still owns the behaviour: which rows get which class.
//
// Skipped when playwright-core is not installed, like the other real-browser
// suites.
import { readFileSync } from 'node:fs';

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('  SKIP  playwright-core not installed'); process.exit(0); }

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const HTML = new URL('../src/dashboard/dashboard.html', import.meta.url).pathname;

let failed = 0;
const ok = (what, pass, saw) => {
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${what}${pass ? '' : `  ${saw}`}`);
  if (!pass) failed++;
};

// The dashboard's real stylesheet, not a copy that can drift from it.
const css = readFileSync(HTML, 'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setContent(`<style>${css}</style><table><tbody>
  <tr class="r posted" data-row="9002"><td><span class="t">reply posted</span></td></tr>
  <tr class="r pmdone" data-row="9001"><td><span class="t">PM sent</span></td></tr>
  <tr class="r posted pmdone" data-row="9003"><td><span class="t">both</span></td></tr>
  <tr class="r" data-row="9000"><td><span class="t">untouched</span></td></tr>
</tbody></table>`);

const paint = (id) => page.$eval(`tr[data-row="${id}"] .t`, (el) => {
  const c = getComputedStyle(el);
  return { line: c.textDecorationLine, colour: c.textDecorationColor, thick: c.textDecorationThickness };
});

const posted = await paint('9002');
ok('a posted reply is struck through', posted.line === 'line-through', JSON.stringify(posted));
ok('and in green', posted.colour === 'rgb(22, 163, 74)', posted.colour);
ok('thick enough to read at a glance', posted.thick === '2px', posted.thick);

const pm = await paint('9001');
ok('a PM sent is struck through too', pm.line === 'line-through', JSON.stringify(pm));
ok('and in blue, so the two are distinguishable', pm.colour === 'rgb(37, 99, 235)', pm.colour);

const both = await paint('9003');
ok('doing both is still struck through', both.line === 'line-through', JSON.stringify(both));

const plain = await paint('9000');
ok('an untouched row is not struck', plain.line === 'none', plain.line);

// "I don't find the Regenerate option" - it existed, called something else and
// buried in the More menu. The button that fixes a wrong draft has to be in
// plain sight, so this checks it is actually on screen and hittable, not just
// present in the markup.
{
  const p2 = await browser.newPage();
  await p2.setContent(readFileSync(HTML, 'utf8').replace(/<script[\s\S]*?<\/script>/g, ''));
  const btn = await p2.$('#regen');
  ok('the rewrite button exists', !!btn);
  const seen = btn && await btn.isVisible();
  ok('and is visible without opening a menu', !!seen, String(seen));
  const label = btn && (await btn.textContent()).trim();
  ok('and says what it does', /rewrite/i.test(label || ''), label);
  const inMenu = await p2.evaluate(() => !!document.querySelector('#regen')?.closest('details'));
  ok('and is not hidden inside the More menu', !inMenu);
  // Hit-testing: something overlapping it would make it unclickable.
  const hit = btn && await p2.evaluate(() => {
    const b = document.querySelector('#regen').getBoundingClientRect();
    const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return el && (el.id === 'regen' || el.closest('#regen') != null);
  });
  ok('and nothing is painted over it', !!hit, String(hit));
  await p2.close();
}

await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall good');
process.exit(failed ? 1 : 0);
