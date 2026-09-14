// Thin persistence layer over chrome.storage.local.

const SEEN_KEY = 'seenThreads';   // { [threadId]: epochMs }
const LEADS_KEY = 'recentLeads';  // last 50 leads, newest first (popup UI)
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

export async function isFirstRun() {
  return Object.keys(await getSeen()).length === 0;
}

export async function recordLeads(leads) {
  const { [LEADS_KEY]: prev } = await chrome.storage.local.get(LEADS_KEY);
  const next = [...leads, ...(prev || [])].slice(0, 50);
  await chrome.storage.local.set({ [LEADS_KEY]: next });
}

export async function getLeads() {
  const { [LEADS_KEY]: leads } = await chrome.storage.local.get(LEADS_KEY);
  return leads || [];
}

export async function updateLead(threadId, patch) {
  const leads = await getLeads();
  const next = leads.map((l) => (l.threadId === threadId ? { ...l, ...patch } : l));
  await chrome.storage.local.set({ [LEADS_KEY]: next });
}

function today() { return new Date().toLocaleDateString('en-CA'); }

export async function getRateState() {
  const { [RATE_KEY]: r } = await chrome.storage.local.get(RATE_KEY);
  if (!r || r.day !== today()) return { day: today(), count: 0, lastPostAt: 0 };
  return r;
}

/** Returns { ok: true } or { ok: false, reason } without mutating state. */
export async function checkRateLimit(cfg) {
  const r = await getRateState();
  if (r.count >= cfg.maxPostsPerDay) {
    return { ok: false, reason: `daily cap reached (${cfg.maxPostsPerDay})` };
  }
  const waitMs = cfg.minMinutesBetweenPosts * 60000 - (Date.now() - r.lastPostAt);
  if (r.lastPostAt && waitMs > 0) {
    return { ok: false, reason: `spacing: ${Math.ceil(waitMs / 60000)} min to go` };
  }
  return { ok: true };
}

export async function recordPost() {
  const r = await getRateState();
  await chrome.storage.local.set({
    [RATE_KEY]: { day: today(), count: r.count + 1, lastPostAt: Date.now() }
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
