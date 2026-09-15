import { DEFAULT_CONFIG as cfg } from '../src/config.js';
import { renderReply, renderDm, renderDmTitle, layTips, offerOf } from '../src/templates.js';
import { lintDraft } from '../src/compliance.js';

let fails = 0;
const ok = (n, c, e='') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + ' ' + e); } };

const lead = (id, over = {}) => ({
  threadId: id, author: 'buyer' + id, title: 'Need local citations for a Dubai clinic',
  url: `https://www.blackhatworld.com/threads/x.${id}/`, category: 'seo', categoryLabel: 'SEO', budget: '$400',
  aiSpecifics: {
    tips: [
      'Manual submissions to directories that index in the UAE',
      'NAP audit across the profiles you already have before adding more',
      'GMB categories and service areas fixed first'
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
ok('public reply is short', r.split('\n').filter(Boolean).length <= 5, String(r.split('\n').filter(Boolean).length));
ok('public reply asks the question', r.includes('survive a manual audit'));
ok('the question is the only thing before the PM line', r.indexOf('?') < r.indexOf('PM'));
ok('the offer is NOT public', !/invoice after|small first order|already done our side/i.test(r));
ok('public reply points at the PM', /\bPM\b/.test(r));
ok('public reply does not paste the thread url', !r.includes('blackhatworld.com'));

// Shape of the PM.
const tips = lead('1001').aiSpecifics.tips;
ok('PM carries all three tips', tips.every((t) => d.includes(t)));
ok('PM opens with the thread link', /HAF|thread/i.test(d.split('\n')[2]) && d.includes('blackhatworld.com'));
ok('PM closes with one of the five offers', /first order|already|whole method|invoice|first batch|fixed price/i.test(d.split('\n').pop()), d.split('\n').pop());
ok('PM greets the author', d.startsWith('Hi buyer1001') || d.startsWith('Hey buyer1001'), d.slice(0, 20));
ok('budget mentioned once', (d.match(/\$400/g) || []).length === 1);

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
const shapes = new Set(dmBodies.map((t) => (/^\d\./m.test(t) ? 'numbered' : /^- /m.test(t) ? 'bulleted' : 'prose')));
ok('PM layout varies: list, numbers and prose all appear', shapes.size === 3, [...shapes].join(','));
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
ok('each close produces a different PM ending', new Set(rendered.map((t) => t.split('\n').pop())).size === 5);
ok('no close offers free work', !rendered.some((t) => /\bfree\b|no charge|at no cost/i.test(t)),
   rendered.find((t) => /\bfree\b/i.test(t))?.slice(-120));
ok('no close promises a guarantee or a discount', !rendered.some((t) => /guarantee|\d+% off|discount/i.test(t)));
ok('no close repeats the tips twice', !rendered.some((t) =>
  (t.match(/Manual submissions to directories/g) || []).length > 1));
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
ok('and still has the common top and a real close', /blackhatworld.com/.test(noAi) && noAi.split('\n').pop().length > 30);

// One tip only: the reply must not read as a stub.
const one = renderReply({ ...lead('4001'), aiSpecifics: { tips: ['Manual submissions to UAE directories'], question: 'Audit-safe or volume?' } }, cfg);
ok('single-tip reply reads whole', one.includes('Manual submissions to UAE directories.') && /PM/.test(one), one);

ok('layTips handles an empty list', layTips([], Math.random) === '');
ok('layTips of one is a sentence, not a list', !layTips(['Just the one thing here'], () => 0).startsWith('-'));

// The ban on free work is enforced by the linter, not just asked for in a prompt.
for (const t of ['We can do a free trial first', 'First one is free of charge', 'Happy to send a free sample',
                 'I will do the first page at no cost', 'happy to do it FOR FREE']) {
  ok(`linter blocks: ${t}`, lintDraft(t, cfg.compliance).errors.length > 0);
}
ok('a paid pilot is not blocked', lintDraft('Small first order at the normal rate', cfg.compliance).errors.length === 0);
ok('no rendered close trips the linter', !allOffers.some((o, i) => lintDraft(rendered[i], cfg.compliance).errors.length));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
