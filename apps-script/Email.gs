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
