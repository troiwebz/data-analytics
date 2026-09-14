/**
 * HAF Watcher — Apps Script, single-file build.
 *
 * Paste this whole file into Code.gs, replacing everything.
 * Edit ONLY the CONFIG section at the top, then:
 *   1. Run setup()
 *   2. Deploy > New deployment > Web app > Execute as me, Anyone
 *   3. Run registerTelegramWebhook()
 */

// ======================================================================
// Config
// ======================================================================

/**
 * EDIT THIS FILE, then run setup() once from the Apps Script editor.
 * Nothing here is committed with real values — keep your token out of git.
 */

// --- Secrets --------------------------------------------------------------
// Must match "sharedSecret" in the extension's Options page.
// Generate one: run crypto.randomUUID() in any browser console.
const SHARED_SECRET = 'CHANGE-ME-to-a-long-random-string';

// From @BotFather: /newbot, then paste the token here.
const TELEGRAM_BOT_TOKEN = '';

// From @userinfobot: send it any message, it replies with your numeric id.
const TELEGRAM_CHAT_ID = '';

// Random string appended to the webhook URL so only Telegram can reach it.
// (Apps Script cannot read request headers, so the secret rides in the query.)
const TELEGRAM_WEBHOOK_SECRET = 'CHANGE-ME-too';

// Optional email fallback. Leave blank to disable email entirely.
const EMAIL_TO = '';

// --- Behaviour ------------------------------------------------------------
// Leads at or above this score buzz your phone. Below it they arrive silently.
// Nothing is ever dropped. Change live from Telegram with:  /buzz 12
const DEFAULT_BUZZ_SCORE = 10;

// Threads with more replies than this are marked EXPIRED and never sent —
// the buyer has already picked someone.
const EXPIRE_AFTER_REPLIES = 10;

// Re-alerting on an author you already pitched. true = alert with a
// "you pitched them on <date>" note; false = never pitch the same person twice.
const REALERT_KNOWN_AUTHORS = true;

// --- BHW compliance -------------------------------------------------------
// Every draft is linted against this BEFORE it reaches Telegram. A draft that
// fails is still sent, flagged with a warning naming the broken rule — the tool
// never quietly hands you something that would break forum rules.
//
// TODO: fill these in from the BHW Hire a Freelancer rules.
const COMPLIANCE = {
  // Substrings/regex that MUST appear somewhere in the reply.
  mustInclude: [
    // { pattern: 'blackhatworld\\.com/threads/your-sales-thread', label: 'BST thread link' }
  ],
  // Must appear within the first N characters.
  mustAppearEarly: [
    // { pattern: 'Telegram', within: 120, label: 'contact line at top' }
  ],
  // Never allowed anywhere in the reply.
  banned: [
    'free trial'
  ],
  // Soft warnings — allowed, but flagged so you can eyeball them.
  warn: [
    'guaranteed', 'guarantee', '100%', 'cheapest'
  ]
};

// --- Internals ------------------------------------------------------------
const SHEET_NAME = 'leads';
const APPROVE_TOKEN_TTL_MIN = 720;
const HEADERS = [
  'threadId', 'foundAt', 'postedAt', 'replyCount', 'score', 'category', 'author',
  'title', 'budget', 'matched', 'url', 'snippet', 'draft', 'compliance',
  'status', 'decidedAt', 'result', 'error'
];

/** Runtime settings that can be changed from Telegram without editing code. */
function prop_(key, fallback) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  return v === null || v === '' ? fallback : v;
}
function setProp_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, String(value));
}
function buzzScore_()  { return Number(prop_('BUZZ_SCORE', DEFAULT_BUZZ_SCORE)); }
function isPaused_()   { return prop_('PAUSED', 'no') === 'yes'; }

// ======================================================================
// Auth
// ======================================================================

/** Shared-secret check for the extension's JSON API. */

function constantTimeEquals_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function checkSecret_(payload) {
  if (!payload || !constantTimeEquals_(String(payload.secret || ''), SHARED_SECRET)) {
    throw new Error('bad secret');
  }
}

