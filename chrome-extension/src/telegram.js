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

/** Is a bot token saved on this install? Never returns the token itself. */
export const hasToken = async () => Boolean(await getToken());
export const setToken = (t) => vault.setSecret('telegram', String(t).trim());
export const clearToken = () => vault.removeSecret('telegram');

/**
 * Seconds before a Telegram request is given up on.
 *
 * fetch has no timeout of its own, so a host that cannot reach
 * api.telegram.org - a firewalled server, a blocked egress route - leaves the
 * request hanging for as long as the network lets it. In a service worker that
 * is worse than an error: nothing resets the 30-second idle timer while we
 * wait, so the worker is killed mid-request and the catch block that would
 * have logged it never runs. Silence, every thirty seconds, forever. A timeout
 * turns that into a sentence in the log.
 */
const CALL_TIMEOUT_MS = 15000;

async function call(method, body) {
  const token = await getToken();
  if (!token) throw new Error('No Telegram bot token saved.');
  const ctl = new AbortController();
  const bail = setTimeout(() => ctl.abort(), CALL_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${API}${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(`could not reach api.telegram.org within ${CALL_TIMEOUT_MS / 1000}s `
        + '- this machine may be blocking it. Check the network, or a proxy or firewall on the server.');
    }
    throw new Error(`could not reach api.telegram.org: ${e.message}`);
  } finally {
    clearTimeout(bail);
  }
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

/** "Posting in 18 min unless you tap Hold", in your own words at 3am. */
function countdownLine(lead) {
  if (!lead.autoPostAt || lead.autoHeld) return '';
  const mins = Math.max(0, Math.round((lead.autoPostAt - Date.now()) / 60000));
  return `\n🌙 <b>Night mode: posting in ${mins} min unless you tap Hold.</b>`;
}

const replyMessage = (lead) => {
  const head = '📋 <b>Public reply</b>' + (lead.url ? ` · <a href="${esc(lead.url)}">open the thread</a>` : '')
    + countdownLine(lead);
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
  m: 'rewrite the PM', e: 'rewrite the public reply',
  f: 'send the PM anyway, past the duplicate check',
  c: 'cancel an edit and put the card back'
};

export function keyboard(lead, kind, cfg) {
  if (!cfg.telegramApprovals) return undefined;
  const id = String(lead.threadId || '');
  if (!id || id === 'sample') return undefined;        // a sample must never post

  // A lead counting down to an unattended post leads with the way to stop it.
  // Hold is the only button that matters at 3am, so it comes first and alone.
  if (lead.autoPostAt && !lead.autoHeld) {
    return {
      inline_keyboard: [
        [{ text: '✋ Hold', callback_data: `h:${id}` }],
        [{ text: '🚀 Post Public Now', callback_data: `p:${id}` },
         { text: '⏭ Skip', callback_data: `s:${id}` }],
        [{ text: '✏️ Edit Post', callback_data: `e:${id}` }]
      ]
    };
  }

  // A PM already in your BHW message list loses its send button. Leaving it
  // there invites a tap that can only be refused, and the refusal arrives
  // seconds later on a card that still looks sendable - better that the card
  // tells the truth and links the conversation instead.
  const pmGone = Boolean(lead.pmSent);

  // The same four on both messages, so whichever one you happen to be looking
  // at can do the whole job. There is no "I posted it" button: a reply is
  // marked posted when it actually lands on the thread, whether you tapped it
  // here or pressed Post reply in the browser yourself.
  const top = [{ text: '🚀 Post Public Now', callback_data: `p:${id}` }];
  if (!pmGone) top.push({ text: '✉️ Post DM Now', callback_data: `d:${id}` });

  const mid = [{ text: '✏️ Edit Post', callback_data: `e:${id}` }];
  if (!pmGone) mid.push({ text: '✏️ Edit DM', callback_data: `m:${id}` });

  const rows = [top, mid];
  if (pmGone && lead.pmUrl) rows.push([{ text: '✅ PM already sent — open it', url: lead.pmUrl }]);
  rows.push([{ text: '⏭ Skip', callback_data: `s:${id}` }]);
  return { inline_keyboard: rows };
}

/**
 * Bring a card up to date on the phone, in place.
 *
 * Used when the message list turns out to hold a PM this lead already has, so
 * the card you are looking at stops offering to send it again. Silent about
 * everything it cannot do: an old message, a deleted one, or a card that was
 * never sent all just mean there is nothing to correct.
 */
export async function refreshCard(chatId, messageId, lead, kind, cfg) {
  if (!chatId || !messageId) return false;
  return editIntoCard(chatId, messageId, lead, kind, cfg);
}

/**
 * Hand over the text to edit.
 *
 * Telegram gives no way to put a long, editable string into your compose box:
 * a bot cannot prefill the input field (switch_inline_query caps at 256
 * characters and needs inline mode), and you cannot edit a bot's message. So
 * the closest thing is made as short as possible:
 *
 *   1. one short line saying what is being edited
 *   2. the draft ON ITS OWN in a <pre> block - one tap on a phone copies the
 *      whole thing, with none of the card text mixed in
 *   3. you paste into the ordinary box, change what you like, and send
 *
 * force_reply used to do step 3, and it is what made this feel wrong: it put
 * the entire draft in the message it quoted, so you typed underneath a wall of
 * quoted text in a shrunken box. Now the next message you send in the chat is
 * taken as the new version, which means a full-size box and no quote at all.
 */
export async function askFor(chatId, header, body) {
  await call('sendMessage', { chat_id: chatId, text: header, disable_web_page_preview: true });
  const m = await call('sendMessage', {
    chat_id: chatId,
    text: `<pre>${esc(String(body || '').slice(0, LIMIT - 60))}</pre>`,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  });
  return m?.message_id;
}

/**
 * Turn the card you tapped INTO the editor, in place.
 *
 * Tapping Edit DM used to send two fresh messages and then, once you replied,
 * a third with the rewritten card - so a small change to two lines pushed four
 * messages into the chat and the thing you were editing scrolled away. Editing
 * the same message means there is one card, it changes to show the draft, and
 * it changes back. Nothing new appears.
 *
 * What Telegram still cannot do is put text in your compose box: a bot may not
 * prefill it, and switch_inline_query caps at 256 characters. So the draft is
 * in a <pre> block, which one tap copies in full on mobile - paste, change your
 * two lines, send.
 */
export async function editIntoEditor(chatId, messageId, which, body, title, threadId) {
  // The draft goes LAST, alone, with nothing after it - and the instructions
  // go above it, short. A buyer once received "Editing the DM — Tap the text
  // to copy it" above the pitch, because the two sat together in one message
  // and a long-press-Copy takes the whole message rather than just the block.
  // Putting the block at the end means a copy that overruns stops at the end
  // of the draft instead of sweeping instructions into it, and anything that
  // still gets through is refused before it reaches a buyer.
  const text = `✏️ <b>Editing the ${esc(which)}</b> — ${esc(String(title || '').slice(0, 60))}\n`
    + `<i>Tap the block below to copy only the draft. Do not copy this whole message.</i>\n`
    + `<pre>${esc(String(body || '').slice(0, LIMIT - 300))}</pre>`;
  try {
    await call('editMessageText', {
      chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: '✖️ Leave it as it is', callback_data: `c:${threadId}` }]] }
    });
    return true;
  } catch { return false; }
}

