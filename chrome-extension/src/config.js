// Default configuration. Everything here is editable from the Options page
// (chrome://extensions -> HAF Watcher -> Details -> Extension options) and is
// stored in chrome.storage.local under the key "config".

export const FEED_URL =
  'https://www.blackhatworld.com/forums/hire-a-freelancer.76/index.rss';

export const DEFAULT_CONFIG = {
  enabled: false,              // flipped on from Options once the webhook is set
  feedUrl: FEED_URL,
  pollMinutes: 3,              // how often to check the forum
  jitterSeconds: 40,           // random delay added to each poll so it's not clockwork
  approvalPollMinutes: 1,      // how often to ask Apps Script for approvals
  backfillHours: 48,           // first run: record threads this recent into the Sheet (no Telegram)

  webhookUrl: '',              // Apps Script /exec URL
  sharedSecret: '',            // must match SHARED_SECRET in Apps Script

  notifyScore: 0,              // send everything; Telegram decides what buzzes
  autoPost: true,              // act on 🚀 taps from Telegram (nothing posts without one)
  maxPostsPerDay: 10,          // hard cap on 🚀 posts, resets at local midnight
  minMinutesBetweenPosts: 3,   // spacing between two 🚀 posts

  // Staging: for strong leads, open the thread in a background tab and type the
  // reply in WITHOUT submitting. A 🚀 tap then just clicks Submit — sub-second.
  stageScore: 10,              // stage leads at or above this score
  maxStagedTabs: 3,            // never hold more than this many tabs open
  stageTtlMinutes: 20,         // close a staged tab if you haven't decided by then

  // ---- Matching -------------------------------------------------------
  // A lead must hit at least one category. The first category it hits picks
  // the reply template. Patterns are case-insensitive regex source strings.
  categories: [
    {
      key: 'seo',
      label: 'SEO / Links',
      patterns: [
        '\\bseo\\b', 'backlink', 'link building', 'guest post', '\\bpbn\\b',
        'off[- ]?page', 'on[- ]?page', '\\bserp\\b', 'keyword research',
        'domain authority', '\\bda\\s?\\d+', '\\bdr\\s?\\d+', 'rank(ing)? (my|our|the) site',
        'google ranking', 'local seo', 'gmb', 'google business profile'
      ]
    },
    {
      key: 'ads',
      label: 'Paid Ads',
      patterns: [
        'google ads', 'adwords', 'facebook ads', '\\bfb ads\\b', 'meta ads',
        'ppc', 'ad account', 'ad campaign', 'tiktok ads', 'bing ads',
        'media buy', 'campaign manager', 'ads? manager', 'white ?hat ads',
        'black ?hat ads', 'cloak', 'ad creative'
      ]
    },
    {
      key: 'design',
      label: 'Design / Artwork',
      patterns: [
        '\\bdesign(er)?\\b', 'artwork', '\\blogo\\b', 'banner', 'graphic',
        'photoshop', 'illustrator', '\\bfigma\\b', 'thumbnail', 'mockup',
        'ui\\s?/?\\s?ux', 'branding', 'brand identity', 'flyer', 'poster',
        'social media creative', 'video edit'
      ]
    },
    {
      key: 'web',
      label: 'Web / Dev',
      patterns: [
        'wordpress', 'landing page', 'website (build|design|develop)',
        'web ?dev', 'shopify', 'funnel', 'html', 'css', 'react', 'php',
        'plugin dev', 'speed optimi'
      ]
    },
    {
      key: 'content',
      label: 'Content / Copy',
      patterns: [
        'content writ', 'copywrit', 'blog post', 'article writ', 'ghost ?writ',
        '\\bcopy\\b', 'script writ', 'product description'
      ]
    }
  ],

  // Extra points when these appear anywhere in the post.
  boosts: [
    { pattern: 'monthly|retainer|ongoing|long[- ]term|recurring', weight: 4, label: 'recurring' },
    { pattern: 'bulk|multiple sites|several projects', weight: 2, label: 'bulk' },
    { pattern: 'urgent|asap|immediately|today', weight: 2, label: 'urgent' },
    { pattern: 'agency|white ?label|reseller', weight: 3, label: 'agency' },
    { pattern: 'portfolio|samples', weight: 1, label: 'wants-samples' }
  ],

  // Any hit here kills the lead outright — never emailed, never posted.
  excludes: [
    'for free', 'no budget', 'free of charge', 'exchange for',
    'barter', 'revenue share', 'rev ?share', 'equity only', 'unpaid',
    'no payment', 'partnership only'
  ],

  // ---- Reply templates -------------------------------------------------
  // {{var}} is substituted. {a|b|c} picks one at random (spintax), so no two
  // replies are byte-identical.
  // Available vars: author, title, budget, category, link
  templates: {
    seo: `{Hi|Hey} @{{author}},

{I can take this on|This is squarely what we do|Happy to handle this} — we run SEO for agencies and direct clients, so {{category}} work is our day job.

• What you get: full audit, on-page fixes, and a white-hat link plan
• Turnaround: first deliverables in 5-7 days
• Reporting: monthly rank + traffic sheet, no fluff
{{budgetLine}}
{Samples and past results on request|Happy to share live case studies|Can send anonymised client results}. {Dropping you a PM with details|PMing you now}.`,

    ads: `{Hi|Hey} @{{author}},

{We handle exactly this|This is in our wheelhouse|Can definitely help} — we manage paid campaigns end to end (Google, Meta, TikTok).

• Setup: account structure, tracking, conversion events
• Creative: we produce the ad assets in-house
• Optimisation: weekly, with a clear spend-to-result report
{{budgetLine}}
{Happy to walk through past accounts|Can share anonymised campaign data}. {Sending a PM|PMing you the details}.`,

    design: `{Hi|Hey} @{{author}},

{We can do this|Right up our street|Happy to take this on} — we're a design team, so {{category}} is what we produce daily.

• Source files included (PSD / AI / Figma)
• 2 concepts first, then unlimited tweaks on the chosen one
• Turnaround: 2-4 days depending on scope
{{budgetLine}}
{Portfolio available on request|Can send the portfolio over}. {PMing you now|Sending you a PM}.`,

    web: `{Hi|Hey} @{{author}},

{We can build this|Happy to handle this|This is straightforward for us} — we do site builds and landing pages in-house.

• Clean, fast, mobile-first build
• On-page SEO done properly from the start
• Turnaround depends on page count — can scope it today
{{budgetLine}}
{Live examples on request|Can send live examples}. {Sending a PM|PMing you}.`,

    // Used when no category matched. Kept deliberately open-ended.
    generic: `{Hi|Hey} @{{author}},

{Interested in this|We can help with this|This is something we can take on} — we're a full-service agency (SEO, paid ads, design, web, content), so whatever the scope, it's in-house.

• Tell us the details and we'll scope it same day
• Clear price before any work starts
{{budgetLine}}
{Happy to share relevant past work|Examples on request}. {PMing you now|Sending a PM}.`,

    content: `{Hi|Hey} @{{author}},

{We can cover this|Happy to take this|This is something we do a lot of} — written by humans, briefed against real search intent.

• SEO-aware, no AI filler
• Sample piece before you commit
• Turnaround: 2-3 days per batch
{{budgetLine}}
{Samples on request|Can send samples}. {PMing you now|Sending a PM}.`
  }
};

