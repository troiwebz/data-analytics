// "Open filled" fills the thread, and the tab STAYS OPEN.
//
// The bug: the dashboard marked the row POSTED the moment it filled, and the
// `mark` handler's cleanup closes any staged tab for that thread - which was
// the tab it had just opened. So the reply appeared and the tab shut about a
// second later. A second closer sat behind it: expireStaged() reaps staged tabs
// after 20 minutes, a tab you opened yourself included.
//
// Now the row goes FILLED, not POSTED, and turns POSTED off the real event -
// the reply appearing on the thread. Neither closer touches a tab you opened.
const bags = { local: {} };
const clone = (v) => (v === undefined ? undefined : structuredClone(v));

let closed = [], created = [], nextTabId = 500;
let onRemoved = () => {}, onUpdated = [];
const msgListeners = [];
globalThis.__msg = (m, sender, respond) => { for (const f of [...msgListeners]) f(m, sender, respond); };

globalThis.chrome = {
  runtime: {
    onInstalled: { addListener: () => {} }, onStartup: { addListener: () => {} },
    // Several listeners at once: the service worker's own, plus the short-lived
    // one runInThread adds to wait for the content script's result.
    onMessage: {
      addListener: (f) => msgListeners.push(f),
      removeListener: (f) => { const i = msgListeners.indexOf(f); if (i >= 0) msgListeners.splice(i, 1); }
    },
    getManifest: () => ({ version: '0.48.0' }), getURL: (p) => 'x/' + p, reload: () => {},
    sendMessage: async () => ({ ok: true }), lastError: null
  },
  action: { onClicked: { addListener: () => {} } },
  tabs: {
    onRemoved: { addListener: (f) => { onRemoved = f; } },
    onUpdated: {
      addListener: (f) => onUpdated.push(f),
      removeListener: (f) => { const i = onUpdated.indexOf(f); if (i >= 0) onUpdated.splice(i, 1); }
    },
    create: async (o) => {
      const t = { id: nextTabId++, url: o.url, active: !!o.active };
      created.push(t);
      setTimeout(() => { for (const f of [...onUpdated]) f(t.id, { status: 'complete' }); }, 2);
      return t;
    },
    get: async (id) => ({ id }),
    remove: async (id) => { closed.push(id); },
    update: async () => {}
  },
  windows: { update: () => {} },
  alarms: { onAlarm: { addListener: () => {} }, clear: async () => {}, create: () => {} },
  notifications: { create: (id, o, cb) => cb && cb(id), clear: () => {},
                   onClicked: { addListener: () => {} }, onButtonClicked: { addListener: () => {} } },
  offscreen: { hasDocument: async () => true, createDocument: async () => {} },
  // The content script "runs": report a staged fill straight back, the way
  // content-post.js does over chrome.runtime.sendMessage.
  scripting: {
    executeScript: async ({ files }) => {
      if (files) setTimeout(() => globalThis.__msg(
        { type: 'haf-post-result', threadId: globalThis.__fillingId, mode: 'stage', result: { ok: true, staged: true } },
        {}, () => {}), 5);
      return [{ result: {} }];
    }
  },
  storage: {
    local: {
      get: async (k) => { if (k == null) return clone(bags.local);
        const ks = Array.isArray(k) ? k : [k];
        return Object.fromEntries(ks.filter((x) => x in bags.local).map((x) => [x, clone(bags.local[x])])); },
      set: async (o) => Object.assign(bags.local, o),
      remove: async (k) => { for (const x of (Array.isArray(k) ? k : [k])) delete bags.local[x]; }
    },
    sync: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    onChanged: { addListener: () => {} }
  }
};
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });

const bg = await import('../src/background.js');
const { getLeads, getStaged, getRateState } = await import('../src/store.js');

let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + ' ' + e); } };
const send = (msg) => new Promise((r) => {
  let done = false;
  globalThis.__msg(msg, {}, (v) => { if (!done) { done = true; r(v); } });
});
const leadOf = async (id) => (await getLeads()).find((l) => String(l.threadId) === String(id));

const lead = (id) => ({ threadId: id, title: 'thread ' + id, author: 'buyer' + id,
                        url: `https://www.blackhatworld.com/threads/x.${id}/`, draft: 'Hi there,\n\nA reply.', status: 'SENT' });
bags.local.recentLeads = [lead('a'), lead('b'), lead('c')];

// ---- Open filled ----------------------------------------------------------
globalThis.__fillingId = 'a';
const r = await send({ cmd: 'fill-thread', lead: lead('a') });
ok('the fill succeeds', r?.ok === true, JSON.stringify(r));
const tab = created[created.length - 1].id;
ok('the tab it opened is NOT closed', !closed.includes(tab), `closed: ${JSON.stringify(closed)}`);
ok('and it opens in front, where the editor can take focus', created[created.length - 1].active === true);

let l = await leadOf('a');
ok('the row says filled, not posted', l.status === 'FILLED', l.status);
ok('so nothing claims a reply you have not sent', l.status !== 'POSTED');
ok('and it does not count against your daily replies yet', (await getRateState()).count === 0,
   String((await getRateState()).count));
ok('the tab is remembered as yours', (await getStaged()).a?.by === 'you', JSON.stringify((await getStaged()).a));

// The exact chain that closed the tab: something marks the row POSTED while
// your filled tab is open. The `mark` cleanup used to close it. It must not
// touch a tab you opened, however the mark got there.
await send({ cmd: 'mark', threadId: 'a', status: 'POSTED', detail: 'marked by hand' });
ok('marking it posted by hand does not close the tab you opened', !closed.includes(tab), JSON.stringify(closed));
// Put it back to filled for the rest of the walk-through.
bags.local.recentLeads = (await getLeads()).map((x) => (x.threadId === 'a' ? { ...x, status: 'FILLED' } : x));
bags.local.stagedTabs = { a: { tabId: tab, at: Date.now(), title: 'thread a', by: 'you' } };

