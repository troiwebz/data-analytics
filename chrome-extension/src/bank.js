// The answer bank: replies other members already wrote, kept by topic.
//
// Every thread the watcher reads adds its replies here. When you ask for
// material on a new thread, the closest past answers come out by keyword
// overlap - no Claude involved. They are raw material to write from, never
// something to post as-is: copying another member's reply is what moderators
// catch.

const KEY = 'answerBank';        // [{ threadId, title, url, forum, kw, replies, at }]
const MAX_THREADS = 400;
const MAX_REPLIES = 6;
const MAX_REPLY_CHARS = 700;

const STOP = new Set(('a an the and or but if then else of to in on at by for with from as is are was were be been '
  + 'being am i me my we our you your he she it its they them their this that these those there here what which who whom '
  + 'how why when where can could would should will shall do does did done have has had having not no yes so than too very '
  + 'just also any some all more most much many few own same other such only about into over under again further once '
  + 'up down out off out through during before after above below between because while both each get got getting '
  + 'like want need know think make use using used still even ever never really thing things something anything '
  + 'anyone someone people guys hi hello thanks thank please help question ask asking looking').split(/\s+/));

/** Lowercase tokens, stopwords out, short words out, deduped, capped. */
export function keywordsOf(text) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text || '').toLowerCase().split(/[^a-z0-9+#]+/)) {
    const w = raw.trim();
    if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w); out.push(w);
    if (out.length >= 40) break;
  }
  return out;
}

export async function getBank() {
  return (await chrome.storage.local.get(KEY))[KEY] || [];
}

/** Add one read thread. Only threads with at least one reply are worth keeping. */
export async function addToBank({ threadId, title, url, forum, body, replies }) {
  const good = (replies || []).map((r) => ({ author: r.author || '', text: String(r.text || '').slice(0, MAX_REPLY_CHARS) }))
    .filter((r) => r.text.length >= 40)
    .slice(0, MAX_REPLIES);
  if (!good.length) return { added: false };
  const bank = (await getBank()).filter((b) => String(b.threadId) !== String(threadId));
  bank.unshift({
    threadId: String(threadId), title: title || '', url: url || '', forum: forum || '',
    kw: keywordsOf(`${title}\n${body || ''}`), replies: good, at: new Date().toISOString()
  });
  await chrome.storage.local.set({ [KEY]: bank.slice(0, MAX_THREADS) });
  return { added: true, size: Math.min(bank.length, MAX_THREADS) };
}

/**
 * The closest past threads to this text, by shared keywords. At least two
 * shared words, or it is noise. Returns [{ title, url, forum, score, replies }].
 */
export async function bankMatches(text, { exclude = '', n = 3 } = {}) {
  const want = new Set(keywordsOf(text));
  if (!want.size) return [];
  const scored = [];
  for (const b of await getBank()) {
    if (String(b.threadId) === String(exclude)) continue;
    let score = 0;
    for (const k of b.kw || []) if (want.has(k)) score++;
    if (score >= 2) scored.push({ title: b.title, url: b.url, forum: b.forum, score, replies: b.replies });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, n);
}

export async function bankStats() {
  const bank = await getBank();
  return { threads: bank.length, replies: bank.reduce((s, b) => s + (b.replies?.length || 0), 0) };
}
