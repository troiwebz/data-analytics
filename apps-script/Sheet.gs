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