// ======================================================================
// Sheet
// ======================================================================

/** Google Sheet as the permanent record. One row per thread ever seen. */

function sheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('No sheet yet — run setup() once from the editor.');
  const ss = SpreadsheetApp.openById(id);
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function rowsToObjects_(sh) {
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const head = values[0];
  return values.slice(1).map(function (row, i) {
    const o = { _row: i + 2 };
    head.forEach(function (h, c) { o[h] = row[c]; });
    return o;
  });
}

function findRow_(sh, threadId) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(threadId)) return i + 2;
  }
  return 0;
}

function setCell_(sh, row, header, value) {
  const col = HEADERS.indexOf(header) + 1;
  if (col > 0) sh.getRange(row, col).setValue(value);
}

function getLead_(threadId) {
  const sh = sheet_();
  const row = findRow_(sh, threadId);
  if (!row) return null;
  const values = sh.getRange(row, 1, 1, HEADERS.length).getValues()[0];
  const o = { _row: row };
  HEADERS.forEach(function (h, i) { o[h] = values[i]; });
  return o;
}

/** Date of the most recent POSTED reply to this author, or ''. */
function priorContact_(author) {
  if (!author) return '';
  const authorCol = HEADERS.indexOf('author'), statusCol = HEADERS.indexOf('status'),
        decidedCol = HEADERS.indexOf('decidedAt');
  const sh = sheet_();
  const last = sh.getLastRow();
  if (last < 2) return '';
  const rows = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  let latest = '';
  rows.forEach(function (r) {
    if (String(r[authorCol]).toLowerCase() === String(author).toLowerCase() &&
        r[statusCol] === 'POSTED' && String(r[decidedCol]) > latest) {
      latest = String(r[decidedCol]);
    }
  });
  return latest ? latest.slice(0, 10) : '';
}

/** Insert unless we already have that threadId. Returns true if new. */
function insertLead_(lead, status, lint) {
  const sh = sheet_();
  if (findRow_(sh, lead.threadId)) return false;
  sh.appendRow([
    String(lead.threadId),
    lead.foundAt || new Date().toISOString(),
    lead.postedAt || '',
    lead.replyCount == null ? '' : Number(lead.replyCount),
    Number(lead.score) || 0,
    lead.categoryLabel || lead.category || '',
    lead.author || '',
    lead.title || '',
    lead.budget || '',
    (lead.matched || []).join(', '),
    lead.url || '',
    String(lead.snippet || '').slice(0, 4000),
    lead.draft || '',
    lint ? (lint.ok ? 'ok' : lint.errors.join(' | ')) : '',
    status,
    '', '', ''
  ]);
  return true;
}

