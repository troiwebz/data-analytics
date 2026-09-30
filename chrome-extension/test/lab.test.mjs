// Thread Lab: relevance by meaning, pull by replies per day, and a full run.
import { tokens, rankCompetitors, repliesPerDay, cluster, parseLab, labPrompt, runLab, REVIEW_COPIES, REVIEW_SECTION,
         titleFeatures, titleFormula, checkReviewCopy, repairReviewCopy, reviewPrompt, runReviewLab, SECTION_RULES, looseJson, viralOnly, parseFill, longTails, marketsIn, nichesIn, parseIdeas, ideasCsv, ideasPrompt } from '../src/lab.js';

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

// --- review-copy mode, on the real section (read 2026-09-30) -------------------
{
  const REAL = [
    [37, 2, "[ 10x Free Review Copies ] - Locke's Authority Guest Posts"], [35, 6, '10 X High DR Guest Post Review Copy'],
    [89, 75, '♥️ Free Review ♥️  500MB Mobile Proxy Free Experience!'], [29, 1, '[BETA TESTERS] Free Google Knowledge Panel account for 20 founders/creators (honest feedback required)'],
    [44, 16, '[CROWDO - SEPTEMBER] 50 Crowdo Link Copies & 5 Guest Posts & 15 Quora & 5 Reddit'], [37, 44, 'Free Review Copy - D0Follow / NoFollow Podcast Backlinks to your website'],
    [4, 237, '[FREE REVIEW COPIES] AutoSmmPanel.com | SMM PANEL ⚡ Free $1 Balance ✅'], [41, 7, 'Free review copies to 20 members: 1 edu email each'],
    [39, 3, "30X Free Review Copies : Ajju's EDU Authority Network⚡"], [19, 5, 'StrixSeo - $ 1 Network Free Review Copy - Sep 2026'],
    [137, 203, '【Free Review】1GB Free Trial – High-Quality Residential Proxies'], [12, 2, 'Free Reivew Copies [ JOHNRANK PBN ]⭐POWERFUL CASINO PBN BACKLINKS ❤️ THAI ✅ INDO ✅ KOREAN NICHE ACCEPTED'],
    [37, 16, '5 Free Review Copies -⚡Permuim Guest Posts⚡✅ High DA 50+✅❤️ 2k+ Traffic❤️ Do follow Link❤️'], [50, 34, '5x Free Review Copies of our 18 month Gemini Pro Upgrade Link Worth $360'],
    [17, 12, 'FREE Review Copies — Human-Run AI Visibility Audit (AEO/GEO), New Features Released - 5 Spots Available!'],
    [10, 9, '10x Free Review Copies:⭐⭐⭐⎝⎝ Casino/iGaming SEO Package ⎠⎠ ✅Slot-UFABET-Sportsbook-Poker-Crypto Casino⚡Indexing & Rank Tracking ✅ Worth $1499'],
    [59, 100, 'Claude Code and Codex API service: Beta Testers Needed'], [13, 9, 'Free Review Copy - 7-Point Semrush Audit All AI Cited Sites'],
    [6, 25, '[BETA TESTERS] Ubot/Zennoposter like browser automation tool - NEED FEEDBACK'], [94, 709, 'FREE REVIEW COPIES FOR CASINO Gambling PBN Do follow BACKLINKS DA 35 DR 50']
  ].map(([rep, d, title], i) => ({ threadId: String(2000 + i), title, replyCount: rep, startedAt: ago(d), url: `https://www.blackhatworld.com/seo/t.${2000 + i}/` }));

  ok('"[ 10x Free Review Copies ] - Locke\'s…" has count first, tag, bracket and brand',
     (({ countFirst, reviewTag, bracketTag, brand }) => countFirst && reviewTag && bracketTag && brand)(titleFeatures(REAL[0].title)), JSON.stringify(titleFeatures(REAL[0].title)));
  ok('an emoji-wall title is flagged', titleFeatures(REAL[15].title).emojiHeavy);
  const f = titleFormula(REAL, { now });
  const feat = (k) => f.features.find((x) => x.key === k);
  ok('the formula ranks by replies per day', f.top[0].title.startsWith('[BETA TESTERS] Free Google Knowledge Panel'), f.top[0].title);
  ok('it measures the top against the rest', f.sample === 20 && typeof feat('countAnywhere').top === 'number');
  ok('on the real section, the top titles state the count more than the rest', feat('countAnywhere').top > feat('countAnywhere').rest, JSON.stringify(feat('countAnywhere')));
  // Measured, not assumed: on this sample the top titles use emoji walls MORE (20% vs 10%).
  ok('emoji use is measured, whichever way it goes', feat('emojiHeavy').top === 20 && feat('emojiHeavy').rest === 10, JSON.stringify(feat('emojiHeavy')));

  const URL = 'https://www.blackhatworld.com/seo/casino-ads.1800000/';
  const clean = { titles: ['[ 10x Free Review Copies ] - Bargain\'s Casino Ads'], description: `Hello,\n\nLooking for 10 honest reviewers.\n\nThread Link:\n${URL}\n\nHow to Apply: reply here.` };
  ok('good copy passes every check', checkReviewCopy(clean, { url: URL, copies: 10 }).length === 0, JSON.stringify(checkReviewCopy(clean, { url: URL, copies: 10 })));
  const probs = checkReviewCopy({ titles: ['Free Review Copies - Casino Ads'], description: 'Get 20% off after. Please bump my thread. Apply at https://forms.gle/x' }, { url: URL, copies: 10 });
  ok('a missing thread link is caught', probs.some((p) => /main thread link/.test(p)));
  ok('a missing count is caught, in the title too', probs.some((p) => /does not say 10/.test(p)) && probs.some((p) => /title 1 does not state 10/.test(p)));
  ok('bump requests, upsells and off-site forms are caught', ['bumping', 'upsell', 'links off BHW'].every((w) => probs.some((p) => p.includes(w))), JSON.stringify(probs));
  const fixed = repairReviewCopy({ description: 'Hello.\n\nThread Link:\n[link]\n\nReply below.' }, { url: URL, copies: 10 });
  ok('a missing link is put in, under Thread Link', /Thread Link:\s*\n?\s*https:\/\/www\.blackhatworld\.com\/seo\/casino-ads/.test(fixed.description) || fixed.description.includes(URL), fixed.description);
  const prompt = reviewPrompt({ url: URL, title: 'Casino ads', body: 'We run casino ads.' }, { copies: 10, gets: '1 campaign setup' }, f, [{ title: 'W', replyCount: 9, rpd: 3, body: 'winner post' }]);
  ok('the prompt carries the rules, the numbers, the offer and the winners', SECTION_RULES.every((r) => prompt.includes(r)) && /free review copies: 10/.test(prompt) && /top \d+% vs rest/.test(prompt) && /winner post/.test(prompt));

  // the whole run
  const read = []; let asked = '';
  const deps = {
    now, step: () => {},
    readThread: async (u) => { read.push(u); return u === URL ? { title: 'Casino ads management', body: 'We run Google and Meta ads for casino brands.' } : { body: 'Hello brothers, looking for 10 honest reviewers. Thread Link: ...' }; },
    readListing: async (u, pages) => { read.push(`${u} x${pages}`); return Object.fromEntries(REAL.map((r) => [r.threadId, r])); },
    ask: async (sys, user) => { asked = user; return { text: JSON.stringify({ titles: ['[ 10x Free Review Copies ] - Bargain\'s Casino Ads'], description: 'Hello,\n\nLooking for 10 honest reviewers.\n\nThread Link:\n[link]\n\nReply below.',
      formula: [{ rule: 'Count first', evidence: '8/10' }], titlePattern: '[ {N}x Free Review Copies ] - {Brand}', rulesCheck: [{ rule: 'free', ok: true }] }), cost: 0.03 }; }
  };
  const out = await runReviewLab({ url: URL, copies: 10, pages: 7 }, deps);
  ok('the Service Reviews & Beta Testers section is what is read', read.some((u) => u.startsWith(REVIEW_SECTION)) && !read.some((u) => u.startsWith(REVIEW_COPIES)), JSON.stringify(read));
  const openedUrls = read.filter((u) => /\/seo\/t\.\d+\//.test(u));
  const v = viralOnly(REAL, { now });
  ok('only viral threads are opened', openedUrls.every((u) => v.some((x) => x.url === u)) && openedUrls.length > 0, JSON.stringify(openedUrls));
  {
    // A casino ads thread just like yours, but barely read: it must not be studied.
    const quiet = { threadId: '2999', title: '[FREE REVIEW COPIES] ||FB | IG | GOOGLE || CASINO | GAMBLING ADS', replyCount: 3, startedAt: ago(20), url: 'https://www.blackhatworld.com/seo/t.2999/' };
    const seen = [];
    await runReviewLab({ url: URL, copies: 10 }, { ...deps, readThread: async (u) => { seen.push(u); return deps.readThread(u); },
      readListing: async () => Object.fromEntries([...REAL, quiet].map((r) => [r.threadId, r])) });
    ok('a thread that matches your niche but is not viral is never opened', !seen.includes(quiet.url), JSON.stringify(seen));
  }
  ok('never more than 5 pages', read.filter((u) => / x\d$/.test(u)).every((u) => / x5$/.test(u)));
  ok('the winners\' posts reach Claude', /looking for 10 honest reviewers/.test(asked));
  ok('the thread link is always in the final post', out.description.includes(URL), out.description);
  ok('the formula, the pattern and the rules check come back', out.formula.length && out.titlePattern && out.rulesCheck.length);
  ok('the measured numbers come back for the page', out.measured.features.length === 9);
  ok('and a clean result has no problems listed', out.problems.length === 0, JSON.stringify(out.problems));
  let err = '';
  try { await runReviewLab({ url: URL, copies: 0 }, deps); } catch (e) { err = e.message; }
  ok('no number of copies, no run', /how many free review copies/.test(err), err);
}

// --- answers the way models really send them --------------------------------
{
  ok('a fenced answer parses', looseJson('```json\n{"titles":["a"],"description":"d"}\n```').titles[0] === 'a');
  ok('a trailing comma is forgiven', looseJson('{"titles":["a",],"description":"d",}').description === 'd');
  ok('smart quotes are forgiven', looseJson('{“titles”:[“a”],"description":"d"}')?.titles?.[0] === 'a');
  const cut = looseJson('{"titles":["A","B","C"],"description":"Hello\\n\\nThread Link:\\nhttps://x","formula":[{"rule":"Count first","evidence":"6 of');
  ok('an answer cut off mid-way still yields the titles and post', cut?.titles?.length === 3 && /Thread Link/.test(cut.description), JSON.stringify(cut));
  ok('prose with no JSON gives nothing', looseJson('Sorry, I cannot help with that.') === null);

  // the run retries once, then says exactly why
  const URL = 'https://www.blackhatworld.com/seo/casino-ads.1800000/';
  const rows = Array.from({ length: 12 }, (_, i) => ({ threadId: String(3000 + i), title: `[ ${i + 5}x Free Review Copies ] - Brand${i} Guest Posts`, replyCount: 10 + i, startedAt: ago(i + 1), url: `https://www.blackhatworld.com/seo/t.${3000 + i}/` }));
  let calls = 0;
  const base = { now, step: () => {}, readThread: async () => ({ title: 'Casino ads', body: 'We run casino ads.' }), readListing: async () => Object.fromEntries(rows.map((r) => [r.threadId, r])) };
  const good = JSON.stringify({ titles: ['[ 10x Free Review Copies ] - Casino Ads'], description: `Hello\n\nThread Link:\n${URL}\n\nLooking for 10 reviewers.` });
  const out = await runReviewLab({ url: URL, copies: 10 }, { ...base, ask: async () => (++calls === 1 ? { text: '{"titles":["x"', stop: 'max_tokens', cost: 0.01 } : { text: good, cost: 0.01 }) });
  ok('a cut-off first answer is retried and the second one used', calls === 2 && out.titles[0].includes('Casino Ads'), `calls ${calls}`);
  ok('both calls are counted in the cost', Math.abs(out.cost - 0.02) < 1e-9, String(out.cost));
  let err = null;
  try { await runReviewLab({ url: URL, copies: 10 }, { ...base, ask: async () => ({ text: 'I would rather not.', stop: 'end_turn', cost: 0 }) }); } catch (e) { err = e; }
  ok('two bad answers stop with the reason, not a shrug', /replied in prose/.test(err?.message || ''), err?.message);
  ok('and what Claude sent is kept for you to see', err?.raw === 'I would rather not.');
}

// --- viral only, and filling the form from your thread ------------------------
{
  const rows = [5, 6, 4, 30, 3, 25, 5, 4].map((rep, i) => ({ threadId: String(i), title: 't' + i, replyCount: rep, startedAt: ago(1) }));
  const v = viralOnly(rows, { now });
  ok('viral means twice the median replies a day', v.bar === 10 && v.every((r, i) => r.rpd >= 10 || i < 3), JSON.stringify(v.map((r) => [r.rpd, r.viral])));
  ok('the busiest come first', v[0].rpd === 30 && v[1].rpd === 25);
  ok('a quiet section still gives three to learn from', viralOnly([1, 1, 1, 1].map((rep, i) => ({ threadId: String(i), title: 't', replyCount: rep, startedAt: ago(1) })), { now }).length === 3);
  const f = parseFill('```json\n{"gets":["1 campaign","tracking"],"features":["Casino ads","Agency accounts"],"requirements":"Review in 48h","delivery":"3-5 days"}\n```');
  ok('the form is filled from what Claude read', f.gets.length === 2 && f.features[0] === 'Casino ads' && f.delivery === '3-5 days');
  ok('a thread that says nothing gives empty fields, not invented ones', JSON.stringify(parseFill('{}')) === JSON.stringify({ gets: [], features: [], requirements: '', delivery: '', targets: '', keywords: [] }));
}

// --- long-tail keyword targeting ------------------------------------------
{
  const t = 'Domain Coasters - Aged Expired Domains for Indonesia Casino iGaming SEO';
  ok('"for Indonesia Casino iGaming SEO" targets a market and a niche', marketsIn(t).includes('indonesia') && nichesIn(t).includes('casino') && nichesIn(t).includes('igaming'));
  ok('"Indianapolis" is not India', !marketsIn('Local SEO for Indianapolis dentists').includes('india'));
  const lt = longTails([{ title: 'Free Review Copies [ JOHNRANK PBN ] POWERFUL CASINO PBN BACKLINKS THAI INDO KOREAN NICHE ACCEPTED', rpd: 6 },
                        { title: 'FREE REVIEW COPIES FOR CASINO Gambling PBN Do follow BACKLINKS DA 35 DR 50', rpd: 1 },
                        { title: "30X Free Review Copies : Ajju's EDU Authority Network", rpd: 13 }]);
  ok('long-tail phrases are pulled from the viral titles', lt.some((k) => /casino pbn/.test(k.phrase)), JSON.stringify(lt.slice(0, 6)));
  const URL = 'https://www.blackhatworld.com/seo/casino-ads.1800000/';
  const flat = { titles: ['[ 10x Free Review Copies ] - Bargain Ads'], description: `Looking for 10 reviewers.\nThread Link:\n${URL}` };
  ok('a bare title with no niche or market is flagged', checkReviewCopy(flat, { url: URL, copies: 10, targets: ['casino', 'indonesia'] }).some((p) => /no long-tail keyword/.test(p)));
  const tuned = { titles: ['[ 10x Free Review Copies ] - Bargain Ads: Google Ads Management for Indonesia Casino Brands'], description: flat.description };
  ok('a title built on the long-tail keyword passes', checkReviewCopy(tuned, { url: URL, copies: 10, targets: ['casino', 'indonesia'] }).length === 0, JSON.stringify(checkReviewCopy(tuned, { url: URL, copies: 10, targets: ['casino', 'indonesia'] })));
  const f = parseFill('{"targets":"Indonesia; casino, iGaming","keywords":["indonesia casino google ads","crypto meta ads"]}');
  ok('Fill brings back targets and long-tail keywords', f.targets.includes('Indonesia') && f.keywords.length === 2);
}

// --- 20 title ideas + CSV --------------------------------------------------
{
  const ideas = Array.from({ length: 22 }, (_, k) => ({ title: `Advault - Reverse Engineer Competitor Ads for ${['Indonesia', 'Thailand', 'Brazil', 'Philippines'][k % 4]} ${['Casino & iGaming', 'Crypto', 'Forex', 'Betting', 'Dating'][k % 5]} SEO ${k}`,
    niche: ['Casino & iGaming', 'Crypto', 'Forex', 'Betting', 'Dating'][k % 5], country: ['Indonesia', 'Thailand', 'Brazil', 'Philippines'][k % 4], keyword: 'X', intent: 'operators' }));
  ideas.push({ title: ideas[0].title });                 // a repeat
  const r = parseIdeas('```json\n' + JSON.stringify({ brand: 'Advault', service: 'Reverse Engineer Competitor Ads', ideas }) + '\n```');
  ok('twenty ideas, no more', r.ideas.length === 20 && r.brand === 'Advault');
  ok('repeats are dropped', new Set(r.ideas.map((i) => i.title)).size === 20);
  ok('each idea is numbered and measured', r.ideas[0].n === 1 && r.ideas[19].n === 20 && r.ideas[0].chars === r.ideas[0].title.length);
  ok('a title too short to hold a keyword is flagged', parseIdeas(JSON.stringify({ ideas: [{ title: 'Advault - Ads', niche: 'Casino', country: 'Indonesia' }] })).ideas[0].flags.includes('short'));
  const csv = ideasCsv([{ n: 1, title: 'Advault - Ads for "Indonesia", Casino', niche: 'Casino', country: 'Indonesia', keyword: 'indonesia casino ads', chars: 38, intent: 'operators' }], { thread: 'https://www.blackhatworld.com/seo/x.1/' });
  ok('the CSV opens cleanly in Excel: BOM, header, quotes and commas escaped', csv.startsWith('﻿"#","Title"') && csv.includes('"Advault - Ads for ""Indonesia"", Casino"') && csv.includes('\r\n'), csv);
  ok('the CSV names the main thread on every row', csv.includes('"https://www.blackhatworld.com/seo/x.1/"'));
  ok('the prompt carries the thread and the targets', /seller's stated niches \/ countries: Indonesia; casino/.test(ideasPrompt({ url: 'u', title: 't', body: 'b' }, { targets: 'Indonesia; casino' })));
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
