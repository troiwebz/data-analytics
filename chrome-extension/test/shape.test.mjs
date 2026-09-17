import { DEFAULT_CONFIG as cfg } from '../src/config.js';
import { renderReply, renderDm, renderDmTitle, layTips, offerOf, plain } from '../src/templates.js';
import { lintDraft } from '../src/compliance.js';

let fails = 0;
const ok = (n, c, e='') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + ' ' + e); } };

const lead = (id, over = {}) => ({
  threadId: id, author: 'buyer' + id, title: 'Need local citations for a Dubai clinic',
  url: `https://www.blackhatworld.com/threads/x.${id}/`, category: 'seo', categoryLabel: 'SEO', budget: '$400',
  aiSpecifics: {
    tips: [
      'We have built citations manually on directories that index in the UAE',
      'We can audit the NAP across the profiles you already have before adding more',
      'We are able to fix GMB categories and service areas before anything else'
    ],
    question: 'Do you want citations that survive a manual audit, or volume for a tier 2 layer?',
    offer: 'formula'
  }, ...over
});

const r = renderReply(lead('1001'), cfg);
const d = renderDm(lead('1001'), cfg);
console.log('\n--- public reply ---\n' + r + '\n\n--- private message ---\n' + d + '\n');

// Shape of the public reply.
ok('public reply carries exactly one tip',
  lead('1001').aiSpecifics.tips.filter((t) => r.includes(t)).length === 1);
ok('public reply is short', r.split('\n').filter(Boolean).length <= 4, String(r.split('\n').filter(Boolean).length));
// The question is written, but held back for the PM. Nobody on HAF opens a
// public reply with a question, and one asked in the open invites the other
// freelancers bidding on the thread to answer it for you.
ok('public reply asks no question', !r.includes('?'), r);
ok('the question is not leaked into it', !r.includes('survive a manual audit'), r);
ok('the reply is the claim and the PM line, nothing else',
   r.trim().split('\n').filter(Boolean).length === 2, JSON.stringify(r));
// No close asks the thread's technical question. "Is the filter setup using
// URL parameters or a JS layer?" dropped into a quote reads as an
// interrogation before a price, which is not what a buyer who has just posted
// wants. The question is still written, for the reply you send once they
// answer; it just is not in the opening message.
{
  const scoped = { ...lead('5001'), aiSpecifics: { ...lead('5001').aiSpecifics, offer: 'scope' } };
  const d2 = renderDm(scoped, cfg);
  ok('the scope close does not interrogate them', !d2.includes(scoped.aiSpecifics.question),
     d2.split('\n\n').slice(-3)[0]);
  ok('and asks nothing at all', !d2.includes('?'), (d2.match(/[^.\n]*\?/) || [''])[0]);
  ok('it still promises a price and a date', /fixed price and a date/i.test(d2), d2.split('\n\n').slice(-3)[0]);
  ok('and no longer demands the market and the volume',
     !/market and the volume|geo and the monthly volume/i.test(d2));
  ok('no template slot is left showing', !/\{\{|\}\}/.test(d2), (d2.match(/\{\{\w+\}\}/) || [''])[0]);

  // Every close works with no question, because none of them uses it now.
  const noQ = { ...scoped, aiSpecifics: { ...scoped.aiSpecifics, question: '' } };
  ok('a lead with no question still renders a whole PM', !/\{\{|\}\}/.test(renderDm(noQ, cfg)));
}

// Every PM offers real samples and a short plan on reply, which is what gets
// an answer - and is a portfolio, not free work, so the linter allows it.
for (const offer of ['pilot', 'ready', 'formula', 'terms', 'scope']) {
  const l = { ...lead('6001'), aiSpecifics: { ...lead('6001').aiSpecifics, offer } };
  const d = renderDm(l, cfg);
  ok(`the ${offer} PM offers real samples`, /real samples/i.test(d), d.split('\n\n').slice(-2)[0]);
  ok(`the ${offer} PM offers a short plan`, /short plan/i.test(d), d.split('\n\n').slice(-2)[0]);
  ok(`the ${offer} PM still asks for a reply`, /reply/i.test(d), d.split('\n\n').slice(-2)[0]);
  ok(`the ${offer} PM offers nothing free`, !/\bfree\b|no charge|no cost/i.test(d), d);
}

