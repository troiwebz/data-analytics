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
      case 'recent':  return json_({ ok: true, leads: handleRecent_(body.limit || 300) });
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

    const lint = (lead.lint && Array.isArray(lead.lint.errors)) ? lead.lint : lintDraft_(lead.draft);
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

/** Newest rows for the dashboard's "Sync from Sheet". */
function handleRecent_(limit) {
  const sh = sheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  const n = Math.min(Number(limit) || 300, last - 1);
  const values = sh.getRange(last - n + 1, 1, n, HEADERS.length).getValues();
  return values.map(function (row) {
    const o = {};
    HEADERS.forEach(function (h, i) { o[h] = row[i] instanceof Date ? row[i].toISOString() : row[i]; });
    o.categoryLabel = o.category;
    return o;
  }).reverse();
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
  // Only 🚀 outcomes are worth a Telegram message; a manual ✅/⏭ from the
  // dashboard just updates the row.
  if (lead && (p.status === 'POSTED' || p.status === 'FAILED') && !/manually/.test(String(p.detail || ''))) {
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
