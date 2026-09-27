// A 7-day memory of every thread seen on the watched forums and the site-wide
// feed - matched or not. Search on the phone reads this, so a word you type
// finds anything recent on the site, not only what a filter let through.
//
// Also where bumps are noticed: the feeds report last-post time, so a thread
// that comes back with a newer time than the one stored was bumped.

const KEY = 'threadIndex';       // { [threadId]: entry }
const DAY = 86400000;

export async function getIndex() {
  return (await chrome.storage.local.get(KEY))[KEY] || {};
}

const ms = (iso) => (iso ? new Date(iso).getTime() : 0);

/**
 * Record what a feed just showed. Returns what is new to the index and what
 * has been bumped since it was last seen.
 *
 * A bump is: already indexed, last activity now at least a minute later than
 * before, and first seen more than 30 minutes ago - two sources reporting the
 * same thread seconds apart must not count as a bump.
 */
export async function upsertIndex(items, sourceKey, { days = 7 } = {}) {
  const index = await getIndex();
  const now = Date.now();
  const fresh = [], bumped = [];
  for (const it of items || []) {
    const id = String(it.threadId || '');
    if (!id) continue;
    const prev = index[id];
    const activity = it.lastActivityAt || it.postedAt || null;
    if (!prev) {
      index[id] = {
        threadId: id, url: it.url, title: it.title || '', author: it.author || '',
        snippet: String(it.snippet || '').slice(0, 300), source: sourceKey,
        forum: it.forum || '', forumNode: it.forumNode || '',
        startedAt: it.startedAt || null, lastActivityAt: activity,
        firstSeenAt: new Date(now).toISOString(), bumpedAt: null, bumps: 0
      };
      fresh.push(it);
      continue;
    }
    const newer = ms(activity) - ms(prev.lastActivityAt) >= 60000;
    const settled = now - ms(prev.firstSeenAt) >= 30 * 60000;
    if (newer && settled) {
      prev.bumps = (prev.bumps || 0) + 1;
      prev.bumpedAt = activity;
      bumped.push({ ...it, prevActivityAt: prev.lastActivityAt, bumps: prev.bumps });
    }
    if (newer) prev.lastActivityAt = activity;
    if (!prev.title && it.title) prev.title = it.title;
    if (!prev.snippet && it.snippet) prev.snippet = String(it.snippet).slice(0, 300);
    if (!prev.startedAt && it.startedAt) prev.startedAt = it.startedAt;
  }
  // Prune by last activity, so a thread still being bumped stays findable.
  const cutoff = now - Math.max(1, days) * DAY;
  for (const [id, e] of Object.entries(index)) {
    if (Math.max(ms(e.lastActivityAt), ms(e.firstSeenAt)) < cutoff) delete index[id];
  }
  await chrome.storage.local.set({ [KEY]: index });
  return { fresh, bumped, size: Object.keys(index).length };
}

export async function patchIndex(threadId, patch) {
  const index = await getIndex();
  const e = index[String(threadId)];
  if (!e) return false;
  index[String(threadId)] = { ...e, ...patch };
  await chrome.storage.local.set({ [KEY]: index });
  return true;
}

const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** NEW, BUMP or DONE, given the index entry and the lead row (if any). */
export function tagOf(entry, lead) {
  if (lead && (lead.status === 'POSTED' || lead.pmSent)) return 'DONE';
  if ((entry?.bumps || 0) > 0 || lead?.bump) return 'BUMP';
  return 'NEW';
}

/**
 * Everything in the index matching the words, newest activity first.
 * mode: 'all' | 'new' | 'bump' | 'done'. Leads are consulted for DONE.
 */
export async function searchIndex(query, { mode = 'all', leads = [], limit = 40 } = {}) {
  const index = await getIndex();
  const byLead = new Map((leads || []).map((l) => [String(l.threadId), l]));
  const words = String(query || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const rxs = words.map((w) => new RegExp(`(^|[^a-z0-9])${escapeRx(w)}`, 'i'));
  const out = [];
  const rows = Object.values(index);
  // Leads carry threads the index never saw (HAF, older installs) - search them too.
  for (const l of leads || []) {
    if (!index[String(l.threadId)] && String(l.threadId) !== 'sample') {
      rows.push({ threadId: String(l.threadId), url: l.url, title: l.title, author: l.author,
                  snippet: l.snippet, source: l.kind === 'thread' ? l.source : 'haf',
                  startedAt: l.postedAt, lastActivityAt: l.lastActivityAt || l.postedAt, bumps: l.bump ? 1 : 0, fromLead: true });
    }
  }
  for (const e of rows) {
    const hay = `${e.title}\n${e.snippet || ''}`;
    if (!rxs.every((rx) => rx.test(hay))) continue;
    const tag = tagOf(e, byLead.get(String(e.threadId)));
    if (mode === 'new' && tag !== 'NEW') continue;
    if (mode === 'bump' && tag !== 'BUMP') continue;
    if (mode === 'done' && tag !== 'DONE') continue;
    out.push({ ...e, tag });
  }
  out.sort((a, b) => Math.max(ms(b.lastActivityAt), ms(b.startedAt)) - Math.max(ms(a.lastActivityAt), ms(a.startedAt)));
  return out.slice(0, limit);
}

export async function indexStats() {
  const index = await getIndex();
  const rows = Object.values(index);
  const bySource = {};
  for (const e of rows) bySource[e.source || '?'] = (bySource[e.source || '?'] || 0) + 1;
  return { size: rows.length, bySource, bumped: rows.filter((e) => e.bumps > 0).length };
}
