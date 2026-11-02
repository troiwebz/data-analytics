// Load the real dashboard.html + dashboard.js in a DOM and click things.
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DIR = new URL('../src/dashboard/', import.meta.url).pathname;
const html = readFileSync(DIR + 'dashboard.html', 'utf8');

const leads = [
  { threadId: '9001', title: 'Looking for Bulk GMB Listings', author: 'Yeon G Mallah', url: 'https://www.blackhatworld.com/threads/gmb.9001/',
    status: 'SENT', score: 6, replyCount: 23, postedAt: new Date(Date.now() - 4e7).toISOString(), foundAt: new Date().toISOString(),
    category: 'seo', categoryLabel: 'SEO / Links', matched: 'GMB, bulk', budget: '',
    draft: 'Hey @Yeon,\n\nBulk GMB is core work for us.\n\nPM sent.', dm: 'Hey Yeon,\n\nSaw your thread: x\n\ntips\n\noffer',
    aiSpecifics: ['Verification handled per listing, not bulk sprayed', 'Categories set before any posting', 'Service areas mapped to real coverage'],
    snippet: 'Need bulk GMB listings created and verified.' },
  { threadId: '9002', title: 'finland guest post', author: 'rankonserp', url: 'https://www.blackhatworld.com/threads/fi.9002/',
    status: 'POSTED', score: 4, replyCount: 20, postedAt: new Date(Date.now() - 5e7).toISOString(), foundAt: new Date().toISOString(),
    category: 'seo', categoryLabel: 'SEO / Links', matched: ['guest post'], budget: '$120', draft: 'x', dm: 'y' }
];

const dom = new JSDOM(html, { url: 'chrome-extension://test/src/dashboard/dashboard.html', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
global.window = window; global.document = window.document;
Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true, writable: true });
global.alert = () => {}; global.confirm = () => true;
global.chrome = {
  runtime: { getManifest: () => ({ version: '0.25.0' }), openOptionsPage: () => {},
    sendMessage: async (msg) => {
      // The dashboard asks the worker for Claude status on every render; the
      // worker answers out of the same storage. This is where the loop lived.
      if (msg?.cmd === 'ai-status') { const C = await import('../src/claude.js'); return C.aiStatus(); }
      if (msg?.cmd === 'next-check') return global.__nextCheck;
      if (msg?.cmd === 'fill-thread' || msg?.cmd === 'send-dm') {
        global.__sent.push(msg);
        return fillFails ? { ok: false, error: 'no reply box on that page' } : { ok: true, tabId: 7 };
      }
      global.__sent.push(msg);
      const lead = leads.find((x) => String(x.threadId) === String(msg?.threadId));
      if (lead) {
        if (msg.cmd === 'mark') lead.status = msg.status;
        if (msg.cmd === 'unmark') lead.status = 'SENT';
        if (msg.cmd === 'mark-pm') lead.pmSent = true;
        if (msg.cmd === 'unmark-pm') lead.pmSent = false;
      }
      return { ok: true };
    } },
  tabs: { create: () => {} },
  storage: (() => {
    const clone = (v) => (v === undefined ? undefined : structuredClone(v));
    const listeners = [];
    const bags = {
      local: { config: { enabled: true, pollMinutes: 3, maxPostsPerDay: 10, webhookUrl: 'https://x/exec', aiSpecifics: true },
               recentLeads: leads, log: [], rateState: { count: 0 }, staged: {} },
      sync: {}
    };
    const mk = (area) => ({
      get: async (k) => { const bag = bags[area];
        if (k == null) return clone(bag);
        const ks = Array.isArray(k) ? k : [k];
        return Object.fromEntries(ks.filter((x) => x in bag).map((x) => [x, clone(bag[x])])); },
      set: async (o) => { Object.assign(bags[area], o); global.__writes++;
        const ch = Object.fromEntries(Object.keys(o).map((k) => [k, { newValue: o[k] }]));
        listeners.forEach((f) => f(ch, area)); },
      remove: async (k) => { for (const x of (Array.isArray(k) ? k : [k])) delete bags[area][x];
        global.__writes++; listeners.forEach((f) => f({}, area)); }
    });
    return { local: mk('local'), sync: mk('sync'), __bags: bags,
             onChanged: { addListener: (f) => listeners.push(f) } };
  })()
};

