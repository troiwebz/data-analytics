// The header of a lead's Telegram message: what it is, how hot, how old, and
// where to go. The two drafts are NOT here - telegram.js appends the public
// reply to this card and sends the PM as a message of its own, so each is a
// clean <pre> block that one tap copies and neither can be truncated by
// Telegram's 4096-character limit.
import { lintSummary } from './compliance.js';
import { stamp } from './timefmt.js';

/** `matched` is an array locally, comma-joined when it comes from the Sheet. */
const tagsOf = (v) => Array.isArray(v) ? v.map(String)
  : typeof v === 'string' ? v.split(',').map((t) => t.trim()).filter(Boolean) : [];

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function ago(iso) {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}
let cardTz = {};
export const setCardZone = (cfg) => { cardTz = cfg; };
const when = (iso) => (iso ? stamp(iso, cardTz) : '');

export function suggestedOffer(lead) {
  if (lead.budgetAmount > 0) {
    const n = Math.round(lead.budgetAmount * 0.9 / 5) * 5;
    return `$${n}${/\/\s?mo|monthly|per month/i.test(`${lead.snippet} ${lead.title}`) ? '/mo' : ''}`;
  }
  return { seo: '$300+', ads: '$400+/mo', design: '$120+', web: '$400+', content: '$80+/batch' }[lead.category] || 'quote on scope';
}

/** HTML for the Telegram card. Kept under Telegram's 4096-char limit. */
export function buildCard(lead) {
  const score = Number(lead.score) || 0;
  const tier = score >= 15 ? '🔥' : score >= 10 ? '⭐' : '•';
  const replies = lead.replyCount == null ? '?' : lead.replyCount;
  const lintLines = [
    lintSummary(lead.lint),
    lead.dmLint && lintSummary(lead.dmLint) ? 'PM: ' + lintSummary(lead.dmLint) : ''
  ].filter(Boolean).join('\n');

  const head =
    `${tier} <b>${score} pts</b> · ${esc(lead.categoryLabel || lead.category || '—')}${lead.budget ? ' · ' + esc(lead.budget) : ''}\n` +
    `<b>${esc(lead.title)}</b>\n\n` +
    // A generic draft never looks wrong on its own - nothing about it says
    // "this is the fallback", so it has to be said here, loud, before the
    // text itself. Only shown when Claude was actually asked and did not
    // answer; a lead you never turned AI on for is not a failure.
    (lead.draftedByNote
      ? `⚠️ <b>Generic draft — Claude did not write the technical lines</b> (${esc(lead.draftedByNote)}). Read before sending.\n\n`
      : '') +
    `👤 ${esc(lead.author)}   💬 ${replies} replies\n` +
    `🕒 Posted ${esc(when(lead.postedAt))} (${ago(lead.postedAt)})${lead.postedAtSource !== 'listing' ? ' ~approx' : ''}\n` +
    (lead.lastActivityAt && lead.lastActivityAt !== lead.postedAt
      ? `💬 Last reply ${esc(when(lead.lastActivityAt))} (${ago(lead.lastActivityAt)})\n` : '') +
    (lead.replyCount != null ? `📊 You'd be reply #${Number(lead.replyCount) + 1}\n` : '') +
    `💰 Suggested: ${esc(suggestedOffer(lead))}\n` +
    (lead.priorContact ? `🔁 You pitched this author on ${esc(lead.priorContact)}\n` : '') +
    (tagsOf(lead.matched).length ? `🔎 ${esc(tagsOf(lead.matched).slice(0, 6).join(', '))}\n` : '') +
    (lintLines ? `\n${esc(lintLines)}\n` : '') +
    `\n<a href="${esc(lead.url)}">Open thread</a>` +
    (lead.dmUrl ? ` · <a href="${esc(lead.dmUrl)}">Open PM to ${esc(lead.author)}</a>` : '');

  return head;
}

/**
 * The card for a lead from a watched forum or the site-wide feed. No score,
 * no offer, no PM: these are threads you answer in public, and the only thing
 * the card has to say is what it is, who asked, and whether it is new or bumped.
 */
export function buildThreadCard(lead) {
  const tag = lead.searchTag === 'DONE' || lead.status === 'POSTED' ? '✅ DONE' : lead.bump ? '🔁 BUMP' : '🆕 NEW';
  const intent = lead.intent === 'BUYER' ? '🎯 BUYER — you can pitch'
    : lead.intent === 'QUESTION' ? '💬 QUESTION — answer, no pitch'
    : 'ℹ️ INFO';
  const replies = lead.replyCount == null ? (lead.replies ? lead.replies.length : '?') : lead.replyCount;
  const started = lead.startedAt || lead.postedAt;
  const words = tagsOf(lead.watchWords);
  const answer = plainLen(lead.draftApproved || lead.draft)
    ? '✍️ Your answer is on this card — tap 🚀 to post it.'
    : '✍️ No answer yet — tap 📋 Material, write it with Claude/ChatGPT, reply to this card with it.';
  return `${tag} · ${esc(lead.sourceLabel || lead.forum || 'BHW')}${lead.forum && lead.forum !== lead.sourceLabel ? ' · ' + esc(lead.forum) : ''}\n`
    + `<b>${esc(lead.title)}</b>\n`
    + `${intent}\n\n`
    + `👤 ${esc(lead.author || '?')}   💬 ${replies} replies\n`
    + (started ? `🕒 Started ${esc(when(started))} (${ago(started)})\n` : '')
    + (lead.bump && lead.bumpedAt ? `🔁 Bumped ${esc(when(lead.bumpedAt))} (${ago(lead.bumpedAt)})\n` : '')
    + (words.length ? `🔎 ${esc(words.join(', '))}\n` : '')
    + `${answer}\n`
    + `\n<a href="${esc(lead.url)}">Open thread</a>`;
}
const plainLen = (s) => String(s || '').trim().length;
