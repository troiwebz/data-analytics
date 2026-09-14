/**
 * EDIT THESE THREE VALUES, then run setup() once from the Apps Script editor.
 */

// Must match "sharedSecret" in the extension's Options page.
// Generate one: open the browser console and run crypto.randomUUID()
const SHARED_SECRET = 'CHANGE-ME-to-a-long-random-string';

// Where lead emails go. Leave blank to use the account running the script.
const EMAIL_TO = '';

// Leave blank on first run — setup() creates a Sheet and prints its id here.
const SHEET_ID = '';

// ---------------------------------------------------------------------------
const SHEET_NAME = 'leads';
const APPROVE_TOKEN_TTL_MIN = 720;   // approval links expire after 12 hours
const HEADERS = [
  'threadId', 'foundAt', 'postedAt', 'score', 'category', 'author',
  'title', 'budget', 'matched', 'url', 'snippet', 'draft',
  'status', 'decidedAt', 'result', 'error'
];
