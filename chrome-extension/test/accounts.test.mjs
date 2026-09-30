// Two PCs, two BHW accounts (1.11.0).
//
// "If I am running from 2 PCs for 2 different accounts how can I tie up the
// account in settings? And it must run only one instance for one account."
//
// Each machine has its own chrome.storage.local; both Chromes are signed in to
// the same Google account, so they share chrome.storage.sync. Each account has
// its own Telegram bot, whose short description holds that bot's lock.
const machines = { mac: {}, win: {}, linux: {} };
let here = 'mac';
const sync = {};
const bots = {};                              // token -> short description
const TOKEN_A = '111:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TOKEN_B = '222:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const TOKEN_C = '333:CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const area = (bag) => ({
  get: async (k) => {
    const b = bag();
    if (k == null) return copy(b);
    const o = {}; for (const x of [].concat(k)) if (x in b) o[x] = copy(b[x]); return o;
  },
  set: async (o) => { const b = bag(); for (const [k, v] of Object.entries(o)) b[k] = copy(v); },
  remove: async (k) => { const b = bag(); for (const x of [].concat(k)) delete b[x]; }
});
globalThis.chrome = {
  storage: { local: area(() => machines[here]), sync: area(() => sync) },
  runtime: { getPlatformInfo: async () => ({ os: here }) }
};
globalThis.fetch = async (url, opts) => {
  const m = String(url).match(/bot([^/]+)\/(\w+)$/);
  const token = m?.[1], method = m?.[2];
  const body = JSON.parse(opts?.body || '{}');
  if (method === 'getMyShortDescription') return { ok: true, status: 200, json: async () => ({ ok: true, result: { short_description: bots[token] || '' } }) };
  if (method === 'setMyShortDescription') { bots[token] = body.short_description; return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) }; }
  return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) };
};

const owner = await import('../src/owner.js');
const vault = await import('../src/vault.js');
const claude = await import('../src/claude.js');
const backup = await import('../src/backup.js');
const { parseLock, lockText, decide, decideAccount, ownership, takeOver, describe, loginProblem, TTL_MS, REGISTRY } = owner;

let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + '  ' + (typeof e === 'string' ? e : JSON.stringify(e))); } };
const on = async (name, { acct, token } = {}) => {
  here = name;
  const L = machines[name];
  L.instanceId = L.instanceId || `${name}id01`;
  if (acct !== undefined) L.config = { ...(L.config || {}), boundAccount: acct };
  if (token) await vault.setSecret('telegram', token);
  delete L.ownerState;
};

// --- the rules, pure ------------------------------------------------------------
const now = Date.now();
const lk = parseLock(lockText('abc', 'win', 5, true, true, 'Sunny SEO'));
ok('a lock carries the account, spaces and all', lk.acct === 'Sunny SEO' && lk.pin && lk.auto === true, lk);
ok('an old lock without an account still reads', parseLock('HAF owner=abc os=mac at=5 pin=1 auto=1').acct === '');
ok('a bot tied to another account is never taken, even abandoned',
  decide({ id: 'x', at: now - TTL_MS * 10, acct: 'alpha' }, 'me', now, 'beta') === 'other-account');
ok('the same account, any case, follows the usual rules',
  decide({ id: 'x', at: now - TTL_MS - 1, acct: 'Alpha' }, 'me', now, 'alpha') === 'take');
ok('an untied copy is not stopped by the account', decide({ id: 'x', at: now, acct: 'alpha' }, 'me', now, '') === 'theirs');
ok('registry: pinned by another is theirs', decideAccount({ id: 'x', at: 0, pin: true }, 'me', now) === 'theirs');
ok('registry: abandoned is free', decideAccount({ id: 'x', at: now - TTL_MS - 1 }, 'me', now) === 'take');
ok('login: tied and signed in as someone else is a stop', /signed in to BHW as "beta"/.test(loginProblem('alpha', 'beta')));
ok('login: same name in another case is fine', loginProblem('Alpha', 'alpha') === '');
ok('login: not tied, or not known yet, is not a stop', loginProblem('', 'beta') === '' && loginProblem('alpha', '') === '');

