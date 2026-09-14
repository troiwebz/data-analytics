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
  autoPost: true,              // act on 🚀 taps from Telegram and the dashboard (nothing posts without one)
  maxPostsPerDay: 10,          // hard cap on 🚀 posts, resets at local midnight
  minMinutesBetweenPosts: 3,   // spacing between two 🚀 posts
  maxDmsPerDay: 8,             // hard cap on sent DMs — unsolicited PMs are what
                               // BHW moderators act on, so keep this low
  minMinutesBetweenDms: 5,     // spacing between two DMs

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
        { p: '\\bdesign(er|s)?\\b', w: 2 }, { p: 'artwork', w: 2 }, { p: '\\blogo\\b', w: 2 },
        'banner', 'graphic', 'photoshop', 'illustrator', '\\bfigma\\b', 'thumbnail',
        'mockup', 'ui\\s?/?\\s?ux', 'branding', 'brand identity', 'flyer',
        // "poster" alone is the person who posts, not a printed poster — the
        // TikTok USA Poster thread taught us that. Require a design context.
        // Outweigh Social's generic "poster" (w:3) — an explicit design
        // context means it really is a printed poster.
        { p: 'poster design', w: 4 }, { p: 'design(ed|ing)?\\s+(a\\s+)?poster', w: 4 },
        { p: 'print(ed)?[- ]?(ready )?poster', w: 4 }, { p: '\\ba[0-9] poster', w: 4 },
        'social media creative', 'video edit', 'banner ad'
      ]
    },
    {
      key: 'social',
      label: 'Social / Accounts',
      patterns: [
        // Platform + doing-something-with-accounts is the strong signal.
        { p: '\\btiktok\\b', w: 3 }, { p: '\\binstagram\\b|\\big\\b', w: 3 },
        { p: '\\byoutube\\b|\\bshorts\\b', w: 3 }, { p: '\\btwitter\\b|\\bx\\.com\\b', w: 2 },
        { p: '\\bthreads\\b|\\bsnapchat\\b|\\breddit\\b', w: 2 },
        { p: '\\bposter\\b|\\bposters\\b', w: 3 },          // a person who posts
        { p: 'post(ing|er)?\\s+(daily|for us|content|videos|reels)', w: 3 },
        { p: 'account manage|manage (my|our|the) account|account manager', w: 3 },
        { p: 'aged account|warm(ed)?[- ]up|account warm', w: 3 },
        { p: '\\b(usa?|uk|canada|australia|german|geo)[- ]?(based|ip|account|number|sim)', w: 3 },
        { p: 'upload(s|ing)? (videos|reels|shorts|content)', w: 2 },
        'content calendar', 'engagement group', 'follower growth', 'grow (my|our) (page|account)',
        'social media manage', 'community manage', 'creator account', 'shadowban'
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
    // No money in it
    'for free', 'no budget', 'free of charge', 'exchange for',
    'barter', 'revenue share', 'rev ?share', 'equity only', 'unpaid',
    'no payment', 'partnership only',
    // Someone selling, not hiring — pitching them our services reads badly.
    '^\\s*(wts|selling|for sale)\\b', '\\bwts\\b', '\\bfor sale\\b',
    'accounts? for sale', 'selling (my|our|aged|bulk|\\d)',
    'i am (selling|offering)', "i'm (selling|offering)"
  ],

  // ---- BHW compliance ---------------------------------------------------
  // Every public reply and PM is checked before it goes anywhere. A failing
  // draft is never auto-posted; it still reaches you, flagged with the rule.
  compliance: {
    mustInclude: [],                                   // e.g. { pattern: 'your-sales-thread', label: 'BST link' }
    mustAppearEarly: [],                               // e.g. { pattern: 'Telegram', within: 120, label: 'contact at top' }
    banned: ['free trial'],
    warn: ['guaranteed', 'guarantee', '100%', 'cheapest']
  },

  // ---- Reply templates -------------------------------------------------
  // {{var}} is substituted. {a|b|c} picks one at random (spintax), so no two
  // replies are byte-identical.
  // Available vars: author, title, budget, category, link
  templates: {
    seo: `{Hi|Hey} @{{author}},

{This is squarely what we do|Happy to handle this|We do this daily} — we run SEO for agencies and direct clients, so {{category}} work is our day job.

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

{We can do this|Right up our street|Happy to handle this} — we're a design team, so {{category}} is what we produce daily.

• Source files included (PSD / AI / Figma)
• 2 concepts first, then unlimited tweaks on the chosen one
• Turnaround: 2-4 days depending on scope
{{budgetLine}}
{Portfolio available on request|Can send the portfolio over}. {PMing you now|Sending you a PM}.`,

    social: `{Hi|Hey} @{{author}},

{We can cover this|Happy to handle this|This is exactly what our team does} — we run and post on social accounts day to day.

• Real devices and residential connections, matched to the geo you need
• Consistent daily posting to your schedule, not bursts
• Warmed accounts, sensible limits, no burning the profile
{{budgetLine}}
{Tell us the platform, geo and volume and we'll scope it today|Send the platform, geo and daily volume and we'll come back with a price}. {Happy to show accounts we already run|Can show current accounts on request}.`,

    web: `{Hi|Hey} @{{author}},

{We can build this|Happy to handle this|This is straightforward for us} — we do site builds and landing pages in-house.

• Clean, fast, mobile-first build
• On-page SEO done properly from the start
• Turnaround depends on page count — can scope it today
{{budgetLine}}
{Live examples on request|Can send live examples}. {Sending a PM|PMing you}.`,

    // Used when no category matched. Kept deliberately open-ended.
    generic: `{Hi|Hey} @{{author}},

{Interested in this|We can help with this|Happy to handle this} — we're a full-service agency (SEO, paid ads, design, web, content), so whatever the scope, it's in-house.

• Tell us the details and we'll scope it same day
• Clear price before any work starts
{{budgetLine}}
{Happy to share relevant past work|Examples on request}. {PMing you now|Sending a PM}.`,

    content: `{Hi|Hey} @{{author}},

{We can cover this|Happy to handle this|This is something we do a lot of} — written by humans, briefed against real search intent.

• SEO-aware, no AI filler
• Sample piece before you commit
• Turnaround: 2-3 days per batch
{{budgetLine}}
{Samples on request|Can send samples}. {PMing you now|Sending a PM}.`
  },

  // Subject line of the DM. XenForo requires one. Same {{vars}} as the body.
  dmTitle: `{Re: |}{{threadTitle}}`,

  // ---- Private message ---------------------------------------------------
  // The offer that closes every PM. Edit this one line and every PM changes.
  dmOffer: `{Happy to share our portfolio and live samples|I can send over our portfolio and live samples|Happy to send the portfolio and live examples of recent work} so you can see the standard before you decide anything.

{We can get started immediately|We can start on this right away|Ready to start today} — {just reply here or on the thread|say the word and I'll get moving|send over the details and I'll get going}.`,

  // ---- Private message templates ---------------------------------------
  // The PM to the thread author. Same {{vars}} and spintax; extra var {{threadTitle}}.
  dmTemplates: {
    // Structure for all of them:
    //   Hi <author>  →  "I just saw your HAF thread: <url>"  →  the public
    //   reply verbatim  →  {{offer}}. Keep {{reply}} and {{offer}} in place.
    generic: `Hi {{author}},

I just saw your HAF thread: {{url}}

{{reply}}

{{offer}}`,

    seo: `Hi {{author}},

I just saw your HAF thread: {{url}}

{{reply}}

{{offer}}`,

    ads: `Hi {{author}},

I just saw your HAF thread: {{url}}

{{reply}}

{{offer}}`,

    design: `Hi {{author}},

I just saw your HAF thread: {{url}}

{{reply}}

{{offer}}`,

    social: `Hi {{author}},

I just saw your HAF thread: {{url}}

{{reply}}

{{offer}}`,

    web: `Hi {{author}},

I just saw your HAF thread: {{url}}

{{reply}}

{{offer}}`,

    content: `Hi {{author}},

I just saw your HAF thread: {{url}}

{{reply}}

{{offer}}`
  }
};

