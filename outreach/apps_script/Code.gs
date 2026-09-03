/**
 * Guest Outreach Sender — Google Apps Script
 *
 * Sends plain-text outreach from your own Gmail, a few at a time, on a timer.
 * Paste this into script.google.com attached to your prospect Sheet.
 *
 * Setup: run setup() once, then installTriggers() once. That's it.
 */

// ── Settings you can change ──────────────────────────────────────────────────
var CONFIG = {
  SHEET_NAME:        'Prospects',
  LOG_SHEET:         'Log',

  DRY_RUN:           true,   // true = creates drafts only, sends nothing. Flip to false when ready.

  PER_RUN:           3,      // emails per trigger run
  WARMUP_START:      10,     // day 1 daily limit
  WARMUP_STEP:       5,      // added per day
  DAILY_MAX:         40,     // hard ceiling, never raise this

  SEND_HOUR_START:   9,      // only send between these hours (script timezone)
  SEND_HOUR_END:     17,
  SEND_WEEKDAYS_ONLY: true,

  JITTER_MIN_SEC:    5,      // random pause between sends within one run
  JITTER_MAX_SEC:    25,

  FROM_NAME:         'Your Name',
  SIGNATURE:         'Your Name\nyoursite.com\n123 Your Street, Your City, Country',

  SUBJECT:  'Quick idea for {{site}}',
  BODY:
    'Hi {{first_name}},\n' +
    '\n' +
    '{{personal_line}}\n' +
    '\n' +
    'I write about the same space and had two pieces in mind that would fit ' +
    '{{site}}:\n' +
    '\n' +
    '  1. {{idea_1}}\n' +
    '  2. {{idea_2}}\n' +
    '\n' +
    'Happy to send an outline for whichever is more useful. And if this ' +
    'isn\'t a fit, just reply "no" and I won\'t follow up.\n' +
    '\n' +
    '{{signature}}'
};

// Column order in the Prospects sheet.
var COL = {
  EMAIL: 1, FIRST_NAME: 2, SITE: 3, PERSONAL_LINE: 4, IDEA_1: 5, IDEA_2: 6,
  STATUS: 7, SENT_AT: 8, THREAD_ID: 9, REPLIED: 10, NOTE: 11
};
var HEADERS = ['email', 'first_name', 'site', 'personal_line', 'idea_1', 'idea_2',
               'status', 'sent_at', 'thread_id', 'replied', 'note'];

// ── One-time setup ───────────────────────────────────────────────────────────

/** Creates the sheets, headers, and a couple of example rows. Run this first. */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME) || ss.insertSheet(CONFIG.SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.appendRow([
      'editor@exampleblog.com', 'Sam', 'exampleblog.com',
      'Your piece on remote onboarding last month was the first one I have read that admitted the first week is mostly paperwork.',
      'What we changed after 40 remote hires ghosted us in week one',
      'The onboarding checklist that cut our 90-day churn in half',
      '', '', '', '', ''
    ]);
  }
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  sheet.setColumnWidth(COL.PERSONAL_LINE, 380);

  if (!ss.getSheetByName(CONFIG.LOG_SHEET)) {
    ss.insertSheet(CONFIG.LOG_SHEET).appendRow(['when', 'event', 'detail']);
  }

  PropertiesService.getScriptProperties().setProperty(
    'warmup_start_date', PropertiesService.getScriptProperties().getProperty('warmup_start_date') || today_()
  );
  log_('setup', 'sheets ready — warmup day 1');
}

/** Installs the timers. Run once. */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sendBatch').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('checkReplies').timeBased().everyHours(2).create();
  log_('triggers', 'sendBatch/15min, checkReplies/2h');
}

/** Sends one email to yourself so you can see exactly what prospects get. */
function sendTestToSelf() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
  var row = sheet.getRange(2, 1, 1, HEADERS.length).getValues()[0];
  var me = Session.getActiveUser().getEmail();
  GmailApp.sendEmail(me, '[TEST] ' + fill_(CONFIG.SUBJECT, row), fill_(CONFIG.BODY, row),
                     { name: CONFIG.FROM_NAME });
  log_('test', 'sent preview to ' + me);
}

// ── The sender ───────────────────────────────────────────────────────────────