// --- two PCs, two accounts, two bots: both run -----------------------------------
await on('mac', { acct: 'alpha', token: TOKEN_A });
let mac = await ownership({ fresh: true });
await on('win', { acct: 'beta', token: TOKEN_B });
let win = await ownership({ fresh: true });
ok('the MacBook runs account alpha', mac.active === true, mac);
ok('the Windows server runs account beta at the same time', win.active === true, win);
ok('each bot is stamped with its own account', /acct=alpha/.test(bots[TOKEN_A]) && /acct=beta/.test(bots[TOKEN_B]), bots);
ok('each account is recorded once in the shared registry', sync[REGISTRY]?.alpha?.id === 'macid01' && sync[REGISTRY]?.beta?.id === 'winid01', sync[REGISTRY]);

// --- keys: one Google account, two bots, never swapped ---------------------------
here = 'mac';
ok('the MacBook still has bot A after the server saved bot B', (await vault.getSecret('telegram')) === TOKEN_A);
here = 'win';
ok('and the server still has bot B', (await vault.getSecret('telegram')) === TOKEN_B);
ok('each account keeps its own synced slot', sync['vault@alpha']?.tgToken === TOKEN_A && sync['vault@beta']?.tgToken === TOKEN_B, Object.keys(sync));
await vault.setSecret('anthropic', 'sk-ant-shared-key-0001');
sync.vault = { key: 'sk-ant-shared-key-0001', tgToken: TOKEN_A, savedAt: Date.now() };   // an untied copy's plain mirror
machines.linux = { config: { boundAccount: 'gamma' } };                                   // a fresh install, tied, empty
here = 'linux';
ok('a fresh copy of a new account takes the Claude key from sync', (await vault.getSecret('anthropic')) === 'sk-ant-shared-key-0001');
ok('but never another account\'s bot token', !(await vault.getSecret('telegram')));

// --- the wrong bot on a PC: refuses, says why ------------------------------------
await on('win', { acct: 'beta', token: TOKEN_A });           // beta's PC given alpha's bot by mistake
win = await ownership({ fresh: true });
ok('a copy of beta on alpha\'s bot stands by', win.active === false && win.wrongAccount === true, win);
ok('and leaves alpha\'s lock alone', /owner=macid01/.test(bots[TOKEN_A]) && /acct=alpha/.test(bots[TOKEN_A]), bots[TOKEN_A]);
ok('and says it needs its own bot', /belongs to BHW account "alpha"/.test(describe({ ...win, myAccount: 'beta' })) && /own bot/.test(describe({ ...win, myAccount: 'beta' })), describe(win));
let err = '';
try { await takeOver(); } catch (e) { err = e.message; }
ok('"Keep THIS as main" refuses to take another account\'s bot', /belongs to BHW account "alpha"/.test(err) && /@BotFather/.test(err), err);
ok('and the lock is still alpha\'s', /owner=macid01/.test(bots[TOKEN_A]));
await on('win', { acct: 'beta', token: TOKEN_B });           // put it right
win = await ownership({ fresh: true });
ok('with its own bot back, beta runs again', win.active === true, win);

// --- the same account on two PCs: only one runs ----------------------------------
await on('linux', { acct: 'alpha', token: TOKEN_C });         // alpha again, on a third bot
let lin = await ownership({ fresh: true });
ok('a second copy of alpha stands by, even on another bot', lin.active === false && lin.accountElsewhere === true, lin);
ok('and names where alpha runs', /"alpha" already runs on the MacBook/.test(describe(lin)) && /one copy per account/.test(describe(lin)), describe(lin));
const took = await takeOver();
ok('"Keep THIS as main" moves alpha to it', took.active === true && sync[REGISTRY].alpha.id === 'linuxid01' && sync[REGISTRY].alpha.pin, sync[REGISTRY].alpha);
await on('mac');
mac = await ownership({ fresh: true });
ok('and the MacBook copy of alpha goes on standby', mac.active === false && mac.owner?.id === 'linuxid01', mac);
// One account, one bot: the newest bot saved for alpha reaches every alpha copy.
ok('every copy of alpha ends up on alpha\'s newest bot', (await vault.getSecret('telegram')) === TOKEN_C);
await on('win');
win = await ownership({ fresh: true });
ok('beta is untouched by all of it', win.active === true, win);

