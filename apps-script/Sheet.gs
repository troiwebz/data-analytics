/** Google Sheet as the state store. Editable from the Sheets mobile app. */

function sheet_() {
  const id = SHEET_ID || PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('No sheet yet — run setup() once from the editor.');
  const ss = SpreadsheetApp.openById(id);
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
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
  const ids = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues();
  for (let i = 1; i < ids.length; i++) {
    if (String(ids[i][0]) === String(threadId)) return i + 1;
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

/** Insert a lead unless we already have that threadId. Returns true if new. */
function insertLead_(lead) {
  const sh = sheet_();
  if (findRow_(sh, lead.threadId)) return false;
  sh.appendRow([
    String(lead.threadId),
    lead.foundAt || new Date().toISOString(),
    lead.postedAt || '',
    lead.score || 0,
    lead.categoryLabel || lead.category || '',
    lead.author || '',
    lead.title || '',
    lead.budget || '',
    (lead.matched || []).join(', '),
    lead.url || '',
    String(lead.snippet || '').slice(0, 4000),
    lead.draft || '',
    'PENDING',
    '', '', ''
  ]);
  return true;
}

/** Creates the spreadsheet on first use and prints what to paste into Config.gs. */
function setup() {
  let id = SHEET_ID || PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) {
    const ss = SpreadsheetApp.create('HAF Watcher — leads');
    id = ss.getId();
    PropertiesService.getScriptProperties().setProperty('SHEET_ID', id);
    ss.getSheets()[0].setName(SHEET_NAME);
    ss.getSheetByName(SHEET_NAME).appendRow(HEADERS);
    ss.getSheetByName(SHEET_NAME).setFrozenRows(1);
  }
  const url = 'https://docs.google.com/spreadsheets/d/' + id;
  Logger.log('Sheet ready: ' + url);
  Logger.log('Optionally paste this into Config.gs -> SHEET_ID: ' + id);
  Logger.log('Emails will go to: ' + (EMAIL_TO || Session.getEffectiveUser().getEmail()));
  Logger.log('Now: Deploy > New deployment > Web app > Execute as me, Anyone.');
  return url;
}