/**
 * Put the card back, on the same message, with its buttons.
 *
 * Used after a rewrite lands and after Cancel, so the chat ends up exactly as
 * it started rather than accumulating a history of the edit.
 */
export async function editIntoCard(chatId, messageId, lead, kind, cfg) {
  const text = kind === 'PM' ? pmMessage(lead) : replyMessage(lead);
  if (!text) return false;
  const body = { chat_id: chatId, message_id: messageId, parse_mode: 'HTML',
                 disable_web_page_preview: true, reply_markup: keyboard(lead, kind, cfg) };
  try {
    await call('editMessageText', { ...body, text });
    return true;
  } catch {
    try { await call('editMessageText', { ...body, text: stripTags(text), parse_mode: undefined }); return true; }
    catch { return false; }
  }
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
  // Which message holds which card. Kept so a card can be corrected later - a
  // PM that turns up in your message list has to stop offering a send button
  // on the card already sitting on your phone.
  const ids = {};
  // Exactly what this card put in front of you. The card and the send used to
  // render the text independently, so anything that changed the lead in
  // between - a draft rewrite, a lost set of Claude lines - meant you approved
  // one message and a different one went to the buyer. What is shown is what
  // is sent, and this is where "what is shown" is captured.
  const shown = { dm: plain(lead.dm || ''), draft: plain(lead.draft || '') };
  for (const [name, text] of parts) {
    if (!text) continue;
    try {
      const m = await call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true,
                                            reply_markup: keyboard(lead, name, cfg) });
      if (m?.message_id) ids[name] = m.message_id;
      onPart?.(name, null, m?.message_id);
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
  return { ids, shown };
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
  const cards = {}, approved = {};
  // Which threads actually went. The caller stamps these as announced, and it
  // must stamp ONLY these: a poll that finds 33 threads sends six, and marking
  // the other 27 as announced silenced them for ever.
  const sentIds = [];
  for (const lead of leads.slice(0, MAX_PER_POLL)) {
    try {
      const r = await sendLead(lead, cfg, { onPart: () => parts++ });
      if (r?.ids && Object.keys(r.ids).length) cards[String(lead.threadId)] = r.ids;
      if (r?.shown) approved[String(lead.threadId)] = r.shown;
      sentIds.push(String(lead.threadId));
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
  return { sent, parts, error, skipped, cards, sentIds, approved };
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
    // Anything you type. Whether it counts is decided in the background, which
    // knows if an edit is waiting; here it is just carried across. replyTo is
    // passed when you did reply to the prompt, because that is still the
    // clearest signal when several things are in flight.
    const m = u.message;
    if (m?.text) {
      out.push({
        kind: 'reply',
        chatId: String(m.chat?.id ?? ''),
        fromId: String(m.from?.id ?? ''),
        messageId: m.message_id,
        replyTo: m.reply_to_message?.message_id || 0,
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
 * Take the webhook off the bot.
 *
 * A bot can have a webhook or be polled, never both. While the old Apps Script
 * relay's webhook is set, every message you send the bot and every button you
 * tap goes to a Google server instead of to Chrome, and nothing here can read
 * either. Removing it is what hands the bot back.
 *
 * Done from here rather than by opening api.telegram.org/bot<token>/... in a
 * tab, which would put the token in browser history and anything that syncs it.
 *
 * drop_pending_updates is deliberately NOT set: anything queued while the
 * webhook was on is then still there to be read.
 */
export async function removeWebhook() {
  const before = await call('getWebhookInfo', {});
  if (!before?.url) return { had: false };
  await call('deleteWebhook', {});
  const after = await call('getWebhookInfo', {});
  // A live Apps Script trigger can put its webhook straight back, which looks
  // exactly like the delete having failed. Say which it is.
  return { had: true, was: before.url, gone: !after?.url, back: after?.url || '' };
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
export async function say(chatId, text, { html = false } = {}) {
  const body = { chat_id: chatId, text, disable_web_page_preview: true };
  try {
    await call('sendMessage', html ? { ...body, parse_mode: 'HTML' } : body);
  } catch {
    // Telegram rejects a whole message over one stray tag, and a status report
    // nobody receives is worse than one without bold.
    try { await call('sendMessage', { ...body, text: stripTags(text) }); }
    catch { /* nothing more we can do from here */ }
  }
}

/**
 * A possible duplicate, put to you on the phone.
 *
 * The refusal used to be final: "Already sent", no evidence, no way past it.
 * Since the evidence was sometimes wrong - a buyer messaging you counted as
 * your PM - a flat refusal meant a lead you had never contacted could not be
 * contacted at all without going to the machine. So: say what was found, link
 * the conversation so you can read it, and leave the decision here.
 *
 * The link is a url button, not a callback, so it costs nothing against the
 * 64-byte callback_data limit and opens BHW directly.
 */
export async function askAnyway(chatId, lead, dup) {
  const id = String(lead.threadId || '');
  const when = dup.at ? ` (${String(dup.at).slice(0, 10)})` : '';
  const text = `❓ <b>Might already be a duplicate</b>\n\n`
    + `${esc(String(lead.title).slice(0, 90))}\n\n`
    + `Not sending yet: ${esc(dup.why || 'a conversation with them exists')}${when}.\n`
    + `That is not proof you pitched this job, so it is your call.`;
  const buttons = [];
  if (dup.url) buttons.push([{ text: '👀 Open the conversation', url: dup.url }]);
  buttons.push([{ text: '✉️ Send anyway', callback_data: `f:${id}` },
                { text: '⏭ Skip', callback_data: `s:${id}` }]);
  try {
    await call('sendMessage', {
      chat_id: chatId, text, parse_mode: 'HTML',
      disable_web_page_preview: true, reply_markup: { inline_keyboard: buttons }
    });
    return true;
  } catch { return false; }
}

/** Stop the spinner on the button. Telegram wants this within a few seconds. */
/**
 * Claim a tap, exclusively, across every copy of this extension.
 *
 * Telegram keeps ONE update queue per bot, and each install tracks its own
 * position in it in its own chrome.storage. So two installs polling the same
 * bot - a Mac and a VPS both left open - each receive the SAME callback_query
 * and each act on it. That is how one tap sent two identical PMs.
 *
 * The inbox check cannot catch this: both copies read the message list before
 * either had sent, so neither saw the other's PM. Checking then acting is not
 * safe when two actors do it at once; it needs a lock.
 *
 * answerCallbackQuery IS that lock. A given callback_query_id can be answered
 * exactly once - Telegram rejects the second - so whichever copy answers first
 * owns the tap and the other is told to stand down. This used to swallow the
 * error and carry on, with a comment saying the tap was already being acted
 * on, which was exactly the wrong conclusion to draw from it.
 *
 * Returns true if this copy owns the tap. On an ambiguous failure it returns
 * false: not acting means you tap again, acting twice means a buyer gets two
 * messages, and those costs are not comparable.
 */
export async function claimTap(id, text = '') {
  try {
    await call('answerCallbackQuery', { callback_query_id: id, text: text.slice(0, 190) });
    return true;
  } catch (e) {
    return { ok: false, why: e.message };
  }
}

/** Answer a tap where nothing is at stake if the answer is lost. */
export async function ackTap(id, text = '') {
  try { await call('answerCallbackQuery', { callback_query_id: id, text: text.slice(0, 190) }); }
  catch { /* only the little toast on your phone is lost */ }
}

/**
 * Say what happened, on the message you tapped, and take the buttons away so
 * the same lead cannot be posted twice from the same card.
 */
export async function settleTap(tap, line) {
  // An empty line means the handler has already rewritten this message itself
  // - the Edit buttons turn the card into the editor in place. Stamping an
  // outcome on top would wipe the very text you are about to copy.
  if (!line) return;
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
