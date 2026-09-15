// Run every suite in its own process, because each one installs its own
// chrome/fetch stubs on globalThis and they would tread on each other.
//
//   node test/run.mjs          from chrome-extension/
//
// dash.test.mjs drives the real dashboard.html in jsdom and needs it
// installed (npm install). Without it that one suite is skipped and the rest
// still run, so the checks stay useful on a machine with no node_modules.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const dir = new URL('.', import.meta.url).pathname;
const suites = readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort();

let failed = 0, skipped = 0;
for (const f of suites) {
  const r = spawnSync(process.execPath, [dir + f], { encoding: 'utf8', timeout: 60000 });
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status === 0) { console.log(`PASS  ${f}`); continue; }
  if (/Cannot find package 'jsdom'/.test(out)) {
    console.log(`SKIP  ${f}  (run: npm install)`); skipped++; continue;
  }
  failed++;
  console.log(`FAIL  ${f}${r.signal ? `  (timed out - usually a render loop)` : ''}`);
  console.log(out.split('\n').filter((l) => /FAIL|Error|at /.test(l)).slice(0, 12).map((l) => '      ' + l).join('\n'));
}
console.log(`\n${suites.length - failed - skipped} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
process.exit(failed ? 1 : 0);
