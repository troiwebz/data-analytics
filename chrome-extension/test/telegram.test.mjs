// Telegram, straight from the extension: two messages a lead, and a failure
// that never costs a lead.
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
globalThis.chrome = { storage: { local: mk('local'), sync: mk('sync') } };

let sent = [], reply = { ok: true, result: { username: 'haf_bot' } };
globalThis.fetch = async (url, opts) => {
  sent.push({ url: String(url), body: JSON.parse(opts.body) });
  return { ok: true, status: 200, json: async () => reply };
};

const T = await import('../src/telegram.js');
const V = await import('../src/vault.js');
const C = await import('../src/claude.js');
let fails = 0;
const ok = (n, c, e='') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + ' ' + e); } };

const cfg = { telegramEnabled: true, telegramChatId: '8812664414' };
const lead = (id) => ({
  threadId: id, title: 'Looking for Bulk GMB Listings', author: 'Yeon', url: 'https://bhw/threads/x.' + id + '/',
  card: '<b>6 pts</b> · SEO', dmUrl: 'https://bhw/direct-messages/add?to=Yeon',
  draft: 'Hey @Yeon,\n\nVerification handled per listing. Core work for us.\n\nPM sent.',
  dm: 'Hey Yeon,\n\nSaw your thread: https://bhw/threads/x.' + id + '/\n\ntip one. tip two. tip three.\n\nPortfolio and samples.'
});

// Nothing configured: silent no-op, never an exception on a poll.
ok('no token: sends nothing, throws nothing', (await T.sendLeads([lead('1')], cfg)).sent === 0);

await T.setToken('1234567890:AAtesttoken');
ok('token stored in the vault', (await V.getSecret('telegram')) === '1234567890:AAtesttoken');

sent = [];
await T.sendLeads([lead('1')], cfg);
ok('two messages per lead', sent.length === 2, String(sent.length));
ok('both go to the bot API', sent.every((m) => m.url.startsWith('https://api.telegram.org/bot1234567890:AAtesttoken/sendMessage')));
ok('both go to the right chat', sent.every((m) => m.body.chat_id === '8812664414'));

const [first, second] = sent;
ok('first carries the card', first.body.text.includes('6 pts'));
ok('first carries the PUBLIC reply', first.body.text.includes('Verification handled per listing'));
ok('public reply is tap-to-copy', /<pre>[\s\S]*Verification handled[\s\S]*<\/pre>/.test(first.body.text));
ok('first does NOT carry the PM', !first.body.text.includes('Portfolio and samples'));
ok('second carries the PM', second.body.text.includes('Portfolio and samples'));
ok('PM is tap-to-copy', /<pre>[\s\S]*Portfolio and samples[\s\S]*<\/pre>/.test(second.body.text));
ok('PM message links the PM page', second.body.text.includes('direct-messages/add'));
ok('both are HTML', sent.every((m) => m.body.parse_mode === 'HTML'));

// Telegram's 4096 limit must never reject a message.
sent = [];
await T.sendLeads([{ ...lead('2'), dm: 'x'.repeat(9000), draft: 'y'.repeat(9000) }], cfg);
ok('over-long drafts are cut, not rejected', sent.every((m) => m.body.text.length <= 4200),
   sent.map((m) => m.body.text.length).join(','));
ok('and say so', sent.some((m) => /full text is on the dashboard/.test(m.body.text)));

// HTML in a thread title cannot break the message.
sent = [];
await T.sendLeads([{ ...lead('3'), draft: 'Use <b>bold</b> & "quotes"' }], cfg);
ok('draft html is escaped', sent[0].body.text.includes('&lt;b&gt;bold&lt;/b&gt; &amp;'));

// A burst is capped rather than flooding the phone.
sent = [];
const many = Array.from({ length: 12 }, (_, i) => lead('m' + i));
const r = await T.sendLeads(many, cfg);
ok('a burst is capped at 6 leads', r.sent === 6, String(r.sent));
ok('and the rest are counted', r.skipped === 6 && sent.some((m) => /6 more on the dashboard/.test(m.body.text)));

// Telegram failing must not throw into the poll.
globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ ok: false, description: 'Unauthorized' }) });
const bad = await T.sendLeads([lead('9')], cfg);
ok('an API error is reported, not thrown', bad.sent === 0 && /Unauthorized/.test(bad.error), JSON.stringify(bad));
globalThis.fetch = async () => { throw new Error('network down'); };
ok('a network failure is caught too', (await T.sendLeads([lead('9')], cfg)).sent === 0);

// Switched off means off.
globalThis.fetch = async (url, opts) => {
  if (opts?.body) sent.push({ url: String(url), body: JSON.parse(opts.body) });
  return { ok: true, status: 200, json: async () => reply };   // also answers Anthropic's key check
};
sent = [];
await T.sendLeads([lead('9')], { ...cfg, telegramEnabled: false });
ok('unticking the box stops it', sent.length === 0);
await T.sendLeads([lead('9')], { ...cfg, telegramChatId: '' });
ok('no chat id stops it', sent.length === 0);

// The two secrets live together but are removed independently.
await C.saveKey('sk-ant-api03-BOTHSECRETS001');
ok('Claude key and bot token coexist', !!(await V.getSecret('telegram')) && !!(await V.getKey()));
await T.clearToken();
ok('removing the bot token keeps the Claude key', !(await V.getSecret('telegram')) && !!(await V.getKey()));
await C.saveKey('sk-ant-api03-BOTHSECRETS001');
await T.setToken('1234567890:AAtesttoken');
await C.clearKey();
ok('removing the Claude key keeps the bot token', !!(await V.getSecret('telegram')) && !(await V.getKey()));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