// A tab the watcher armed is different: marking that one done does close it,
// because nobody is sitting in it.
bags.local.stagedTabs.w = { tabId: 902, at: Date.now(), title: 'thread w', by: 'watcher' };
bags.local.recentLeads = [...(await getLeads()), { threadId: 'w', title: 'thread w', status: 'SENT' }];
await send({ cmd: 'mark', threadId: 'w', status: 'POSTED' });
ok('a tab the watcher armed is still closed on marking', closed.includes(902), JSON.stringify(closed));

// ---- 20-minute reaper -----------------------------------------------------
// Backdate it well past the expiry and run the reaper.
const staged = await getStaged();
staged.a.at = Date.now() - 60 * 60000;
bags.local.stagedTabs = staged;
await bg.expireStaged();
ok('the 20-minute reaper leaves your own tab alone', !closed.includes(tab), `closed: ${JSON.stringify(closed)}`);
ok('and it is still filled', (await leadOf('a')).status === 'FILLED');

// A tab the watcher armed by itself is still reaped - that is what it is for.
bags.local.stagedTabs = { b: { tabId: 901, at: Date.now() - 60 * 60000, title: 'thread b', by: 'watcher' } };
await bg.expireStaged();
ok('a tab the watcher armed is still reaped', closed.includes(901), JSON.stringify(closed));

// ---- the reply actually landing -------------------------------------------
// Clear the counter the hand-marks above moved, so the numbers below are only
// about a reply landing.
bags.local.rateState = { ...(bags.local.rateState || {}), count: 0 };
bags.local.recentLeads = (await getLeads()).map((x) => (x.threadId === 'a' ? { ...x, status: 'FILLED' } : x));
bags.local.stagedTabs = { a: { tabId: tab, at: Date.now(), title: 'thread a', by: 'you' } };
await send({ cmd: 'reply-landed', threadId: 'a', postUrl: 'https://www.blackhatworld.com/threads/x.a/post-77' });
l = await leadOf('a');
ok('once the reply lands the row turns posted', l.status === 'POSTED', l.status);
ok('and the real post link is saved', l.postUrl.endsWith('/post-77'), l.postUrl);
ok('now it counts against your daily replies', (await getRateState()).count === 1, String((await getRateState()).count));
ok('the tab is still not closed - it is yours to read', !closed.includes(tab), JSON.stringify(closed));
ok('and it is no longer held as staged', !(await getStaged()).a, JSON.stringify(await getStaged()));

// Landing twice must not double-count.
await send({ cmd: 'reply-landed', threadId: 'a', postUrl: 'https://x/post-77' });
ok('the same reply landing twice counts once', (await getRateState()).count === 1);

// ---- a page reload onto the post, instead of an AJAX insert ---------------
globalThis.__fillingId = 'c';
await send({ cmd: 'fill-thread', lead: lead('c') });
const cTab = created[created.length - 1].id;
ok('a fresh fill is filled', (await leadOf('c')).status === 'FILLED');
for (const f of onUpdated) await f(cTab, { url: 'https://www.blackhatworld.com/threads/x.c/post-91' });
ok('a reload onto the new post also counts as landed', (await leadOf('c')).status === 'POSTED',
   (await leadOf('c')).status);
ok('with that post link', (await leadOf('c')).postUrl.endsWith('/post-91'), (await leadOf('c')).postUrl);

// Reading someone else's post permalink in a filled tab must not count as
// yours, and neither must a post in a different thread.
globalThis.__fillingId = 'd';
bags.local.recentLeads = [...(await getLeads()), { ...lead('d'), status: 'SENT' }];
await send({ cmd: 'fill-thread', lead: lead('d') });
const dTab = created[created.length - 1].id;
for (const f of onUpdated) await f(dTab, { url: 'https://www.blackhatworld.com/threads/other.99/post-12' });
ok('a post in another thread does not count as your reply', (await leadOf('d')).status === 'FILLED',
   (await leadOf('d')).status);
for (const f of onUpdated) await f(dTab, { url: 'https://www.blackhatworld.com/threads/x.d/post-12' });
ok('a post in the thread you filled does count', (await leadOf('d')).status === 'POSTED', (await leadOf('d')).status);

// A row you never filled cannot be marked posted by a stray landing.
await send({ cmd: 'reply-landed', threadId: 'b', postUrl: 'https://x/post-5' });
ok('a row you never filled is left alone', (await leadOf('b')).status !== 'POSTED', (await leadOf('b')).status);

// ---- closing the tab without posting -------------------------------------
globalThis.__fillingId = 'b';
bags.local.recentLeads = (await getLeads()).map((x) => (x.threadId === 'b' ? { ...x, status: 'SENT' } : x));
await send({ cmd: 'fill-thread', lead: lead('b') });
const bTab = created[created.length - 1].id;
ok('filled', (await leadOf('b')).status === 'FILLED');
const countBefore = (await getRateState()).count;
await onRemoved(bTab);
const back = await leadOf('b');
ok('closing the tab without posting puts it back on the to-do list', back.status === 'SENT', back.status);
ok('and it costs no daily slot', (await getRateState()).count === countBefore,
   `${(await getRateState()).count} vs ${countBefore}`);
ok('and it is no longer staged', !(await getStaged()).b, JSON.stringify(await getStaged()));

// Closing the tab after the reply landed must NOT undo the posted row.
await onRemoved(cTab);
ok('closing the tab after posting keeps it posted', (await leadOf('c')).status === 'POSTED',
   (await leadOf('c')).status);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
