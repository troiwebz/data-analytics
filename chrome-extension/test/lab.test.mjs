// Thread Lab: relevance by meaning, pull by replies per day, and a full run.
import { tokens, rankCompetitors, repliesPerDay, cluster, parseLab, labPrompt, runLab, REVIEW_COPIES } from '../src/lab.js';

let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + '  ' + e); } };
const now = Date.parse('2026-09-30T12:00:00Z');
const ago = (d) => new Date(now - d * 86400000).toISOString();

ok('noise words are dropped', !tokens('The BEST cheap SEO service 2026 - instant delivery!').includes('best'));
ok('plurals fold together', tokens('backlinks backlink').every((w) => w === 'backlink'));
ok('replies per day is fair to age', repliesPerDay({ replyCount: 100, startedAt: ago(100) }, now) === 1 && repliesPerDay({ replyCount: 10, startedAt: ago(2) }, now) === 5);
ok('a thread under a day old counts as one day', repliesPerDay({ replyCount: 7, startedAt: ago(0.1) }, now) === 7);

const mine = { threadId: '1', title: 'Casino and iGaming Google Ads management - black hat ads for gambling brands',
               body: 'We run Google Ads and Facebook ads for casino, betting and crypto brands. Cloaking, agency accounts.' };
const rows = [
  { threadId: '1', title: mine.title, replyCount: 50, startedAt: ago(10) },                                   // yours
  { threadId: '2', title: '[Review Copies] Casino Google Ads campaigns for gambling brands', replyCount: 40, startedAt: ago(4) },
  { threadId: '3', title: 'Cheap DR 70 guest posts - 1000 sites', replyCount: 900, startedAt: ago(30) },       // busy, not you
  { threadId: '4', title: 'Facebook ads for crypto and casino - agency accounts included', replyCount: 12, startedAt: ago(6) },
  { threadId: '5', title: 'Rules of the Free Review Copies forum', replyCount: 5, startedAt: ago(900), sticky: true },
  { threadId: '6', title: 'Instagram followers real and active', replyCount: 300, startedAt: ago(20) }
];
const r = rankCompetitors(mine, rows, { now });
ok('your own thread is not your competitor', !r.relevant.some((x) => x.threadId === '1'));
ok('a sticky is not a competitor', !r.relevant.some((x) => x.threadId === '5'));
ok('the busy but unrelated thread is left out', !r.relevant.some((x) => x.threadId === '3' || x.threadId === '6'), JSON.stringify(r.relevant.map((x) => [x.threadId, x.sim])));
ok('the casino ads threads are found', ['2', '4'].every((id) => r.relevant.some((x) => x.threadId === id)), JSON.stringify(r.relevant.map((x) => x.threadId)));
ok('and ranked by relevance times pull', r.top[0].threadId === '2', JSON.stringify(r.top.map((x) => [x.threadId, x.score.toFixed(3)])));
ok('each says which words it shares with yours', r.top[0].shared.includes('casino'), JSON.stringify(r.top[0].shared));

const g = cluster([{ title: 'Casino Google Ads management', replyCount: 10 }, { title: 'Google Ads for casino brands', replyCount: 5 }, { title: 'Instagram followers', replyCount: 50 }]);
ok('similar offers cluster together', g.some((x) => x.size === 2), JSON.stringify(g.map((x) => [x.label, x.size])));

const good = parseLab('Here you go:\n```json\n{"titles":["A","B","C","D"],"description":"Hello","hooks":["h1"],"keywords":{"winning":["casino"],"missing":["crypto"]},"competitors":[{"id":"2","offer":"o"}]}\n```');
ok('the answer is found inside prose and fences', good.ok && good.titles.length === 3 && good.keywords.missing[0] === 'crypto');
ok('a broken answer is flagged, not trusted', parseLab('sorry, no').ok === false);
ok('the prompt carries your post and theirs', /OPERATOR'S THREAD/.test(labPrompt(mine, [{ threadId: '2', title: 't', body: 'their post', rpd: 10 }])) && /their post/.test(labPrompt(mine, [{ threadId: '2', title: 't', body: 'their post', rpd: 10 }])));

// --- a whole run, with stand-in pages -------------------------------------
{
  const read = [];
  const steps = [];
  let asked = '';
  const deps = {
    now, step: (m) => steps.push(m),
    readThread: async (u) => { read.push(u); return /x\.1\//.test(u)
      ? { title: mine.title, body: mine.body, forum: 'Social Media', forumUrl: 'https://www.blackhatworld.com/forums/social-media.200/' }
      : { body: 'Their opening post about casino ads.' }; },
    readListing: async (u, pages) => { read.push(`${u} x${pages}`); return Object.fromEntries(rows.map((r) => [r.threadId, { ...r, url: `https://www.blackhatworld.com/seo/t.${r.threadId}/` }])); },
    ask: async (sys, user) => { asked = user; return { text: JSON.stringify({ titles: ['T1', 'T2', 'T3'], description: 'D', gaps: ['g'], competitors: [{ id: '2', offer: 'free review copy', hook: 'h', pain: 'p', why: 'w' }] }), cost: 0.02 }; }
  };
  const out = await runLab({ url: 'https://www.blackhatworld.com/seo/mine.x.1/', pages: 9, open: 6 }, deps);
  ok('your thread is read first', /x\.1\//.test(read[0]), read[0]);
  ok('Free Review Copies and your own section are both read', read.some((u) => u.startsWith(REVIEW_COPIES)) && read.some((u) => /social-media\.200/.test(u)), JSON.stringify(read));
  ok('never more than 5 pages each', read.filter((u) => / x\d$/.test(u)).every((u) => / x5$/.test(u)), JSON.stringify(read));
  ok('only relevant competitors are opened', !read.some((u) => /t\.(3|6)\//.test(u)), JSON.stringify(read));
  ok('Claude sees what it read', /Their opening post/.test(asked));
  ok('the copy comes back', out.titles.length === 3 && out.description === 'D');
  ok('the ranked threads and Claude\'s teardown are both kept', out.competitors.some((c) => c.threadId === '2' && c.title) && out.teardown[0].offer === 'free review copy', JSON.stringify({ c: out.competitors[0], t: out.teardown }));
  ok('progress is reported step by step', steps.length >= 5, JSON.stringify(steps));
  let err = '';
  try { await runLab({ url: 'https://google.com/x' }, deps); } catch (e) { err = e.message; }
  ok('a link that is not BHW is refused before any reading', /not a BlackHatWorld thread/.test(err), err);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
