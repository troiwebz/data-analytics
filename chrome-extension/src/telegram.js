// Telegram, called straight from the extension.
//
// No Apps Script, no server, no webhook. Chrome talks to api.telegram.org the
// same way it talks to Anthropic, and the bot token lives in the vault beside
// the Claude key, so it survives resets and reinstalls.
//
// The private message goes FIRST, because it is the one that gets sent. The
// public reply follows it, and either can be switched off in Settings.
//
//   1. the card (score, replies, when it was posted, links) plus the PM in a
//      <pre> block, with a link to the prefilled PM page and to your inbox
//   2. the public reply in a <pre> block of its own
//
// One tap on a <pre> block copies the whole thing on the Telegram mobile app,
// which is the point: see the lead on your phone, copy, paste, send. Splitting
// them means neither is ever truncated by Telegram's 4096-character limit, and
// you are never copying the public reply when you wanted the PM.

import * as vault from './vault.js';
import { plain } from './templates.js';

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

const INBOX = 'https://www.blackhatworld.com/direct-messages/';

/**
 * The PM. First, because it is the message that actually gets sent, and a lead
 * with no PM draft says so rather than quietly sending nothing - which is how
 * a missing draft used to look exactly like "Telegram only sends the reply".
 */
function pmMessage(lead) {
  const head = String(lead.card || `<b>${esc(lead.title)}</b>`) +
    `\n\n✉️ <b>PM to ${esc(lead.author || 'the poster')}</b>` +
    (lead.dmUrl ? `\n<a href="${esc(lead.dmUrl)}">Open the PM page for ${esc(lead.author || 'them')}</a>` : '') +
    `\n<a href="${INBOX}">Your BHW inbox</a>` +
    (lead.dmTitle ? `\nSubject: <code>${esc(lead.dmTitle)}</code>` : '');

  const body = plain(lead.dm || '').trim();
  return head + (body
    ? preBlock('(tap to copy)', body, LIMIT - head.length)
    : '\n\n<i>No PM draft on this lead. Open it on the dashboard and press Rebuild drafts.</i>');
}

const replyMessage = (lead) => {
  const head = '📋 <b>Public reply</b>' + (lead.url ? ` · <a href="${esc(lead.url)}">open the thread</a>` : '');
  const body = plain(lead.draft || '').trim();
  return body ? head + preBlock('(tap to copy)', body, LIMIT - head.length) : '';
};

/**
 * The approval buttons.
 *
 * Tapping one of these on your phone makes Chrome do the thing: the PM button
 * sends the private message, the reply button posts the public reply. Nothing
 * is ever sent without a tap.
 *
 * callback_data has a hard 64-byte limit, so it is one letter and the thread
 * id: d=send the PM, p=post the reply, s=skip this lead.
 */
export const ACTIONS = { d: 'send the PM', p: 'post the public reply', s: 'skip this lead' };

function keyboard(lead, kind, cfg) {
  if (!cfg.telegramApprovals) return undefined;
  const id = String(lead.threadId || '');
  if (!id || id === 'sample') return undefined;        // a sample must never post
  const row = kind === 'PM'
    ? [{ text: '✉️ Send this PM', callback_data: `d:${id}` }]
    : [{ text: '🚀 Post this reply', callback_data: `p:${id}` }];
  return { inline_keyboard: [row, [{ text: '⏭ Skip', callback_data: `s:${id}` }]] };
}

/**
 * Both parts are sent independently. They used to share one try block, so a
 * failure on the second swallowed the first and the batch stopped - which is
 * why a lead could arrive as the public reply alone with nothing explaining it.
 */
export async function sendLead(lead, cfg, { onPart } = {}) {
  const chatId = cfg.telegramChatId;
  if (!chatId) throw new Error('No Telegram chat id saved.');
  const what = cfg.telegramSend || 'both';

  const parts = [];
  if (what !== 'reply') parts.push(['PM', pmMessage(lead)]);
  if (what !== 'pm') parts.push(['public reply', replyMessage(lead)]);

  const failed = [];
  for (const [name, text] of parts) {
    if (!text) continue;
    try {
      await call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true,
                                  reply_markup: keyboard(lead, name, cfg) });
      onPart?.(name, null);
      continue;
    } catch (e) {
      // Telegram rejects a whole message over one bad tag. Losing half of a
      // lead silently is how "it only sends the public reply" happened and
      // stayed invisible, so say which half went and what Telegram said.
      if (/pars|entit|tag|markup/i.test(e.message)) {
        try {
          // Better a PM with no formatting than no PM.
          await call('sendMessage', { chat_id: chatId, text: stripTags(text), disable_web_page_preview: true });
          onPart?.(name, null);
          continue;
        } catch { /* fall through to reporting the original */ }
      }
      failed.push(`${name}: ${e.message}`);
      onPart?.(name, e);
    }
  }
  if (failed.length) throw new Error(failed.join(' | '));
}

