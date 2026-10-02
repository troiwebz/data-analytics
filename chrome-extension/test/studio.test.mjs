// Thread Studio (1.12.0): niche keywords, discussion-only picking, the rule
// check and the plan parser. The page and the background runner sit on top.
import { nicheRegex, pickThreads, ruleCheck, plainBody, parseStudio, studioPrompt, addPlan, STUDIO_SECTIONS, STUDIO_SYSTEM } from '../src/studio.js';

let fails = 0;
const ok = (n, c, e) => { if (!c) fails++; console.log(`${c ? '  ok' : 'FAIL'}  ${n}${c || e === undefined ? '' : `  -> ${JSON.stringify(e).slice(0, 300)}`}`); };

// --- the niche pulls in the words people actually use ----------------------------
const casino = nicheRegex('casino');
ok('casino also catches gambling, igaming, betting', ['Gambling advertising on Facebook', 'iGaming Facebook Ads in Malaysia', 'Best sportsbook traffic'].every((t) => casino.test(t)));
ok('and not unrelated threads', !casino.test('How to stop Facebook ads from getting limited reach?'));
const crypto = nicheRegex('crypto ads');
ok('crypto catches web3 and memecoin', crypto.test('Web3 project marketing') && crypto.test('The memecoin boom'));
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

// --- GROW 1.12.1: "bet" matched "better", "token" matched Facebook's System User Tokens -----
ok('"bet" never matches "better" (root cause: no closing word boundary)', !nicheRegex('casino').test('Which Is Better for a Website: Auto Ads or Manual Ads?') && !nicheRegex('casino').test('Are original Reels getting better reach now?'));
ok('crypto does not catch Facebook System User Tokens', !nicheRegex('crypto').test('working with BMs via System User Tokens'));

// --- GROW 1.12.1: a cut-off Claude answer is repaired, not thrown away -----------------
const full = JSON.stringify({ pains: [{ pain: 'x', threads: 1, replies: 2, fit: 'strong', evidence: [] }], threads: [0, 1, 2, 3, 4].map(mk) });
const cut = full.slice(0, Math.floor(full.length * 0.93));
let repaired = null; try { repaired = parseStudio(cut); } catch (e) { repaired = e.message; }
ok('an answer cut off near the end still yields the complete threads (root cause: 9k token cap, strict JSON.parse)', repaired && repaired.threads && repaired.threads.length >= 4, typeof repaired === 'string' ? repaired : repaired.threads.length);

// --- the BHW search reader, on a search results page as XenForo renders it -----------------
{
  const { JSDOM } = await import('jsdom');
  const row = (id, title, forum, replies, ts, snippet, kind = 'Thread') => `<li class="block-row"><div class="contentRow"><div class="contentRow-main">
    <h3 class="contentRow-title"><a href="/seo/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${id}/unread">${title}</a></h3>
    <div class="contentRow-snippet">${snippet}</div>
    <div class="contentRow-minor contentRow-minor--hideLinks"><ul class="listInline listInline--bullet"><li><a href="/members/u.9/" class="username">someone</a></li><li>${kind}</li><li><time data-timestamp="${ts}"></time></li><li>Replies: ${replies}</li><li>Forum: ${forum}</li></ul></div></div></div></li>`;
  const html = `<html data-logged-in="true"><body><ol>${row(1850834, 'GMB services Require for US Uk', 'Hire a Freelancer', 64, 1790000000, 'I can handle US and UK Google Business Profile')}
    ${row(1839358, 'gambling advertising !!!!', 'FaceBook', 32, 1789000000, 'Is there a way to advertise in the gambling niche without getting rejected?')}
    ${row(39136, '$5 Casino Guest Posts', 'Marketplace', 0, 1788000000, 'offer', 'Media item')}</ol><a class="pageNav-jump pageNav-jump--next" href="#">Next</a></body></html>`;
  const dom = new JSDOM(html, { url: 'https://www.blackhatworld.com/search/12/?q=casino' });
  globalThis.document = dom.window.document; globalThis.location = dom.window.location; globalThis.URL = dom.window.URL;
  const { extractSearch } = await import('../src/browse.js');
  const r = extractSearch();
  ok('search rows are read: title, forum, replies, date, snippet', r.rows.length === 2 && r.rows[1].forum === 'FaceBook' && r.rows[1].replyCount === 32 && /rejected/.test(r.rows[1].snippet) && r.rows[1].startedAt.startsWith('2026'), r.rows);
  ok('the link is the thread itself, never /unread', r.rows[0].url === 'https://www.blackhatworld.com/seo/gmb-services-require-for-us-uk.1850834/' && r.rows[0].threadId === '1850834', r.rows[0].url);
  ok('media and non-thread results are skipped, signed-in and next-page flags set', r.loggedIn === true && r.next === true);
  delete globalThis.document; delete globalThis.location;
}

// --- 1.12.2: every run is its own saved plan -----------------------------------------------
{
  const res = (niche, at) => ({ niche, service: 'Advauult, competitor ads tool', at, threads: [{ id: 1 }], pains: [] });
  let a = addPlan({}, res('crypto', '2026-10-01T10:00:00Z'), { name: 'Advauult crypto October', now: 1 });
  ok('a plan is saved with the name, niche and service text given', a.plans[a.id].name === 'Advauult crypto October' && a.plans[a.id].niche === 'crypto' && /Advauult/.test(a.plans[a.id].service));
  let b = addPlan(a.plans, res('crypto', '2026-10-02T10:00:00Z'), { now: 2 });
  ok('a second run for the same niche does not replace the first', Object.keys(b.plans).length === 2 && !!b.plans[a.id] && b.id !== a.id, Object.keys(b.plans));
  ok('with no name given it is called niche + date', b.plans[b.id].name === 'crypto · 2026-10-02', b.plans[b.id].name);
  const old = addPlan({ casino: res('casino', '2026-09-30T10:00:00Z') }, res('nutra', '2026-10-03T10:00:00Z'), { now: 3 });
  ok('plans saved by the older version (keyed by niche, no id) are kept and get a name', Object.values(old.plans).some((p) => p.niche === 'casino' && p.id && p.name === 'casino · 2026-09-30'), Object.values(old.plans).map((p) => p.name));
  let many = {}; for (let i = 0; i < 70; i++) many = addPlan(many, res('n' + i, new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString()), { now: 100 + i }).plans;
  ok('the list is capped at 60, oldest dropped', Object.keys(many).length === 60 && !Object.values(many).some((p) => p.niche === 'n0') && Object.values(many).some((p) => p.niche === 'n69'));
}

// --- 1.12.2: the closing question is not repeated in the last paragraph ---------------------
{
  const t = { week: 1, type: 'Quick tip', section: 'CryptoCurrency', title: 'Tip', body: ['Got a faucet live?', ['One', 'Two'], 'Pick one offer today. How many offerwall providers are you running right now?'], question: 'How many offerwall providers are you running right now?', replies: [] };
  const pl = parseStudio(JSON.stringify({ pains: [], threads: [t, t, t, t] }));
  const body = plainBody(pl.threads[0]);
  ok('the question appears once, as the last line', body.split('How many offerwall providers').length === 2 && /right now\?$/.test(body), body);
  ok('and the rest of that paragraph is kept', /Pick one offer today\./.test(body));
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
