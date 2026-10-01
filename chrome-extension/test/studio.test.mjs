// Thread Studio (1.12.0): niche keywords, discussion-only picking, the rule
// check and the plan parser. The page and the background runner sit on top.
import { nicheRegex, pickThreads, ruleCheck, plainBody, parseStudio, studioPrompt, STUDIO_SECTIONS, STUDIO_SYSTEM } from '../src/studio.js';

let fails = 0;
const ok = (n, c, e) => { if (!c) fails++; console.log(`${c ? '  ok' : 'FAIL'}  ${n}${c || e === undefined ? '' : `  -> ${JSON.stringify(e).slice(0, 300)}`}`); };

// --- the niche pulls in the words people actually use ----------------------------
const casino = nicheRegex('casino');
ok('casino also catches gambling, igaming, betting', ['Gambling advertising on Facebook', 'iGaming Facebook Ads in Malaysia', 'Best sportsbook traffic'].every((t) => casino.test(t)));
ok('and not unrelated threads', !casino.test('How to stop Facebook ads from getting limited reach?'));
const crypto = nicheRegex('crypto ads');
ok('crypto catches token and web3', crypto.test('Launching a token on MEXC') && crypto.test('Web3 project marketing'));
ok('an unknown niche uses its own words', nicheRegex('roofing leads').test('Need roofing leads in Texas'));
ok('an empty niche gives nothing', nicheRegex('  ') === null);

// --- discussion sections only ------------------------------------------------------
ok('no commercial section is ever read', !STUDIO_SECTIONS.some((s) => /hire-a-freelancer|want-to-buy|marketplace|link-building|seo-packages/.test(s.url)));

// --- picking: recent by start date, viral from the all-time list, no sales threads ---
const now = Date.parse('2026-10-01T00:00:00Z');
const d = (daysAgo) => new Date(now - daysAgo * 86400000).toISOString();
const rows = [
  { threadId: '1', title: 'Is it possible to run casino ads on Google?', startedAt: d(10), replyCount: 17 },
  { threadId: '2', title: 'Gambling advertising !!!!', startedAt: d(50), replyCount: 32 },
  { threadId: '3', title: 'How to run GAMBLING offers on Facebook A-Z', startedAt: d(1400), replyCount: 198 },
  { threadId: '4', title: 'Cheap casino guest posts $5', startedAt: d(5), replyCount: 3 },
  { threadId: '5', title: 'Casino SEO services for hire', startedAt: d(5), replyCount: 9 },
  { threadId: '1', title: 'Is it possible to run casino ads on Google?', startedAt: d(10), replyCount: 17 },
  { threadId: '6', title: 'Best proxies for scraping', startedAt: d(3), replyCount: 40 }
];
const p = pickThreads(rows, casino, { days: 90, now });
ok('recent = on-niche threads inside the window, most replies first', p.recent.map((r) => r.threadId).join() === '2,1', p.recent.map((r) => r.threadId));
ok('older ones become the viral list', p.viral.map((r) => r.threadId).join() === '3');
ok('sales threads ($, services, cheap) are left out', !p.recent.some((r) => ['4', '5'].includes(r.threadId)));
ok('each thread counted once', p.recent.filter((r) => r.threadId === '1').length === 1);

// --- the prompt carries the rules and stays small ------------------------------------
ok('the rules are in the system prompt', /3\.15/.test(STUDIO_SYSTEM) && /3\.12/.test(STUDIO_SYSTEM) && /no cloaking instructions/i.test(STUDIO_SYSTEM));
const prompt = studioPrompt({ niche: 'casino', service: 'We run casino ads.', recent: p.recent, viral: p.viral, ops: [{ title: 't', body: 'x'.repeat(5000) }] });
ok('opening posts are trimmed', prompt.length < 3000, prompt.length);

// --- the rule check ------------------------------------------------------------------
const clean = 'Has this happened to you?\n\n1. Check the domain.\n\nWhat do you check first?';
ok('a clean body passes every check', ruleCheck(clean).every((c) => c.pass), ruleCheck(clean));
const bad = 'Great results. DM me for the list at https://t.me/x, only $49, giveaway for the first 10 people. A real game changer.';
const failed = ruleCheck(bad).filter((c) => !c.pass).map((c) => c.rule);
ok('links, DM me, prices, giveaways, hype and no question are all caught', ['3.15', '3.6 / 3.12', '3.6', '3.9', 'Tone', 'Form'].every((r) => failed.includes(r)), failed);

// --- the plan parser -----------------------------------------------------------------
const mk = (n) => ({ week: Math.floor(n / 2) + 1, type: ['Question', 'Quick tip', 'Either/or', 'Story'][n % 4], section: 'Google Ads', title: `Thread ${n} — title`,
  body: ['Has this happened to you?', ['Point one', 'Point two – detail'], 'Quick check today.'], question: 'Which one worked for you?',
  basedOn: ['Gambling advertising !!!!'], replies: [{ who: 'm1', text: 'hi' }, { you: true, text: 'Good point. Which GEO?' }] });
const plan = parseStudio('Here you go: ' + JSON.stringify({ pains: [{ pain: 'Ads rejected', threads: 5, replies: 67, fit: 'strong', evidence: ['gambling advertising'] }], threads: [0, 1, 2, 3, 4, 5, 6, 7].map(mk) }) + ' done');
ok('8 threads come back, in 4 weeks', plan.threads.length === 8 && plan.threads.every((t) => t.week >= 1 && t.week <= 4));
ok('dashes are taken out of titles and bodies', !/[—–]/.test(JSON.stringify(plan.threads)));
ok('each thread carries its rule check', plan.threads.every((t) => Array.isArray(t.checks) && t.checks.every((c) => c.pass)), plan.threads[0].checks);
ok('the copied body ends with the question', /Which one worked for you\?$/.test(plainBody(plan.threads[0])));
let err = '';
try { parseStudio('{"threads":[1,2]}'); } catch (e) { err = e.message; }
ok('a short or broken answer is an error, never half a plan', /too few|malformed|did not return/.test(err), err);

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
