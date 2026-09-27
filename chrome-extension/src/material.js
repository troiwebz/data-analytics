// The material pack: what you take to Claude or ChatGPT on your phone.
//
// Not a draft. The question, the replies already on the thread, and the
// closest answers from the bank - each in its own <pre> block, because one tap
// on a block copies exactly that and nothing else. You paste the pack into an
// AI chat, get your answer, and reply to the thread card with it.

const LIMIT = 3900;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const PROMPT = 'Write a helpful, specific reply for a forum thread. Plain English, 5-8 lines, '
  + 'no self-promotion, no links. Use the existing replies below only as background - do not copy them. '
  + 'Answer the question directly and add one thing nobody else said.';

function block(label, text, room) {
  const body = esc(String(text || '').trim());
  if (!body) return '';
  const head = label ? `${label}\n` : '';
  const wrap = `${head}<pre>${body}</pre>`;
  if (wrap.length <= room) return wrap;
  return `${head}<pre>${body.slice(0, Math.max(0, room - head.length - 30))}\n[cut]</pre>`;
}

/** Pack pieces into as few messages as fit under Telegram's limit. */
function pack(pieces) {
  const out = [];
  let cur = '';
  for (const p of pieces) {
    if (!p) continue;
    if (!cur) { cur = p; continue; }
    if (cur.length + 2 + p.length <= LIMIT) cur += '\n\n' + p;
    else { out.push(cur); cur = p; }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * HTML messages for one lead. `matches` come from bank.bankMatches.
 * Returns an array of strings, each under Telegram's limit.
 */
export function materialMessages(lead, matches = []) {
  const replies = lead.replies || [];
  const head = `📋 <b>Material</b> · ${esc(lead.tagLabel || '')}${lead.intent ? ` · ${esc(lead.intent)}` : ''}\n`
    + `<b>${esc(lead.title)}</b>\n<a href="${esc(lead.url)}">Open thread</a>`
    + (lead.sourceLabel ? ` · ${esc(lead.sourceLabel)}` : '');

  const pieces = [head];
  pieces.push(block('🧾 <b>PROMPT</b> (paste first)', PROMPT, LIMIT));
  pieces.push(block(`❓ <b>THE QUESTION</b> by ${esc(lead.author || 'the poster')}`,
    lead.body || lead.snippet || lead.title, LIMIT));

  if (replies.length) {
    pieces.push(`💬 <b>EXISTING REPLIES (${replies.length})</b>`);
    replies.slice(0, 8).forEach((r, i) => {
      pieces.push(block(`#${i + 1} <i>${esc(r.author || 'member')}</i>`, r.text, 1500));
    });
  } else {
    pieces.push('💬 <b>No replies yet</b> - you would be first.');
  }

  if (matches.length) {
    pieces.push('🗂 <b>SIMILAR ANSWERS FROM THE BANK</b>');
    for (const m of matches) {
      const best = (m.replies || []).slice(0, 2);
      best.forEach((r, i) => pieces.push(block(`From "${esc(String(m.title).slice(0, 60))}" · ${esc(r.author || 'member')}`, r.text, 1200)));
    }
  }

  pieces.push('✍️ <b>Next:</b> copy the blocks into Claude or ChatGPT, get your answer, then '
    + '<b>reply to the thread card</b> (swipe it) with the answer text. Chrome posts it when you tap 🚀.');
  return pack(pieces);
}
