// The example thread behind Settings → Telegram → "Send a sample lead".
//
// It lives here, on its own, so the test can send the very same object the
// button sends. A sample written separately in the test would prove nothing:
// it could read fine while the one you actually receive is broken.
//
// Deliberately a thread the matcher has real work to do on - two cities, a
// named service, a stated budget - so the PM that comes out is a fair example
// of a real one rather than a best case.
export function sampleThread(now = Date.now()) {
  return {
    threadId: 'sample',
    title: 'Need local citations for a Dubai clinic, also ranking in the UK',
    author: 'sample_buyer',
    url: 'https://www.blackhatworld.com/forums/hire-a-freelancer.76/',
    snippet: 'We have a clinic in Dubai and a second location in Manchester. Need consistent NAP '
           + 'across directories that actually get indexed locally, plus GMB cleanup. Budget $400.',
    postedAt: new Date(now - 22 * 60000).toISOString(),
    postedAtSource: 'listing',
    lastActivityAt: new Date(now - 4 * 60000).toISOString(),
    replyCount: 3
  };
}

// A thread the matcher declines to score still has to produce a sendable
// sample, so the button never comes back empty-handed.
export const unscored = (s) => ({ ...s, score: 0, category: '', categoryLabel: '', matched: [], budget: '', budgetAmount: 0 });
