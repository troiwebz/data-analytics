import { DEFAULT_CONFIG as cfg } from '../src/config.js';
import { renderReply, renderDm, renderDmTitle, layTips } from '../src/templates.js';

let fails = 0;
const ok = (n, c, e='') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + ' ' + e); } };

const lead = (id, over = {}) => ({
  threadId: id, author: 'buyer' + id, title: 'Need local citations for a Dubai clinic',
  url: `https://www.blackhatworld.com/threads/x.${id}/`, category: 'seo', categoryLabel: 'SEO', budget: '$400',
  aiSpecifics: [
    'Manual submissions to directories that index in the UAE',
    'NAP audit across the profiles you already have before adding more',
    'GMB categories and service areas fixed first'
  ], ...over
});

const r = renderReply(lead('1001'), cfg);
const d = renderDm(lead('1001'), cfg);
console.log('\n--- public reply ---\n' + r + '\n\n--- private message ---\n' + d + '\n');

// Shape of the public reply.
ok('public reply carries exactly one tip',
  [1, 2, 3].filter((i) => r.includes(lead('1001').aiSpecifics[i - 1])).length === 1);
ok('public reply is short', r.split('\n').filter(Boolean).length <= 4, String(r.split('\n').filter(Boolean).length));
ok('public reply points at the PM', /\bPM\b/.test(r));
ok('public reply does not paste the thread url', !r.includes('blackhatworld.com'));

// Shape of the PM.
const tips = lead('1001').aiSpecifics;
ok('PM carries all three tips', tips.every((t) => d.includes(t)));
ok('PM opens with the thread link', /HAF|thread/i.test(d.split('\n')[2]) && d.includes('blackhatworld.com'));
ok('PM closes with samples and portfolio', /portfolio/i.test(d) && /sample/i.test(d));
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
const noAi = renderDm({ ...lead('3001'), aiSpecifics: undefined }, cfg);
ok('works with no Claude lines', noAi.length > 100 && !/\{\{/.test(noAi));
ok('and still has the common top and bottom', /blackhatworld.com/.test(noAi) && /portfolio/i.test(noAi));

// One tip only: the reply must not read as a stub.
const one = renderReply({ ...lead('4001'), aiSpecifics: ['Manual submissions to UAE directories'] }, cfg);
ok('single-tip reply reads whole', one.includes('Manual submissions to UAE directories.') && /PM/.test(one), one);

ok('layTips handles an empty list', layTips([], Math.random) === '');
ok('layTips of one is a sentence, not a list', !layTips(['Just the one thing here'], () => 0).startsWith('-'));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