// Still written - it is what you ask once they reply - just not sent.
ok('the question is still produced, for the reply you send next', !!lead('1001').aiSpecifics.question,
   lead('1001').aiSpecifics.question);
ok('the offer is NOT public', !/invoice after|small first order|already done our side/i.test(r));
ok('public reply points at the PM', /\bPM\b/.test(r));
ok('public reply does not paste the thread url', !r.includes('blackhatworld.com'));
// No salutation and no @name: that is how replies on HAF actually read, and
// opening every one of ours with "Hi @buyer," would be a pattern of its own.
ok('public reply does not tag the buyer', !r.includes('@'), r.split('\n')[0]);
ok('and does not name them at all', !r.includes(lead('1001').author), r.split('\n')[0]);
ok('it opens on the technical line', r.trimStart().startsWith(lead('1001').aiSpecifics.tips[0].slice(0, 20)),
   JSON.stringify(r.slice(0, 50)));
// The PM is personal, so that one still greets them by name.
ok('the PM still greets them by name', d.startsWith('Hi ' + lead('1001').author), d.split('\n')[0]);

// Shape of the PM.
const tips = lead('1001').aiSpecifics.tips;
ok('PM carries all three tips', tips.every((t) => d.includes(t)));

// The exact shape asked for: heading, numbered claims, close, start line, sign-off.
ok('PM greets, then links the thread', /^Hi buyer1001,/.test(d) && d.includes('blackhatworld.com'));
ok('PM has the bold heading', d.includes('**Why We Can Do It:**'));
ok('heading is bold only in the editor, not in the copy', !plain(d).includes('**') && plain(d).includes('Why We Can Do It:'));
ok('PM numbers the claims', /^1\. We /m.test(d) && /^2\. We /m.test(d) && /^3\. We /m.test(d));
ok('every claim is about us', d.split('\n').filter((l) => /^\d\. /.test(l)).every((l) => /^\d\. We /.test(l)));
ok('PM carries one of the five closes', /first order|already built|whole method|invoice|fixed price/i.test(d));
// Every close must sit happily in front of the reply line, not repeat it.
ok('no close asks for a reply itself, which would say it twice',
   !Object.values(cfg.offers).some((t) => /(send|drop) a reply|just reply here/i.test(t)));
// It asks for a reply AND says what replying gets them. "Reply and we can get
// started" asked for the reply and offered nothing for it.
ok('PM asks for a reply rather than announcing availability',
   /(send|drop) a reply|reply here/i.test(d), d.split('\n\n').slice(-2)[0]);
ok('and gives a reason to send one', /real samples/i.test(d) && /short plan/i.test(d),
   d.split('\n\n').slice(-2)[0]);
ok('the old "say the word" close is gone', !/say the word|ready to start today/i.test(d));
ok('PM signs off', d.trim().endsWith('Thanks!!'));
ok('the reply line appears once', (d.match(/real samples/gi) || []).length === 1, d);
ok('PM greets the author', d.startsWith('Hi buyer1001') || d.startsWith('Hey buyer1001'), d.slice(0, 20));
// The requested shape has no budget line, so the PM no longer carries one.
ok('the PM does not mention the budget', !d.includes('$400'), d);