global.__writes = 0;
global.__sent = [];
global.__nextCheck = { enabled: true, at: Date.now() + 125000, lastAt: Date.now() - 55000,
                       everyMinutes: 3, jitterSeconds: 40 };
let fillFails = false;
let consoleErr = null;
window.addEventListener('error', (e) => { consoleErr = e.error || e.message; });

const dash = await import(pathToFileURL(DIR + 'dashboard.js').href);
// The dashboard re-renders off storage changes, debounced by 150ms.
const render = async () => {
  await chrome.storage.local.set({ recentLeads: leads });
  await new Promise((r) => setTimeout(r, 300));
};
await new Promise((r) => setTimeout(r, 120));

let fails = 0;
const ok = (n, c, e='') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + ' ' + e); } };
const $ = (id) => window.document.getElementById(id);

ok('no error while loading the page', !consoleErr, String(consoleErr));
ok('rows rendered', $('rows').querySelectorAll('tr[data-row]').length === 2,
   String($('rows').querySelectorAll('tr[data-row]').length));

const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const wait = () => new Promise((r) => setTimeout(r, 60));

// The thing the user actually does: click the thread title.
const title = $('rows').querySelector('tr[data-row="9001"] .t');
ok('the title is not a link any more', title && title.tagName === 'SPAN', title && title.tagName);
click(title); await wait();
ok('clicking the title opens the draft', !!$('rows').querySelector('tr.detail'));
ok('the open row shows the reply', $('rows').querySelector('textarea[data-draft="9001"]')?.value.includes('Bulk GMB'));
ok('and the PM', $('rows').querySelector('textarea[data-dm="9001"]')?.value.includes('Saw your thread'));
ok('chevron turned down', $('rows').querySelector('tr[data-row="9001"] .ch').textContent === '▾');

click($('rows').querySelector('tr[data-row="9001"] .t')); await wait();
ok('clicking again closes it', !$('rows').querySelector('tr.detail'));

// Any other cell in the row works too.
click($('rows').querySelector('tr[data-row="9001"] td')); await wait();
ok('clicking the date cell also opens it', !!$('rows').querySelector('tr.detail'));

// The arrow still goes to BHW, and must not toggle the row.
const ext = $('rows').querySelector('tr[data-row="9001"] .ext');
ok('the BHW link is still there', ext && ext.getAttribute('href').includes('blackhatworld.com'));
click(ext); await wait();
ok('the BHW link does not close the row', !!$('rows').querySelector('tr.detail'));

// Typing in the textarea must not collapse the row.
const ta = $('rows').querySelector('textarea[data-draft="9001"]');
click(ta); await wait();
ok('clicking the textarea does not close the row', !!$('rows').querySelector('tr.detail'));

// Buttons inside the row run their action, not the row toggle.
const copy = $('rows').querySelector('button[data-act="copy"]');
let copied = '';
Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async (t) => { copied = t; } }, configurable: true });
click(copy); await wait();
ok('Copy copies the reply', copied.includes('Bulk GMB'), copied.slice(0, 40));
ok('Copy did not close the row', !!$('rows').querySelector('tr.detail'));

// A posted lead keeps its struck-through title.
// Which rows carry the strike-through classes. What those classes actually
// paint - line-through, green for a reply, blue for a PM - is proved in
// strike.test.mjs, because jsdom resolves the `text-decoration` shorthand by
// source order rather than specificity and would report "none" for a row
// Chrome strikes right through.
const struck = (id) => $('rows').querySelector(`tr[data-row="${id}"]`).className;
ok('posted rows are still marked', $('rows').querySelector('tr[data-row="9002"]').className.includes('posted'));
const flashOf = (id) => $('rows').querySelector(`#msg-${id}`)?.textContent.trim() || '';
const tagOf = (id) => $('rows').querySelector(`tr[data-row="${id}"] .done`)?.textContent.trim() || '';
ok('a posted reply says so next to the title', tagOf('9002') === '✓ reply posted', tagOf('9002'));
ok('a posted reply is struck through in green', /\bposted\b/.test(struck('9002')), struck('9002'));

leads[0].pmSent = true; leads[0].status = 'SENT';
await render();
ok('a PM sent is struck through too', /\bpmdone\b/.test(struck('9001')), struck('9001'));
ok('and by a different class, so the two get different colours', !/\bposted\b/.test(struck('9001')), struck('9001'));
ok('a PM sent says so next to the title', tagOf('9001') === '✓ PM sent', tagOf('9001'));