export const CONFIG_VERSION = 10;

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
  if (v < 4) {
    for (const k of ['compliance']) {
      if (next[k] == null) next[k] = DEFAULT_CONFIG[k];
    }
    next.dmTemplates = { ...DEFAULT_CONFIG.dmTemplates, ...(next.dmTemplates || {}) };
    for (const [k, t] of Object.entries(next.templates || {})) {   // retire the old opener
      if (typeof t === 'string') next.templates[k] = t.replace(/\{I can take this on\|/, '{').replace(/\|Happy to take this on\}/, '|Happy to handle this}');
    }
  }
  if (v < 5) {
    // v4's PMs were standalone paragraphs; v5 mirrors the public reply and
    // closes with the shared offer. Replace them unless they were customised.
    next.dmOffer = next.dmOffer ?? DEFAULT_CONFIG.dmOffer;
    next.dmTemplates = { ...DEFAULT_CONFIG.dmTemplates };
  }
  // Offers the user asked to retire: the discount/payment-terms one, and the
  // one that promised bespoke sample work. Replaced unless they wrote their own.
  if (v < 7 && /20% off|payment only after|sample first so you can judge|sample together first/i.test(next.dmOffer || '')) {
    next.dmOffer = DEFAULT_CONFIG.dmOffer;
  }
  if (v < 8) {
    for (const k of ['dmTitle', 'maxDmsPerDay', 'minMinutesBetweenDms']) {
      if (next[k] == null) next[k] = DEFAULT_CONFIG[k];
    }
  }
  if (v < 10 && Array.isArray(next.excludes) && !next.excludes.some((e) => /for sale/.test(e))) {
    next.excludes = DEFAULT_CONFIG.excludes;   // seller-thread guards added
  }
  if (v < 9) {
    // "poster" used to mean design; a Social / Accounts category now owns it.
    next.categories = DEFAULT_CONFIG.categories;
    next.templates = { ...DEFAULT_CONFIG.templates, ...(next.templates || {}) };
    if (!next.templates.social) next.templates.social = DEFAULT_CONFIG.templates.social;
    if (!next.dmTemplates?.social) next.dmTemplates = { ...DEFAULT_CONFIG.dmTemplates, ...(next.dmTemplates || {}) };
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
