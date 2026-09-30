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

// pin=1 means you chose this copy as the MAIN system. A pinned lock is never
// taken over by time: when the main system is switched off the others stay
// on standby and say so, until you choose again on the one in front of you.
// auto=1/0 travels with the lock, so the machine you make main picks up the
// auto-mode setting the previous main had - it is one decision, not per machine.
// acct=<name> ties the bot to one BHW account (Settings → "This copy works for
// BHW account"). One bot is one account: a copy tied to a different account
// never takes this bot over, and says it needs a bot of its own.
export const lockText = (id, os, at = Date.now(), pin = false, auto = null, acct = '') =>
  `HAF owner=${id} os=${os} at=${at}${pin ? ' pin=1' : ''}${auto == null ? '' : ` auto=${auto ? 1 : 0}`}`
  + (acct ? ` acct=${encodeURIComponent(String(acct).trim()).slice(0, 40)}` : '');

export function parseLock(text) {
  const m = String(text || '').match(/HAF owner=([a-z0-9]+) os=([a-z0-9_]+) at=(\d+)( pin=1)?(?: auto=([01]))?(?: acct=(\S+))?/i);
  if (!m) return null;
  let acct = '';
  try { acct = m[6] ? decodeURIComponent(m[6]) : ''; } catch { acct = m[6] || ''; }
  return { id: m[1], os: m[2], at: Number(m[3]), pin: !!m[4], auto: m[5] == null ? null : m[5] === '1', acct };
}

/** Account names compare without case or surrounding spaces. */
export const sameAccount = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/** Tied to one account, signed in to BHW as another: the reason nothing may be sent ('' = fine). Pure. */
export function loginProblem(bound, me) {
  const b = String(bound || '').trim();
  if (!b || !String(me || '').trim() || sameAccount(b, me)) return '';
  return `Chrome is signed in to BHW as "${String(me).trim()}", but this copy is tied to "${b}" - nothing is sent until they match (sign in as ${b}, or change the account in Settings)`;
}

/** A name a person recognises, not an id. */
export const machineName = (os) => ({ mac: 'MacBook', win: 'Windows server', linux: 'Linux server', cros: 'Chromebook' }[String(os || '').toLowerCase()] || 'another machine');

