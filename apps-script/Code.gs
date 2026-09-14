/**
 * HAF Watcher control plane.
 *
 *   doPost  — JSON API used by the Chrome extension (ingest / pending / result)
 *             and the HTML form posts from the confirm pages.
 *   doGet   — the pages you see on your phone (confirm / edit / skip).
 *
 * Deploy: Deploy > New deployment > Web app > Execute as: me,
 *         Who has access: Anyone. The shared secret is what protects the API.
 */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------------------------------------------ doPost

function doPost(e) {
  try {
    // Form submissions from the confirm/edit pages arrive urlencoded.
    if (e.parameter && e.parameter.formAction) return handleFormPost_(e.parameter);

    const payload = JSON.parse(e.postData.contents);
    checkSecret_(payload);

    switch (payload.action) {
      case 'ping':    return json_({ ok: true, sheet: sheet_().getParent().getUrl() });
      case 'ingest':  return json_(handleIngest_(payload.leads || []));
      case 'pending': return json_({ ok: true, leads: handlePending_() });
      case 'result':  return json_(handleResult_(payload));
      default:        return json_({ ok: false, error: 'unknown action' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function handleIngest_(leads) {
  let added = 0, skipped = 0;
  for (const lead of leads) {
    if (!lead || !lead.threadId) continue;
    if (insertLead_(lead)) { sendLeadEmail_(lead); added++; }
    else skipped++;
  }
  return { ok: true, added: added, duplicates: skipped };
}

/** Rows you approved from your phone, handed to the extension to post. */
function handlePending_() {
  const sh = sheet_();
  return rowsToObjects_(sh)
    .filter(function (r) { return r.status === 'APPROVED'; })
    .map(function (r) {
      return {
        threadId: String(r.threadId),
        url: r.url,
        title: r.title,
        author: r.author,
        category: r.category,
        draft: r.draft
      };
    });
}

function handleResult_(p) {
  const sh = sheet_();
  const row = findRow_(sh, p.threadId);
  if (!row) return { ok: false, error: 'unknown threadId' };
  setCell_(sh, row, 'status', p.status);
  setCell_(sh, row, 'result', p.status === 'POSTED' ? (p.detail || 'posted') : '');
  setCell_(sh, row, 'error', p.status === 'FAILED' ? (p.detail || 'unknown') : '');
  const lead = getLead_(p.threadId);
  if (lead) sendResultEmail_(lead, p.status, p.detail);
  return { ok: true };
}

/** POSTs coming from the confirm page and the edit form. */
function handleFormPost_(p) {
  const threadId = String(p.id || '');
  const action = String(p.formAction || '');
  if (!verifyToken_(threadId, action === 'save' ? 'edit' : action, p.t)) {
    return page_('Link expired', 'This approval link is no longer valid. Re-run the lead from the Sheet, or reply manually.', '#dc2626');
  }
  const sh = sheet_();
  const row = findRow_(sh, threadId);
  if (!row) return page_('Not found', 'That lead is not in the sheet any more.', '#dc2626');

  const current = getLead_(threadId);
  if (current.status === 'POSTED') {
    return page_('Already posted', 'This reply went out already — nothing more to do.', '#16a34a');
  }

  if (action === 'skip') {
    setCell_(sh, row, 'status', 'SKIPPED');
    setCell_(sh, row, 'decidedAt', new Date().toISOString());
    return page_('Skipped', 'This lead will be ignored.', '#64748b');
  }

  if (action === 'save') {
    const draft = String(p.draft || '').trim();
    if (!draft) return page_('Empty reply', 'Nothing to post — go back and add some text.', '#dc2626');
    setCell_(sh, row, 'draft', draft);
  }

  setCell_(sh, row, 'status', 'APPROVED');
  setCell_(sh, row, 'decidedAt', new Date().toISOString());
  return page_('Queued ✅',
    'Your reply is queued. The extension posts it within a minute and emails you the confirmation.',
    '#16a34a');
}

// ------------------------------------------------------------------- doGet

function doGet(e) {
  try {
    const p = e.parameter || {};
    const page = p.page || 'status';
    const threadId = String(p.id || '');

    if (page === 'status') {
      const rows = rowsToObjects_(sheet_());
      const counts = {};
      rows.forEach(function (r) { counts[r.status] = (counts[r.status] || 0) + 1; });
      return page_('HAF Watcher is running',
        'Leads in sheet: ' + rows.length + '<br>' +
        Object.keys(counts).map(function (k) { return k + ': ' + counts[k]; }).join('<br>'),
        '#0f172a');
    }

    if (!verifyToken_(threadId, page, p.t)) {
      return page_('Link expired', 'This link is no longer valid (they last ' +
        (APPROVE_TOKEN_TTL_MIN / 60) + ' hours).', '#dc2626');
    }
    const lead = getLead_(threadId);
    if (!lead) return page_('Not found', 'That lead is no longer in the sheet.', '#dc2626');
    if (lead.status === 'POSTED') return page_('Already posted', 'Nothing more to do here.', '#16a34a');

    if (page === 'edit') return editPage_(lead, p.t);
    return confirmPage_(lead, page, p.t);
  } catch (err) {
    return page_('Error', String(err && err.message ? err.message : err), '#dc2626');
  }
}

// -------------------------------------------------------------------- HTML

const PAGE_CSS =
  'body{margin:0;background:#f1f5f9;font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a}' +
  '.w{max-width:620px;margin:0 auto;padding:20px}' +
  '.c{background:#fff;border-radius:14px;padding:22px;box-shadow:0 1px 3px rgba(0,0,0,.08)}' +
  'h1{font-size:21px;margin:0 0 12px}' +
  'textarea{width:100%;box-sizing:border-box;min-height:280px;font:15px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;' +
  'padding:12px;border:1px solid #cbd5e1;border-radius:10px}' +
  'button{width:100%;padding:16px;font-size:17px;font-weight:600;color:#fff;border:0;border-radius:10px;margin-top:12px}' +
  '.q{background:#f8fafc;border-left:3px solid #cbd5e1;padding:12px;white-space:pre-wrap;font-size:14px;margin-bottom:16px}' +
  'a{color:#2563eb}';

function html_(body) {
  return HtmlService.createHtmlOutput(
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<style>' + PAGE_CSS + '</style><div class="w"><div class="c">' + body + '</div></div>')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function page_(title, msg, color) {
  return html_('<h1 style="color:' + color + '">' + title + '</h1><p>' + msg + '</p>');
}

/** GET never changes state — this is the button that does. */
function confirmPage_(lead, action, token) {
  const label = action === 'skip' ? 'Yes, skip it' : 'Yes, post it now';
  const color = action === 'skip' ? '#64748b' : '#16a34a';
  return html_(
    '<h1>' + (action === 'skip' ? 'Skip this lead?' : 'Post this reply?') + '</h1>' +
    '<p style="color:#475569;margin-top:-6px">' + esc_(lead.title) + '</p>' +
    (action === 'skip' ? '' : '<div class="q">' + esc_(lead.draft) + '</div>') +
    '<form method="post" action="' + webAppUrl_() + '">' +
      '<input type="hidden" name="formAction" value="' + action + '">' +
      '<input type="hidden" name="id" value="' + esc_(lead.threadId) + '">' +
      '<input type="hidden" name="t" value="' + esc_(token) + '">' +
      '<button style="background:' + color + '">' + label + '</button>' +
    '</form>' +
    '<p style="margin-top:16px"><a href="' + esc_(lead.url) + '">Open the thread on BHW</a></p>');
}

function editPage_(lead, token) {
  return html_(
    '<h1>Edit your reply</h1>' +
    '<p style="color:#475569;margin-top:-6px">' + esc_(lead.title) + '</p>' +
    '<div class="q">' + esc_(String(lead.snippet).slice(0, 600)) + '</div>' +
    '<form method="post" action="' + webAppUrl_() + '">' +
      '<input type="hidden" name="formAction" value="save">' +
      '<input type="hidden" name="id" value="' + esc_(lead.threadId) + '">' +
      '<input type="hidden" name="t" value="' + esc_(token) + '">' +
      '<textarea name="draft">' + esc_(lead.draft) + '</textarea>' +
      '<button style="background:#16a34a">Save &amp; post</button>' +
    '</form>');
}
