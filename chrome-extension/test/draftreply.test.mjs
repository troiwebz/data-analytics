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

// "Why is no answer here? Can Claude write a two-liner, very technical, and ask
// a question to extend the conversation - and save credits by understanding the
// answers already there - so I can post it directly?" (1.11.5)
let calls = 0, lastBody = null;
let answer = '{"lines":["Split the brand and generic campaigns so brand spend stops masking the real CPA.","Check the search terms report weekly, most wasted spend hides in broad match variants."],"question":"Are you running this on one account or several?"}';
globalThis.fetch = async (url, opts) => {
  if (/anthropic/.test(String(url))) {
    calls++; lastBody = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: answer }], usage: { input_tokens: 900, output_tokens: 90 }, stop_reason: 'end_turn' }) };
  }
  return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }), text: async () => '' };
};
bags.local.vault = { key: 'sk-ant-test-key-000', savedAt: 1 };
bags.sync.vault = { key: 'sk-ant-test-key-000', savedAt: 1 };
const claude = await import('../src/claude.js');
const bg = await import('../src/background.js');
let fails = 0;
const ok = (n, c, e) => { if (!c) fails++; console.log(`${c ? '  ok' : 'FAIL'}  ${n}${c || e === undefined ? '' : `  -> ${JSON.stringify(e).slice(0, 300)}`}`); };

const lead = { threadId: '777', kind: 'thread', title: 'Specialized Google Ads accounts', forum: 'Google Ads', url: 'https://www.blackhatworld.com/seo/x.777/',
  body: 'Looking at options for specialised Google Ads accounts. '.repeat(60),
  replies: Array.from({ length: 9 }, (_, i) => ({ author: `m${i}`, text: `Reply ${i}: use aged accounts with billing history. `.repeat(20) })) };

const p = claude.replyPrompt(lead, 'We run Google Ads for iGaming clients.');
ok('the post is trimmed to 1200 characters', /post: (.{1200})\n/.test(p) && !/post: .{1201}/.test(p));
ok('at most 6 replies, each cut to 220 characters', (p.match(/^\d\. /gm) || []).length === 6 && p.split('\n').filter((l) => /^\d\. /.test(l)).every((l) => l.length <= 224));
ok('it says how many replies there are in all', /replies already on the thread \(9\)/.test(p));
ok('the whole prompt stays small', p.length < 3200, p.length);

const c = claude.composeReply(answer);
ok('two lines, a blank line, then the question', /^[^\n]+\n[^\n]+\n\n[^\n]+\?$/.test(c.text), c.text);
ok('a clean draft has no warnings', c.problems.length === 0, c.problems);
const dirty = claude.composeReply('{"lines":["We squarely leverage aged accounts — free trial (ask)","Second line"],"question":"Budget"}');
ok('dashes and brackets are cleaned out, a question mark added', !/[—()]/.test(dirty.text) && /Budget\?$/.test(dirty.text), dirty.text);
ok('stiff words and free work are flagged, not hidden', dirty.problems.length === 2, dirty.problems);
ok('a half answer is an error, not a broken draft', !!claude.composeReply('{"lines":["only one"]}').error);

bags.local.recentLeads = [lead];
const r1 = await bg.draftThreadReply('777');
ok('a draft comes back for the box', /^Split the brand/.test(r1.text || '') && calls === 1, r1);
ok('with a small answer budget', lastBody.max_tokens <= 400, lastBody.max_tokens);
ok('nothing is posted: the lead is not marked', !['POSTED'].includes(bags.local.recentLeads[0].status) && !bags.local.recentLeads[0].postedAt);
ok('the draft is kept on the lead', bags.local.recentLeads[0].claudeReply?.text === r1.text);
const r2 = await bg.draftThreadReply('777');
ok('pressing again with no new replies is free', r2.cached === true && calls === 1 && r2.text === r1.text, { calls, r2 });
bags.local.recentLeads[0].replies.push({ author: 'new', text: 'a new reply' });
answer = answer.replace('Split the brand', 'Separate brand');
const r3 = await bg.draftThreadReply('777');
ok('a new reply on the thread means a fresh draft', calls === 2 && /^Separate brand/.test(r3.text), { calls, t: r3.text });
const r4 = await bg.draftThreadReply('777', { force: true });
ok('"Draft again" asks Claude again on purpose', calls === 3 && !r4.cached);

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
