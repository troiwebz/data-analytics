// Reading the competition, locally and for free.
//
// The replies already on a thread are the other freelancers bidding for the
// same job. Between them they establish what the buyer is actually shopping
// for - and, more usefully, they show what none of them has answered. On
// "Crypto Runner" three people offered to run the ads and not one of them
// answered the only constraint the buyer actually stated: keep the accounts
// off suspension. That silence is the opening.
//
// This works out three things without calling anybody:
//
//   asks     what the buyer asked for, as terms taken from their own post
//   covered  which of those the competition has already answered
//   gap      which of those nobody has touched
//
// That is what makes the reply a combination rather than one more voice: it is
// written knowing the whole thread, and aimed at the part of it still open.
//
// IMPORTANT, and the reason this does not simply merge their claims: what a
// rival says they can do is not evidence that you can do it. Their words are
// used to work out what the JOB needs, never to put a capability in your
// mouth. What you can honestly claim comes from your own brief in Settings.

const STOP = new Set(`a about after all also am an and any are as at be been before being between both but by can cant
cannot could did do does doing done dont down during each else etc even ever every few for from further get got had has
have having he her here hers him his how i if in into is it its itself just me more most much must my need needs no nor
not now of off on once only or other our out over own please put re same shall she should so some such than that the
their them then there these they this those through to too under until up us use used using very want wants was way we
were what when where which while who whom why will with within would you your yours hi hello hey thanks thank looking
look need someone anyone experienced good great best job work working project budget price paid pay pm dm message send
sent reply replies thread forum member sure make made makes also im ive you'll youll
dont doesnt cant wont isnt arent didnt havent hasnt theyre youre were'nt lets let's
`.split(/\s+/).filter(Boolean));

