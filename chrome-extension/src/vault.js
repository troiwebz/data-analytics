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

// Secrets the vault holds, by field name. Adding one here is all that is
// needed: storage, mirroring, restore and reset protection all follow.
export const SECRETS = { anthropic: 'key', telegram: 'tgToken' };

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

  const has = (v) => Object.values(SECRETS).some((f) => v && v[f]);
  if (has(local) && !has(mirror)) {           // profile copy lost or never written
    try { await chrome.storage.sync.set({ [VAULT]: local }); }
    catch { /* sync unavailable; the local copy still works */ }
    return local;
  }
  if (!has(local) && has(mirror)) {           // this is the case that used to lose the key
    await chrome.storage.local.set({ [VAULT]: mirror });
    return { ...mirror, restored: true };
  }
  // Both present: newer wins, so a secret saved on another machine takes over.
  if (has(local) && has(mirror) && (mirror.savedAt || 0) > (local.savedAt || 0)) {
    await chrome.storage.local.set({ [VAULT]: mirror });
    return { ...mirror, restored: true };
  }
  return local;
}

export const getSecret = async (name) => (await read())[SECRETS[name]] || '';
export const getKey = () => getSecret('anthropic');

/**
 * Is chrome.storage.sync actually carrying the keys right now?
 *
 * Answers the question "will a new machine, signed into the same Google
 * account, pick these up by itself" without needing to move anything there
 * to find out. False for two different reasons the caller cannot tell apart
 * from here - Sync is off in this Chrome profile, or nothing has been saved
 * yet - so it is reported alongside `available` (Sync reachable at all) and
 * `hasSecrets` (something is actually in it), not collapsed into one flag.
 */
export async function syncStatus() {
  try {
    const mirror = (await chrome.storage.sync.get(VAULT))[VAULT] || {};
    const hasSecrets = Object.values(SECRETS).some((f) => mirror[f]);
    return { available: true, hasSecrets, savedAt: mirror.savedAt || 0 };
  } catch {
    return { available: false, hasSecrets: false, savedAt: 0 };
  }
}

export async function setSecret(name, value) {
  const field = SECRETS[name];
  if (!field) throw new Error(`Unknown secret: ${name}`);
  // Storing what it already holds must not count as a change: a write fires
  // chrome.storage.onChanged, which re-renders the dashboard, which reads the
  // vault again. Writing on every read would never settle.
  const current = await readLocal();
  if (current[field] === String(value) && (await readSync())[field] === String(value)) return current;
  const entry = { ...current, [field]: String(value), savedAt: Date.now() };
  await chrome.storage.local.set({ [VAULT]: entry });          // must not fail
  try { await chrome.storage.sync.set({ [VAULT]: entry }); } catch { /* local is enough */ }
  return entry;
}
export const setKey = (key) => setSecret('anthropic', key);

/** Forget one secret; the others in the vault are untouched. */
export async function removeSecret(name) {
  const field = SECRETS[name];
  const entry = { ...(await read()), savedAt: Date.now() };
  delete entry[field];
  delete entry.restored;
  const empty = !Object.values(SECRETS).some((f) => entry[f]);
  if (empty) {
    await chrome.storage.local.remove(VAULT);
    try { await chrome.storage.sync.remove(VAULT); } catch { /* nothing mirrored */ }
    return;
  }
  await chrome.storage.local.set({ [VAULT]: entry });
  try { await chrome.storage.sync.set({ [VAULT]: entry }); } catch { /* local is enough */ }
}
export const removeKey = () => removeSecret('anthropic');

export const mask = (k) => (k ? `${k.slice(0, 11)}…${k.slice(-4)}` : '');

/** What the Settings page shows about the stored key, without revealing it. */
export async function info(name = 'anthropic') {
  const field = SECRETS[name];
  const v = await read();
  return {
    stored: !!v[field],
    hint: mask(v[field]),
    savedAt: v.savedAt || 0,
    restored: !!v.restored,
    mirrored: !!(await readSync())[field]
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
  return { cleared: RESETTABLE.length, keyKept: !!v[SECRETS.anthropic] };
}
