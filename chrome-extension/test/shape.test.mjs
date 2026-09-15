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
ok('public reply asks the question', r.includes('survive a manual audit'));
ok('the question is the only thing before the PM line', r.indexOf('?') < r.indexOf('PM'));
ok('the offer is NOT public', !/invoice after|small first order|already done our side/i.test(r));
ok('public reply points at the PM', /\bPM\b/.test(r));
ok('public reply does not paste the thread url', !r.includes('blackhatworld.com'));

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
ok('PM asks for a reply rather than announcing availability',
   /(send|drop) a reply|reply here/i.test(d) && /get (started|going)|make a start/i.test(d), d.split('\n\n').slice(-2)[0]);
ok('the old "say the word" close is gone', !/say the word|ready to start today/i.test(d));
ok('PM signs off', d.trim().endsWith('Thanks!!'));
ok('the reply line appears once', (d.match(/get started|get going|make a start/gi) || []).length === 1, d);
ok('PM greets the author', d.startsWith('Hi buyer1001') || d.startsWith('Hey buyer1001'), d.slice(0, 20));
// The requested shape has no budget line, so the PM no longer carries one.
ok('the PM does not mention the budget', !d.includes('$400'), d);

// No AI tells anywhere.
const all = [...Array(60)].map((_, i) => renderReply(lead('2' + i), cfg) + '\n' + renderDm(lead('2' + i), cfg));
ok('no em or en dashes in 60 renders', !all.some((t) => /[–—]/.test(t)));
ok('no bullet glyphs', !all.some((t) => /•/.test(t)));
ok('no "delve"/"seamless"/"elevate"', !all.some((t) => /\b(delve|seamless|elevate|tapestry|robust solution)\b/i.test(t)));
ok('never three blank lines', !all.some((t) => /\n{3,}/.test(t)));
ok('no empty {{vars}} left behind', !all.some((t) => /\{\{|\}\}|\{[^}]*\|/.test(t)));

// Uniqueness across threads.
const openers = all.map((t) => t.split('\n')[0] + '|' + t.split('\n')[2]);
ok('openers vary across threads', new Set(openers).size > 4, String(new Set(openers).size));
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
ok('each close is different', new Set(rendered.map((t) => t.split('\n\n').slice(-3)[0])).size === 5);
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
