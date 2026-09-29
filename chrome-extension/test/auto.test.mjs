// Auto mode: the PRIVATE MESSAGE sends itself, 1-3 minutes after a new Hire a
// Freelancer thread is found. Never a public reply, only threads found after
// it was switched on, and only when Claude's screen said yes.
import { blockedReason, postAt, dueNow, pending } from '../src/auto.js';

let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + '  ' + e); } };

const since = new Date(Date.now() - 3600000).toISOString();
const cfg = { autoMode: true, autoModeMinScore: 0, autoModeSince: since };

const good = { threadId: '1', title: 'Need a Google Ads manager', author: 'buyer1', status: 'SENT', score: 5, category: 'ads',
               dm: 'Hi buyer,\n\nlines\n\nThanks', draft: 'A public reply.',
               foundAt: new Date().toISOString(),
               body: 'The buyer wrote this, and it was actually read.',
               aiSpecifics: { tips: ['We have done this'], pm: 'yes', why: 'asks for an ads manager' },
               dmLint: { ok: true }, lint: { ok: true } };
const why = (over, c = cfg) => blockedReason({ ...good, ...over }, c);

// --- what may send by itself --------------------------------------------
ok('a screened, fresh HAF lead may send its PM', why({}) === null, why({}));
ok('a public reply already posted by hand does not stop the PM', why({ status: 'POSTED' }) === null, why({ status: 'POSTED' }));

// --- private message only, HAF only -------------------------------------
ok('a thread from the other sources is never auto-messaged', /public reply only/.test(why({ kind: 'thread' }) || ''), why({ kind: 'thread' }));
ok('a PM already sent is not sent again', /already sent/.test(why({ pmSent: true }) || ''));
ok('no PM text, nothing to send', /no PM drafted/.test(why({ dm: '', dmApproved: '' }) || ''));
ok('the text you approved counts as the PM', why({ dm: '', dmApproved: 'Approved text' }) === null);
ok('no author, nobody to message', /no author/.test(why({ author: '' }) || ''));

// --- only after switch-on ------------------------------------------------
ok('a lead found before auto mode was switched on is left alone',
   /before auto mode/.test(why({ foundAt: new Date(Date.now() - 7200000).toISOString() }) || ''));
ok('with no switch-on time recorded, age is not a reason', why({ foundAt: '2020-01-01T00:00:00Z' }, { autoMode: true }) === null);

// --- the Claude screen ----------------------------------------------------
ok('a post that was never read cannot have been screened', /never read/.test(why({ body: '' }) || ''), why({ body: '' }));
ok('and no score can buy its way past that', why({ body: '', score: 999 }) !== null);
ok('no Claude lines means no screen', /did not screen/.test(why({ aiSpecifics: null }) || ''), why({ aiSpecifics: null }));
ok('and it says why Claude was absent', /no Claude key set/.test(why({ aiSpecifics: null, draftedByNote: 'no Claude key set' }) || ''));
ok('Claude saying no is final', /screened it out/.test(why({ aiSpecifics: { tips: ['x'], pm: 'no', why: 'a seller advertising' } }) || ''));
ok('and the reason is shown', /a seller advertising/.test(why({ aiSpecifics: { tips: ['x'], pm: 'no', why: 'a seller advertising' } }) || ''));
ok('lines without a verdict do not send', /no verdict/.test(why({ aiSpecifics: { tips: ['x'] } }) || ''), why({ aiSpecifics: { tips: ['x'] } }));
ok('"maybe" is not a yes', /no verdict/.test(why({ aiSpecifics: { tips: ['x'], pm: 'maybe' } }) || ''));

// --- the other gates ------------------------------------------------------
ok('a failed compliance check on the PM is refused', /compliance/.test(why({ dmLint: { ok: false, errors: ['banned phrase'] } }) || ''));
ok('and it says which phrase', /banned phrase/.test(why({ dmLint: { ok: false, errors: ['banned phrase'] } }) || ''));
ok('a buyer you have messaged before waits for you', /messaged buyer1 before/.test(why({ priorContact: '2026-09-01' }) || ''));
ok('a possible duplicate waits for you', /duplicate/.test(why({ pmMaybe: 'same subject' }) || ''));
ok('below the score bar it waits for you', /below your auto-mode bar/.test(why({ score: 1 }, { ...cfg, autoModeMinScore: 4 }) || ''));
for (const status of ['SKIPPED', 'FAILED', 'EXPIRED', 'BACKFILL']) {
  ok(`a lead already ${status.toLowerCase()} is not messaged`, !!why({ status }));
}