const norm = (s) => String(s || '').toLowerCase()
  .replace(/[’']/g, '')            // don't -> dont, so one stopword covers both
  .replace(/[^a-z0-9\s-]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// Crude but stable: enough to match "account" to "accounts", "running" to "run".
function stem(w) {
  let x = w;
  if (x.length > 4 && /ies$/.test(x)) return x.slice(0, -3) + 'y';
  if (x.length > 3 && /(sses|shes|ches|xes)$/.test(x)) return x.slice(0, -2);
  if (x.length > 3 && /s$/.test(x) && !/ss$/.test(x)) x = x.slice(0, -1);
  if (x.length > 5 && /ing$/.test(x)) x = x.slice(0, -3);
  if (x.length > 4 && /ed$/.test(x)) x = x.slice(0, -2);
  return x;
}

const key = (term) => term.split(' ').map(stem).join(' ');

/**
 * Terms worth answering, taken from the buyer's own words. Runs of words that
 * are not filler, up to three long, longest first - "ads suspended" says more
 * than "ads", so it is preferred where both are present.
 */
export function asksIn(text, { max = 12 } = {}) {
  const words = norm(text).split(' ').filter(Boolean);
  const runs = [];
  let run = [];
  for (const w of words) {
    if (STOP.has(w) || w.length < 3 || /^\d+$/.test(w)) { if (run.length) runs.push(run); run = []; }
    else run.push(w);
  }
  if (run.length) runs.push(run);

  const seen = new Map();
  for (const r of runs) {
    for (let n = Math.min(3, r.length); n >= 1; n--) {
      for (let i = 0; i + n <= r.length; i++) {
        const term = r.slice(i, i + n).join(' ');
        const k = key(term);
        const score = n * 10 + Math.min(term.length, 20);
        const prev = seen.get(k);
        if (!prev) seen.set(k, { term, key: k, score, count: 1 });
        else { prev.count++; prev.score += 2; if (term.length > prev.term.length) prev.term = term; }
      }
    }
  }

  // A shorter term inside a longer one it always travels with is noise.
  const all = [...seen.values()].sort((a, b) => b.score - a.score);
  const kept = [];
  for (const t of all) {
    if (kept.some((k2) => k2.key !== t.key && k2.key.includes(t.key))) continue;
    kept.push(t);
    if (kept.length >= max) break;
  }
  return kept;
}

const mentions = (haystackKey, term) => haystackKey.includes(term.key);

/**
 * What the thread collectively says, and what it leaves open.
 *
 * Returns { asks, covered, gap, crowded, rivals } where
 *   covered  asks a rival has already answered, with who answered them
 *   gap      asks nobody has answered - the reason to reply at all
 *   crowded  what two or more of them are all promising, so saying it again
 *            puts you in a queue rather than ahead of it
 */
export function readRivals(body, replies = [], opts = {}) {
  const asks = asksIn(body, opts);
  const list = (replies || []).map((r) => ({
    author: r.author || '',
    text: String(r.text || ''),
    key: key(norm(r.text || ''))
  }));

  const covered = [], gap = [];
  for (const a of asks) {
    const who = list.filter((r) => mentions(r.key, a)).map((r) => r.author || 'someone');
    if (who.length) covered.push({ ...a, by: who });
    else gap.push(a);
  }

  // What they are all saying. Two people promising the same thing rarely word
  // it the same way, so this counts single words rather than phrases - the
  // phrases differ, the vocabulary does not.
  const theirs = new Map();
  for (const r of list) {
    const seen = new Set();
    for (const w of norm(r.text).split(' ')) {
      if (STOP.has(w) || w.length < 4 || /^\d+$/.test(w)) continue;
      const k = stem(w);
      if (seen.has(k)) continue;
      seen.add(k);
      const prev = theirs.get(k);
      if (prev) prev.by.push(r.author || 'someone');
      else theirs.set(k, { term: w, key: k, by: [r.author || 'someone'] });
    }
  }
  const crowded = [...theirs.values()].filter((t) => t.by.length > 1)
    .sort((a, b) => b.by.length - a.by.length || b.term.length - a.term.length).slice(0, 6);

  return { asks, covered, gap, crowded, rivals: list.length };
}

/**
 * The analysis, as a few lines for Claude to work from. Empty when there is
 * nothing to say - no replies yet means no competition to read, and an empty
 * section in a prompt is worse than no section.
 */
export function rivalBrief(body, replies = []) {
  const r = readRivals(body, replies);
  if (!r.rivals) return '';
  const out = [];
  if (r.crowded.length) {
    out.push(`all of them are already promising: ${r.crowded.map((t) => t.term).join(', ')}`);
  }
  if (r.covered.length) {
    out.push(`answered by someone already: ${r.covered.slice(0, 6).map((t) => t.term).join(', ')}`);
  }
  if (r.gap.length) {
    out.push(`asked for but STILL UNANSWERED by anyone: ${r.gap.slice(0, 6).map((t) => t.term).join(', ')}`);
  }
  return out.join('\n');
}

/**
 * A fingerprint of what a draft was written from. Two drafts with the same
 * fingerprint would come out the same, so asking again is money for nothing.
 */
export function sourceOf(lead) {
  const r = readRivals(lead.body || lead.snippet || '', lead.replies || []);
  return {
    body: (lead.body || '').length,
    rivals: r.rivals,
    gap: r.gap.slice(0, 6).map((t) => t.key).join('|')
  };
}

/**
 * Is there an upgrade to be had, or would this be the same answer again?
 *
 * Claude is only worth calling when something it has not seen would change what
 * it writes. Returns a short reason, or null to stand down and cost nothing.
 */
export function upgradeReason(lead) {
  const has = lead.aiSpecifics?.tips?.length || lead.aiSpecifics?.length;
  if (!has) return 'no lines written yet';

  const now = sourceOf(lead);
  const was = lead.aiFrom;
  if (!was) return 'written before the thread itself was read';
  if (now.body > (was.body || 0) + 40) return 'the post has been read since';
  if (now.rivals > (was.rivals || 0)) {
    const n = now.rivals - was.rivals;
    return `${n} new repl${n === 1 ? 'y' : 'ies'} on the thread to answer`;
  }
  if (now.gap && now.gap !== was.gap) return 'what nobody has answered has changed';
  return null;                        // nothing new to say: keep what is there
}