/** Creates the spreadsheet on first use. Run once from the editor. */
function setup() {
  let id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) {
    const ss = SpreadsheetApp.create('HAF Watcher — leads');
    id = ss.getId();
    PropertiesService.getScriptProperties().setProperty('SHEET_ID', id);
    const sh = ss.getSheets()[0];
    sh.setName(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  Logger.log('Sheet: https://docs.google.com/spreadsheets/d/' + id);
  Logger.log('Next: Deploy > New deployment > Web app > Execute as me, Anyone.');
  Logger.log('Then run registerTelegramWebhook().');
}

// ======================================================================
// Compliance
// ======================================================================

/**
 * Lints a draft against the BHW rules in Config.gs.
 * Returns { ok, errors: [], warnings: [] }. Never throws.
 */
function lintDraft_(draft) {
  const text = String(draft || '');
  const errors = [];
  const warnings = [];
  const rx = function (p) { return new RegExp(p, 'i'); };

  (COMPLIANCE.mustInclude || []).forEach(function (r) {
    if (!rx(r.pattern).test(text)) errors.push('missing: ' + (r.label || r.pattern));
  });
  (COMPLIANCE.mustAppearEarly || []).forEach(function (r) {
    const m = text.match(rx(r.pattern));
    if (!m) errors.push('missing: ' + (r.label || r.pattern));
    else if (m.index > (r.within || 150)) errors.push('not at top: ' + (r.label || r.pattern));
  });
  (COMPLIANCE.banned || []).forEach(function (p) {
    if (rx(p).test(text)) errors.push('banned phrase: "' + p + '"');
  });
  (COMPLIANCE.warn || []).forEach(function (p) {
    if (rx(p).test(text)) warnings.push('check: "' + p + '"');
  });

  return { ok: errors.length === 0, errors: errors, warnings: warnings };
}

function complianceSummary_(lint) {
  if (!lint) return '';
  const parts = [];
  if (lint.errors.length) parts.push('❌ ' + lint.errors.join(' · '));
  if (lint.warnings.length) parts.push('⚠️ ' + lint.warnings.join(' · '));
  return parts.join('\n');
}

// ======================================================================
// Email
// ======================================================================

/** Optional email fallback — only used when EMAIL_TO is set in Config.gs. */

function esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sendResultEmail_(lead, status, detail) {
  if (!EMAIL_TO) return;
  const ok = status === 'POSTED';
  MailApp.sendEmail({
    to: EMAIL_TO,
    subject: (ok ? '✅ Posted — ' : '❌ Post failed — ') + String(lead.title).slice(0, 80),
    htmlBody:
      '<div style="font:15px/1.55 system-ui,sans-serif;max-width:600px;margin:0 auto">' +
        '<p><b>' + (ok ? 'Your reply is live.' : 'Could not post.') + '</b></p>' +
        '<p style="background:#f8fafc;padding:12px;border-radius:8px">' + esc_(detail || '') + '</p>' +
        '<p><a href="' + esc_(lead.url) + '">Open the thread</a></p>' +
      '</div>'
  });
}

// ======================================================================
// Telegram
// ======================================================================

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
  const card =
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
        '/won 1234567 — mark a lead as won (for template stats)', true);
    case 'stats':
      return tgSay_(statsText_(), true);
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

// ======================================================================
// Code
// ======================================================================

