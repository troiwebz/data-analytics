// Keys that travel with the folder.
//
// The vault lives in chrome.storage, which belongs to one Chrome profile on
// one machine. Copying the extension to a server therefore copies the code and
// none of the setup, so every move meant retyping an Anthropic key and a
// Telegram token by hand over RDP - which is exactly the part that is painful
// and error-prone.
//
// So: if a file called haf-secrets.json sits next to manifest.json, the
// extension reads it on install and on every browser start and fills in
// whatever is missing. Set it up once, keep the file in the folder, and every
// machine you copy that folder to configures itself.
//
// The file format is deliberately the same one Settings already exports, so
// "Download settings file (with keys)" produces something that works as a seed
// with no editing at all.
//
// Two things this is careful about:
//
//   It never overwrites. A key already in the vault wins, because the browser
//   you are sitting at is the more recent authority - a stale seed file must
//   not undo a key you rotated this morning.
//
//   It is not in git and not in the zip by default. The file is listed in
//   .gitignore, and tools/build-zip.sh leaves it out unless you pass
//   --with-secrets. Anyone holding the folder holds the keys, which is the
//   trade being made here and the reason the default is off.
//
// It is NOT in web_accessible_resources, so no web page can read it; only the
// extension's own code can.

import { importAll } from './backup.js';

export const SEED_FILE = 'haf-secrets.json';
const STAMP_KEY = 'seedStamp';

/** Cheap content fingerprint, so an edited file is picked up and an unchanged one is not. */
function stamp(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36) + ':' + text.length;
}

/**
 * Read the seed file, if there is one.
 *
 * A missing file is the normal case and not an error - most installs will not
 * have one. Anything unreadable is reported, because a seed file that is
 * present but broken is worth knowing about rather than silently ignoring.
 */
export async function readSeed() {
  let text;
  try {
    const res = await fetch(chrome.runtime.getURL(SEED_FILE), { cache: 'no-store' });
    if (!res.ok) return { none: true };
    text = await res.text();
  } catch { return { none: true }; }
  if (!text || !text.trim()) return { none: true };
  try {
    return { data: JSON.parse(text), stamp: stamp(text) };
  } catch (e) {
    return { error: `${SEED_FILE} is not valid JSON: ${e.message}` };
  }
}

/**
 * Apply it, filling gaps only.
 *
 * `force` is for the button in Settings: "use the file even where I already
 * have something". Nothing else ever overwrites.
 */
export async function applySeed({ force = false } = {}) {
  const seed = await readSeed();
  if (seed.none) return { none: true };
  if (seed.error) return { error: seed.error };

  const { [STAMP_KEY]: seen } = await chrome.storage.local.get(STAMP_KEY);
  if (!force && seen === seed.stamp) return { already: true, stamp: seed.stamp };

  const vault = await import('./vault.js');
  const data = { ...seed.data };

  // Accept the plain shape as well as the export shape, because someone
  // hand-writing this file will reasonably write the obvious thing.
  if (!data.kind) {
    const s = {};
    if (data.anthropicKey || data.anthropic) s.anthropic = data.anthropicKey || data.anthropic;
    if (data.telegramToken || data.telegram) s.telegram = data.telegramToken || data.telegram;
    const cfg = { ...(data.config || {}) };
    if (data.telegramChatId) cfg.telegramChatId = String(data.telegramChatId);
    if (!Object.keys(s).length && !Object.keys(cfg).length) {
      return { error: `${SEED_FILE} has no keys or settings in it.` };
    }
    data.kind = 'haf-watcher-settings';
    data.secrets = s;
    data.config = cfg;
  }

  // Never clobber a secret already here. The vault is the live one.
  const kept = [];
  if (!force && data.secrets) {
    for (const name of ['anthropic', 'telegram']) {
      if (data.secrets[name] && (await vault.getSecret(name))) { delete data.secrets[name]; kept.push(name); }
    }
  }

  // Same for settings: a config already saved in this browser wins, so only
  // the keys it does not have are taken from the file.
  const { config: current } = await chrome.storage.local.get('config');
  if (!force && current && Object.keys(current).length && data.config) {
    const fill = {};
    for (const [k, v] of Object.entries(data.config)) {
      const has = current[k];
      if (has === undefined || has === '' || has === null) fill[k] = v;
    }
    data.config = { ...current, ...fill };
  }

  // Secrets are written here rather than through importAll, because importAll
  // refuses a file with no settings in it - which is right for the Restore
  // button, where an empty file is a mistake, and wrong here: "just my two
  // keys" is the most useful seed file there is.
  const took = [];
  for (const name of ['anthropic', 'telegram']) {
    const v = data.secrets?.[name];
    if (v) { await vault.setSecret(name, String(v).trim()); took.push(name); }
  }

  let settings = 0;
  if (data.config && Object.keys(data.config).length) {
    const r = await importAll({ ...data, secrets: null });
    if (r.error) return { error: r.error };
    settings = r.settings || 0;
  }

  if (!took.length && !settings) return { error: `${SEED_FILE} had nothing left to apply.` };
  await chrome.storage.local.set({ [STAMP_KEY]: seed.stamp });
  return { ok: true, secrets: took, kept, settings, stamp: seed.stamp };
}

/** Has a seed file been applied, and which one? For the Settings panel. */
export async function seedStatus() {
  const seed = await readSeed();
  const { [STAMP_KEY]: seen } = await chrome.storage.local.get(STAMP_KEY);
  if (seed.none) return { present: false, applied: false };
  if (seed.error) return { present: true, applied: false, error: seed.error };
  const d = seed.data || {};
  const s = d.secrets || {};
  return {
    present: true,
    applied: seen === seed.stamp,
    has: {
      anthropic: Boolean(s.anthropic || d.anthropicKey || d.anthropic),
      telegram: Boolean(s.telegram || d.telegramToken || d.telegram),
      chatId: Boolean(d.telegramChatId || d.config?.telegramChatId)
    },
    settings: Object.keys(d.config || {}).length
  };
}
