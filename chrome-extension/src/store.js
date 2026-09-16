// Thin persistence layer over chrome.storage.local.

const SEEN_KEY = 'seenThreads';   // { [threadId]: epochMs }
const LEADS_KEY = 'recentLeads';  // last 500 leads, newest first (dashboard)
const RATE_KEY = 'rateState';     // { day: 'YYYY-MM-DD', count: n, lastPostAt: epochMs }
const LOG_KEY = 'log';            // last 100 log lines
const SEEN_TTL_MS = 21 * 24 * 60 * 60 * 1000;

export async function getSeen() {
  const { [SEEN_KEY]: seen } = await chrome.storage.local.get(SEEN_KEY);
  return seen || {};
}

export async function markSeen(threadIds) {
  const seen = await getSeen();
  const now = Date.now();
  for (const id of threadIds) seen[id] = now;
  for (const [id, ts] of Object.entries(seen)) {
    if (now - ts > SEEN_TTL_MS) delete seen[id];   // keep storage bounded
  }
  await chrome.storage.local.set({ [SEEN_KEY]: seen });
}

/** Forget every seen thread so the next poll runs the first-run backfill again. */
export async function clearSeen() {
  await chrome.storage.local.set({ [SEEN_KEY]: {} });
}

export async function isFirstRun() {
  return Object.keys(await getSeen()).length === 0;
}

/** What you decided about a lead. Re-finding a thread must never undo it. */
const DECISIONS = ['status', 'pmSent', 'pmSentAt', 'pmFrom', 'postUrl', 'decidedAt', 'priorContact', 'staged'];

/**
 * Bought with a request to the forum, so a later parse that happens not to
 * carry them must not throw them away - a backfill row would otherwise wipe
 * the post body a poll had already read, and the next draft would be written
 * from the title again.
 */
const EXPENSIVE = ['body', 'replies', 'aiSpecifics', 'aiFrom'];

/**
 * One row per thread, ever.
 *
 * "Load last 48h" forgets which threads have been seen and polls again, so
 * everything already in the table came back as a second row - same thread,
 * same time, listed twice. Leads are keyed by thread id now: a thread already
 * known keeps what you decided about it and takes the newer parse of
 * everything else.
 */
export async function recordLeads(leads) {
  const { [LEADS_KEY]: prev } = await chrome.storage.local.get(LEADS_KEY);
  const byId = new Map();
  for (const l of prev || []) byId.set(String(l.threadId), l);

  const fresh = [];
  for (const l of leads) {
    const id = String(l.threadId);
    const old = byId.get(id);
    if (!old) { byId.set(id, l); fresh.push(l); continue; }
    const keep = {};
    for (const k of DECISIONS) if (old[k] !== undefined) keep[k] = old[k];
    // Only fall back to the old copy where the new parse has nothing: a poll
    // that did read the thread should win, a backfill that did not should not.
    for (const k of EXPENSIVE) {
      const fresh = l[k];
      const empty = fresh == null || fresh === '' || (Array.isArray(fresh) && !fresh.length);
      if (empty && old[k] !== undefined) keep[k] = old[k];
    }
    // A thread already decided on keeps that decision; a fresh find of an
    // untouched thread is allowed to set its own status.
    byId.set(id, { ...l, ...keep, foundAt: old.foundAt || l.foundAt });
  }

  // Newest first, by when we found it, and capped as before.
  const next = [...byId.values()]
    .sort((a, b) => new Date(b.foundAt || 0) - new Date(a.foundAt || 0))
    .slice(0, 500);
  await chrome.storage.local.set({ [LEADS_KEY]: next });
  return { added: fresh.length, merged: leads.length - fresh.length };
}

/** Collapse rows already duplicated before the keying above existed. */
export async function dedupeLeads() {
  const { [LEADS_KEY]: prev } = await chrome.storage.local.get(LEADS_KEY);
  const rows = prev || [];
  const byId = new Map();
  for (const l of rows) {
    const id = String(l.threadId);
    const old = byId.get(id);
    if (!old) { byId.set(id, l); continue; }
    // Keep whichever copy carries a decision, so a duplicate cannot lose one.
    const merged = { ...old, ...l };
    for (const k of DECISIONS) {
      if (old[k] !== undefined && old[k] !== '' && old[k] !== false) merged[k] = old[k];
      if (l[k] !== undefined && l[k] !== '' && l[k] !== false) merged[k] = l[k];
    }
    byId.set(id, merged);
  }
  const next = [...byId.values()].sort((a, b) => new Date(b.foundAt || 0) - new Date(a.foundAt || 0));
  if (next.length !== rows.length) await chrome.storage.local.set({ [LEADS_KEY]: next });
  return { before: rows.length, after: next.length, removed: rows.length - next.length };
}

export async function getLeads() {
  const { [LEADS_KEY]: leads } = await chrome.storage.local.get(LEADS_KEY);
  return leads || [];
}

/** The Sheet stores `matched` comma-joined; locally it is an array. */
function toTags(v) {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') return v.split(',').map((t) => t.trim()).filter(Boolean);
  return [];
}

