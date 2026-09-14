/**
 * EDIT THIS FILE, then run setup() once from the Apps Script editor.
 * Nothing here is committed with real values — keep your token out of git.
 */

// --- Secrets --------------------------------------------------------------
// Must match "sharedSecret" in the extension's Options page.
// Generate one: run crypto.randomUUID() in any browser console.
const SHARED_SECRET = 'CHANGE-ME-to-a-long-random-string';

// From @BotFather: /newbot, then paste the token here.
const TELEGRAM_BOT_TOKEN = '';

// From @userinfobot: send it any message, it replies with your numeric id.
const TELEGRAM_CHAT_ID = '';

// Random string appended to the webhook URL so only Telegram can reach it.
// (Apps Script cannot read request headers, so the secret rides in the query.)
const TELEGRAM_WEBHOOK_SECRET = 'CHANGE-ME-too';

// Optional email fallback. Leave blank to disable email entirely.
const EMAIL_TO = '';

// --- Behaviour ------------------------------------------------------------
// Leads at or above this score buzz your phone. Below it they arrive silently.
// Nothing is ever dropped. Change live from Telegram with:  /buzz 12
const DEFAULT_BUZZ_SCORE = 10;

// Threads with more replies than this are marked EXPIRED and never sent —
// the buyer has already picked someone.
const EXPIRE_AFTER_REPLIES = 10;

// Re-alerting on an author you already pitched. true = alert with a
// "you pitched them on <date>" note; false = never pitch the same person twice.
const REALERT_KNOWN_AUTHORS = true;

// --- BHW compliance -------------------------------------------------------
// Every draft is linted against this BEFORE it reaches Telegram. A draft that
// fails is still sent, flagged with a warning naming the broken rule — the tool
// never quietly hands you something that would break forum rules.
//
// TODO: fill these in from the BHW Hire a Freelancer rules.
const COMPLIANCE = {
  // Substrings/regex that MUST appear somewhere in the reply.
  mustInclude: [
    // { pattern: 'blackhatworld\\.com/threads/your-sales-thread', label: 'BST thread link' }
  ],
  // Must appear within the first N characters.
  mustAppearEarly: [
    // { pattern: 'Telegram', within: 120, label: 'contact line at top' }
  ],
  // Never allowed anywhere in the reply.
  banned: [
    'free trial'
  ],
  // Soft warnings — allowed, but flagged so you can eyeball them.
  warn: [
    'guaranteed', 'guarantee', '100%', 'cheapest'
  ]
};

// --- Internals ------------------------------------------------------------
const SHEET_NAME = 'leads';
const APPROVE_TOKEN_TTL_MIN = 720;
const HEADERS = [
  'threadId', 'foundAt', 'postedAt', 'replyCount', 'score', 'category', 'author',
  'title', 'budget', 'matched', 'url', 'snippet', 'draft', 'compliance',
  'status', 'decidedAt', 'result', 'error'
];

/** Runtime settings that can be changed from Telegram without editing code. */
function prop_(key, fallback) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  return v === null || v === '' ? fallback : v;
}
function setProp_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, String(value));
}
function buzzScore_()  { return Number(prop_('BUZZ_SCORE', DEFAULT_BUZZ_SCORE)); }
function isPaused_()   { return prop_('PAUSED', 'no') === 'yes'; }
