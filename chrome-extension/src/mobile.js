// Phone dashboard (1.25): the same numbers and thread list as the Chrome dashboard, sent every 2 minutes to
// https://haf-mobile.vercel.app and read there on the phone through a private link. Pure helpers only; the
// sending lives in background.js. Thread data only: no keys, no tokens, no DM or reply drafts.

export const MOBILE_URL = 'https://haf-mobile.vercel.app';
export const MOBILE_EVERY_MS = 2 * 60000;
export const MOBILE_ROWS = 150;

/** A long random code (32 characters). Whoever has it can view this account's board, nothing else. */
export function newMobileKey() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const mobileLink = (key) => (key ? `${MOBILE_URL}/#k=${key}` : '');

const STATUS = {
  SENT: 'To do', NEW: 'To do', APPROVED: 'Queued', FILLED: 'Filled', POSTED: 'Posted', SKIPPED: 'Skipped',
  FAILED: 'Failed', BACKFILL: 'History', EXPIRED: 'Too late'
};
const tagsOf = (v) => (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(',').map((t) => t.trim()).filter(Boolean) : []);
const time = (iso) => { const t = new Date(iso || 0).getTime(); return isFinite(t) ? t : 0; };

/** One lead as a phone row: what the dashboard table shows, nothing more. */
export function mobileRow(l) {
  const other = l.kind === 'thread';
  return {
    id: String(l.threadId || ''),
    url: l.url || '',
    title: l.title || '',
    author: l.author || '',
    started: l.postedAt || l.foundAt || null,
    approx: !!(l.postedAtSource && l.postedAtSource !== 'listing'),
    replies: l.replyCount == null ? null : Number(l.replyCount),
    status: l.status || 'SENT',
    statusLabel: STATUS[l.status] || String(l.status || 'to do').toLowerCase().replace(/^./, (c) => c.toUpperCase()),
    pmSent: !!l.pmSent,
    ...(other
      ? {
          tag: l.status === 'POSTED' ? 'DONE' : l.bump ? 'BUMP' : 'NEW',
          intent: l.intent || 'INFO',
          source: l.sourceLabel || '',
          forum: l.forum || '',
          matched: tagsOf(l.watchWords),
          answer: !!String(l.draftApproved || l.draft || '').trim()
        }
      : {
          score: l.score ?? null,
          budget: l.budget || '',
          category: l.categoryLabel || '',
          matched: tagsOf(l.matched).slice(0, 4)
        })
  };
}

/** Newest first, as the dashboard opens; capped so the snapshot stays small. */
export function mobileRows(leads, kind) {
  return leads
    .filter((l) => String(l.threadId) !== 'sample' && (kind === 'other' ? l.kind === 'thread' : l.kind !== 'thread'))
    .sort((a, b) => time(b.postedAt || b.foundAt) - time(a.postedAt || a.foundAt))
    .slice(0, MOBILE_ROWS)
    .map(mobileRow);
}
