// Smoke test: the extension's Claude client, with chrome + fetch stubbed.
const store = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (k) => (k in store ? { [k]: structuredClone(store[k]) } : {}),
      set: async (o) => Object.assign(store, o),
      remove: async (k) => { delete store[k]; }
    },
    sync: { get: async () => ({}), set: async () => {}, remove: async () => {} }
  }
};

let lastReq = null;
let reply = {
  ok: true, status: 200,
  json: async () => ({
    content: [{ type: 'text', text: 'Here you go:\n```json\n{"111":{"tips":["Manual citations on UAE directories that actually index — no scraped lists","GMB category and service-area fixes before any citation work","NAP audit across the profiles you already have"],"question":"Audit-safe citations, or volume for a tier 2 layer?","offer":"formula"},"222":{"tips":["short"],"question":"x","offer":"nope"}}\n```' }],
    usage: { input_tokens: 900, cache_read_input_tokens: 400, output_tokens: 120 }
  })
};
globalThis.fetch = async (url, opts) => { lastReq = { url, opts }; return reply; };

const C = await import('../src/claude.js');
let fails = 0;
const ok = (name, cond, extra='') => { if (cond) console.log('  ok  ' + name); else { fails++; console.log('  FAIL ' + name + ' ' + extra); } };

// 1. No key -> stands down quietly, never throws.
let r = await C.writeSpecifics([{ threadId: '1', title: 't', snippet: 's' }]);
ok('no key: empty + note', Object.keys(r.specifics).length === 0 && /no Claude key/.test(r.note));

// 2. A bad key is rejected before it is stored.
await C.saveKey('nope').then(() => ok('rejects non sk-ant key', false), (e) => ok('rejects non sk-ant key', /sk-ant/.test(e.message)));
ok('bad key not stored', !(await C.revealKey()));

// 3. A good key is validated against the API then stored.
await C.saveKey('sk-ant-api03-ABCDEFGHIJKLMNOP');
ok('key stored in the vault', (await C.revealKey()) === 'sk-ant-api03-ABCDEFGHIJKLMNOP');
ok('validated via /v1/models', /\/v1\/models/.test(lastReq.url));
let st = await C.aiStatus();
ok('hint masks the key', st.hint === 'sk-ant-api0…MNOP', st.hint);

// 4. A real batch.
r = await C.writeSpecifics([
  { threadId: '111', title: 'Local Citation Services - Dubai & UK', snippet: 'need citations', category: 'seo' },
  { threadId: '222', title: 'x', snippet: 'y', category: 'seo' }
]);
ok('parses JSON out of prose + fence', r.specifics['111']?.tips?.length === 3, JSON.stringify(r.specifics['111']));
ok('keeps the public question', /tier 2 layer\?$/.test(r.specifics['111'].question), r.specifics['111'].question);
ok('keeps the chosen offer', r.specifics['111'].offer === 'formula');
ok('drops bullets under 16 chars', !('222' in r.specifics));

const body = JSON.parse(lastReq.opts.body);
ok('browser header sent', lastReq.opts.headers['anthropic-dangerous-direct-browser-access'] === 'true');
ok('api version sent', lastReq.opts.headers['anthropic-version'] === '2023-06-01');
ok('system prefix is cached', body.system[0].cache_control.type === 'ephemeral');
ok('effort low', body.output_config.effort === 'low');
ok('max_tokens scales with batch', body.max_tokens === 130 * 2 + 60, body.max_tokens);
ok('snippet is capped', body.messages[0].content.length < 1500);

// 5. Usage and cost.
st = await C.aiStatus();
ok('calls counted', st.callsToday === 1 && st.leadsToday === 2);
// sonnet default: 900/1e6*2 + 400/1e6*0.2 + 120/1e6*10 = 0.0018+0.00008+0.0012
// sonnet: 900/1e6*2 + 400/1e6*(2*0.1) + 120/1e6*10 = 0.00308, shown rounded to 4dp
ok('cost priced with cache discount', Math.abs(C.spendOf({ in: 900, cached: 400, out: 120 }, 'claude-sonnet-5') - 0.00308) < 1e-9);
ok('spendToday rounded for display', st.spentToday === 0.0031, st.spentToday);
ok('per-lead shown', st.perLead > 0);

// 6. Batch cap.
await C.writeSpecifics(Array.from({ length: 20 }, (_, i) => ({ threadId: String(i), title: 't', snippet: 's' })));
ok('never more than 8 leads per call', JSON.parse(lastReq.opts.body).messages[0].content.split('---').length === 8);

// 7. The daily limit stands Claude down instead of spending.
await C.setBudget(0.0001);
const before = lastReq;
r = await C.writeSpecifics([{ threadId: '9', title: 't', snippet: 's' }]);
ok('over budget: no call made', lastReq === before);
ok('over budget: says why', /daily limit/.test(r.note), r.note);

// 8. API errors never throw at the caller.
await C.setBudget(5);
reply = { ok: false, status: 401, json: async () => ({ error: { message: 'invalid x-api-key' } }) };
r = await C.writeSpecifics([{ threadId: '9', title: 't', snippet: 's' }]);
ok('401 handled', Object.keys(r.specifics).length === 0 && /rejected the key/.test(r.note));
globalThis.fetch = async () => { throw new Error('network down'); };
r = await C.writeSpecifics([{ threadId: '9', title: 't', snippet: 's' }]);
ok('network failure handled', /could not reach/.test(r.note));

// 9. The prompt's rules are enforced on the way out.
const cleaned = C.clean({ a: { tips: [
  '— leading dash and an em—dash inside the line here',
  'We guarantee first page rankings within thirty days',
  '• bullet glyph opener that is quite long indeed',
  'We will do the first one for free so you can judge it'
], question: 'Which route do you want, audit-safe or volume', offer: 'terms' } }).a.tips;
ok('em/en dashes stripped', !/[–—]/.test(cleaned.join('')), JSON.stringify(cleaned));
ok('bullet glyph stripped', !/•/.test(cleaned.join('')));
ok('guarantees dropped', !cleaned.some((b) => /guarantee/i.test(b)));
ok('offers of free work dropped', !cleaned.some((b) => /\bfree\b/i.test(b)), JSON.stringify(cleaned));
ok('a bogus offer id is discarded', C.clean({ a: { tips: ['a long enough line to survive the filter'], offer: 'nope' } }).a.offer === '');
ok('a question is given its question mark', C.clean({ a: { tips: ['a long enough line to survive the filter'], question: 'Audit-safe or volume for a tier 2 layer' } }).a.question.endsWith('?'));
ok('cap of 3 bullets', C.clean({ a: { tips: Array(9).fill('a long enough bullet line to survive') } }).a.tips.length === 3);
ok('the old bare-array shape still parses', C.clean({ a: ['a long enough bullet line to survive'] }).a.tips.length === 1);

// 10. Clearing forgets the key.
await C.clearKey();
ok('key cleared', !(await C.aiStatus()).configured);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