leads[0].status = 'POSTED';
await render();
ok('doing both says both', tagOf('9001') === '✓ replied + PM sent', tagOf('9001'));
leads[0].status = 'SENT';

leads[0].pmSent = false; leads[0].status = 'SENT';
await render();
ok('an untouched row is not struck', !/\b(posted|pmdone)\b/.test(struck('9001')), struck('9001'));
ok('and carries no label', tagOf('9001') === '', tagOf('9001'));

// Header buttons still wired.
ok('Settings button is live', typeof $('opts').onclick !== 'undefined' && !!$('opts'));
ok('Sheet buttons visible when a webhook is set', !$('sync').hidden && !$('approvals').hidden);

// Open a row only if it is shut, so one test's state cannot break the next.
const openLead = async (id) => {
  if (!$('rows').querySelector(`tr[data-row="${id}"] + tr.detail`)) {
    click($('rows').querySelector(`tr[data-row="${id}"] .t`)); await wait();
  }
};

// Copying is how the reply usually gets posted, so it marks the row done.
global.__sent = [];
await openLead('9001');
click($('rows').querySelector('button[data-act="copy"]')); await wait();
ok('Copy marks the thread posted',
   global.__sent.some((m) => m.cmd === 'mark' && m.threadId === '9001' && m.status === 'POSTED'),
   JSON.stringify(global.__sent));
ok('and says so', /marked as posted/i.test($('rows').querySelector('#msg-9001')?.textContent || ''),
   $('rows').querySelector('#msg-9001')?.textContent);

// Open filled fills a tab and leaves it open. It must NOT mark the row posted:
// that mark is what used to close the very tab it had just opened, and it also
// claimed a reply you had not sent yet. The service worker sets the row to
// FILLED, and it turns POSTED off the reply actually landing - staged.test.mjs
// owns that half.
leads[0].status = 'SENT'; leads[0].pmSent = false;
await render();
global.__sent = [];
await openLead('9001');
click($('rows').querySelector('button[data-act="fill"]')); await wait(); await wait();
ok('Open filled asks for the fill', global.__sent.some((m) => m.cmd === 'fill-thread' && m.lead?.threadId === '9001'),
   JSON.stringify(global.__sent.map((m) => m.cmd)));
ok('and does NOT mark the row posted, which is what closed the tab',
   !global.__sent.some((m) => m.cmd === 'mark'), JSON.stringify(global.__sent.map((m) => m.cmd)));
ok('and says the tab stays open and will go green by itself',
   /stays open/i.test(flashOf('9001')) && /green/i.test(flashOf('9001')), flashOf('9001'));

// The FILLED row reads as waiting on you, not as done.
leads[0].status = 'FILLED'; await render();
const filled = $('rows').querySelector('tr[data-row="9001"]');
ok('a filled row is flagged as waiting on you', /filled — waiting on you/.test(filled.textContent), filled.textContent.slice(0, 80));
ok('and is not struck through as done', !/\bposted\b/.test(filled.className) && /\bfilling\b/.test(filled.className), filled.className);
ok('and keeps its Post now and Skip buttons', !!$('rows').querySelector('button[data-act="post"]'));
leads[0].status = 'SENT'; await render();

// A fill that fails must NOT mark anything.
leads[0].status = 'SENT'; await render();
fillFails = true; global.__sent = [];
await openLead('9001');
click($('rows').querySelector('button[data-act="fill"]')); await wait(); await wait();
ok('a fill that fails marks nothing', !global.__sent.some((m) => m.cmd === 'mark'),
   JSON.stringify(global.__sent.map((m) => m.cmd)));
ok('and says why', /could not fill/i.test(flashOf('9001')), flashOf('9001'));
fillFails = false;

// Open filled on the PM marks the PM, not the thread.
leads[0].status = 'SENT'; leads[0].pmSent = false; await render();
global.__sent = [];
await openLead('9001');
click($('rows').querySelector('button[data-act="opendm"]')); await wait(); await wait();
ok('Open filled on the PM marks it sent', global.__sent.some((m) => m.cmd === 'mark-pm'));
ok('and does not mark the thread posted', !global.__sent.some((m) => m.cmd === 'mark'));

