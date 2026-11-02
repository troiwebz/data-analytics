// Reading the competition before answering it.
//
// The replies already on a thread are the other freelancers bidding for the
// same job. Between them they show what the buyer is being offered - and what
// none of them has answered, which is the reason to reply at all.
//
// The real case: "Crypto Runner. I want a crypto runner. You'll have to run my
// ads, and to make sure they don't get suspended! This will be a continuous
// job." Three freelancers replied. All three offered to run the ads. Not one
// answered suspension, which is the only constraint the buyer actually stated.
import { asksIn, readRivals, rivalBrief, upgradeReason, sourceOf } from '../src/rivals.js';

let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + '  ' + e); } };

const BODY = "Crypto Runner. Hi, I want a crypto runner. You'll have to run my ads, "
           + "and to make sure they don't get suspended! This will be a continuous job";
const REPLIES = [
  { author: 'AnyAdz', text: 'We can run crypto ads campaign for your business, We if you do not have certificate, then we can use our own certificate or we use cloaking.' },
  { author: 'AGENCY LINK', text: 'We have experience running Crypto wallet, investment and exchange ads on Google and Meta. The campaigns will run without problems and will be scalable' },
  { author: 'Ben Mark', text: 'I have over 10 years of experience in Google and Meta Ads management and have been working with others on same Peptides industry' }
];

const term = (list) => list.map((t) => t.term);
const r = readRivals(BODY, REPLIES);

// What the buyer asked for, in their own words.
ok('the buyer\'s constraint is picked up', term(r.asks).includes('suspended'), term(r.asks).join(' | '));
ok('and that it is ongoing work', term(r.asks).some((t) => /continuous/.test(t)), term(r.asks).join(' | '));
ok('filler is not mistaken for an ask',
   !term(r.asks).some((t) => /^(hi|the|this|will|have|make|sure|dont|don)$/.test(t)), term(r.asks).join(' | '));

// The whole point: the part nobody answered.
ok('suspension is flagged as unanswered', term(r.gap).includes('suspended'), term(r.gap).join(' | '));
ok('and the ongoing side too', term(r.gap).some((t) => /continuous/.test(t)), term(r.gap).join(' | '));
ok('running the ads is NOT in the gap, they all offered that',
   !term(r.gap).includes('ads'), term(r.gap).join(' | '));
ok('and it is recorded as answered, with who answered it',
   r.covered.some((c) => c.term === 'ads' && c.by.length === 3), JSON.stringify(r.covered.map((c) => c.term)));

// What is now worth nothing to say.
const crowd = term(r.crowded);
ok('what they are all promising is spotted', crowd.length >= 3, crowd.join(' | '));
ok('including the obvious ones', crowd.includes('crypto') && crowd.includes('experience'), crowd.join(' | '));
ok('every crowded term is claimed by more than one of them',
   r.crowded.every((t) => t.by.length > 1), JSON.stringify(r.crowded.map((t) => [t.term, t.by.length])));

// What Claude is handed.
const brief = rivalBrief(BODY, REPLIES);
ok('the brief names the unanswered part loudly', /STILL UNANSWERED[^\n]*suspended/.test(brief), brief);
ok('and what not to lead with', /already promising/.test(brief), brief);
ok('a thread with no replies yet produces no brief', rivalBrief(BODY, []) === '', rivalBrief(BODY, []));

// --- The gate: Claude only when there is an upgrade in it -------------------
const lead = { threadId: '1', body: BODY, replies: REPLIES };
ok('a lead with no lines is worth asking about', upgradeReason(lead) === 'no lines written yet', upgradeReason(lead));

const written = { ...lead, aiSpecifics: { tips: ['We keep crypto ad accounts off suspension'] } };
ok('lines written before the thread was read are worth redoing',
   /before the thread/.test(upgradeReason(written) || ''), upgradeReason(written));

const current = { ...written, aiFrom: sourceOf(written) };
ok('nothing new to say costs nothing', upgradeReason(current) === null, upgradeReason(current));

const answered = { ...current, replies: [...REPLIES, { author: 'newcomer', text: 'We handle appeals when accounts get suspended' }] };
ok('a new reply on the thread is worth answering',
   /1 new reply/.test(upgradeReason(answered) || ''), upgradeReason(answered));

const grew = { ...current, body: BODY + ' Also need daily reporting and a named account manager on call.' };
ok('the post being read since is worth redoing',
   /post has been read/.test(upgradeReason(grew) || ''), upgradeReason(grew));

// Two replies arriving is still one call, not two.
const twoMore = { ...current, replies: [...REPLIES, { author: 'x', text: 'we do appeals' }, { author: 'y', text: 'we do warmup' }] };
ok('two new replies read as two, in plain English',
   /2 new replies/.test(upgradeReason(twoMore) || ''), upgradeReason(twoMore));

// A thread with nothing to read must not crash or invent.
ok('an empty thread gives an empty reading', readRivals('', []).asks.length === 0);
ok('and no gap to chase', readRivals('', []).gap.length === 0);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
