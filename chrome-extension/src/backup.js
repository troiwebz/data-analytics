// Settings that survive the machine.
//
// Until now only the two secrets were mirrored - the Claude key and the bot
// token live in the vault, which writes to chrome.storage.sync. Everything
// else (your chat id, your limits, your timezone, your brief, your templates)
// sat in chrome.storage.local, which is per-install. Move to a new machine, or
// reinstall from a different folder, and Chrome hands you a brand new empty
// local store: the extension comes up looking configured - the secrets are
// there - with every setting silently back to its default.
//
// Two ways out, because they fail in different situations:
//
//   SYNC     automatic, needs the same Chrome profile signed in. Nothing to
//            remember and nothing to carry.
//   FILE     a JSON file you keep. Works across Google accounts, browsers and
//            machines, and works when sync is off or full.
//
// chrome.storage.sync is quota'd: 102,400 bytes in total but only 8,192 per
// item. The config is about 12KB in one piece, so storing it whole would be
// rejected - quietly, in a callback nobody reads. It goes one key per setting
// instead: ~40 items, largest about 3.5KB, well inside both limits.

import { DEFAULT_CONFIG } from './config.js';

const PREFIX = 'c:';
const STAMP = 'cfgSavedAt';

/** Settings only. The vault owns the secrets and mirrors them itself. */
const keys = (cfg) => Object.keys(cfg).filter((k) => k !== 'configVersion');

/**
 * Mirror the settings to sync. Never throws: a full or switched-off sync must
 * not break saving your settings locally, which is the part that matters now.
 */
export async function pushConfig(cfg) {
  if (!cfg) return { ok: false };
  const out = { [STAMP]: Date.now() };
  const tooBig = [];
  for (const k of keys(cfg)) {
    const v = JSON.stringify(cfg[k] ?? null);
    // 8,192 per item. Anything over is left behind rather than failing the
    // whole write, and named so it is not a silent hole in the backup.
    if (v.length > 8000) { tooBig.push(k); continue; }
    out[PREFIX + k] = cfg[k] ?? null;
  }
  try {
    await chrome.storage.sync.set(out);
    return { ok: true, saved: Object.keys(out).length - 1, tooBig };
  } catch (e) {
    return { ok: false, error: e.message, tooBig };
  }
}

/** What sync is holding, or null when it has nothing. */
export async function readSynced() {
  let all;
  try { all = await chrome.storage.sync.get(null); } catch { return null; }
  const at = all?.[STAMP] || 0;
  const cfg = {};
  for (const [k, v] of Object.entries(all || {})) {
    if (k.startsWith(PREFIX)) cfg[k.slice(PREFIX.length)] = v;
  }
  return Object.keys(cfg).length ? { cfg, at } : null;
}

/**
 * Bring settings back from sync on a fresh install.
 *
 * Only when there is nothing local to lose. A machine that already has
 * settings keeps them: silently replacing what is in front of you with what
 * another machine last wrote is how you lose an afternoon's tuning without
 * noticing, and sync has no way to tell which of the two you meant.
 */
export async function restoreIfEmpty() {
  const { config } = await chrome.storage.local.get('config');
  if (config && Object.keys(config).length > 3) return { restored: false, reason: 'already set up here' };
  const synced = await readSynced();
  if (!synced) return { restored: false, reason: 'nothing in sync yet' };
  await chrome.storage.local.set({ config: { ...DEFAULT_CONFIG, ...synced.cfg } });
  return { restored: true, at: synced.at, keys: Object.keys(synced.cfg).length };
}

/**
 * Everything, as a file.
 *
 * Secrets are left OUT unless asked for. A downloaded file goes to Downloads,
 * where it may be backed up to a cloud, opened by anything, or sent to someone
 * by accident - and a live Claude key in it is a live Claude key in all of
 * those places. Including them is a deliberate tick, not the default.
 */
export async function exportAll({ secrets = false } = {}) {
  const { config } = await chrome.storage.local.get('config');
  const out = {
    kind: 'haf-watcher-settings',
    version: chrome.runtime.getManifest().version,
    exportedAt: new Date().toISOString(),
    config: config || {}
  };
  if (secrets) {
    const vault = await import('./vault.js');
    out.secrets = {
      anthropic: (await vault.getSecret('anthropic')) || '',
      telegram: (await vault.getSecret('telegram')) || ''
    };
  }
  return out;
}

/**
 * Put a file back. Returns what it did rather than assuming, because an
 * import that quietly does nothing is worse than one that refuses.
 */
export async function importAll(data) {
  if (!data || data.kind !== 'haf-watcher-settings') {
    return { error: 'That is not a HAF Watcher settings file.' };
  }
  const cfg = data.config;
  if (!cfg || typeof cfg !== 'object' || !Object.keys(cfg).length) {
    return { error: 'That file has no settings in it.' };
  }
  await chrome.storage.local.set({ config: { ...DEFAULT_CONFIG, ...cfg } });
  await pushConfig({ ...DEFAULT_CONFIG, ...cfg });

  let restored = [];
  if (data.secrets) {
    const vault = await import('./vault.js');
    for (const name of ['anthropic', 'telegram']) {
      if (data.secrets[name]) { await vault.setSecret(name, data.secrets[name]); restored.push(name); }
    }
  }
  return { ok: true, settings: Object.keys(cfg).length, secrets: restored, from: data.version || 'unknown' };
}
