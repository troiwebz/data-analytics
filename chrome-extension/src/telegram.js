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
export const ACTIONS = {
  d: 'send the PM', p: 'post the public reply', s: 'skip this lead',
  m: 'rewrite the PM', e: 'rewrite the public reply'
};

export function keyboard(lead, kind, cfg) {
  if (!cfg.telegramApprovals) return undefined;
  const id = String(lead.threadId || '');
  if (!id || id === 'sample') return undefined;        // a sample must never post

  // The same four on both messages, so whichever one you happen to be looking
  // at can do the whole job. There is no "I posted it" button: a reply is
  // marked posted when it actually lands on the thread, whether you tapped it
  // here or pressed Post reply in the browser yourself.
  return {
    inline_keyboard: [
      [{ text: '🚀 Post Public Now', callback_data: `p:${id}` },
       { text: '✉️ Post DM Now', callback_data: `d:${id}` }],
      [{ text: '✏️ Edit Post', callback_data: `e:${id}` },
       { text: '✏️ Edit DM', callback_data: `m:${id}` }],
      [{ text: '⏭ Skip', callback_data: `s:${id}` }]
    ]
  };
}

/**
 * Ask for the new wording, with the phone's reply box already open.
 *
 * force_reply is what makes this work on a phone: Telegram opens the keyboard
 * quoting this message, so whatever is typed next comes back as a reply
 * pointing at it, and we know which lead and which half it belongs to without
 * asking you to repeat yourself.
 */
export async function askFor(chatId, prompt) {
  const m = await call('sendMessage', {
    chat_id: chatId, text: prompt, disable_web_page_preview: true,
    reply_markup: { force_reply: true, input_field_placeholder: 'Type the new wording' }
  });
  return m?.message_id;
}

/** Put the lead back in front of you, rewritten, with the buttons again. */
export async function resend(lead, cfg, kind) {
  const text = kind === 'PM' ? pmMessage(lead) : replyMessage(lead);
  if (!text) return;
  try {
    await call('sendMessage', { chat_id: cfg.telegramChatId, text, parse_mode: 'HTML',
                                disable_web_page_preview: true, reply_markup: keyboard(lead, kind, cfg) });
  } catch {
    await call('sendMessage', { chat_id: cfg.telegramChatId, text: stripTags(text),
                                disable_web_page_preview: true, reply_markup: keyboard(lead, kind, cfg) });
  }
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
  // Ask Telegram what the bot is actually called. You cannot message a bot you
  // cannot name, and "what is my bot called?" is not answerable from a token
  // that is shown masked. Cached so the Settings page does not ask every time.
  let bot = '';
  if (v.stored) {
    const cached = (await chrome.storage.local.get('tgBot')).tgBot;
    if (cached?.hint === v.hint) bot = cached.username;
    else {
      try {
        const me = await call('getMe', {});
        bot = me?.username || '';
        if (bot) await chrome.storage.local.set({ tgBot: { hint: v.hint, username: bot } });
      } catch { /* offline or a bad token; status still tells you what it knows */ }
    }
  }
  return { ...v, bot, chatId: cfg.telegramChatId || '', enabled: !!cfg.telegramEnabled };
}

/**
 * Why nothing is arriving.
 *
 * "The Telegram button does nothing" has half a dozen causes that all look
 * identical from the outside: no token, no chat id, a chat the bot has never
 * been spoken to, a webhook left over from the Apps Script days. This checks
 * each one against Telegram itself and names the one that is actually wrong,
 * with what to do about it.
 */