// --- an untied copy behaves exactly as before ------------------------------------
machines.solo = { instanceId: 'soloid01' };
here = 'solo';
await vault.setSecret('telegram', '444:DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD');
const solo = await ownership({ fresh: true });
ok('not tied: runs, no account on the lock', solo.active === true && !/acct=/.test(bots['444:DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD']), bots['444:DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD']);

// --- the Claude prompt: yours to change, the safety part always there -------------
const base = claude.systemFor('', '');
ok('empty = the built-in prompt, both parts', base.startsWith(claude.DEFAULT_WRITING) && base.includes(claude.LOCKED_PROMPT));
const mine = claude.systemFor('', '', 'You write short first-person lines for {{account}}. Start each with "I".', 'beta');
ok('your own prompt replaces the writing part', mine.startsWith('You write short first-person lines for beta.') && !mine.includes('READ THE POST, NOT THE TITLE'), mine.slice(0, 120));
ok('{{account}} becomes the tied account', mine.includes('for beta.') && !mine.includes('{{account}}'));
ok('the screen verdict and JSON shape are always added', mine.includes('"pm":"yes"') && mine.includes('Return ONLY a JSON object'));
ok('and the valid offer ids are named', /one of: pilot, ready, formula, terms/.test(mine));
ok('the operator\'s screen rules still go in', claude.systemFor('', 'never PM crypto buyers', 'Write briefly.', 'beta').includes('never PM crypto buyers'));
{ const long = claude.systemFor('', '', 'x'.repeat(claude.MAX_WRITING + 500));
  ok('a prompt too long is cut, not sent whole', long.includes('x'.repeat(claude.MAX_WRITING)) && !long.includes('x'.repeat(claude.MAX_WRITING + 1))); }

// --- three angles: every rule kept, only the lead changes ------------------------
ok('there are at least 3 angles', claude.ANGLES.length >= 3);
ok('each angle is the full built-in rules plus its own paragraph',
  claude.ANGLES.every((a) => a.text.startsWith(claude.DEFAULT_WRITING) && /ANGLE FOR THIS ACCOUNT/.test(a.text)));
ok('each angle is different', new Set(claude.ANGLES.map((a) => a.text)).size === claude.ANGLES.length);
ok('each still gets the locked screen + JSON', claude.ANGLES.every((a) => claude.systemFor('', '', a.text, 'x').includes(claude.LOCKED_PROMPT)));
ok('no angle loosens a rule (no free work, no prices, no guarantees)',
  claude.ANGLES.every((a) => !/free (trial|sample|audit)|you may (offer|promise)|ignore the rules/i.test(a.text.slice(claude.DEFAULT_WRITING.length))));
ok('the rule check passes clean lines', claude.checkLines(['We build UK citations by hand.', 'We verify GMB for US brands.', 'We send live links for each.']).length === 0);
{ const p = claude.checkLines(['we do it', 'We do it \u2014 fast', 'We offer a free sample of our guaranteed work that is really very long indeed, much more than a hundred characters long']);
  ok('and flags each broken rule', p.some((x) => /line 1 does not start/.test(x)) && p.some((x) => /line 2 has a dash/.test(x))
     && p.some((x) => /line 3 offers free/.test(x)) && p.some((x) => /line 3 is \d+ characters/.test(x)) && p.some((x) => /guarantee/.test(x)), p); }

