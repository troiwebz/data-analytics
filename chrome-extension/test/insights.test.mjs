// The insights page: the maths behind the bars, and that it draws them.
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DIR = new URL('../src/insights/', import.meta.url).pathname;
const dom = new JSDOM(readFileSync(DIR + 'insights.html', 'utf8'),
  { url: 'chrome-extension://x/src/insights/insights.html', pretendToBeVisual: true });
global.window = dom.window; global.document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

// The page groups in IST, so the fixture has to be built in IST or the counts
// drift by a day whenever the machine is not in India. IST is UTC+5:30 all
// year, so the hour maps straight across.
const IST = { timezone: 'Asia/Kolkata' };
const { partsIn } = await import('../src/timefmt.js');
const at = (daysBack, istHour) => {
  const [y, m, d] = partsIn(new Date(Date.now() - daysBack * 86400000), IST).key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, istHour - 5, -30)).toISOString();
};
// Only a start time read off the listing counts. The feed's date is a thread's
// LAST REPLY, so a year-old thread bumped this minute must not be counted as
// launched today - that is what made a quiet forum look like 27 a day.
const listed = (iso) => ({ postedAt: iso, postedAtSource: 'listing' });
const leads = [
  // today: 3 threads
  { threadId: '1', ...listed(at(0, 9)), title: 'a' }, { threadId: '2', ...listed(at(0, 14)), title: 'b' },
  { threadId: '3', ...listed(at(0, 14)), title: 'c' },
  // yesterday: 2
  { threadId: '4', ...listed(at(1, 14)), title: 'd' }, { threadId: '5', ...listed(at(1, 20)), title: 'e' },
  // three days back: 1, leaving a gap the day between
  { threadId: '6', ...listed(at(3, 9)), title: 'f' },
  // a listed thread whose date cannot be read
  { threadId: '7', postedAt: 'not a date', postedAtSource: 'listing', title: 'g' },
  // an old thread bumped a minute ago: the feed says "now", the truth is old
  { threadId: '8', postedAt: new Date().toISOString(), postedAtSource: 'feed', title: 'bumped' },
  // and one the backfill could not date at all
  { threadId: '9', postedAt: null, postedAtSource: 'unknown', title: 'undated' }
];

// Two readings each at 10am and 10pm IST, a day apart - enough to average.
const trafficSamples = [
  { ts: new Date(at(0, 10)).getTime(), members: 400 },
  { ts: new Date(at(1, 10)).getTime(), members: 420 },
  { ts: new Date(at(0, 22)).getTime(), members: 50 },
  { ts: new Date(at(1, 22)).getTime(), members: 60 }
];

global.chrome = {
  runtime: { getURL: (p) => 'x/' + p, sendMessage: async () => ({}) },
  storage: { local: { get: async (k) => (k === 'recentLeads' ? { recentLeads: leads }
                                       : k === 'config' ? { config: { timezone: 'Asia/Kolkata' } }
                                       : k === 'trafficSamples' ? { trafficSamples } : {}),
                      set: async () => {} },
             onChanged: { addListener: () => {} } }
};
// A page error must fail the run, not vanish into a silent empty render.
dom.window.addEventListener('error', (e) => { console.log('PAGE ERROR:', e.error?.stack || e.message); process.exitCode = 1; });
await import(pathToFileURL(DIR + 'insights.js').href);
await new Promise((r) => setTimeout(r, 150));

let fails = 0;
const ok = (n, c, e='') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + ' ' + e); } };
const $ = (id) => dom.window.document.getElementById(id);
const tile = (label) => [...dom.window.document.querySelectorAll('.k')]
  .find((k) => k.querySelector('span').textContent.startsWith(label))?.querySelector('b').textContent;

ok('threads launched today are counted', tile('launched today') === '3', tile('launched today'));
ok('a thread with an unreadable date is ignored', tile('threads recorded') === '6', tile('threads recorded'));
ok('a bumped old thread is NOT counted as launched today', tile('launched today') === '3', tile('launched today'));
ok('and the exclusions are reported', /3 excluded/.test($('range').textContent), $('range').textContent);

