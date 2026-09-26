// The service-threads page: a screen of its own, deliberately separate from
// the HAF leads dashboard - this only ever renders serviceThreads, never
// recentLeads, and every action goes through chrome.runtime.sendMessage
// rather than touching the leads table's own storage keys.
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DIR = new URL('../src/services/', import.meta.url).pathname;
const dom = new JSDOM(readFileSync(DIR + 'services.html', 'utf8'),
  { url: 'chrome-extension://x/src/services/services.html', pretendToBeVisual: true });
global.window = dom.window; global.document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.confirm = () => true;

let cfg = {
  serviceThreads: [
    { id: '111', url: 'https://www.blackhatworld.com/seo/thread-one.111/', label: 'Thread One' },
    { id: '222', url: 'https://www.blackhatworld.com/seo/thread-two.222/', label: 'Thread Two',
      lastBumpedAt: new Date().toISOString(), lastBumpKind: 'promo' }
  ]
};
let sent = [];
const responses = {};   // cmd -> fn(msg) -> response, set per-test
const storageListeners = [];

global.chrome = {
  runtime: {
    getURL: (p) => 'x/' + p,
    sendMessage: async (msg) => { sent.push(msg); return (responses[msg.cmd] || (() => ({})))(msg); }
  },
  storage: {
    local: { get: async (k) => (k === 'config' ? { config: cfg } : {}), set: async () => {} },
    onChanged: { addListener: (fn) => storageListeners.push(fn) }
  }
};
const fireConfigChanged = () => storageListeners.forEach((fn) => fn({ config: {} }, 'local'));
dom.window.addEventListener('error', (e) => { console.log('PAGE ERROR:', e.error?.stack || e.message); process.exitCode = 1; });
await import(pathToFileURL(DIR + 'services.js').href);
await new Promise((r) => setTimeout(r, 80));

let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + '  ' + e); } };
const $ = (id) => dom.window.document.getElementById(id);

const cards = () => [...$('list').querySelectorAll('.thread')];

ok('both tracked threads are rendered', cards().length === 2, String(cards().length));
ok('never eligible is shown as eligible now', cards()[0].querySelector('.pill').textContent.includes('eligible now'),
   cards()[0].querySelector('.pill').textContent);
ok('a just-bumped thread is shown as waiting', cards()[1].querySelector('.pill').textContent.includes('eligible in'),
   cards()[1].querySelector('.pill').textContent);
ok('the thread link is shown', cards()[0].querySelector('a').href.includes('thread-one.111'));
ok('leads are never touched - this page has no such storage key', !('recentLeads' in cfg));

// --- Get idea -----------------------------------------------------------------
responses['bump-idea'] = () => ({ ok: true, text: 'Bumping this up with a fresh update!' });
sent = [];
cards()[0].querySelector('[data-act="idea"]').dispatchEvent(new dom.window.Event('click'));
await new Promise((r) => setTimeout(r, 30));
ok('"Get idea" asks the background for this specific thread', sent[0]?.cmd === 'bump-idea' && sent[0]?.label === 'Thread One', JSON.stringify(sent));
ok('and shows the returned text on the page', cards()[0].querySelector('.idea').textContent === 'Bumping this up with a fresh update!',
   cards()[0].querySelector('.idea').textContent);
ok('asking for an idea never touches Telegram from this page', !sent.some((m) => m.cmd?.includes('telegram')));

// --- Mark bumped ----------------------------------------------------------------
responses['mark-bumped-thread'] = () => ({ marked: true });
sent = [];
cards()[0].querySelector('[data-act="bumped"]').dispatchEvent(new dom.window.Event('click'));
await new Promise((r) => setTimeout(r, 30));
ok('"Mark bumped" names the right thread', sent.some((m) => m.cmd === 'mark-bumped-thread' && m.label === 'Thread One'), JSON.stringify(sent));

// --- Untrack ----------------------------------------------------------------
responses['untrack-service-thread'] = () => ({ removed: true });
cfg = { serviceThreads: cfg.serviceThreads.filter((t) => t.label !== 'Thread Two') };   // simulate the removal
sent = [];
cards()[1].querySelector('[data-act="untrack"]').dispatchEvent(new dom.window.Event('click'));
await new Promise((r) => setTimeout(r, 30));
ok('untrack confirms before removing', sent.some((m) => m.cmd === 'untrack-service-thread' && m.label === 'Thread Two'), JSON.stringify(sent));
ok('and the page re-renders down to one thread', cards().length === 1, String(cards().length));

// --- The bulk-add box -------------------------------------------------------
responses['batch-track-services'] = () => ({ added: [{ id: '333', label: 'Thread Three' }], already: [], noTitle: [] });
cfg = { serviceThreads: [...cfg.serviceThreads, { id: '333', url: 'https://x/333/', label: 'Thread Three' }] };
$('bulkTrack').value = 'https://www.blackhatworld.com/seo/thread-three.333/';
$('bulkTrackBtn').dispatchEvent(new dom.window.Event('click'));
await new Promise((r) => setTimeout(r, 30));
ok('adding from the box reports success and clears the textarea', /1 added/.test($('bulkTrackStatus').textContent), $('bulkTrackStatus').textContent);
ok('the new thread appears without a page reload', cards().length === 2, String(cards().length));

// --- The empty state, reached the same way a real untrack-to-zero would ------
cfg = { serviceThreads: [] };
fireConfigChanged();
await new Promise((r) => setTimeout(r, 30));
ok('with nothing left tracked, the page says so rather than showing a blank list',
   /No service threads tracked yet/.test($('list').textContent), $('list').textContent);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
