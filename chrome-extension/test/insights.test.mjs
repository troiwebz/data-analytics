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
const leads = [
  // today: 3 threads
  { threadId: '1', postedAt: at(0, 9), title: 'a' }, { threadId: '2', postedAt: at(0, 14), title: 'b' },
  { threadId: '3', postedAt: at(0, 14), title: 'c' },
  // yesterday: 2
  { threadId: '4', postedAt: at(1, 14), title: 'd' }, { threadId: '5', postedAt: at(1, 22), title: 'e' },
  // three days back: 1, leaving a gap the day between
  { threadId: '6', postedAt: at(3, 9), title: 'f' },
  // and one with no usable date at all
  { threadId: '7', postedAt: 'not a date', title: 'g' }
];

global.chrome = {
  runtime: { getURL: (p) => 'x/' + p, sendMessage: async () => ({}) },
  storage: { local: { get: async (k) => (k === 'recentLeads' ? { recentLeads: leads }
                                       : k === 'config' ? { config: { timezone: 'Asia/Kolkata' } } : {}),
                      set: async () => {} },
             onChanged: { addListener: () => {} } }
};
await import(pathToFileURL(DIR + 'insights.js').href);
await new Promise((r) => setTimeout(r, 150));

let fails = 0;
const ok = (n, c, e='') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + ' ' + e); } };
const $ = (id) => dom.window.document.getElementById(id);
const tile = (label) => [...dom.window.document.querySelectorAll('.k')]
  .find((k) => k.querySelector('span').textContent.startsWith(label))?.querySelector('b').textContent;

ok('threads launched today are counted', tile('launched today') === '3', tile('launched today'));
ok('a thread with an unreadable date is ignored', tile('threads recorded') === '6', tile('threads recorded'));

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

// Every bar has a hover target, and a table exists for every chart.
for (const id of ['daily', 'hourly', 'weekly']) {
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