// "I posted it" and "I sent it" confirm rather than silently re-rendering.
leads[0].status = 'SENT'; leads[0].pmSent = false; await render();
await openLead('9001');
click($('rows').querySelector('button[data-act="done"]')); await wait(); await wait();
ok('"I posted it" confirms', /marked as posted/i.test(flashOf('9001')), flashOf('9001'));

leads[0].status = 'SENT'; leads[0].pmSent = false; await render();
await openLead('9001');
click($('rows').querySelector('button[data-act="pmsent"]')); await wait(); await wait();
ok('"I sent it" confirms', /marked as sent/i.test(flashOf('9001')), flashOf('9001'));

// A stray copy must be reversible.
leads[0].status = 'SENT'; leads[0].pmSent = false; await render();
await openLead('9001');
click($('rows').querySelector('button[data-act="copy"]')); await wait();
await openLead('9001');
const undo = $('rows').querySelector('button[data-act="undo"]');
ok('a posted row offers Undo', !!undo);
global.__sent = [];
click(undo); await wait();
ok('Undo puts it back on the to-do list', global.__sent.some((m) => m.cmd === 'unmark' && m.threadId === '9001'));

// The PM copy marks the PM, not the thread.
global.__sent = [];
await openLead('9001');
click($('rows').querySelector('button[data-act="copydm"]')); await wait();
ok('Copy PM marks the PM sent', global.__sent.some((m) => m.cmd === 'mark-pm' && m.threadId === '9001'));
ok('and does not mark the thread posted', !global.__sent.some((m) => m.cmd === 'mark'));

// The state the user actually upgraded from: a v0.22 key in profile storage.
// Reading it used to rewrite storage, which fired onChanged, which re-rendered,
// which read it again. The page looked alive but ignored every click.
chrome.storage.__bags.sync.aiSettings = { key: 'sk-ant-api03-FROMVERSION022X', model: 'claude-sonnet-5', budget: 0.5, enabled: true };
global.__writes = 0;
global.__sent = [];
global.__nextCheck = { enabled: true, at: Date.now() + 125000, lastAt: Date.now() - 55000,
                       everyMinutes: 3, jitterSeconds: 40 };
click($('rows').querySelector('tr[data-row="9002"] .t')); await new Promise((r) => setTimeout(r, 700));
ok('no runaway writes after a click', global.__writes < 12, `${global.__writes} writes in 700ms`);
ok('the page still responds to a click', !!$('rows').querySelector('tr.detail'));
const settled = global.__writes;
await new Promise((r) => setTimeout(r, 500));
ok('and settles instead of spinning', global.__writes === settled, `${global.__writes - settled} more writes while idle`);

// The countdown to the next check, read off the alarm rather than guessed.
const cdEl = $('countdown');
await new Promise((r) => setTimeout(r, 1100));
ok('the countdown is showing', !cdEl.hidden, cdEl.outerHTML.slice(0, 80));
ok('it counts down in minutes and seconds', /Next check in/.test(cdEl.textContent) && /\d:\d\d/.test(cdEl.textContent), cdEl.textContent);
ok('it says how often and when it last ran', /Every 3 min/.test(cdEl.title) && /Last check/.test(cdEl.title), cdEl.title);
ok('it does not warn while there is time', !cdEl.className.includes('soon'), cdEl.className);

// The page caches the schedule; focus makes it re-read, as it does in Chrome.
const resync = async () => { window.dispatchEvent(new window.Event('focus')); await new Promise((r) => setTimeout(r, 1100)); };
global.__nextCheck = { ...global.__nextCheck, at: Date.now() + 9000 };
await resync();
ok('it warns when the check is close', cdEl.className.includes('soon'), cdEl.className);

global.__nextCheck = { ...global.__nextCheck, at: Date.now() - 2000 };
await resync();
ok('past zero it says it is running, not a negative number',
   /Checking the forum now/.test(cdEl.textContent) && !/-/.test(cdEl.textContent), cdEl.textContent);

global.__nextCheck = { enabled: false, at: 0, lastAt: 0, everyMinutes: 3, jitterSeconds: 0 };
await resync();
ok('switched off, it says so instead of counting', /Not watching/.test(cdEl.textContent), cdEl.textContent);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