/** Trigger target. Sends up to PER_RUN emails, respecting the daily cap. */
function sendBatch() {
  if (!withinSendWindow_()) return;

  var remaining = dailyRemaining_();
  if (remaining <= 0) return;

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var rows = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  var budget = Math.min(CONFIG.PER_RUN, remaining);
  var sentThisRun = 0;

  for (var i = 0; i < rows.length && sentThisRun < budget; i++) {
    var row = rows[i];
    var rowNum = i + 2;

    if (String(row[COL.STATUS - 1]).trim() !== '') continue;      // already handled
    var email = String(row[COL.EMAIL - 1]).trim();
    if (!isEmail_(email)) { mark_(sheet, rowNum, 'skipped', 'not a valid email'); continue; }
    if (isSuppressed_(email)) { mark_(sheet, rowNum, 'skipped', 'suppressed'); continue; }

    try {
      var subject = fill_(CONFIG.SUBJECT, row);
      var body    = fill_(CONFIG.BODY, row);
      var draft   = GmailApp.createDraft(email, subject, body, { name: CONFIG.FROM_NAME });

      if (CONFIG.DRY_RUN) {
        mark_(sheet, rowNum, 'draft', 'DRY_RUN — draft created, not sent');
      } else {
        var msg = draft.send();
        sheet.getRange(rowNum, COL.THREAD_ID).setValue(msg.getThread().getId());
        sheet.getRange(rowNum, COL.SENT_AT).setValue(new Date());
        mark_(sheet, rowNum, 'sent', '');
        bumpDailyCount_();
      }
      sentThisRun++;
      Utilities.sleep(randMs_(CONFIG.JITTER_MIN_SEC, CONFIG.JITTER_MAX_SEC));

    } catch (err) {
      mark_(sheet, rowNum, 'error', String(err).slice(0, 200));
      log_('error', email + ' — ' + err);
    }
  }

  if (sentThisRun) log_('batch', sentThisRun + ' processed, ' + (remaining - sentThisRun) + ' left today');
}

/** Marks rows whose thread got a reply, so you stop following up. */
function checkReplies() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var me = Session.getActiveUser().getEmail().toLowerCase();
  var rows = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  var found = 0;

  for (var i = 0; i < rows.length; i++) {
    var threadId = String(rows[i][COL.THREAD_ID - 1]).trim();
    if (!threadId || String(rows[i][COL.REPLIED - 1]).trim() !== '') continue;

    try {
      var messages = GmailApp.getThreadById(threadId).getMessages();
      for (var m = 1; m < messages.length; m++) {
        if (messages[m].getFrom().toLowerCase().indexOf(me) === -1) {
          sheet.getRange(i + 2, COL.REPLIED).setValue(new Date());
          sheet.getRange(i + 2, COL.STATUS).setValue('replied');
          found++;
          break;
        }
      }
    } catch (err) {
      log_('error', 'thread ' + threadId + ' — ' + err);
    }
  }
  if (found) log_('replies', found + ' new');
}

// ── Caps and warmup ──────────────────────────────────────────────────────────

/** Today's allowance: ramps up from WARMUP_START, never past DAILY_MAX. */
function dailyAllowance_() {
  var props = PropertiesService.getScriptProperties();
  var start = props.getProperty('warmup_start_date');
  if (!start) { props.setProperty('warmup_start_date', today_()); return CONFIG.WARMUP_START; }

  var days = Math.floor((new Date(today_()) - new Date(start)) / 86400000);
  return Math.min(CONFIG.WARMUP_START + (days * CONFIG.WARMUP_STEP), CONFIG.DAILY_MAX);
}

function dailyRemaining_() { return dailyAllowance_() - dailyCount_(); }

function dailyCount_() {
  var v = PropertiesService.getScriptProperties().getProperty('count_' + today_());
  return v ? parseInt(v, 10) : 0;
}

function bumpDailyCount_() {
  PropertiesService.getScriptProperties().setProperty('count_' + today_(), String(dailyCount_() + 1));
}

/** Prints today's numbers to the execution log. Handy sanity check. */
function showStatus() {
  Logger.log('Warmup allowance today: %s | already sent: %s | remaining: %s | DRY_RUN: %s',
             dailyAllowance_(), dailyCount_(), dailyRemaining_(), CONFIG.DRY_RUN);
}

// ── Small helpers ────────────────────────────────────────────────────────────

function withinSendWindow_() {
  var now = new Date();
  var tz  = Session.getScriptTimeZone();
  var hour = parseInt(Utilities.formatDate(now, tz, 'H'), 10);
  var dow  = parseInt(Utilities.formatDate(now, tz, 'u'), 10);   // 1=Mon .. 7=Sun
  if (CONFIG.SEND_WEEKDAYS_ONLY && dow > 5) return false;
  return hour >= CONFIG.SEND_HOUR_START && hour < CONFIG.SEND_HOUR_END;
}

/** Replaces {{placeholders}} from the row, plus {{signature}}. */
function fill_(template, row) {
  return template.replace(/\{\{(\w+)\}\}/g, function (match, key) {
    if (key === 'signature') return CONFIG.SIGNATURE;
    var idx = HEADERS.indexOf(key);
    return idx === -1 ? match : String(row[idx]);
  });
}

function mark_(sheet, rowNum, status, note) {
  sheet.getRange(rowNum, COL.STATUS).setValue(status);
  if (note) sheet.getRange(rowNum, COL.NOTE).setValue(note);
}

/** Anyone who replied "no" anywhere, or is on a Suppression sheet, is skipped. */
function isSuppressed_(email) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Suppression');
  if (!sheet || sheet.getLastRow() < 1) return false;
  var list = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
  for (var i = 0; i < list.length; i++) {
    if (String(list[i][0]).trim().toLowerCase() === email.toLowerCase()) return true;
  }
  return false;
}

function isEmail_(s) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s); }
function today_()     { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function randMs_(a, b) { return (a + Math.random() * (b - a)) * 1000; }

function log_(event, detail) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.LOG_SHEET);
  if (sheet) sheet.appendRow([new Date(), event, detail]);
}
