/**
 * Telegram is the phone UI. Two messages per lead:
 *   1. the card — metadata + buttons
 *   2. the reply, alone, in a <pre> block — Telegram gives that a one-tap copy
 *
 * Callbacks come back to doPost() as Telegram "update" objects.
 */

const TG_API = 'https://api.telegram.org/bot';

function tg_(method, payload) {
  if (!TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not set in Config.gs');
  const res = UrlFetchApp.fetch(TG_API + TELEGRAM_BOT_TOKEN + '/' + method, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const data = JSON.parse(res.getContentText() || '{}');
  if (!data.ok) throw new Error('Telegram ' + method + ': ' + (data.description || res.getResponseCode()));
  return data.result;
}

function tgEsc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function ago_(iso) {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  return h < 24 ? h + ' h ago' : Math.round(h / 24) + ' d ago';
}

function tier_(score) {
  return score >= 15 ? '🔥' : score >= buzzScore_() ? '⭐' : '•';
}

/** Rough offer: 10% under a stated budget, else the category floor. */
function suggestedOffer_(lead) {
  if (lead.budgetAmount > 0) {
    const n = Math.round(lead.budgetAmount * 0.9 / 5) * 5;
    return '$' + n + (/\/\s?mo|monthly|per month/i.test(lead.snippet + lead.title) ? '/mo' : '');
  }
  const floors = { seo: '$300+', ads: '$400+/mo', design: '$120+', web: '$400+', content: '$80+/batch' };
  return floors[lead.category] || 'quote on scope';
}

function sendLeadTelegram_(lead, lint, priorContact) {
  const score = Number(lead.score) || 0;
  const silent = score < buzzScore_();
  // The extension may send a fully rendered card (HTML) so the layout can
  // evolve without touching this script. Otherwise build the default one.
  const card = lead.card ? String(lead.card) :
    tier_(score) + ' <b>' + score + ' pts</b> · ' + tgEsc_(lead.categoryLabel || lead.category || '—') +
      (lead.budget ? ' · ' + tgEsc_(lead.budget) : '') + '\n' +
    '<b>' + tgEsc_(lead.title) + '</b>\n\n' +
    '👤 ' + tgEsc_(lead.author) +
    '   💬 ' + (lead.replyCount == null ? '?' : lead.replyCount) + ' replies' +
    '   ⏱ ' + ago_(lead.postedAt) + '\n' +
    (lead.replyCount != null ? '📊 You\'d be reply #' + (Number(lead.replyCount) + 1) + '\n' : '') +
    '💰 Suggested: ' + tgEsc_(suggestedOffer_(lead)) + '\n' +
    (priorContact ? '🔁 You pitched this author on ' + tgEsc_(priorContact) + '\n' : '') +
    (lead.matched && lead.matched.length ? '🔎 ' + tgEsc_(lead.matched.slice(0, 6).join(', ')) + '\n' : '') +
    (lint && !lint.ok ? '\n' + tgEsc_(complianceSummary_(lint)) + '\n' :
     lint && lint.warnings.length ? '\n' + tgEsc_(complianceSummary_(lint)) + '\n' : '') +
    '\n<a href="' + tgEsc_(lead.url) + '">Open thread</a>';

  const id = String(lead.threadId);
  const keyboard = {
    inline_keyboard: [
      [
        { text: '🚀 Post now', callback_data: 'post:' + id },
        { text: '✅ I posted it', callback_data: 'done:' + id }
      ],
      [
        { text: '⏭ Skip', callback_data: 'skip:' + id },
        { text: '🔗 Thread', url: lead.url }
      ]
    ]
  };

  const sent = tg_('sendMessage', {
    chat_id: TELEGRAM_CHAT_ID,
    text: card,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    disable_notification: silent,
    reply_markup: keyboard
  });

  // The reply alone, so one tap copies exactly what you paste.
  tg_('sendMessage', {
    chat_id: TELEGRAM_CHAT_ID,
    text: '<pre>' + tgEsc_(lead.draft) + '</pre>',
    parse_mode: 'HTML',
    disable_notification: true,
    reply_to_message_id: sent.message_id
  });
  return sent.message_id;
}

function tgSay_(text, silent) {
  return tg_('sendMessage', {
    chat_id: TELEGRAM_CHAT_ID, text: text, parse_mode: 'HTML',
    disable_web_page_preview: true, disable_notification: !!silent
  });
}

/** Rewrites the card's buttons once a decision is made, so it can't be tapped twice. */
function tgSettle_(msg, label) {
  try {
    tg_('editMessageText', {
      chat_id: msg.chat.id, message_id: msg.message_id,
      text: msg.text ? tgEsc_(msg.text) + '\n\n<b>' + label + '</b>' : label,
      parse_mode: 'HTML', disable_web_page_preview: true
    });
  } catch (e) { /* message too old or unchanged — not worth failing over */ }
}

// ---------------------------------------------------------------- inbound

function handleTelegramUpdate_(update) {
  if (update.callback_query) return handleCallback_(update.callback_query);
  if (update.message && update.message.text) return handleCommand_(update.message);
}

function handleCallback_(cq) {
  const fromOk = String(cq.from && cq.from.id) === String(TELEGRAM_CHAT_ID) ||
                 String(cq.message && cq.message.chat && cq.message.chat.id) === String(TELEGRAM_CHAT_ID);
  if (!fromOk) return tg_('answerCallbackQuery', { callback_query_id: cq.id, text: 'Not for you.' });

  const parts = String(cq.data || '').split(':');
  const action = parts[0], threadId = parts[1];
  const sh = sheet_();
  const row = findRow_(sh, threadId);
  if (!row) return tg_('answerCallbackQuery', { callback_query_id: cq.id, text: 'Lead not found.' });

  const lead = getLead_(threadId);
  if (lead.status === 'POSTED') {
    return tg_('answerCallbackQuery', { callback_query_id: cq.id, text: 'Already posted.' });
  }

  const now = new Date().toISOString();
  if (action === 'post') {
    setCell_(sh, row, 'status', 'APPROVED');
    setCell_(sh, row, 'decidedAt', now);
    tgSettle_(cq.message, '🚀 Queued — posting within a minute');
    return tg_('answerCallbackQuery', { callback_query_id: cq.id, text: 'Queued. Extension posts it next tick.' });
  }
  if (action === 'done') {
    setCell_(sh, row, 'status', 'POSTED');
    setCell_(sh, row, 'decidedAt', now);
    setCell_(sh, row, 'result', 'posted manually');
    tgSettle_(cq.message, '✅ Marked as posted');
    return tg_('answerCallbackQuery', { callback_query_id: cq.id, text: 'Logged. Won\'t be suggested again.' });
  }
  if (action === 'skip') {
    setCell_(sh, row, 'status', 'SKIPPED');
    setCell_(sh, row, 'decidedAt', now);
    tgSettle_(cq.message, '⏭ Skipped');
    return tg_('answerCallbackQuery', { callback_query_id: cq.id, text: 'Skipped.' });
  }
  return tg_('answerCallbackQuery', { callback_query_id: cq.id, text: 'Unknown action.' });
}

function handleCommand_(msg) {
  if (String(msg.chat.id) !== String(TELEGRAM_CHAT_ID)) return;
  const text = String(msg.text).trim();
  const m = text.match(/^\/(\w+)(?:@\w+)?\s*(.*)$/);
  if (!m) return;
  const cmd = m[1].toLowerCase(), arg = m[2].trim();

  switch (cmd) {
    case 'start':
    case 'help':
      return tgSay_(
        '<b>HAF Watcher</b>\n' +
        '/stats — today, this week, by category\n' +
        '/buzz 12 — only buzz for score ≥ 12 (now ' + buzzScore_() + ')\n' +
        '/pause · /resume — stop/start sending leads\n' +
        '/pending — what\'s waiting for you\n' +
        '/won 1234567 — mark a lead as won (for template stats)\n' +
        '/version — which version is running\n' +
        '/ai — Claude-written specifics on/off, or set the model\n' +
        '/cost — what Claude has cost today\n' +
        '/budget 0.25 — cap Claude spend per day', true);
    case 'stats':
      return tgSay_(statsText_(), true);
    case 'cost':
      return tgSay_(aiUsageText_(), true);
    case 'budget': {
      const n = parseFloat(arg);
      if (!isFinite(n)) return tgSay_('Daily Claude budget is $' + aiBudget_().toFixed(2) +
        '. Send /budget 0.25 to change it, /budget 0 for no cap.', true);
      setProp_('AI_DAILY_BUDGET_USD', Math.max(0, n));
      setProp_('AI_BUDGET_FLAGGED', '');
      return tgSay_(n > 0 ? 'Claude will stand down after $' + n.toFixed(2) + ' a day and use the built-in rules.'
                          : 'Daily budget removed. Claude runs with no cap.', true);
    }
    case 'ai': {
      const on = arg.toLowerCase();
      if (on === 'on' || on === 'off') {
        setProp_('AI_SPECIFICS', on === 'on' ? 'yes' : 'no');
        return tgSay_(on === 'on'
          ? (aiKey_() ? '🤖 Claude specifics on.' : '⚠️ On, but ANTHROPIC_API_KEY is not set in Script Properties.')
          : '🤖 Claude specifics off. Replies use the built-in rules.', true);
      }
      if (arg) { setProp_('ANTHROPIC_MODEL', arg); return tgSay_('Model set to <b>' + tgEsc_(arg) + '</b>.', true); }
      return tgSay_('Claude specifics: <b>' + (aiEnabled_() ? 'on' : 'off') + '</b> (' + tgEsc_(aiModel_()) + ')\n' +
                    '/ai on · /ai off · /ai claude-haiku-4-5 · /cost', true);
    }
    case 'version':
      return tgSay_('HAF Watcher Apps Script <b>' + VERSION + '</b>', true);
    case 'buzz': {
      const n = parseInt(arg, 10);
      if (!isFinite(n)) return tgSay_('Buzz threshold is ' + buzzScore_() + '. Send /buzz 12 to change.', true);
      setProp_('BUZZ_SCORE', n);
      return tgSay_('Buzzing for score ≥ ' + n + '. Lower scores arrive silently.', true);
    }
    case 'pause':
      setProp_('PAUSED', 'yes');
      return tgSay_('⏸ Paused. Threads are still logged; nothing is sent until /resume.', true);
    case 'resume':
      setProp_('PAUSED', 'no');
      return tgSay_('▶️ Resumed.', true);
    case 'pending': {
      const rows = rowsToObjects_(sheet_()).filter(function (r) { return r.status === 'SENT' || r.status === 'APPROVED'; });
      if (!rows.length) return tgSay_('Nothing waiting.', true);
      return tgSay_(rows.slice(-10).map(function (r) {
        return (r.status === 'APPROVED' ? '🚀 ' : '• ') + r.score + ' · ' + tgEsc_(r.title).slice(0, 60);
      }).join('\n'), true);
    }
    case 'won': {
      const sh = sheet_();
      const row = findRow_(sh, arg);
      if (!row) return tgSay_('No lead with id ' + tgEsc_(arg), true);
      setCell_(sh, row, 'result', 'WON');
      return tgSay_('🏆 Marked WON.', true);
    }
    default:
      return tgSay_('Unknown command. /help', true);
  }
}

function statsText_() {
  const rows = rowsToObjects_(sheet_());
  const now = Date.now();
  const day = 86400000;
  const within = function (r, ms) { return now - new Date(r.foundAt).getTime() < ms; };
  const count = function (list, status) { return list.filter(function (r) { return r.status === status; }).length; };
  const today = rows.filter(function (r) { return within(r, day); });
  const week = rows.filter(function (r) { return within(r, 7 * day); });

  const byCat = {};
  week.forEach(function (r) {
    const c = r.category || '—';
    byCat[c] = byCat[c] || { seen: 0, posted: 0, won: 0 };
    byCat[c].seen++;
    if (r.status === 'POSTED') byCat[c].posted++;
    if (r.result === 'WON') byCat[c].won++;
  });

  return '<b>Today</b>: ' + today.length + ' seen · ' + count(today, 'POSTED') + ' posted · ' +
    count(today, 'SKIPPED') + ' skipped · ' + count(today, 'EXPIRED') + ' expired\n' +
    '<b>7 days</b>: ' + week.length + ' seen · ' + count(week, 'POSTED') + ' posted\n\n' +
    Object.keys(byCat).map(function (c) {
      const b = byCat[c];
      return tgEsc_(c) + ': ' + b.seen + ' seen, ' + b.posted + ' posted' + (b.won ? ', ' + b.won + ' won' : '');
    }).join('\n') +
    '\n\nBuzz ≥ ' + buzzScore_() + (isPaused_() ? ' · ⏸ PAUSED' : '');
}

/** Run once from the editor after deploying the web app. */
function registerTelegramWebhook() {
  const url = ScriptApp.getService().getUrl() + '?tg=' + encodeURIComponent(TELEGRAM_WEBHOOK_SECRET);
  const r = tg_('setWebhook', { url: url, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true });
  Logger.log('Webhook set: ' + JSON.stringify(r));
  tgSay_('👋 HAF Watcher connected. Send /help.');
}
