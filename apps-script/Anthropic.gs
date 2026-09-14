/**
 * Claude writes the two or three lines that prove you read the thread.
 *
 * Cost is the whole design here:
 *   - Claude writes ONLY the bullets. The template carries greeting, offer and
 *     sign-off, so output is ~70 tokens per lead instead of ~400.
 *   - Leads are batched into one request, so the instructions are paid for once
 *     per poll rather than once per lead.
 *   - The instructions sit in a cached system prefix; repeat polls read it at
 *     a tenth of the input price.
 *   - effort "low" — this is short-form writing from supplied text, not a
 *     reasoning problem.
 *   - Results are stored on the row, so a thread is never sent twice.
 *
 * Set ANTHROPIC_API_KEY in Script Properties. The key never leaves Google.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const AI_MAX_LEADS = 8;       // per request
const AI_SNIPPET_CHARS = 600; // enough to see the ask, not the whole post

function aiKey_()     { return prop_('ANTHROPIC_API_KEY', ''); }
function aiModel_()   { return prop_('ANTHROPIC_MODEL', 'claude-opus-5'); }
function aiEnabled_() { return !!aiKey_() && prop_('AI_SPECIFICS', 'yes') !== 'no'; }

const AI_SYSTEM = [
  'You write the middle of a reply to a job post on a freelancer forum.',
  'The rest of the reply (greeting, pricing offer, sign-off) is already written; you write ONLY the bullet points.',
  '',
  'For each thread, write 2-4 bullets that prove the writer read that specific post.',
  'Rules:',
  '- Name the actual deliverable, platform, market or constraint the poster asked for.',
  '- Concrete and checkable. "Manual submissions to directories that index in the UAE" beats "high quality citations".',
  '- No praise, no restating their request back to them, no filler.',
  '- Plain words. Never use an em dash, en dash or bullet glyph. Use ordinary hyphens and full stops.',
  '- Never promise a specific price, a discount, free work, a guarantee, or a ranking result.',
  '- Under 110 characters each.',
  '- British or neutral English, lower-key than marketing copy.',
  '',
  'Return ONLY a JSON object mapping each thread id to its array of bullet strings.',
  'Example: {"1847904":["...","..."],"1847910":["..."]}'
].join('\n');

/**
 * leads: [{ threadId, title, snippet, category }]
 * returns { [threadId]: [bullet, ...] } — missing ids just fall back to rules.
 */
function aiSpecifics_(leads) {
  if (!aiEnabled_() || !leads || !leads.length) return {};
  const batch = leads.slice(0, AI_MAX_LEADS);

  const threads = batch.map(function (l) {
    return [
      'id: ' + l.threadId,
      'service area: ' + (l.category || 'unknown'),
      'title: ' + String(l.title || '').slice(0, 200),
      'post: ' + String(l.snippet || '').replace(/\s+/g, ' ').slice(0, AI_SNIPPET_CHARS)
    ].join('\n');
  }).join('\n\n---\n\n');

  const body = {
    model: aiModel_(),
    max_tokens: 120 * batch.length + 100,
    system: [{ type: 'text', text: AI_SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: threads }]
  };

  try {
    const res = UrlFetchApp.fetch(ANTHROPIC_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': aiKey_(), 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    const data = JSON.parse(res.getContentText() || '{}');
    if (code !== 200) {
      logAi_('error ' + code + ': ' + ((data.error && data.error.message) || '').slice(0, 200));
      return {};
    }
    if (data.stop_reason === 'refusal') { logAi_('refused'); return {}; }

    const text = (data.content || [])
      .filter(function (b) { return b.type === 'text'; })
      .map(function (b) { return b.text; }).join('');

    recordAiUsage_(data.usage, batch.length);
    return cleanSpecifics_(parseJsonObject_(text));
  } catch (e) {
    logAi_('threw: ' + e.message);
    return {};
  }
}

/** The model may wrap JSON in prose or a fence; take the outermost object. */
function parseJsonObject_(text) {
  const s = String(text || '');
  const start = s.indexOf('{'), end = s.lastIndexOf('}');
  if (start === -1 || end <= start) return {};
  try { return JSON.parse(s.slice(start, end + 1)); } catch (e) { return {}; }
}

/** Enforce what the prompt asked for; a prompt is a request, not a guarantee. */
function cleanSpecifics_(obj) {
  const out = {};
  Object.keys(obj || {}).forEach(function (id) {
    const arr = Array.isArray(obj[id]) ? obj[id] : [];
    const bullets = arr
      .map(function (b) {
        return String(b)
          .replace(/[–—]/g, '-')     // en/em dash
          .replace(/^[\s\-•*]+/, '')      // leading glyph or hyphen
          .replace(/•/g, '-')
          .replace(/\s+/g, ' ')
          .trim();
      })
      .filter(function (b) { return b.length > 15 && b.length <= 160; })
      .filter(function (b) { return !/\b(guarantee|guaranteed|free trial|discount|\d+% off)\b/i.test(b); })
      .slice(0, 4);
    if (bullets.length) out[String(id)] = bullets;
  });
  return out;
}

// ---- running cost, so the bill is never a surprise ------------------------

function recordAiUsage_(usage, leadCount) {
  if (!usage) return;
  const p = PropertiesService.getScriptProperties();
  const day = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const prev = JSON.parse(p.getProperty('AI_USAGE') || '{}');
  const cur = prev.day === day ? prev : { day: day, calls: 0, leads: 0, in: 0, cached: 0, out: 0 };
  cur.calls += 1;
  cur.leads += leadCount;
  cur.in += (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
  cur.cached += usage.cache_read_input_tokens || 0;
  cur.out += usage.output_tokens || 0;
  p.setProperty('AI_USAGE', JSON.stringify(cur));
}

/** Rates per million tokens, by model. */
const AI_RATES = {
  'claude-opus-5':    { in: 5,  out: 25 },
  'claude-sonnet-5':  { in: 2,  out: 10 },
  'claude-haiku-4-5': { in: 1,  out: 5 }
};

function aiUsageText_() {
  const u = JSON.parse(PropertiesService.getScriptProperties().getProperty('AI_USAGE') || '{}');
  if (!u.day) return 'No Claude calls yet today.';
  const r = AI_RATES[aiModel_()] || AI_RATES['claude-opus-5'];
  const cost = (u.in / 1e6) * r.in + (u.cached / 1e6) * (r.in * 0.1) + (u.out / 1e6) * r.out;
  const per = u.leads ? cost / u.leads : 0;
  return '<b>Claude today</b> (' + aiModel_() + ')\n' +
    u.leads + ' leads in ' + u.calls + ' call(s)\n' +
    u.in + ' in · ' + u.cached + ' cached · ' + u.out + ' out\n' +
    '≈ $' + cost.toFixed(4) + ' total · $' + per.toFixed(5) + ' per lead';
}

function logAi_(msg) {
  Logger.log('[claude] ' + msg);
  try { tgSay_('⚠️ Claude specifics: ' + tgEsc_(msg), true); } catch (e) { /* telegram optional */ }
}
