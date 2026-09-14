/**
 * EDIT THIS FILE, then run setup() once from the Apps Script editor.
 * Nothing here is committed with real values — keep your token out of git.
 */

const VERSION = '0.6.0';

// --- Secrets --------------------------------------------------------------
// Preferred: set these once in  ⚙️ Project Settings → Script Properties.
// Then code updates (/update) never overwrite them. The literal here is only
// a fallback for people who paste values straight into the file.
//
//   SHARED_SECRET            must match "Shared secret" in the extension
//   TELEGRAM_BOT_TOKEN       from @BotFather
//   TELEGRAM_CHAT_ID         from @userinfobot
//   TELEGRAM_WEBHOOK_SECRET  any long random string
//   EMAIL_TO                 optional email fallback
//   GITHUB_TOKEN             fine-grained PAT, read-only "Contents" on the repo — enables /update
//   GITHUB_REPO              owner/name            (default troiwebz/data-analytics)
//   GITHUB_REF               branch to update from (default claude/wizardly-brahmagupta-178bgm)
const SHARED_SECRET           = prop_('SHARED_SECRET', 'CHANGE-ME-to-a-long-random-string');
const TELEGRAM_BOT_TOKEN      = prop_('TELEGRAM_BOT_TOKEN', '');
const TELEGRAM_CHAT_ID        = prop_('TELEGRAM_CHAT_ID', '');
const TELEGRAM_WEBHOOK_SECRET = prop_('TELEGRAM_WEBHOOK_SECRET', 'CHANGE-ME-too');
const EMAIL_TO                = prop_('EMAIL_TO', '');

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