export const CONFIG_VERSION = 3;

/**
 * Upgrade settings saved by an older version of the extension without
 * touching what the user typed (URL, secret, keyword edits). Runs on every
 * install/reload; a no-op once configVersion is current.
 */
export async function migrateConfig() {
  const { config } = await chrome.storage.local.get('config');
  if (!config) return;
  const v = config.configVersion || 1;
  if (v >= CONFIG_VERSION) return;
  const next = { ...config };
  if (v < 3) {
    // v1/v2 shipped 10-minute polling, a score filter, no staging, no backfill.
    if (next.pollMinutes === 10) next.pollMinutes = DEFAULT_CONFIG.pollMinutes;
    if (next.notifyScore === 4) next.notifyScore = DEFAULT_CONFIG.notifyScore;
    for (const k of ['jitterSeconds', 'stageScore', 'maxStagedTabs', 'stageTtlMinutes', 'backfillHours']) {
      if (next[k] == null) next[k] = DEFAULT_CONFIG[k];
    }
    next.templates = { ...DEFAULT_CONFIG.templates, ...(next.templates || {}) };  // adds 'generic'
  }
  next.configVersion = CONFIG_VERSION;
  await chrome.storage.local.set({ config: next });
  return next;
}

export async function getConfig() {
  const { config } = await chrome.storage.local.get('config');
  return { ...DEFAULT_CONFIG, ...(config || {}) };
}

export async function setConfig(patch) {
  const current = await getConfig();
  const next = { ...current, ...patch, configVersion: CONFIG_VERSION };
  await chrome.storage.local.set({ config: next });
  return next;
}