/** Merge rows from the Sheet: Sheet status wins, local extras (staged, error) are kept. */
export async function mergeLeads(rows) {
  const leads = await getLeads();
  const byId = new Map(leads.map((l) => [String(l.threadId), l]));
  for (const r of rows) {
    const id = String(r.threadId);
    const local = byId.get(id) || {};
    byId.set(id, { ...local, ...r, matched: toTags(r.matched) });
  }
  const next = [...byId.values()].sort((a, b) => new Date(b.foundAt) - new Date(a.foundAt)).slice(0, 500);
  await chrome.storage.local.set({ [LEADS_KEY]: next });
  return next.length;
}

/** Patch replyCount on any local lead present in the map. */
export async function updateReplyCounts(counts) {
  const leads = await getLeads();
  let changed = false;
  const next = leads.map((l) => {
    const c = counts[l.threadId];
    if (c != null && c !== l.replyCount) { changed = true; return { ...l, replyCount: c }; }
    return l;
  });
  if (changed) await chrome.storage.local.set({ [LEADS_KEY]: next });
}

export async function updateLead(threadId, patch) {
  const leads = await getLeads();
  const next = leads.map((l) => (l.threadId === threadId ? { ...l, ...patch } : l));
  await chrome.storage.local.set({ [LEADS_KEY]: next });
}

function today() { return new Date().toLocaleDateString('en-CA'); }

export async function getRateState() {
  const { [RATE_KEY]: r } = await chrome.storage.local.get(RATE_KEY);
  if (!r || r.day !== today()) return { day: today(), count: 0, lastPostAt: 0, dmCount: 0, lastDmAt: 0 };
  return r;
}

/**
 * Both limits are yours. Every one of the four numbers is editable in
 * Settings, and **0 means no limit**: 0 a day is unlimited, 0 minutes apart is
 * back to back. Nothing here is a floor the extension insists on.
 *
 * Returns { ok: true } or { ok: false, reason } without mutating state.
 */
const wait = (ms) => (ms >= 60000 ? `${Math.ceil(ms / 60000)} min` : `${Math.ceil(ms / 1000)} sec`);

function gate(used, lastAt, cap, gapSeconds, what) {
  if (cap > 0 && used >= cap) return { ok: false, reason: `your daily ${what} limit of ${cap} is used up` };
  const left = (gapSeconds || 0) * 1000 - (Date.now() - (lastAt || 0));
  if (gapSeconds > 0 && lastAt && left > 0) {
    return { ok: false, reason: `your ${wait(gapSeconds * 1000)} gap: ${wait(left)} to go` };
  }
  return { ok: true };
}

export async function checkRateLimit(cfg) {
  const r = await getRateState();
  return gate(r.count, r.lastPostAt, Number(cfg.maxPostsPerDay) || 0, Number(cfg.minSecondsBetweenPosts) || 0, 'reply');
}

export async function checkDmLimit(cfg) {
  const r = await getRateState();
  return gate(r.dmCount || 0, r.lastDmAt, Number(cfg.maxDmsPerDay) || 0, Number(cfg.minSecondsBetweenDms) || 0, 'PM');
}

export async function recordDm() {
  const r = await getRateState();
  await chrome.storage.local.set({
    [RATE_KEY]: { ...r, day: today(), dmCount: (r.dmCount || 0) + 1, lastDmAt: Date.now() }
  });
}

/** Undo counts against the cap too, or an undone post still costs you a slot. */
export async function unrecordDm() {
  const r = await getRateState();
  await chrome.storage.local.set({ [RATE_KEY]: { ...r, dmCount: Math.max(0, (r.dmCount || 0) - 1) } });
}

export async function unrecordPost() {
  const r = await getRateState();
  await chrome.storage.local.set({ [RATE_KEY]: { ...r, count: Math.max(0, (r.count || 0) - 1) } });
}

export async function recordPost() {
  const r = await getRateState();
  await chrome.storage.local.set({
    [RATE_KEY]: { ...r, day: today(), count: r.count + 1, lastPostAt: Date.now() }
  });
}

export async function log(msg, level = 'info') {
  const { [LOG_KEY]: prev } = await chrome.storage.local.get(LOG_KEY);
  const line = { t: new Date().toISOString(), level, msg: String(msg).slice(0, 400) };
  await chrome.storage.local.set({ [LOG_KEY]: [line, ...(prev || [])].slice(0, 100) });
  console[level === 'error' ? 'error' : 'log']('[HAF]', msg);
}

export async function getLog() {
  const { [LOG_KEY]: l } = await chrome.storage.local.get(LOG_KEY);
  return l || [];
}

// ---- staged tabs: { [threadId]: { tabId, at, title } } ---------------------
const STAGED_KEY = 'stagedTabs';

export async function getStaged() {
  const { [STAGED_KEY]: s } = await chrome.storage.local.get(STAGED_KEY);
  return s || {};
}
export async function setStaged(threadId, entry) {
  const s = await getStaged();
  if (entry) s[threadId] = entry; else delete s[threadId];
  await chrome.storage.local.set({ [STAGED_KEY]: s });
}
export async function removeStagedByTab(tabId) {
  const s = await getStaged();
  for (const [id, e] of Object.entries(s)) if (e.tabId === tabId) delete s[id];
  await chrome.storage.local.set({ [STAGED_KEY]: s });
}
