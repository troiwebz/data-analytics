const bags = { local: {}, sync: {} };
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const mk = (area) => ({
  get: async (k) => { const bag = bags[area];
    if (k == null) return clone(bag);
    const ks = Array.isArray(k) ? k : [k];
    return Object.fromEntries(ks.filter((x) => x in bag).map((x) => [x, clone(bag[x])])); },
  set: async (o) => Object.assign(bags[area], o),
  remove: async (k) => { for (const x of (Array.isArray(k) ? k : [k])) delete bags[area][x]; }
});

globalThis.chrome = {
  runtime: {
    onInstalled: { addListener: () => {} }, onStartup: { addListener: () => {} },
    onMessage: { addListener: () => {} },
    getManifest: () => ({ version: '0.46.0' }), getURL: (p) => 'chrome-extension://x/' + p, lastError: null,
    sendMessage: async () => ({})
  },
  action: { onClicked: { addListener: () => {} } },
  tabs: { onRemoved: { addListener: () => {} }, onUpdated: { addListener: () => {}, removeListener: () => {} } },
  alarms: { onAlarm: { addListener: () => {} }, clear: async () => {}, create: () => {} },
  notifications: { create: (id, o, cb) => cb && cb(id), clear: () => {},
                   onClicked: { addListener: () => {} }, onButtonClicked: { addListener: () => {} } },
  scripting: { executeScript: async () => [{ result: {} }] },
  offscreen: { hasDocument: async () => true, createDocument: async () => {} },
  storage: { local: mk('local'), sync: mk('sync') }
};

// "See if I get any new message in https://www.blackhatworld.com/direct-messages/
// and notify me on Telegram" (1.11.6).
const ME = 'bargainbed';
const ts = (h) => Math.floor((Date.now() - h * 3600000) / 1000);
const row = (id, title, starter, lastBy, h, unread) => `
  <div class="structItem structItem--conversation${unread ? ' is-unread' : ''} js-inlineModContainer" data-author="${starter}">
    <div class="structItem-title"><a href="/direct-messages/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${id}/">${title}</a></div>
    <div class="structItem-minor"><ul class="listInline"><li><a href="/members/${starter.toLowerCase()}.9/" class="username">${starter}</a></li><li><a href="/members/${ME}.1/" class="username">${ME}</a></li></ul></div>
    <div class="structItem-cell structItem-cell--latest"><time data-timestamp="${ts(h)}"></time><div class="structItem-minor"><a href="/members/${lastBy.toLowerCase()}.9/" class="username">${lastBy}</a></div></div>
  </div>`;
let inbox = [row(501, 'GMB services Require for US Uk', ME, 'abbask', 0.2, true), row(502, 'Photoshop master', ME, ME, 0.5, false), row(503, 'Claude Max subscription', ME, ME, 1, true)];
const page = () => `<html><div class="p-navgroup-user"><span class="p-navgroup-user-linkText">${ME}</span></div><div class="structItemContainer">${inbox.join('')}</div></html>`;
let sent = [], inboxReads = 0;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (/direct-messages\/$/.test(u)) { inboxReads++; return { ok: true, status: 200, text: async () => page() }; }
  if (/api\.telegram\.org/.test(u)) { const b = JSON.parse(opts.body || '{}'); if (b.text) sent.push(b.text); return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) }; }
  return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }), text: async () => '' };
};
bags.local.config = { telegramChatId: '123', boundAccount: ME, bhwUsername: ME };
bags.local.vault = { tgToken: '1:abcdefghijklmnopqrstuvwxyz', savedAt: 1 };
const { parseConversations } = await import('../src/messages.js');
const bg = await import('../src/background.js');
let fails = 0;
const ok = (n, c, e) => { if (!c) fails++; console.log(`${c ? '  ok' : 'FAIL'}  ${n}${c || e === undefined ? '' : `  -> ${JSON.stringify(e).slice(0, 300)}`}`); };

const rows = parseConversations(page());
ok('unread conversations are recognised', rows.map((r) => r.unread).join() === 'true,false,true', rows.map((r) => r.unread));
ok('and who wrote the latest message', rows[0].lastBy === 'abbask' && rows[1].lastBy === ME, rows.map((r) => r.lastBy));

const cfg = { telegramChatId: '123', dmAlerts: true };
let r = await bg.alertUnreadDms(rows, ME, cfg);
ok('a new message from a buyer is sent to Telegram', r.told === 1 && sent.length === 1 && /abbask: GMB services Require for US Uk/.test(sent[0]) && /direct-messages\/gmb-services/.test(sent[0]), sent);
ok('your own last message never alerts you, even if unread', !/Claude Max/.test(sent[0]));
r = await bg.alertUnreadDms(rows, ME, cfg);
ok('the same message is told once only', r.told === 0 && sent.length === 1);
inbox[0] = row(501, 'GMB services Require for US Uk', ME, 'abbask', 0.01, true);
r = await bg.alertUnreadDms(parseConversations(page()), ME, cfg);
ok('a NEW reply in the same conversation is told again', r.told === 1 && sent.length === 2);
r = await bg.alertUnreadDms(parseConversations(page()), ME, { ...cfg, dmAlerts: false });
ok('switched off in Settings: nothing', r.told === 0 && sent.length === 2);

// From the envelope count on a page the extension read anyway.
inbox.push(row(504, 'Need TikTok ads help', 'newbuyer', 'newbuyer', 0.05, true));
inboxReads = 0;
let c = await bg.checkDmBadge(0);
ok('envelope at 0: no inbox read at all', c.skipped === true && inboxReads === 0);
c = await bg.checkDmBadge(2);
ok('envelope above 0: the inbox is read once and the new one told', inboxReads === 1 && c.told === 1 && /newbuyer: Need TikTok ads help/.test(sent[sent.length - 1]), { c, inboxReads });
c = await bg.checkDmBadge(2);
ok('and not read again within 3 minutes', c.skipped === true && inboxReads === 1);

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
