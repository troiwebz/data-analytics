/** The mobile UI: one email per lead, three big tap targets. */

function webAppUrl_() {
  return ScriptApp.getService().getUrl();
}

function actionLink_(threadId, action) {
  return webAppUrl_() + '?page=' + action + '&id=' + encodeURIComponent(threadId) +
         '&t=' + encodeURIComponent(signToken_(String(threadId), action));
}

function esc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sendLeadEmail_(lead) {
  const to = EMAIL_TO || Session.getEffectiveUser().getEmail();
  const heat = lead.score >= 12 ? '🔥' : lead.score >= 8 ? '⭐' : '•';
  const budget = lead.budget ? lead.budget + ' — ' : '';
  const subject = heat + ' [HAF ' + lead.score + 'pts] ' + budget + String(lead.title).slice(0, 90);

  const btn = function (href, bg, label) {
    return '<a href="' + href + '" style="display:block;background:' + bg +
      ';color:#fff;text-decoration:none;font:600 17px system-ui,-apple-system,Segoe UI,sans-serif;' +
      'padding:16px;border-radius:10px;text-align:center;margin:0 0 10px">' + label + '</a>';
  };

  const html =
    '<div style="max-width:600px;margin:0 auto;font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;color:#1a1a1a">' +
      '<div style="background:#0f172a;color:#fff;padding:14px 16px;border-radius:10px 10px 0 0">' +
        '<div style="font-size:13px;opacity:.75">' + esc_(lead.category) + ' · score ' + lead.score +
        (lead.budget ? ' · budget ' + esc_(lead.budget) : '') + '</div>' +
        '<div style="font-size:18px;font-weight:700;margin-top:4px">' + esc_(lead.title) + '</div>' +
      '</div>' +

      '<div style="border:1px solid #e2e8f0;border-top:0;padding:16px;border-radius:0 0 10px 10px">' +
        '<div style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:6px">Their post</div>' +
        '<div style="background:#f8fafc;border-left:3px solid #cbd5e1;padding:12px;white-space:pre-wrap">' +
          esc_(String(lead.snippet).slice(0, 900)) + '</div>' +
        '<div style="margin:10px 0 20px;font-size:13px;color:#475569">by <b>' + esc_(lead.author) +
          '</b> · <a href="' + esc_(lead.url) + '" style="color:#2563eb">open thread</a></div>' +

        '<div style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:6px">Your ready reply</div>' +
        '<div style="background:#f0fdf4;border-left:3px solid #22c55e;padding:12px;white-space:pre-wrap;margin-bottom:22px">' +
          esc_(lead.draft) + '</div>' +

        btn(actionLink_(lead.threadId, 'approve'), '#16a34a', '✅ &nbsp;Post this reply') +
        btn(actionLink_(lead.threadId, 'edit'), '#2563eb', '✏️ &nbsp;Edit first') +
        btn(actionLink_(lead.threadId, 'skip'), '#64748b', '⏭️ &nbsp;Skip') +

        '<div style="font-size:12px;color:#94a3b8;margin-top:14px">' +
          'Matched: ' + esc_((lead.matched || []).join(', ')) + '<br>' +
          'Links expire in ' + (APPROVE_TOKEN_TTL_MIN / 60) + ' hours. Nothing posts until you confirm on the next screen.' +
        '</div>' +
      '</div>' +
    '</div>';

  MailApp.sendEmail({
    to: to,
    subject: subject,
    htmlBody: html,
    body: lead.title + '\n\n' + lead.snippet + '\n\n--- reply ---\n' + lead.draft +
          '\n\nApprove: ' + actionLink_(lead.threadId, 'approve')
  });
}

function sendResultEmail_(lead, status, detail) {
  const to = EMAIL_TO || Session.getEffectiveUser().getEmail();
  const ok = status === 'POSTED';
  MailApp.sendEmail({
    to: to,
    subject: (ok ? '✅ Posted — ' : '❌ Post failed — ') + String(lead.title).slice(0, 80),
    htmlBody:
      '<div style="font:15px/1.55 system-ui,sans-serif;max-width:600px;margin:0 auto">' +
        '<p><b>' + (ok ? 'Your reply is live.' : 'Could not post.') + '</b></p>' +
        '<p style="background:#f8fafc;padding:12px;border-radius:8px">' + esc_(detail || '') + '</p>' +
        '<p><a href="' + esc_(lead.url) + '">Open the thread</a></p>' +
      '</div>'
  });
}