// --- what auto mode will not message ---------------------------------------
{
  const { DEFAULT_CONFIG } = await import('../src/config.js');
  const full = { ...cfg, autoSkipPhrases: DEFAULT_CONFIG.autoSkipPhrases, autoRequireMatch: true };
  const post = (body, title) => why({ body, ...(title ? { title } : {}) }, full);
  ok('a thread matching none of your services waits for you', /does not match any of your services/.test(why({ category: '' }, full) || ''), why({ category: '' }, full));
  ok('unless you switch that rule off', why({ category: '' }, { ...full, autoRequireMatch: false }) === null);
  for (const [text, label] of [
    ['I will make the payment after posting is live.', 'payment after posting'],
    ['Payment only after delivery of the work.', 'payment after delivery'],
    ['You get paid once the campaign is approved.', 'paid once'],
    ['We pay on results, nothing upfront.', 'pay on results'],
    ['No upfront payment, sorry.', 'no upfront'],
    ['This is commission only for now.', 'commission only'],
    ['We can offer revenue share.', 'revenue share'],
    ['Please do a free trial first.', 'free trial'],
    ['Looking for a full-time employee.', 'full-time'],
    ['Monthly salary 300 usd.', 'salary'],
    ['Budget is 5000 INR.', 'INR'],
    ['Must be from India.', 'India']
  ]) {
    const r = post(`We need Google Ads help. ${text}`);
    ok(`"${label}" is a deal-breaker`, /deal-breaker/.test(r || ''), String(r));
  }
  ok('and the reason quotes the buyer', /payment after posting/i.test(post('I will make the payment after posting is live.') || ''), post('I will make the payment after posting is live.'));
  ok('a deal-breaker in the title counts too', /deal-breaker/.test(post('Need ads help.', 'Google Ads manager - commission only') || ''));
  ok('an honest paying buyer passes', post('We need a Google Ads manager for our casino brand. Budget $1500 a month, paid upfront by crypto.') === null,
     String(post('We need a Google Ads manager for our casino brand. Budget $1500 a month, paid upfront by crypto.')));
  ok('"Indiana" is not India', post('Local business in Indianapolis needs Google Ads. Budget $800.') === null, String(post('Local business in Indianapolis needs Google Ads. Budget $800.')));
  ok('a broken pattern is skipped, not fatal', why({}, { ...cfg, autoSkipPhrases: ['(unclosed', 'commission'] }) === null);
  ok('a budget under your minimum waits for you', /below your minimum/.test(why({ budget: '$20', budgetAmount: 20 }, { ...full, autoMinBudget: 100 }) || ''));
  ok('no stated budget is not held against it', why({ budgetAmount: 0 }, { ...full, autoMinBudget: 100 }) === null);
}

// --- the countdown ------------------------------------------------------
const now = Date.now();
ok('the floor is one minute', postAt(cfg, now, () => 0) === now + 60000);
ok('the ceiling is three minutes', postAt(cfg, now, () => 1) === now + 180000);

const queue = [
  { threadId: 'a', status: 'SENT', autoSendAt: now - 1000 },                     // due
  { threadId: 'b', status: 'SENT', autoSendAt: now + 90000 },                    // counting down
  { threadId: 'c', status: 'SENT', autoSendAt: now - 1000, autoSendHeld: true }, // held
  { threadId: 'd', status: 'SENT', autoSendAt: now - 1000, pmSent: true },       // already sent
  { threadId: 'e', status: 'SENT' },                                             // never armed
  { threadId: 'f', status: 'POSTED', autoSendAt: now - 1000 }                    // replied in public by hand: PM still due
];
ok('what is due is due', dueNow(queue, now).map((l) => l.threadId).join() === 'a,f', dueNow(queue, now).map((l) => l.threadId).join());
ok('a held one never becomes due', !dueNow(queue, now).some((l) => l.threadId === 'c'));
ok('a sent one never becomes due', !dueNow(queue, now).some((l) => l.threadId === 'd'));
ok('and the rest are still counting down', pending(queue, now).map((l) => l.threadId).join() === 'b');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
