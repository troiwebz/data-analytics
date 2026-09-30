// Keys from Terminal.
//
// `bash ~/haf-watcher/tools/set-keys.sh` (or set-keys.ps1 on Windows) writes
// haf-keys.json into the folder Chrome loads. This reads it every minute and,
// when it has changed, puts the Claude key, the bot token and the chat id in
// place - replacing what was there, because typing a key in Terminal is you
// saying "use this one". Nothing else in your settings is touched.
//
// The file never leaves this machine: it is git-ignored, the updaters never
// ship or overwrite it, and it is not web-accessible.

import * as vault from './vault.js';

export const KEYS_FILE = 'haf-keys.json';
const STAMP = 'keysFileStamp';

function stamp(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/** Load the keys file if it is new. Returns what it did, or null when there was nothing to do. */
export async function loadKeysFile({ setChatId } = {}) {
  let text;
  try {
    const res = await fetch(chrome.runtime.getURL(KEYS_FILE), { cache: 'no-store' });
    if (!res.ok) return null;
    text = await res.text();
  } catch { return null; }
  if (!text || !text.trim()) return null;
  const s = stamp(text);
  const { [STAMP]: seen } = await chrome.storage.local.get(STAMP);
  if (seen === s) return null;
  let d;
  try { d = JSON.parse(text); } catch (e) { return { error: `${KEYS_FILE} is not valid JSON: ${e.message}` }; }
  const took = [];
  const clean = (v) => String(v || '').trim();
  if (clean(d.anthropicKey)) {
    if (!/^sk-ant-/.test(clean(d.anthropicKey))) return { error: 'the Anthropic key in haf-keys.json does not start with sk-ant- - check it and run set-keys again' };
    await vault.setSecret('anthropic', clean(d.anthropicKey)); took.push('Claude key');
  }
  if (clean(d.telegramToken)) {
    if (!/^\d+:[\w-]{20,}$/.test(clean(d.telegramToken))) return { error: 'the bot token in haf-keys.json does not look like 123456:ABC… - check it and run set-keys again' };
    await vault.setSecret('telegram', clean(d.telegramToken)); took.push('bot token');
  }
  if (clean(d.telegramChatId) && setChatId) {
    if (!/^-?\d{4,}$/.test(clean(d.telegramChatId))) return { error: 'the chat id in haf-keys.json should be digits only' };
    await setChatId(clean(d.telegramChatId)); took.push('chat id');
  }
  await chrome.storage.local.set({ [STAMP]: s });
  return { took };
}
