// The credential store. Deliberately separate from everything else.
//
// The Anthropic key is the one thing here that is expensive to replace: losing
// it means going back to console.anthropic.com and creating a new one. So it
// does not live with the settings, is never part of a config object, and is
// never touched by a reset, a defaults reload, a config migration or a database
// clear. Those wipe `config`, `ai`, `recentLeads`, `seenThreads`; the vault is
// none of them.
//
// It is written to two places on every save:
//   chrome.storage.local  — belongs to this installed extension
//   chrome.storage.sync   — belongs to your Chrome profile
//
// Local is emptied whenever Chrome decides this is a different extension: you
// remove and re-add the folder, or load it from a new path. The profile copy
// is not, so read() refills local from it. The key therefore survives a pull,
// a reload, a reinstall, a new folder, a reset, and a second machine signed
// into the same Chrome.
//
// Only removeKey() ever deletes it, and only when you press Remove.

const VAULT = 'vault';

/** Storage keys a reset is allowed to clear. The vault is not among them. */
export const RESETTABLE = ['config', 'ai', 'recentLeads', 'seenThreads', 'rateState', 'log', 'staged'];

const readLocal = async () => (await chrome.storage.local.get(VAULT))[VAULT] || {};
const readSync = async () => {
  try { return (await chrome.storage.sync.get(VAULT))[VAULT] || {}; }
  catch { return {}; }                       // sync switched off or unavailable
};

/**
 * The vault, refilling whichever copy has gone missing from the other.
 * Returns { key, savedAt, restored } — restored is true only on the read that
 * did the refilling, so the UI can say "just now" and not say it again.
 */
export async function read() {
  const local = await readLocal();
  const mirror = await readSync();

  if (local.key && !mirror.key) {             // profile copy lost or never written
    try { await chrome.storage.sync.set({ [VAULT]: local }); } catch { /* local is enough */ }
    return local;
  }
  if (!local.key && mirror.key) {             // this is the case that used to lose the key
    await chrome.storage.local.set({ [VAULT]: mirror });
    return { ...mirror, restored: true };
  }
  // Both present: newer wins, so a key saved on another machine takes over.
  if (local.key && mirror.key && (mirror.savedAt || 0) > (local.savedAt || 0)) {
    await chrome.storage.local.set({ [VAULT]: mirror });
    return { ...mirror, restored: true };
  }
  return local;
}

export const getKey = async () => (await read()).key || '';

export async function setKey(key) {
  const entry = { key: String(key), savedAt: Date.now() };
  await chrome.storage.local.set({ [VAULT]: entry });          // must not fail
  try { await chrome.storage.sync.set({ [VAULT]: entry }); } catch { /* local is enough */ }
  return entry;
}

export async function removeKey() {
  await chrome.storage.local.remove(VAULT);
  try { await chrome.storage.sync.remove(VAULT); } catch { /* nothing mirrored */ }
}

export const mask = (k) => (k ? `${k.slice(0, 11)}…${k.slice(-4)}` : '');

/** What the Settings page shows about the stored key, without revealing it. */
export async function info() {
  const v = await read();
  return {
    stored: !!v.key,
    hint: mask(v.key),
    savedAt: v.savedAt || 0,
    restored: !!v.restored,
    mirrored: !!(await readSync()).key
  };
}

/**
 * Wipe the extension's data and keep the credentials. Anything that offers to
 * "reset" or "start over" goes through here, so there is one place where the
 * vault is protected rather than a rule each caller has to remember.
 */
export async function resetKeepingVault() {
  await chrome.storage.local.remove(RESETTABLE);
  const v = await read();                     // refills local from the mirror
  return { cleared: RESETTABLE.length, keyKept: !!v.key };
}