// Four calendar days span today..3 days back, including the empty one.
const dailyRows = [...$('daily').querySelectorAll('table tbody tr')];
ok('every day in the range gets a bar, gaps included', dailyRows.length === 4, String(dailyRows.length));
ok('the empty day is drawn as zero', dailyRows.some((r) => r.querySelector('td.n').textContent === '0'));
ok('today is last', dailyRows.at(-1).querySelector('td.n').textContent === '3');

// Today must not drag the average down; it is incomplete.
// Complete days are yesterday 2, gap 0, three-back 1 -> 1.0
// Three complete days is the floor for calling anything an average; this
// fixture has three (yesterday, the gap, and three days back).
ok('today is left out of the average', tile('average a day') === '1.0', tile('average a day'));
ok('and is hatched rather than recoloured',
   /url\(#part-daily\)/.test($('daily').querySelector('.bar[style]')?.getAttribute('style') || ''),
   $('daily').querySelector('.bar[style]')?.getAttribute('style'));
ok('only today is hatched', $('daily').querySelectorAll('.bar[style]').length === 1);

// Hours read as am/pm, never as 20 or 21.
const hourLabels = [...$('hourly').querySelectorAll('svg text.tick')].map((t) => t.textContent);
ok('the hour axis is am/pm', hourLabels.filter((l) => /(am|pm)/.test(l)).length >= 6, hourLabels.join(','));
ok('no 24 hour numbers on the hour axis', !hourLabels.some((l) => /^(1[3-9]|2[0-3])$/.test(l)), hourLabels.join(','));

// Hours are in the configured zone and every hour of the day is present.
const hourRows = [...$('hourly').querySelectorAll('table tbody tr')];
ok('all 24 hours are drawn', hourRows.length === 24);
ok('2 pm holds the three threads posted then', hourRows[14].querySelector('td.n').textContent === '3', hourRows[14].textContent);
ok('an hour with nothing is still drawn', hourRows[0].querySelector('td.n').textContent === '0');

// Weekdays are averaged over how many of each we have, not summed.
ok('all seven weekdays are drawn', $('weekly').querySelectorAll('table tbody tr').length === 7);

// The BHW traffic chart - fed by src/traffic.js's readings, not thread activity.
const trafficRows = [...$('traffic').querySelectorAll('table tbody tr')];
ok('all 24 hours are drawn for traffic too', trafficRows.length === 24, String(trafficRows.length));
ok('10am shows the averaged members-online reading', trafficRows[10].querySelector('td.n').textContent === '410',
   trafficRows[10].textContent);
ok('10pm shows its own, much lower average', trafficRows[22].querySelector('td.n').textContent === '55',
   trafficRows[22].textContent);
ok('an hour with no reading is zero, not a crash', trafficRows[3].querySelector('td.n').textContent === '0');
ok('the sub-line reports how many readings this is built from, and that it is still learning',
   /4\/20 readings/.test($('trafficSub').textContent), $('trafficSub').textContent);

// Every bar has a hover target, and a table exists for every chart.
for (const id of ['daily', 'hourly', 'weekly', 'traffic']) {
  const bars = $(id).querySelectorAll('rect.bar').length;
  ok(`${id}: every bar is hoverable`, $(id).querySelectorAll('rect.hit').length === bars, `${bars} bars`);
  ok(`${id}: the numbers are readable as a table`, $(id).querySelectorAll('table tbody tr').length === bars);
}
ok('exactly one value is labelled directly, not every bar',
   $('daily').querySelectorAll('text.val').length === 1);

// No data at all must not throw or draw a misleading empty chart.
const none = [...dom.window.document.querySelectorAll('.empty')].length;
ok('the page rendered charts rather than the empty state', none === 0, String(none));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