/** Last resort when Telegram will not accept the markup: send the words. */
const stripTags = (html) => String(html)
  .replace(/<\/?(b|i|u|s|a|code|pre|tg-spoiler|blockquote)\b[^>]*>/gi, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  .slice(0, LIMIT);

export async function sendLeads(leads, cfg) {
  if (!cfg.telegramEnabled || !cfg.telegramChatId || !(await getToken())) return { sent: 0 };
  let sent = 0, parts = 0;
  const errors = [];
  for (const lead of leads.slice(0, MAX_PER_POLL)) {
    try {
      await sendLead(lead, cfg, { onPart: () => parts++ });
      sent++;
    } catch (e) {
      // One lead failing no longer stops the rest: they are unrelated, and
      // stopping hid the failure behind "nothing else arrived".
      errors.push(`"${String(lead.title || lead.threadId).slice(0, 40)}" ${e.message}`);
      if (errors.length >= 3) break;               // systemic; stop hammering
    }
  }
  const error = errors.join(' · ');
  const skipped = Math.max(0, leads.length - MAX_PER_POLL);
  if (skipped) {
    try {
      await call('sendMessage', { chat_id: cfg.telegramChatId,
        text: `…and ${skipped} more on the dashboard.`, parse_mode: 'HTML' });
    } catch { /* the count is a nicety */ }
  }
  return { sent, parts, error, skipped };
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

// --------------------------------------------------------------- your taps
//
// How a tap on your phone reaches Chrome, with no server anywhere.
//
// Telegram offers two ways to hear about a button press. A webhook needs a
// public URL, which means a server - the Apps Script we got rid of. The other
// is getUpdates, where the client asks Telegram "anything new?". An extension
// can do that itself, so that is what this does: an alarm wakes the service
// worker, it asks Telegram for taps it has not seen, acts on them, and edits
// the message on your phone to say what happened.
//
// The cost of having no server is honest and worth stating plainly: CHROME HAS
// TO BE RUNNING. Tap Post while your Mac is asleep and nothing happens until
// Chrome is awake again - then it catches up, because Telegram holds updates
// for 24 hours and the offset below means none are missed, only delayed.

const OFFSET_KEY = 'tgOffset';

const getOffset = async () => (await chrome.storage.local.get(OFFSET_KEY))[OFFSET_KEY] || 0;
const setOffset = (n) => chrome.storage.local.set({ [OFFSET_KEY]: n });

/**
 * Taps waiting for us. Returns [] and never throws when Telegram is not set
 * up, so a poll is never lost to it.
 *
 * `offset` is Telegram's own acknowledgement mechanism: asking for update N+1
 * is what tells it update N was handled, so nothing is delivered twice and
 * nothing is dropped if Chrome is closed mid-batch.
 */
export async function pendingTaps() {
  if (!(await getToken())) return [];
  const offset = await getOffset();
  let updates;
  try {
    updates = await call('getUpdates', {
      offset, timeout: 0, allowed_updates: ['callback_query']
    });
  } catch (e) {
    // A webhook set on this bot makes getUpdates illegal. Say which it is
    // rather than failing silently every 30 seconds forever.
    if (/webhook/i.test(e.message)) {
      throw new Error('this bot has a webhook set, so it cannot be polled. '
        + 'Delete it (open api.telegram.org/bot<token>/deleteWebhook once) and this will start working.');
    }
    throw e;
  }
  if (!updates?.length) return [];
  await setOffset(updates[updates.length - 1].update_id + 1);

  return updates.map((u) => u.callback_query).filter(Boolean).map((q) => {
    const [action, threadId] = String(q.data || '').split(':');
    return {
      id: q.id,
      action,
      threadId,
      chatId: String(q.message?.chat?.id ?? ''),
      fromId: String(q.from?.id ?? ''),
      messageId: q.message?.message_id,
      text: q.message?.text || ''
    };
  });
}

/** Stop the spinner on the button. Telegram wants this within a few seconds. */
export async function ackTap(id, text = '') {
  try { await call('answerCallbackQuery', { callback_query_id: id, text: text.slice(0, 190) }); }
  catch { /* the tap is already being acted on; a failed ack must not undo it */ }
}

/**
 * Say what happened, on the message you tapped, and take the buttons away so
 * the same lead cannot be posted twice from the same card.
 */
export async function settleTap(tap, line) {
  const stamp = `\n\n${line}`;
  try {
    await call('editMessageText', {
      chat_id: tap.chatId,
      message_id: tap.messageId,
      text: stripTags(tap.text).slice(0, LIMIT - stamp.length) + stamp,
      disable_web_page_preview: true
    });
  } catch {
    // Editing can fail (too old, unchanged). The outcome still has to reach
    // you, so fall back to a new message rather than leaving a dead button.
    try { await call('sendMessage', { chat_id: tap.chatId, text: line, disable_web_page_preview: true }); }
    catch { /* nothing more we can do from here */ }
  }
}