export async function diagnose(cfg) {
  const out = [];
  const token = await getToken();
  if (!token) {
    out.push(['✗', 'No bot token saved. If you already have a bot, get its token from @BotFather with '
      + '/mybots → pick it → API Token. Do not send /newbot unless you want a second bot.']);
    return { ok: false, checks: out };
  }
  out.push(['✓', 'Bot token is saved.']);

  let me;
  try { me = await call('getMe', {}); out.push(['✓', `Telegram knows the bot: @${me.username}.`]); }
  catch (e) {
    out.push(['✗', `Telegram rejected the token: ${e.message}. Check it in @BotFather.`]);
    return { ok: false, checks: out };
  }

  if (!cfg.telegramChatId) {
    // There is a button for this two inches away, so point at it rather than
    // sending you to a third-party bot.
    out.push(['✗', `No chat id saved. Open @${me.username} in Telegram, send it any message, `
      + `then press "Find it for me" next to the chat id box above.`]);
    return { ok: false, checks: out };
  }
  try {
    await call('sendChatAction', { chat_id: cfg.telegramChatId, action: 'typing' });
    out.push(['✓', `The bot can reach chat ${cfg.telegramChatId}.`]);
  } catch (e) {
    out.push(['✗', `The bot cannot message chat ${cfg.telegramChatId}: ${e.message}. `
      + `Open Telegram, find @${me.username}, and press Start - a bot cannot message you until you do.`]);
    return { ok: false, checks: out };
  }

  // A webhook makes getUpdates illegal, so taps would never arrive even though
  // messages go out fine. This is the one that looks like nothing at all.
  try {
    const hook = await call('getWebhookInfo', {});
    if (hook?.url) {
      const script = /script\.google\.com/.test(hook.url);
      out.push(['✗', `A webhook is set on this bot (${hook.url}), so your taps cannot be read.`
        + (script
          ? ` That is the old Apps Script relay - it is still running, still sending you its own cards with`
            + ` "Post now / I posted it / Skip", and it is holding your taps. Turn it off first: in the Apps`
            + ` Script project, Triggers, delete the triggers, then Deploy, Manage deployments, Archive.`
          : '')
        + ` Then open api.telegram.org/bot<your token>/deleteWebhook once in a tab and try again.`]);
      return { ok: false, checks: out };
    }
    out.push(['✓', 'No webhook in the way, so button taps can be read.']);
  } catch { out.push(['?', 'Could not check for a webhook.']); }

  if (!cfg.telegramEnabled) out.push(['✗', 'Sending to Telegram is switched off above.']);
  else out.push(['✓', 'New threads are sent to Telegram.']);
  if (!cfg.telegramApprovals) out.push(['!', 'Approval buttons are off, so messages arrive without buttons.']);
  else out.push(['✓', 'Approval buttons are on.']);

  return { ok: out.every(([m]) => m !== '✗'), checks: out, bot: me.username };
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
      // Your typed rewrites come back as ordinary messages, so those are asked
      // for too. Nothing else about a message is read or stored.
      offset, timeout: 0, allowed_updates: ['callback_query', 'message']
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

  const out = [];
  for (const u of updates) {
    if (u.callback_query) {
      const q = u.callback_query;
      const [action, threadId] = String(q.data || '').split(':');
      out.push({
        kind: 'tap', id: q.id, action, threadId,
        chatId: String(q.message?.chat?.id ?? ''),
        fromId: String(q.from?.id ?? ''),
        messageId: q.message?.message_id,
        text: q.message?.text || ''
      });
      continue;
    }
    // A reply you typed. Only a reply counts - a message that is not answering
    // one of our prompts is somebody chatting to the bot, and is ignored.
    const m = u.message;
    if (m?.text && m.reply_to_message) {
      out.push({
        kind: 'reply',
        chatId: String(m.chat?.id ?? ''),
        fromId: String(m.from?.id ?? ''),
        messageId: m.message_id,
        replyTo: m.reply_to_message.message_id,
        body: String(m.text)
      });
    }
  }
  return out;
}

/**
 * Find your chat id from the bot itself.
 *
 * Sending you to @userinfobot works but is a detour: your own id is already
 * sitting in anything you have ever sent this bot. This reads the bot's
 * pending updates and takes the chat from the most recent one.
 *
 * Deliberately does NOT move the offset. Reading without acknowledging leaves
 * every pending update where it is, so looking up an id can never swallow a
 * tap you made a moment earlier.
 */
export async function findChatId() {
  if (!(await getToken())) return { error: 'No bot token saved yet.' };
  let updates;
  try { updates = await call('getUpdates', { timeout: 0 }); }
  catch (e) {
    if (/webhook/i.test(e.message)) {
      return { error: 'This bot has a webhook set, so its messages cannot be read. '
        + 'That is usually the old Apps Script relay - turn it off first.' };
    }
    return { error: e.message };
  }
  const chats = [];
  for (const u of updates || []) {
    const chat = u.message?.chat || u.callback_query?.message?.chat || u.channel_post?.chat;
    if (chat?.id != null && !chats.some((c) => c.id === chat.id)) {
      chats.push({ id: String(chat.id), name: chat.username || chat.first_name || chat.title || '' });
    }
  }
  if (!chats.length) {
    return { error: 'Nothing from you yet. Open Telegram, find your bot, and send it any message '
      + '("hi" will do) - then press this again.' };
  }
  return { chats, chatId: chats[chats.length - 1].id };
}

/**
 * The one thing no amount of checking from this side can prove: that a tap on
 * your phone reaches Chrome. Sends a message with a single button; tapping it
 * closes the loop, and the reply you get back is the proof.
 */
export async function selfTest(cfg) {
  const m = await call('sendMessage', {
    chat_id: cfg.telegramChatId,
    text: '🧪 HAF Watcher self-test.\n\nThis message arriving proves Chrome can send to you.\n'
        + 'Tap the button below to prove your taps reach Chrome. Nothing is posted to the forum.',
    reply_markup: { inline_keyboard: [[{ text: '✅ Tap me to finish the test', callback_data: 't:selftest' }]] }
  });
  return { messageId: m?.message_id };
}

/** A plain acknowledgement in the chat, for things with no button to edit. */
export async function say(chatId, text) {
  try { await call('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true }); }
  catch { /* nothing more we can do from here */ }
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