// ---- When they pay --------------------------------------------------------
// The question behind every HAF thread is "what if I pay and nothing
// arrives". It is answered before they ask, and named against the actual work:
// "after the first milestone" is a phrase, "once the campaigns are live and
// spending" is a commitment.
{
  const milestone = {
    seo: /links are live/i,
    ads: /ads (are|go) live/i,
    design: /files/i,
    social: /accounts? (is|are) running|posts are (live|going up)/i,
    web: /build/i,
    content: /pieces/i,
    generic: /first (part|piece)/i
  };
  for (const [cat, re] of Object.entries(milestone)) {
    const l = { ...lead('7001'), category: cat,
                aiSpecifics: { ...lead('7001').aiSpecifics, offer: 'pilot' } };
    const dm = renderDm(l, cfg);
    ok(`the ${cat} PM says there is nothing upfront`, /no (money|payment) upfront|nothing upfront/i.test(dm),
       dm.split('\n\n').slice(-3)[0]);
    ok(`and names the ${cat} milestone, not a generic one`, re.test(dm), dm.split('\n\n').slice(-3)[0]);
    ok(`the ${cat} line says pay after it`, /(you )?pay (once|after)/i.test(dm), dm.split('\n\n').slice(-3)[0]);
    // It has to read like a person typing on a forum, not like an invoice.
    ok(`the ${cat} line is not invoice boilerplate`,
       !/nothing is due|first invoice|remittance|net \d|upon receipt/i.test(dm), dm.split('\n\n').slice(-3)[0]);
    ok(`and offers nothing free`, !/\bfree\b|no charge|no cost/i.test(dm), dm);
    ok(`no slot is left showing for ${cat}`, !/\{\{|\}\}/.test(dm), (dm.match(/\{\{\w+\}\}/) || [''])[0]);
  }

  // The "terms" close already says this. Saying it twice in six lines reads as
  // protesting rather than reassuring.
  const t = renderDm({ ...lead('7002'), category: 'ads',
                       aiSpecifics: { ...lead('7002').aiSpecifics, offer: 'terms' } }, cfg);
  ok('the terms close does not say it twice',
     !/upfront/i.test(t) && (t.match(/invoice|payment after/gi) || []).length === 1,
     JSON.stringify(t.split('\n\n').slice(-3)));
  ok('and there is no empty gap where the line would have been', !/\n{3,}/.test(t), JSON.stringify(t));

  // Every category and every close, linted.
  for (const cat of ['seo', 'ads', 'design', 'social', 'web', 'content', 'generic']) {
    for (const offer of ['pilot', 'ready', 'formula', 'terms', 'scope']) {
      const dm = renderDm({ ...lead('7003'), category: cat,
                            aiSpecifics: { ...lead('7003').aiSpecifics, offer } }, cfg);
      ok(`${cat}/${offer} passes the compliance check`, lintDraft(dm, cfg.compliance).ok !== false,
         JSON.stringify(lintDraft(dm, cfg.compliance).errors));
    }
  }
}

// No AI tells anywhere.
const all = [...Array(60)].map((_, i) => renderReply(lead('2' + i), cfg) + '\n' + renderDm(lead('2' + i), cfg));
ok('no em or en dashes in 60 renders', !all.some((t) => /[–—]/.test(t)));
ok('no bullet glyphs', !all.some((t) => /•/.test(t)));
ok('no "delve"/"seamless"/"elevate"', !all.some((t) => /\b(delve|seamless|elevate|tapestry|robust solution)\b/i.test(t)));
ok('never three blank lines', !all.some((t) => /\n{3,}/.test(t)));
ok('no empty {{vars}} left behind', !all.some((t) => /\{\{|\}\}|\{[^}]*\|/.test(t)));

// Uniqueness across threads.
//
// This used to measure the reply's first line, which varied only because it
// tagged the buyer by name - "Hi @buyer2001," is not real variety, and the
// salutation is gone now. What genuinely differs between two replies is the
// technical line and the question, both written by Claude against that
// specific thread, which fixed test leads cannot show. So what is checked here
// is the part the templates themselves are responsible for: the closer, and
// the PM's whole opening.
const replies = [...Array(60)].map((_, i) => renderReply(lead('2' + i), cfg));
const closers = new Set(replies.map((t) => t.trim().split('\n').pop()));
ok('the closing line varies between threads', closers.size > 1, [...closers].join(' / '));
ok('no reply tags the buyer', !replies.some((t) => t.includes('@')), replies.find((t) => t.includes('@')));
const pmOpeners = new Set([...Array(60)].map((_, i) => renderDm(lead('2' + i), cfg).split('\n\n')[1]));
ok('PM openers vary across threads', pmOpeners.size > 1, String(pmOpeners.size));
const dmBodies = [...Array(60)].map((_, i) => renderDm(lead('2' + i), cfg));
// Numbered always, by request: the lines are steps in an order, not a feature list.
ok('every PM numbers its lines 1. 2. 3.', dmBodies.every((t) => /^1\. /m.test(t) && /^2\. /m.test(t) && /^3\. /m.test(t)));
ok('every PM has the heading and the sign-off', dmBodies.every((t) => t.includes('**Why We Can Do It:**') && t.trim().endsWith('Thanks!!')));
ok('no dash bullets anywhere', !dmBodies.some((t) => /^- /m.test(t)));
const firstLines = new Set(dmBodies.map((t) => t.split('\n').slice(0, 5).join(' ')));
ok('no two PMs in 60 share their whole opening', firstLines.size > 10, String(firstLines.size));

