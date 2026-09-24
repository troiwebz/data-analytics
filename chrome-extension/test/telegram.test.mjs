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

const cfg = { telegramEnabled: true, telegramChatId: '8812664414', telegramSend: 'both' };
const lead = (id) => ({
  threadId: id, title: 'Looking for Bulk GMB Listings', author: 'Yeon', url: 'https://bhw/threads/x.' + id + '/',
  card: '<b>6 pts</b> · SEO', dmUrl: 'https://bhw/direct-messages/add?to=Yeon', dmTitle: 'Re: Bulk GMB Listings',
  draft: 'Hey @Yeon,\n\nVerification handled per listing. Core work for us.\n\nPM sent.',
  dm: 'Hey Yeon,\n\nSaw your thread: https://bhw/threads/x.' + id + '/\n\ntip one. tip two. tip three.\n\nPortfolio and samples.'
});

// Nothing configured: silent no-op, never an exception on a poll.
ok('no token: sends nothing, throws nothing', (await T.sendLeads([lead('1')], cfg)).sent === 0);

await T.setToken('1234567890:AAtesttoken');
ok('token stored in the vault', (await V.getSecret('telegram')) === '1234567890:AAtesttoken');

// "HAF Watcher is my bot name ah?" - no, that is the extension. The bot is
// whatever it was called in BotFather, and a masked token cannot tell you. So
// Settings asks Telegram and shows the real @name.
{
  const st = await T.status({ telegramChatId: '', telegramEnabled: true });
  ok('the status names the bot itself', st.bot === 'haf_bot', JSON.stringify(st));
  const before = sent.length;
  await T.status({ telegramChatId: '', telegramEnabled: true });
  ok('and does not ask Telegram again every time', sent.length === before, `${sent.length} vs ${before}`);
}

sent = [];
await T.sendLeads([lead('1')], cfg);
ok('two messages per lead', sent.length === 2, String(sent.length));
ok('both go to the bot API', sent.every((m) => m.url.startsWith('https://api.telegram.org/bot1234567890:AAtesttoken/sendMessage')));
ok('both go to the right chat', sent.every((m) => m.body.chat_id === '8812664414'));

const [first, second] = sent;
// The PM leads, because it is the one that gets sent.
ok('the PM comes FIRST', first.body.text.includes('Portfolio and samples'), first.body.text.slice(0, 120));
ok('the first message carries the card', first.body.text.includes('6 pts'));
ok('PM is tap-to-copy', /<pre>[\s\S]*Portfolio and samples[\s\S]*<\/pre>/.test(first.body.text));
ok('the PM message links the prefilled PM page', first.body.text.includes('direct-messages/add'));
ok('and links your inbox', first.body.text.includes('https://www.blackhatworld.com/direct-messages/"'));
ok('the PM link carries no title parameter', !/[?&]title=/.test(first.body.text));
ok('the subject is readable, since the URL no longer carries it', first.body.text.includes('Re: Bulk GMB Listings'));
ok('the public reply comes second', second.body.text.includes('Verification handled per listing'));
ok('public reply is tap-to-copy', /<pre>[\s\S]*Verification handled[\s\S]*<\/pre>/.test(second.body.text));
ok('the two are not mixed up', !first.body.text.includes('Verification handled') && !second.body.text.includes('Portfolio and samples'));
ok('both are HTML', sent.every((m) => m.body.parse_mode === 'HTML'));

// A lead with no PM draft must say so, not silently send only the reply.
sent = [];
await T.sendLeads([{ ...lead('4'), dm: '' }], cfg);
ok('a missing PM draft still sends a PM message', sent.length === 2, String(sent.length));
ok('and says what is wrong', /No PM draft on this lead/.test(sent[0].body.text), sent[0].body.text.slice(-120));