/** 'mine' | 'take' (free or abandoned) | 'theirs' | 'other-account'. Pure, so the rule can be proven. */
export function decide(lock, myId, now = Date.now(), myAcct = '') {
  if (!lock) return 'take';
  if (lock.id === myId) return 'mine';
  // The bot is tied to another BHW account: never taken, whatever its age.
  if (lock.acct && myAcct && !sameAccount(lock.acct, myAcct)) return 'other-account';
  if (lock.pin) return 'theirs';                 // your choice stands until you change it
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
/** This copy's auto-mode setting, for the stamp. Read lazily so tests can stub config. */
async function myAuto() {
  try { const { config } = await chrome.storage.local.get('config'); return !!config?.autoMode; } catch { return null; }
}
/** The BHW account this copy is tied to in Settings ('' = not tied). */
export async function myAccount() {
  try { const { config } = await chrome.storage.local.get('config'); return String(config?.boundAccount || '').trim(); } catch { return ''; }
}

// ---- one copy per BHW account, across bots -----------------------------
//
// The bot lock stops two copies sharing ONE bot. Two copies on two PCs with
// two different bots but the SAME account would both send as that account.
// They share no bot, but they do share the Google profile's chrome.storage.sync
// when Chrome is signed in to the same Google account, so the account's owner
// is recorded there too: same rules as the bot lock (pinned stays, a stamp
// older than TTL_MS is free). Different Google profiles cannot see each other;
// the dashboard says so.
export const REGISTRY = 'hafAccountOwners';
const acctKey = (a) => String(a || '').trim().toLowerCase();

async function readRegistry() {
  try { return (await chrome.storage.sync.get(REGISTRY))[REGISTRY] || {}; } catch { return null; }
}
async function writeRegistry(acct, entry) {
  const reg = await readRegistry();
  if (!reg) return;
  try { await chrome.storage.sync.set({ [REGISTRY]: { ...reg, [acctKey(acct)]: entry } }); } catch { /* sync off */ }
}

/** 'mine' | 'take' | 'theirs' for the account registry entry. Pure. */
export function decideAccount(entry, myId, now = Date.now()) {
  if (!entry) return 'take';
  if (entry.id === myId) return 'mine';
  if (entry.pin) return 'theirs';
  return now - (entry.at || 0) > TTL_MS ? 'take' : 'theirs';
}

/** An active result, checked against the account registry. */
async function checkAccount(out, me, acct, now) {
  if (!acct || !out.active) return out;
  const reg = await readRegistry();
  if (!reg) return out;                                   // Sync unavailable: the bot lock alone decides
  const entry = reg[acctKey(acct)];
  const d = decideAccount(entry, me.id, now);
  if (d === 'theirs') return { active: false, known: true, accountElsewhere: true, owner: { ...entry, acct }, me, checkedAt: now };
  if (d === 'take' || now - (entry?.at || 0) > BEAT_MS || (out.owner?.pin && !entry?.pin)) {
    await writeRegistry(acct, { id: me.id, os: me.os, at: now, pin: !!(entry?.id === me.id ? entry.pin : false) || !!out.owner?.pin, bot: out.bot || entry?.bot || '' });
  }
  return out;
}

export async function ownership({ fresh = false } = {}) {
  const acct = await myAccount();
  if (!(await telegram.hasToken())) {
    return checkAccount({ active: true, known: false, reason: 'no bot token on this copy' }, await whoAmI(), acct, Date.now());
  }
  const { [STATE]: st } = await chrome.storage.local.get(STATE);
  const now = Date.now();
  if (!fresh && st && now - (st.checkedAt || 0) < CACHE_MS && sameAccount(st.myAccount, acct)) return st;

  const me = await whoAmI();
  let lock;
  try { lock = parseLock(await telegram.getLockText()); }
  catch (e) {
    return st ? { ...st, stale: true } : { active: false, known: false, me, reason: `could not check with Telegram: ${e.message}` };
  }

  let d = decide(lock, me.id, now, acct);
  if (d === 'take' || (d === 'mine' && (now - lock.at > BEAT_MS || !sameAccount(lock.acct, acct)))) {
    try {
      await telegram.setLockText(lockText(me.id, me.os, now, d === 'mine' && !!lock?.pin, await myAuto(), acct));
      if (d === 'take') {
        // Two copies can find the lock free in the same second. Look again:
        // whoever wrote last holds it, and the other stands down.
        await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
        const again = parseLock(await telegram.getLockText());
        if (again && again.id !== me.id) { lock = again; d = 'theirs'; }
      }
    } catch { /* could not write; the next check tries again */ }
  }

  let out = d === 'other-account'
    ? { active: false, known: true, wrongAccount: true, owner: lock, me, checkedAt: now }
    : d === 'theirs'
      ? { active: false, known: true, owner: lock, me, checkedAt: now }
      : { active: true, known: true, owner: { id: me.id, os: me.os, at: now, pin: d === 'mine' && !!lock?.pin, acct }, me, checkedAt: now };
  out = await checkAccount(out, me, acct, now);
  out.myAccount = acct;
  await chrome.storage.local.set({ [STATE]: out });
  return out;
}

/** You chose this one as the MAIN system. Pinned: it stays main until you choose another. */
export async function takeOver() {
  const me = await whoAmI();
  // What the previous main was doing about auto mode is carried over.
  let before = null;
  try { before = parseLock(await telegram.getLockText()); } catch { /* none readable */ }
  const acct = await myAccount();
  if (before && before.id !== me.id && before.acct && acct && !sameAccount(before.acct, acct)) {
    throw new Error(`this Telegram bot belongs to BHW account "${before.acct}", and this copy is tied to "${acct}". `
      + `Each account needs its own bot: make one in @BotFather and paste its token in Settings on this machine.`);
  }
  if (before && before.id !== me.id && before.acct && !acct) {
    throw new Error(`this Telegram bot belongs to BHW account "${before.acct}". Set "This copy works for BHW account" in Settings first.`);
  }
  // Same account, same bot: taking over is always yours. Carry auto mode across.
  const inherit = before && before.id !== me.id && before.auto != null ? before.auto : null;
  if (await telegram.hasToken()) await telegram.setLockText(lockText(me.id, me.os, Date.now(), true, inherit ?? await myAuto(), acct));
  if (acct) await writeRegistry(acct, { id: me.id, os: me.os, at: Date.now(), pin: true });
  const out = { active: true, known: true, owner: { id: me.id, os: me.os, at: Date.now(), pin: true, acct }, me, checkedAt: Date.now(), took: true, inheritAuto: inherit, from: before?.os || '', myAccount: acct };
  await chrome.storage.local.set({ [STATE]: out });
  return out;
}

/** In words, for the log, the dashboard and Telegram. */
export function describe(o) {
  if (!o) return 'ownership unknown';
  if (o.wrongAccount) return `STANDBY - this Telegram bot belongs to BHW account "${o.owner?.acct}" (on the ${machineName(o.owner?.os)}); this copy is tied to "${o.myAccount || 'another account'}" and needs its own bot`;
  if (o.accountElsewhere) {
    const mins = Math.max(0, Math.round((Date.now() - (o.owner?.at || 0)) / 60000));
    return `STANDBY - BHW account "${o.owner?.acct}" already runs on the ${machineName(o.owner?.os)} (last seen ${mins} min ago${o.owner?.pin ? ', chosen by you' : ''}); one copy per account`;
  }
  if (o.active) return o.known ? (o.owner?.pin ? 'this copy is the MAIN system (chosen by you)' : 'this copy is the active one') : `this copy is active (${o.reason || 'unshared'})`;
  if (!o.known) return `not acting: ${o.reason || 'ownership could not be checked'}`;
  const mins = Math.max(0, Math.round((Date.now() - (o.owner?.at || 0)) / 60000));
  return `STANDBY - the main system is the ${machineName(o.owner?.os)} (last seen ${mins} min ago)${o.owner?.pin ? ', chosen by you' : ''}`;
}
