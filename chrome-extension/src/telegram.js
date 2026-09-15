// Telegram, called straight from the extension.
//
// No Apps Script, no server, no webhook. Chrome talks to api.telegram.org the
// same way it talks to Anthropic, and the bot token lives in the vault beside
// the Claude key, so it survives resets and reinstalls.
//
// Two messages per lead, deliberately:
//   1. the card (score, replies, when it was posted, links) plus the PUBLIC
//      reply in a <pre> block
//   2. the PRIVATE message in a <pre> block of its own
//
// One tap on a <pre> block copies the whole thing on the Telegram mobile app,
// which is the point: see the lead on your phone, copy, paste, send. Splitting
// them means neither is ever truncated by Telegram's 4096-character limit, and
// you are never copying the public reply when you wanted the PM.

import * as vault from './vault.js';

const API = 'https://api.telegram.org/bot';
const LIMIT = 4000;           // Telegram's cap is 4096; leave room for tags
const MAX_PER_POLL = 6;       // a quiet burst, not a flood, if many land at once

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const getToken = () => vault.getSecret('telegram');
export const setToken = (t) => vault.setSecret('telegram', String(t).trim());
export const clearToken = () => vault.removeSecret('telegram');

async function call(method, body) {
  const token = await getToken();
  if (!token) throw new Error('No Telegram bot token saved.');
  const res = await fetch(`${API}${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.description || `Telegram returned ${res.status}`);
  return data.result;
}

/** Cut a <pre> block to fit, rather than letting Telegram reject the message. */
function preBlock(label, text, room) {
  const body = esc(String(text || ''));
  if (!body) return '';
  const wrap = `\n\n${label}\n<pre>${body}</pre>`;
  if (wrap.length <= room) return wrap;
  return `\n\n${label}\n<pre>${body.slice(0, Math.max(0, room - label.length - 40))}\n[cut - full text is on the dashboard]</pre>`;
}

export async function sendLead(lead, cfg) {
  const chatId = cfg.telegramChatId;
  if (!chatId) throw new Error('No Telegram chat id saved.');

  const head = String(lead.card || `<b>${esc(lead.title)}</b>`);
  const first = head + preBlock('📋 <b>Public reply</b> (tap to copy)', lead.draft, LIMIT - head.length);
  await call('sendMessage', { chat_id: chatId, text: first, parse_mode: 'HTML',
                              disable_web_page_preview: true });

  if (lead.dm) {
    const title = `✉️ <b>PM to ${esc(lead.author || 'the poster')}</b>` +
      (lead.dmUrl ? ` · <a href="${esc(lead.dmUrl)}">open the PM page</a>` : '');
    await call('sendMessage', { chat_id: chatId,
      text: title + preBlock('(tap to copy)', lead.dm, LIMIT - title.length),
      parse_mode: 'HTML', disable_web_page_preview: true });
  }
}

/**
 * Send a batch after a poll. Never throws and never blocks the poll: Telegram
 * being down must not cost you the lead, which is already in the database.
 */
export async function sendLeads(leads, cfg) {
  if (!cfg.telegramEnabled || !cfg.telegramChatId || !(await getToken())) return { sent: 0 };
  let sent = 0, error = '';
  for (const lead of leads.slice(0, MAX_PER_POLL)) {
    try { await sendLead(lead, cfg); sent++; }
    catch (e) { error = e.message; break; }        // one failure means stop, not retry
  }
  const skipped = Math.max(0, leads.length - MAX_PER_POLL);
  if (skipped) {
    try {
      await call('sendMessage', { chat_id: cfg.telegramChatId,
        text: `…and ${skipped} more on the dashboard.`, parse_mode: 'HTML' });
    } catch { /* the count is a nicety */ }
  }
  return { sent, error, skipped };
}

/** Prove the token and chat id work, from the Settings page. */
export async function test(cfg) {
  const me = await call('getMe', {});
  if (!cfg.telegramChatId) throw new Error('Saved the token. Now add your chat id - message @userinfobot on Telegram and it replies with it.');
  await call('sendMessage', {
    chat_id: cfg.telegramChatId,
    parse_mode: 'HTML',
    text: '✅ <b>HAF Watcher is connected.</b>\n\nNew threads will arrive here automatically, '
        + 'each as two messages: the public reply, then the PM. Tap a block to copy it.'
  });
  return { bot: me.username };
}

export async function status(cfg) {
  const v = await vault.info('telegram');
  return { ...v, chatId: cfg.telegramChatId || '', enabled: !!cfg.telegramEnabled };
}
