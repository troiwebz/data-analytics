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
      return {};
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
let consoleErr = null;
window.addEventListener('error', (e) => { consoleErr = e.error || e.message; });

await import(pathToFileURL(DIR + 'dashboard.js').href);
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
ok('posted rows are still marked', $('rows').querySelector('tr[data-row="9002"]').className.includes('posted'));

// Header buttons still wired.
ok('Settings button is live', typeof $('opts').onclick !== 'undefined' && !!$('opts'));
ok('Sheet buttons visible when a webhook is set', !$('sync').hidden && !$('approvals').hidden);

// The state the user actually upgraded from: a v0.22 key in profile storage.
// Reading it used to rewrite storage, which fired onChanged, which re-rendered,
// which read it again. The page looked alive but ignored every click.
chrome.storage.__bags.sync.aiSettings = { key: 'sk-ant-api03-FROMVERSION022X', model: 'claude-sonnet-5', budget: 0.5, enabled: true };
global.__writes = 0;
click($('rows').querySelector('tr[data-row="9002"] .t')); await new Promise((r) => setTimeout(r, 700));
ok('no runaway writes after a click', global.__writes < 12, `${global.__writes} writes in 700ms`);
ok('the page still responds to a click', !!$('rows').querySelector('tr.detail'));
const settled = global.__writes;
await new Promise((r) => setTimeout(r, 500));
ok('and settles instead of spinning', global.__writes === settled, `${global.__writes - settled} more writes while idle`);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