// Either half can be switched off.
sent = [];
await T.sendLeads([lead('5')], { ...cfg, telegramSend: 'pm' });
ok('"PM only" sends one message', sent.length === 1 && /Portfolio and samples/.test(sent[0].body.text));
sent = [];
await T.sendLeads([lead('6')], { ...cfg, telegramSend: 'reply' });
ok('"reply only" sends one message', sent.length === 1 && /Verification handled/.test(sent[0].body.text));

// Telegram's 4096 limit must never reject a message.
sent = [];
await T.sendLeads([{ ...lead('2'), dm: 'x'.repeat(9000), draft: 'y'.repeat(9000) }], cfg);
ok('over-long drafts are cut, not rejected', sent.every((m) => m.body.text.length <= 4200),
   sent.map((m) => m.body.text.length).join(','));
ok('and say so', sent.some((m) => /full text is on the dashboard/.test(m.body.text)));

// HTML in a thread title cannot break the message.
sent = [];
await T.sendLeads([{ ...lead('3'), draft: 'Use <b>bold</b> & "quotes"' }], cfg);
// The reply is the second message now, so escaping is checked where it lives.
ok('draft html is escaped', sent.some((m) => m.body.text.includes('&lt;b&gt;bold&lt;/b&gt; &amp;')),
   sent.map((m) => m.body.text.slice(0, 60)).join(' | '));

// A burst is capped rather than flooding the phone.
sent = [];
const many = Array.from({ length: 12 }, (_, i) => lead('m' + i));
const r = await T.sendLeads(many, cfg);
ok('a burst is capped at 6 leads by default', r.sent === 6, String(r.sent));
ok('and the rest are counted', r.skipped === 6 && sent.some((m) => /6 more on the dashboard/.test(m.body.text)));

// A caller answering something asked for on purpose (the "pending" command)
// can raise that cap - it used to be hardcoded, silently overriding whatever
// a caller intended.
sent = [];
const capRaised = await T.sendLeads(many, cfg, { max: 8 });
ok('a caller can raise the cap', capRaised.sent === 8, String(capRaised.sent));
ok('and the remainder narrows to match', capRaised.skipped === 4, String(capRaised.skipped));

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

// Telegram rejecting the PM used to lose it silently and stop the batch, so
// only the public reply ever arrived. Both halves must be accounted for.
globalThis.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  sent.push({ url: String(url), body });
  // Refuse the PM once, the way Telegram refuses a message over one bad tag.
  if (/PM to/.test(body.text) && body.parse_mode === 'HTML') {
    return { ok: false, status: 400, json: async () => ({ ok: false, description: "Bad Request: can't parse entities" }) };
  }
  return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) };
};
sent = [];
const r2 = await T.sendLeads([lead('20')], cfg);
ok('a refused PM is retried without formatting', sent.filter((m) => /PM to/.test(m.body.text)).length === 2,
   String(sent.filter((m) => /PM to/.test(m.body.text)).length));
ok('and the retry carries no parse mode', sent.filter((m) => /PM to/.test(m.body.text))[1].body.parse_mode === undefined);
ok('the PM still arrives', /Portfolio and samples/.test(sent.filter((m) => /PM to/.test(m.body.text))[1].body.text));
ok('and the lead counts as sent', r2.sent === 1 && !r2.error, JSON.stringify(r2));

// A PM that fails even as plain text must be reported, and must not stop the rest.
globalThis.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  sent.push({ url: String(url), body });
  if (/PM to/.test(body.text)) return { ok: false, status: 400, json: async () => ({ ok: false, description: 'Forbidden: bot blocked' }) };
  return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) };
};
sent = [];
const r3 = await T.sendLeads([lead('21'), lead('22')], cfg);
ok('a hard failure names which half went wrong', /PM:/.test(r3.error), r3.error);
ok('and says what Telegram said', /bot blocked/.test(r3.error), r3.error);
ok('the public reply still goes out', sent.some((m) => /Public reply/.test(m.body.text)));
ok('and the next lead is still attempted', sent.filter((m) => /Public reply/.test(m.body.text)).length === 2,
   String(sent.filter((m) => /Public reply/.test(m.body.text)).length));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
