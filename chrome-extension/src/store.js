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

export async function recordLeads(leads) {
  const { [LEADS_KEY]: prev } = await chrome.storage.local.get(LEADS_KEY);
  const next = [...leads, ...(prev || [])].slice(0, 500);
  await chrome.storage.local.set({ [LEADS_KEY]: next });
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