// --- PM formats: a different skeleton per account, same method, same rules ---------
{
  const { renderDm, DM_STYLES, dmStyleList } = await import('../src/templates.js');
  const { DEFAULT_CONFIG } = await import('../src/config.js');
  const { lintDraft } = await import('../src/compliance.js');
  const tips = ['We have run local citation builds for UK agencies at volume.', 'We can verify GMB listings for US and UK locations.', 'We deliver a sheet of every live citation with its URL.'];
  const ids = Object.keys(DM_STYLES);
  ok('at least 3 formats besides your own', ids.length >= 3 && dmStyleList()[0].id === '');
  ok('each angle comes with its own format', new Set(claude.ANGLES.map((a) => a.format)).size === claude.ANGLES.length && claude.ANGLES.every((a) => ids.includes(a.format)));
  const bad = [];
  const firsts = {};
  for (const st of ['', ...ids]) {
    for (let n = 0; n < 40; n++) {
      for (const offer of ['pilot', 'ready', 'formula', 'terms']) {
        for (const category of ['seo', 'ads', 'generic']) {
          const lead = { threadId: String(1850000 + n), author: `buyer${n}`, url: `https://www.blackhatworld.com/seo/t.${1850000 + n}/`, category, aiSpecifics: { tips, offer } };
          const dm = renderDm(lead, { ...DEFAULT_CONFIG, dmStyle: st });
          const lint = lintDraft(dm, DEFAULT_CONFIG.compliance);
          const why = [];
          if (!dm.includes(lead.url)) why.push('no thread link');
          if (!dm.includes(lead.author)) why.push('no name');
          if (!tips.every((t) => dm.includes(t.replace(/\.$/, '').replace(/^We can /, 'We can').slice(10, 40)))) why.push('lines missing');
          if (offer !== 'terms' && !/upfront/i.test(dm)) why.push('no upfront line');
          if (!/reply/i.test(dm)) why.push('no reply ask');
          if (!lint.ok || lint.warnings.length) why.push(...lint.errors, ...lint.warnings);
          if (/\{\{|\}\}|\{[^}]*\|/.test(dm)) why.push('unfilled template');
          if (/\bfree\b|guarantee|\$\d/i.test(dm)) why.push('free / guarantee / price');
          if (st && /\(https?:/.test(dm)) why.push('link in brackets');
          if (st && /squarely|in our lane|won or lost|delve|seamless|leverage|tailored|\bhappy\b[^.]*\bhappy\b/i.test(dm)) why.push('reads machine-written');
          if (why.length) bad.push(`${st || 'classic'} ${offer} ${category} #${n}: ${why.join(', ')}`);
          if (n === 0 && offer === 'pilot' && category === 'seo') firsts[st || 'classic'] = dm;
        }
      }
    }
  }
  ok('every format, every close, every service: link, name, 3 lines, upfront line, reply ask, rules clean', !bad.length, bad.slice(0, 4));
  const shapes = Object.values(firsts).map((d) => d.split('\n')[0].replace(/buyer0/, '') + '|' + d.split('\n').slice(-1)[0] + '|' + (d.match(/^(\d\.|- |Step \d)/m) || ['prose'])[0]);
  ok('the formats open, lay out and sign off differently', new Set(shapes).size === shapes.length, shapes);
  ok('the paragraph format has no heading and no list', !/Why We Can Do It|^\s*(\d\.|- |Step)/m.test(firsts.paragraph), firsts.paragraph);
  ok('the paragraph reads on - "We also" rather than three "We" openers', /We (can |have )?also /.test(firsts.paragraph), firsts.paragraph);
}

// --- a new PC restoring settings from sync never takes the other account's name ---
here = 'fresh';
machines.fresh = {};
const { pushConfig } = backup;
here = 'mac';
await pushConfig({ boundAccount: 'alpha', bhwUsername: 'alpha', claudeWriting: 'alpha voice', telegramChatId: '123', timezone: 'Asia/Kolkata', pollMinutes: 6 });
here = 'fresh';
const r = await backup.restoreIfEmpty();
const cfgNow = machines.fresh.config || {};
ok('a fresh install restores the settings', r.restored === true && cfgNow.telegramChatId === '123', { r, cfgNow: Object.keys(cfgNow).length });
ok('but not the other PC\'s account, username or prompt', !cfgNow.boundAccount && !cfgNow.bhwUsername && !cfgNow.claudeWriting, { b: cfgNow.boundAccount, u: cfgNow.bhwUsername, w: cfgNow.claudeWriting });
machines.fresh.config = { ...cfgNow, boundAccount: 'beta', telegramChatId: '' };
const filled = await backup.fillEssentials();
ok('the chat id is still refilled', filled.includes('telegramChatId') && machines.fresh.config.telegramChatId === '123', filled);
ok('the username is not', !machines.fresh.config.bhwUsername, machines.fresh.config.bhwUsername);

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