// Stable: the same thread renders the same every time.
ok('same thread renders identically twice', renderDm(lead('1001'), cfg) === d);
ok('and so does the reply', renderReply(lead('1001'), cfg) === r);
ok('a different thread renders differently', renderDm(lead('1002'), cfg) !== d.replace(/1001/g, '1002'));

// Falls back to the built-in rules with no Claude lines.
// Every close, checked for the things that must never appear.
const allOffers = Object.keys(cfg.offers);
ok('there are five closes', allOffers.length === 5, allOffers.join(','));
const rendered = allOffers.map((o) => renderDm({ ...lead('5' + o), aiSpecifics: { ...lead('1').aiSpecifics, offer: o } }, cfg));
// Compared whole, not by paragraph position. The payment line added a
// paragraph and the "terms" close suppresses it, so counting back from the end
// no longer lands on the close - it lands on different things per offer.
ok('each close is different', new Set(rendered).size === 5, String(new Set(rendered).size));
ok('and the difference is the close itself, not the rest of the PM',
   new Set(allOffers.map((o) => cfg.offers[o])).size === 5);
ok('no close offers free work', !rendered.some((t) => /\bfree\b|no charge|at no cost/i.test(t)),
   rendered.find((t) => /\bfree\b/i.test(t))?.slice(-120));
ok('no close promises a guarantee or a discount', !rendered.some((t) => /guarantee|\d+% off|discount/i.test(t)));
ok('no close repeats the tips twice', !rendered.some((t) =>
  (t.match(/citations manually on directories/g) || []).length > 1));
ok('the chosen close is the one that renders',
  /first batch/i.test(renderDm({ ...lead('6'), aiSpecifics: { ...lead('1').aiSpecifics, offer: 'terms' } }, cfg)));
ok('offerOf reports it', offerOf({ ...lead('6'), aiSpecifics: { ...lead('1').aiSpecifics, offer: 'terms' } }, cfg) === 'terms');

// An unknown or missing offer must still produce a real close, not a blank.
const noOffer = renderDm({ ...lead('7'), aiSpecifics: { tips: lead('1').aiSpecifics.tips, question: 'q?', offer: 'nonsense' } }, cfg);
ok('an unknown offer falls back to a real one', noOffer.length > 200 && !/\{\{/.test(noOffer));
const picked = new Set([...Array(40)].map((_, i) => offerOf({ ...lead('8' + i), aiSpecifics: { tips: ['x'] } }, cfg)));
ok('leads with no offer spread across all five', picked.size === 5, [...picked].join(','));

const noAi = renderDm({ ...lead('3001'), aiSpecifics: undefined }, cfg);
ok('works with no Claude lines', noAi.length > 100 && !/\{\{/.test(noAi));
ok('and still has the whole shape', /blackhatworld.com/.test(noAi) && noAi.includes('Why We Can Do It') && noAi.trim().endsWith('Thanks!!'));

// One tip only: the reply must not read as a stub.
const one = renderReply({ ...lead('4001'), aiSpecifics: { tips: ['We have built citations in the UAE'], question: 'Audit-safe or volume?' } }, cfg);
ok('single-tip reply reads whole', one.includes('We have built citations in the UAE') && /PM/.test(one), one);

ok('layTips handles an empty list', layTips([]) === '');
ok('layTips of one is a sentence, not a numbered item', layTips(['Just the one thing here']) === 'Just the one thing here.');
ok('layTips numbers three', layTips(['one thing', 'two thing', 'three thing']) === '1. one thing\n2. two thing\n3. three thing');

// The ban on free work is enforced by the linter, not just asked for in a prompt.
for (const t of ['We can do a free trial first', 'First one is free of charge', 'Happy to send a free sample',
                 'I will do the first page at no cost', 'happy to do it FOR FREE']) {
  ok(`linter blocks: ${t}`, lintDraft(t, cfg.compliance).errors.length > 0);
}
ok('a paid pilot is not blocked', lintDraft('Small first order at the normal rate', cfg.compliance).errors.length === 0);
ok('no rendered close trips the linter', !allOffers.some((o, i) => lintDraft(rendered[i], cfg.compliance).errors.length));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
