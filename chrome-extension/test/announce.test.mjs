// The "is this new" rule, on its own - no chrome API, no network, no mocking.
//
// Every one of the "old thread bumped again" reports this week traced back to
// a DIFFERENT copy of this rule going stale: the whole-batch stamp, the
// unbounded backlog, the missing age cutoff. Three near-identical rules were
// three chances to be wrong in three different ways, none of which the other
// two copies could catch. This file is the rule proven once, directly,
// against every one of those cases at the same time - so a future change that
// breaks any of them breaks a test in under a second, not a bug report three
// days later.
import { SILENT_STATUSES, TOO_OLD, BASELINE, isCandidate, isTooOld, selectQueue, queueCounts }
  from '../src/announce.js';

let fails = 0;
const ok = (n, c, e = '') => { if (c) console.log('  ok  ' + n); else { fails++; console.log('  FAIL ' + n + '  ' + e); } };

const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();
const lead = (id, over = {}) => ({
  threadId: id, title: `thread ${id}`, author: 'buyer', foundAt: hoursAgo(1),
  draft: 'd', dm: 'p', status: 'SENT', ...over
});
const CFG = { announceMaxAgeHours: 12 };

// --- the plain case ----------------------------------------------------------
ok('a fresh, undecided lead is a candidate', isCandidate(lead('1')));
ok('nothing is a candidate before it exists', !isCandidate(null) && !isCandidate(undefined));

// --- v0.78's bug: the whole batch stamped, not just what was sent -----------
// (that bug lived in the CALLER, not this rule - but the rule has to make
// "already sent" permanent however it got that way, which is what this checks)
ok('once tgSentAt is set, nothing makes it a candidate again',
   !isCandidate(lead('2', { tgSentAt: new Date().toISOString() })));
ok('a sentinel value locks it out identically to a real timestamp',
   !isCandidate(lead('3', { tgSentAt: TOO_OLD })) && !isCandidate(lead('4', { tgSentAt: BASELINE })));

// --- v0.81's bug: the backlog reached back through all of history -----------
ok('every SILENT status is excluded, not just POSTED',
   SILENT_STATUSES.every((st) => !isCandidate(lead('s', { status: st }))));
ok('and nothing outside that list is silenced by accident',
   isCandidate(lead('open', { status: 'SENT' })) && isCandidate(lead('open2', { status: 'FILLED' })));
ok('a sample lead is never a candidate', !isCandidate(lead('sample')));

// --- v0.83's bug: no age limit, so pre-stamp history looked brand new -------
ok('a thread from an hour ago is not too old', !isTooOld(lead('r', { foundAt: hoursAgo(1) }), CFG));
ok('a thread from two days ago is', isTooOld(lead('o', { foundAt: hoursAgo(48) }), CFG));
ok('right at the boundary counts as too old, not "almost"',
   isTooOld(lead('b', { foundAt: hoursAgo(12) }), CFG));
ok('0 turns the age limit off entirely', !isTooOld(lead('anc', { foundAt: hoursAgo(9000) }), { announceMaxAgeHours: 0 }));
ok('a missing setting defaults to 12h, not "no limit"',
   isTooOld(lead('d', { foundAt: hoursAgo(48) }), {}));

// --- the combined decision, as the caller actually uses it -------------------
{
  const leads = [
    lead('recent1', { foundAt: hoursAgo(1) }),
    lead('recent2', { foundAt: hoursAgo(6) }),
    lead('old1', { foundAt: hoursAgo(48) }),
    lead('old2', { foundAt: hoursAgo(200) }),
    lead('done', { status: 'POSTED' }),
    lead('gone', { tgSentAt: new Date().toISOString() }),
    lead('history', { status: 'BACKFILL' }),
    lead('demo', { threadId: 'sample' })
  ];
  const { send, stale } = selectQueue(leads, CFG);
  ok('only the genuinely new, recent leads are queued to send',
     send.map((l) => l.threadId).sort().join(',') === 'recent1,recent2', JSON.stringify(send.map((l) => l.threadId)));
  ok('the old-but-never-announced ones are named for stamping, not silently dropped',
     stale.map((l) => l.threadId).sort().join(',') === 'old1,old2', JSON.stringify(stale.map((l) => l.threadId)));
  ok('newest first', send[0].threadId === 'recent1', JSON.stringify(send.map((l) => l.threadId)));

  const counts = queueCounts(leads, CFG);
  ok('queueCounts agrees with selectQueue exactly', counts.queued === send.length, JSON.stringify(counts));
  ok('and folds in leads already marked too old from an earlier check',
     queueCounts([...leads, lead('already-stale', { tgSentAt: TOO_OLD })], CFG).stale === stale.length + 1,
     JSON.stringify(queueCounts([...leads, lead('already-stale', { tgSentAt: TOO_OLD })], CFG)));
}

// --- the exact regression: a thread bumped by someone else's reply ----------
{
  const reposted = lead('bumped', {
    status: 'POSTED', tgSentAt: hoursAgo(2), foundAt: new Date().toISOString()   // re-parsed just now
  });
  ok('a POSTED, already-announced lead re-found today is still never a candidate',
     !isCandidate(reposted), JSON.stringify(reposted));
  ok('and selectQueue agrees', selectQueue([reposted], CFG).send.length === 0);
}

// --- the newest regression: a thread from yesterday, first SEEN today -------
//
// A thread can sit off the RSS window and off page 1 of the listing until
// something bumps it - a reply, an edit - back into view. The first time our
// own poll ever notices it is today, so foundAt is "just now" even though the
// thread itself is a day old. Checking age against foundAt alone said "brand
// new" and sent it straight to Telegram: exactly "I still get a previous day
// bumped thread". postedAt - the forum's own start date for the thread, read
// off the listing page - does not move when it gets bumped, so it is the one
// that has to decide "is this recent", not foundAt.
{
  const bumpedYesterday = lead('late1', { postedAt: hoursAgo(30), foundAt: hoursAgo(0.01) });
  ok('a thread posted yesterday is too old however recently WE found it',
     isTooOld(bumpedYesterday, CFG), JSON.stringify(bumpedYesterday));
  ok('and selectQueue holds it back, not sends it',
     selectQueue([bumpedYesterday], CFG).stale.map((l) => l.threadId).join() === 'late1',
     JSON.stringify(selectQueue([bumpedYesterday], CFG)));

  // The ordinary case is unaffected: a thread with no listing data yet (no
  // postedAt) still falls back to foundAt exactly as before.
  ok('with no postedAt at all, foundAt still decides it', !isTooOld(lead('nolisting', { foundAt: hoursAgo(1) }), CFG));

  // And a thread that really was posted minutes ago, found minutes ago, still
  // goes straight out.
  const trulyNew = lead('late2', { postedAt: hoursAgo(0.05), foundAt: hoursAgo(0.05) });
  ok('a genuinely fresh thread is unaffected', !isTooOld(trulyNew, CFG));
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
