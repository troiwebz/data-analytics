// Reading the thread itself.
//
// Everything Claude used to know about a job came from the title and whatever
// the RSS feed carried as a description - and a thread found on a listing page
// has no description at all. That is how "Crypto Runner" (a buyer wanting
// someone to run crypto ads without getting the accounts suspended) came back
// as wallet and exchange operations across several chains. The title alone is
// not a brief.
//
// So the thread page is read: the first post in full, and the replies already
// on it. The replies matter as much as the post. They are the other
// freelancers bidding for the same job - they show what has already been
// promised, which is what you have to say something different from, and they
// show the register the room actually writes in, which is plainer and more
// direct than anything a template would produce.
//
// Regex, not DOMParser: MV3 service workers have no DOMParser. All the markup
// assumptions live in the patterns here.

const POST_SPLIT = /<article[^>]*class="[^"]*\bmessage\b[^"]*"/;
const AUTHOR     = /data-author="([^"]*)"/;
const BODY       = /<div class="bbWrapper">([\s\S]*?)<\/div>\s*(?:<\/div>|<aside|<div class="message-signature)/;
const BODY_LOOSE = /<div class="bbWrapper">([\s\S]*?)<\/article>/;
// A quote block is the post being replied to, not what this person wrote.
const QUOTE      = /<blockquote[\s\S]*?<\/blockquote>/g;
// Signatures are advertising, not an answer to the job.
const SIGNATURE  = /<div class="message-signature"[\s\S]*$/;

function text(html) {
  return String(html || '')
    .replace(QUOTE, ' ')
    .replace(SIGNATURE, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * A freelancer's pitch is mostly contact details and a sales banner. Strip the
 * lines that carry no information about the job, so what reaches Claude is the
 * claim itself.
 */
const NOISE = new RegExp([
  '^\\s*(telegram|skype|whatsapp|discord|email|gmail|e-?mail|contact|pm me|dm me|website|site)\\b',
  '^\\s*https?://', '^\\s*@\\w+\\s*$', '^[\\W_]{0,4}$'
].join('|'), 'i');

const clean = (body) => text(body).split('\n')
  .filter((l) => l.trim() && !NOISE.test(l))
  .join('\n')
  .trim();

/** { body, replies: [{ author, text }] } from a thread page's HTML. */
export function parseThread(html) {
  const blocks = String(html || '').split(POST_SPLIT).slice(1);
  const posts = [];
  for (const b of blocks) {
    const author = (b.match(AUTHOR) || [])[1] || '';
    const raw = (b.match(BODY) || b.match(BODY_LOOSE) || [])[1] || '';
    const body = clean(raw);
    if (body) posts.push({ author, text: body });
  }
  if (!posts.length) return { body: '', replies: [] };
  return { body: posts[0].text, replies: posts.slice(1) };
}

/**
 * Read one thread. Signed in, because a guest sees less of the page than you
 * do. Never throws: a thread we cannot read just falls back to the title and
 * whatever the feed carried, which is how it worked before.
 */
export async function fetchThread(url) {
  try {
    const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
    if (!res.ok) return { body: '', replies: [] };
    const html = await res.text();
    if (!/\bbbWrapper\b/.test(html)) return { body: '', replies: [] };   // login wall or theme change
    return parseThread(html);
  } catch {
    return { body: '', replies: [] };
  }
}

/**
 * Read several threads, one at a time with a pause. This is a signed-in
 * account reading its own forum, so it goes at a human pace rather than
 * firing a burst of requests.
 */
export async function fetchThreads(leads, { delayMs = 1500, max = 8, onOne } = {}) {
  const out = {};
  const list = leads.slice(0, max);
  for (let i = 0; i < list.length; i++) {
    const l = list[i];
    if (!l?.url) continue;
    const got = await fetchThread(l.url);
    if (got.body || got.replies.length) out[l.threadId] = got;
    if (onOne) onOne(l, got);
    if (i < list.length - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return out;
}