/**
 * HAF Watcher control plane.
 *
 *   doPost  — (a) JSON API from the Chrome extension: ingest / pending / result
 *             (b) Telegram webhook updates (button taps, /commands)
 *   doGet   — a plain status page, nothing more. State never changes on GET.
 *
 * Deploy: Deploy > New deployment > Web app > Execute as: me, Access: Anyone.
 * Then run registerTelegramWebhook() once.
 */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const params = e.parameter || {};
    const body = JSON.parse(e.postData.contents || '{}');

    // Telegram: secret rides in the query string (no header access in Apps Script).
    if (params.tg !== undefined) {
      if (!constantTimeEquals_(String(params.tg), TELEGRAM_WEBHOOK_SECRET)) return json_({ ok: false });
      handleTelegramUpdate_(body);
      return json_({ ok: true });
    }

    checkSecret_(body);
    switch (body.action) {
      case 'ping':    return json_({ ok: true, sheet: sheet_().getParent().getUrl(), paused: isPaused_(), buzz: buzzScore_() });
      case 'ingest':  return json_(body.backfill ? handleBackfill_(body.leads || []) : handleIngest_(body.leads || []));
      case 'pending': return json_({ ok: true, leads: handlePending_() });
      case 'result':  return json_(handleResult_(body));
      default:        return json_({ ok: false, error: 'unknown action' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/**
 * Every thread is recorded. Then, in order:
 *   already known        → duplicate, ignore
 *   too many replies     → EXPIRED, logged, not sent
 *   author blocked       → SKIPPED (only if REALERT_KNOWN_AUTHORS is false)
 *   paused               → NEW, logged, not sent
 *   otherwise            → lint, send to Telegram, SENT
 */
function handleIngest_(leads) {
  const out = { ok: true, added: 0, duplicates: 0, expired: 0, sent: 0, held: 0 };
  for (const lead of leads) {
    if (!lead || !lead.threadId) continue;

    const replies = lead.replyCount == null ? 0 : Number(lead.replyCount);
    if (replies > EXPIRE_AFTER_REPLIES) {
      if (insertLead_(lead, 'EXPIRED', null)) { out.added++; out.expired++; } else out.duplicates++;
      continue;
    }

    const prior = priorContact_(lead.author);
    if (prior && !REALERT_KNOWN_AUTHORS) {
      if (insertLead_(lead, 'SKIPPED', null)) { out.added++; } else out.duplicates++;
      continue;
    }

    if (isPaused_()) {
      if (insertLead_(lead, 'NEW', null)) { out.added++; out.held++; } else out.duplicates++;
      continue;
    }

    const lint = lintDraft_(lead.draft);
    if (!insertLead_(lead, 'SENT', lint)) { out.duplicates++; continue; }
    out.added++;
    try {
      sendLeadTelegram_(lead, lint, prior);
      out.sent++;
    } catch (err) {
      const sh = sheet_();
      setCell_(sh, findRow_(sh, lead.threadId), 'error', 'telegram: ' + err.message);
    }
  }
  return out;
}

/** First-run history: recorded in the Sheet, never sent to Telegram. */
function handleBackfill_(leads) {
  let added = 0, duplicates = 0;
  for (const lead of leads) {
    if (!lead || !lead.threadId) continue;
    if (insertLead_(lead, 'BACKFILL', null)) added++; else duplicates++;
  }
  return { ok: true, added: added, duplicates: duplicates, backfill: true };
}

/** Leads you tapped 🚀 on, for the extension to post. */
function handlePending_() {
  return rowsToObjects_(sheet_())
    .filter(function (r) { return r.status === 'APPROVED'; })
    .map(function (r) {
      return { threadId: String(r.threadId), url: r.url, title: r.title,
               author: r.author, category: r.category, draft: r.draft };
    });
}

function handleResult_(p) {
  const sh = sheet_();
  const row = findRow_(sh, p.threadId);
  if (!row) return { ok: false, error: 'unknown threadId' };
  setCell_(sh, row, 'status', p.status);
  setCell_(sh, row, 'decidedAt', new Date().toISOString());
  setCell_(sh, row, 'result', p.status === 'POSTED' ? (p.detail || 'posted') : '');
  setCell_(sh, row, 'error', p.status === 'FAILED' ? (p.detail || 'unknown') : '');
  const lead = getLead_(p.threadId);
  if (lead) {
    try {
      tgSay_(p.status === 'POSTED'
        ? '✅ Posted: <b>' + tgEsc_(lead.title) + '</b>\n' + tgEsc_(p.detail || lead.url)
        : '❌ Post failed: <b>' + tgEsc_(lead.title) + '</b>\n' + tgEsc_(p.detail || '') +
          '\n<a href="' + tgEsc_(lead.url) + '">Open thread</a> — copy-paste from the message above.',
        p.status === 'POSTED');
    } catch (e) { /* Telegram down — sheet still has the truth */ }
    sendResultEmail_(lead, p.status, p.detail);
  }
  return { ok: true };
}

function doGet() {
  try {
    const rows = rowsToObjects_(sheet_());
    const counts = {};
    rows.forEach(function (r) { counts[r.status] = (counts[r.status] || 0) + 1; });
    return HtmlService.createHtmlOutput(
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<div style="font:16px/1.6 system-ui,sans-serif;padding:24px;max-width:520px;margin:0 auto">' +
      '<h2>HAF Watcher</h2><p>' + rows.length + ' threads recorded</p><p>' +
      Object.keys(counts).map(function (k) { return k + ': ' + counts[k]; }).join('<br>') +
      '</p><p>' + (isPaused_() ? '⏸ paused' : '▶️ running') + ' · buzz ≥ ' + buzzScore_() + '</p></div>');
  } catch (err) {
    return HtmlService.createHtmlOutput('<p>' + String(err.message || err) + '</p>');
  }
}
