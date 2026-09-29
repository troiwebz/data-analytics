// One bot, one BHW account, one copy acting on them.
//
// Two copies of this extension sharing a bot token is how a public reply went
// up that nobody approved: the message "auto on" reached a second copy running
// older rules, on a machine nobody was looking at. Copies on different
// machines share no storage, so the lock lives in the one place they all
// reach - the bot itself. Its short description holds who owns it and when
// they last said so; every copy with the token can read it.
//
// The owner acts. Every other copy is PASSIVE: it reads nothing from BHW,
// polls nothing from Telegram, sends nothing and posts nothing, and says so on
// its dashboard with a button to take over. A lock nobody has refreshed for
// twelve minutes is free - the owner's Chrome is closed - and is taken.

import * as telegram from './telegram.js';

const STATE = 'ownerState';
const ID = 'instanceId';
export const TTL_MS = 12 * 60000;      // a lock older than this is abandoned
export const BEAT_MS = 4 * 60000;      // the owner re-stamps it this often
const CACHE_MS = 60000;

export const lockText = (id, os, at = Date.now()) => `HAF owner=${id} os=${os} at=${at}`;

export function parseLock(text) {
  const m = String(text || '').match(/HAF owner=([a-z0-9]+) os=([a-z0-9_]+) at=(\d+)/i);
  return m ? { id: m[1], os: m[2], at: Number(m[3]) } : null;
}

/** 'mine' | 'take' (free or abandoned) | 'theirs'. Pure, so the rule can be proven. */
export function decide(lock, myId, now = Date.now()) {
  if (!lock) return 'take';
  if (lock.id === myId) return 'mine';
  return now - lock.at > TTL_MS ? 'take' : 'theirs';
}

export async function whoAmI() {
  let { [ID]: id } = await chrome.storage.local.get(ID);
  if (!id) { id = Math.random().toString(36).slice(2, 10); await chrome.storage.local.set({ [ID]: id }); }
  let os = 'unknown';
  try { os = (await chrome.runtime.getPlatformInfo()).os || 'unknown'; } catch { /* tests, old Chrome */ }
  return { id, os };
}

/**
 * Is this copy the one that acts?
 *   active  - yes, do the work
 *   known   - the answer came from the bot itself, not from a guess
 * With no bot token there is nothing to share, so the copy is active and the
 * answer is not "known". When Telegram cannot be reached the last answer
 * stands; with no last answer the copy does not act by itself.
 */
export async function ownership({ fresh = false } = {}) {
  if (!(await telegram.hasToken())) return { active: true, known: false, reason: 'no bot token on this copy' };
  const { [STATE]: st } = await chrome.storage.local.get(STATE);
  const now = Date.now();
  if (!fresh && st && now - (st.checkedAt || 0) < CACHE_MS) return st;

  const me = await whoAmI();
  let lock;
  try { lock = parseLock(await telegram.getLockText()); }
  catch (e) {
    return st ? { ...st, stale: true } : { active: false, known: false, me, reason: `could not check with Telegram: ${e.message}` };
  }

  let d = decide(lock, me.id, now);
  if (d === 'take' || (d === 'mine' && now - lock.at > BEAT_MS)) {
    try {
      await telegram.setLockText(lockText(me.id, me.os, now));
      if (d === 'take') {
        // Two copies can find the lock free in the same second. Look again:
        // whoever wrote last holds it, and the other stands down.
        await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
        const again = parseLock(await telegram.getLockText());
        if (again && again.id !== me.id) { lock = again; d = 'theirs'; }
      }
    } catch { /* could not write; the next check tries again */ }
  }

  const out = d === 'theirs'
    ? { active: false, known: true, owner: lock, me, checkedAt: now }
    : { active: true, known: true, owner: { id: me.id, os: me.os, at: now }, me, checkedAt: now };
  await chrome.storage.local.set({ [STATE]: out });
  return out;
}

/** You are sitting at this one: make it the owner. The other goes passive within a minute. */
export async function takeOver() {
  const me = await whoAmI();
  await telegram.setLockText(lockText(me.id, me.os));
  const out = { active: true, known: true, owner: { id: me.id, os: me.os, at: Date.now() }, me, checkedAt: Date.now(), took: true };
  await chrome.storage.local.set({ [STATE]: out });
  return out;
}

/** In words, for the log, the dashboard and Telegram. */
export function describe(o) {
  if (!o) return 'ownership unknown';
  if (o.active) return o.known ? 'this copy is the active one' : `this copy is active (${o.reason || 'unshared'})`;
  if (!o.known) return `not acting: ${o.reason || 'ownership could not be checked'}`;
  const mins = Math.max(0, Math.round((Date.now() - (o.owner?.at || 0)) / 60000));
  return `PASSIVE - another copy of HAF Watcher (on ${o.owner?.os || 'another machine'}, last seen ${mins} min ago) owns this bot`;
}
