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
  aiSpecifics: true,           // let Claude write the bullets (needs ANTHROPIC_API_KEY
                               // in Apps Script Script Properties); falls back to rules


  // Telegram, straight from this extension. The bot token lives in the vault.
  telegramEnabled: true,       // send every new lead to Telegram automatically
  telegramChatId: '',          // from @userinfobot

  webhookUrl: '',              // Apps Script /exec URL (optional, legacy relay)
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
        'google ranking', 'local seo', 'gmb', 'google business profile',
        // Local-search work is SEO, not a generic enquiry.
        { p: 'citations?\\b', w: 2 }, { p: '\\bnap\\b', w: 2 },
        'directory (listing|submission)', 'business listing', 'map ?pack', 'local ?pack',
        'yext', 'moz local', 'near me', 'schema markup', 'technical seo', '\\baso\\b'
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
    // Free work is banned outright: it is what attracts time wasters, and it
    // was the rule from day one. Every shape of it, not just the phrase.
    banned: [
      'free trial', 'free sample', 'free test', 'for free', 'no charge',
      'free of charge', 'at no cost', "won't cost you", 'free work'
    ],
    warn: [
      'guaranteed', 'guarantee', '100%', 'cheapest',
      // Reads as AI-written on a forum. Keep replies in plain punctuation.
      '\\u2014', '\\u2013', '\\u2022', 'delve', 'leverage our', 'tailored solution',
      'in today\'s', 'game[- ]?changer', 'seamless'
    ]
  },

  // ---- Thread-specific bullets -------------------------------------------
  // The template says what we do; these say "we have done exactly this".
  // First matching rule wins. {{geo}} becomes the places named in the thread,
  // and a bullet needing a geo is dropped when none was named.
  specifics: {
    geoPatterns: [
      { p: '\\bdubai\\b|\\buae\\b|abu dhabi|sharjah', label: 'Dubai/UAE' },
      { p: '\\buk\\b|united kingdom|\\blondon\\b|\\bengland\\b|manchester|birmingham', label: 'the UK' },
      { p: '\\bus(a)?\\b|united states|america\\b', label: 'the US' },
      { p: '\\bcanada\\b|toronto|vancouver', label: 'Canada' },
      { p: '\\baustralia\\b|\\bsydney\\b|melbourne', label: 'Australia' },
      { p: '\\bindia\\b|mumbai|delhi|bangalore', label: 'India' },
      { p: '\\bgermany\\b|\\bberlin\\b|munich', label: 'Germany' },
      { p: '\\bsingapore\\b', label: 'Singapore' },
      { p: 'saudi|\\bksa\\b|riyadh', label: 'Saudi' }
    ],
    multiGeoBullet: 'Separate listing sets per market, not one profile stretched across {{geo}}',

    rules: [
      { p: 'citation|nap\\b|directory (listing|submission)|yext|moz local|business listing',
        bullets: [
          'Manual submissions to directories that actually index in {{geo}}, not a blast list',
          'Existing listings audited first, so duplicates and wrong NAP get fixed before new ones go out',
          'Live sheet with every citation, its login and its live/pending status'
        ] },
      { p: 'gmb|google business profile|google my business|map ?pack|local ?pack',
        bullets: [
          'Profile built out properly for {{geo}}: categories, services, service area, hours, Q&A',
          'Geo-tagged posts and photos on a weekly schedule, not a one-off setup',
          'Rank tracked on a grid around the pin, so you see movement by area not one average'
        ] },
      { p: 'local seo|rank (my|our) (business|shop|store|clinic)|near me',
        bullets: [
          'On-page built around the {{geo}} service pages, not generic keywords',
          'Citations and NAP consistency cleaned up first, since that gates the map pack',
          'Grid rank tracking around the pin so you can see area-by-area movement'
        ] },
      { p: 'guest post|link ?insert|niche edit|\\bpbn\\b|outreach link',
        bullets: [
          'Live sites with real traffic only, metrics shown before anything is placed',
          'You approve every domain before we buy or place',
          'Anchor mix kept natural, no exact-match stacking'
        ] },
      { p: 'e-?commerce|shopify|woocommerce|product page',
        bullets: [
          'Product and collection pages templated so the fixes scale across the catalogue',
          'Schema, internal linking and faceted-navigation handling done properly',
          'Reporting by collection, so you can see which range is actually earning'
        ] },
      { p: 'app store|aso\\b|play store',
        bullets: [
          'Keyword field, title and subtitle worked separately for each store',
          'Screenshot and icon tests run against install rate, not opinion',
          'Reviews and ratings velocity handled alongside the listing'
        ] }
    ],

    // Used when no rule matches: the category's own bullets.
    defaults: {
      seo:     ['Full audit, on-page fixes, and a white hat link plan',
                'First deliverables in 5-7 days',
                'Monthly rank and traffic report'],
      ads:     ['Account structure, tracking and conversion events set up properly',
                'Ad creative produced in house',
                'Weekly optimisation with a clear spend to result report'],
      design:  ['Source files included (PSD, AI, Figma)',
                '2 concepts first, then unlimited tweaks on the one you pick',
                '2-4 days depending on scope'],
      social:  ['Real devices and residential connections, matched to the geo you need',
                'Steady daily posting on your schedule, not bursts',
                'Warmed accounts and sensible limits so the profile stays healthy'],
      web:     ['Clean, fast, mobile first build',
                'On-page SEO done properly from the start',
                'Timeline depends on page count, happy to scope it today'],
      content: ['SEO aware, no AI filler',
                'Sample piece before you commit',
                '2-3 days per batch'],
      generic: ['Tell us the details and we will scope it same day',
                'Clear price before any work starts']
    }
  },

  // ---- Reply templates -------------------------------------------------
  // {{var}} is substituted. {a|b|c} picks one at random (spintax), so no two
  // replies are byte-identical.
  // Available vars: author, title, budget, category, link
  // ---- Public forum reply ------------------------------------------------
  // Short on purpose. One technical line proves you read the thread; the rest
  // goes in the PM, where the other freelancers reading the thread cannot see
  // it. Openers, orderings and closers all vary per thread.
  templates: {
    seo: `{Hi|Hey} @{{author}},

{{tip}} {We run SEO for agencies and direct clients|We do this work weekly|This is core work for us}.

{{question}}

{Sent you a PM with the detail|PM sent with the specifics|Dropped you a PM}.`,

    ads: `{Hi|Hey} @{{author}},

{{tip}} {We manage paid campaigns end to end on Google, Meta and TikTok|Paid is what we run day to day|We handle the build and the ongoing management}.

{{question}}

{Sent you a PM|PM sent with how we would approach it|Dropped you a PM with the detail}.`,

    design: `{Hi|Hey} @{{author}},

{{tip}} {Our design team produces {{category}} in house|This is what our team turns out daily|In house team, no outsourcing}.

{{question}}

{PM sent|Sent you a PM with examples|Dropped you a PM}.`,

    social: `{Hi|Hey} @{{author}},

{{tip}} {We run and post on accounts every day|Account management is what we do day to day|We handle accounts at volume}.

{{question}}

{Sent you a PM|PM sent with the specifics|Dropped you a PM with the detail}.`,

    web: `{Hi|Hey} @{{author}},

{{tip}} {Builds and landing pages are done in house|We do site work in house|Our developers handle this directly}.

{{question}}

{PM sent|Sent you a PM|Dropped you a PM with the detail}.`,

    content: `{Hi|Hey} @{{author}},

{{tip}} {Written by people, briefed against real search intent|Human writers, briefed properly|Written to brief, not spun}.

{{question}}

{PM sent with samples|Sent you a PM|Dropped you a PM}.`,

    // Used when no category matched. Kept deliberately open-ended.
    generic: `{Hi|Hey} @{{author}},

{{tip}} {We are a full service agency covering SEO, paid ads, design, web and content, all in house|We cover SEO, ads, design, web and content in house|Full service in house team}.

{{question}}

{Sent you a PM|PM sent with the detail|Dropped you a PM}.`
  },

  dmTitle: `{Re: |}{{threadTitle}}`,

  // ---- Private message ---------------------------------------------------
  // Every PM has the same top and the same bottom; only the middle is the
  // thread's own. The top says where you found them and links the thread; the
  // bottom offers samples and the portfolio. In between go the three technical
  // lines, laid out as a list, as numbers or as prose depending on the thread,
  // so a run of PMs never shares one skeleton.

  // ---- The five closes -------------------------------------------------
  // Claude picks whichever fits the thread and never repeats the one it used
  // last, so a buyer reading two of your PMs does not see the same pitch.
  // None of them offers free work: that was the rule from the start, and on a
  // board like this free work mostly buys time wasters.
  //
  //   pilot    small paid first order, so they risk little without you working free
  //   ready    the asset or list already exists, so there is nothing to wait for
  //   formula  the method, given away openly, which proves it better than claiming it
  //   terms    money after delivery, not before
  //   scope    two questions and a fixed price and date back the same day
  //
  // Each is spintax and is picked per thread, so the wording varies too.
  offers: {
    pilot: `{Easiest way in is a small first order|Simplest start is one small order|If it helps, start small}: {one page, one listing, one article, whatever the smallest useful unit is here|a single item at the normal rate}. {You see the actual work before committing to volume|Judge it on that, then scale or walk}.`,

    ready: `{The list and the accounts are already built|We already have the list built and cleaned|The groundwork is already done our side}, so {day one is delivery, not research|there is nothing to wait for|we start on the actual work, not setup}. {Say the word and it moves today|Happy to start today}.`,

    formula: `{That is the whole method, in that order|That is the entire approach, and the order matters|Those three, in that order, are the whole method}. {The sequence is the part most people get wrong|Most of the failures we see are that sequence run backwards|Run it out of order and the later work inherits the earlier errors}. {Take it and run it in house if you prefer, no hard feelings|Use it yourself if that suits you better|You are welcome to hand that to whoever you hire}.`,

    terms: `{Happy to invoice after the first batch lands|We can do the first batch first and invoice after|Payment after the first batch suits us fine}, {so you are judging finished work rather than a promise|so you see it before anything is paid}. {No deposit|Nothing up front}.`,

    scope: `{Tell me two things and I will come back today with a fixed price and a date|Send me two details and you will have a fixed price and a date today}: {the target market and the volume you want|the geo and the monthly volume|the market and how much of it you need}. {No call needed|Nothing to book, just reply here}.`
  },

  // {{tips}} is the three technical lines, {{offer}} is the close Claude chose
  // from the five above, {{url}} is the thread.
  dmTemplates: {
    generic: `{Hi|Hey} {{author}},

{Saw your thread on HAF|Just read your HAF thread|Came across your thread on HAF}: {{url}}

{Here is how we would approach it|How we would handle it|What we would do}:

{{tips}}

{{budgetLine}}

{{offer}}`,

    seo: `{Hi|Hey} {{author}},

{Saw your thread on HAF|Just read your HAF thread|Came across your HAF thread}: {{url}}

{Here is how we would approach it|How we would run it|What we would do first}:

{{tips}}

{{budgetLine}}

{{offer}}`,

    ads: `{Hi|Hey} {{author}},

{Saw your HAF thread|Just read your thread on HAF|Came across your HAF thread}: {{url}}

{Here is how we would run it|How we would approach the account|What we would set up}:

{{tips}}

{{budgetLine}}

{{offer}}`,

    design: `{Hi|Hey} {{author}},

{Saw your thread on HAF|Just read your HAF thread|Came across your thread}: {{url}}

{Here is how we would handle it|How we would approach it|What we would produce}:

{{tips}}

{{budgetLine}}

{{offer}}`,

    social: `{Hi|Hey} {{author}},

{Saw your HAF thread|Just read your thread on HAF|Came across your HAF thread}: {{url}}

{Here is how we would run it|How we would handle the accounts|What we would do}:

{{tips}}

{{budgetLine}}

{{offer}}`,

    web: `{Hi|Hey} {{author}},

{Saw your thread on HAF|Just read your HAF thread|Came across your HAF thread}: {{url}}

{Here is how we would build it|How we would approach the build|What we would do}:

{{tips}}

{{budgetLine}}

{{offer}}`,

    content: `{Hi|Hey} {{author}},

{Saw your HAF thread|Just read your thread on HAF|Came across your thread on HAF}: {{url}}

{Here is how we would approach it|How we would handle it|What we would produce}:

{{tips}}

{{budgetLine}}

{{offer}}`
  }
};

export const CONFIG_VERSION = 16;

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
    next.dmTemplates = { ...DEFAULT_CONFIG.dmTemplates };
  }
  if (v < 8) {
    for (const k of ['dmTitle', 'maxDmsPerDay', 'minMinutesBetweenDms']) {
      if (next[k] == null) next[k] = DEFAULT_CONFIG[k];
    }
  }
  if (v < 16) {
    // One offer for every PM became five, chosen per thread, and the public
    // reply gained a question. Both template sets change shape, and the ban on
    // free work is widened from the single phrase to every form of it.
    next.offers = next.offers ?? DEFAULT_CONFIG.offers;
    next.templates = DEFAULT_CONFIG.templates;
    next.dmTemplates = DEFAULT_CONFIG.dmTemplates;
    next.compliance = { ...next.compliance, banned: DEFAULT_CONFIG.compliance.banned };
    delete next.dmOffer;
  }
  if (v < 13 && next.aiSpecifics == null) next.aiSpecifics = DEFAULT_CONFIG.aiSpecifics;
  if (v < 15) {
    for (const k of ['telegramEnabled', 'telegramChatId']) {
      if (next[k] == null) next[k] = DEFAULT_CONFIG[k];
    }
  }
  if (v < 14) {
    // v13 put the same three bullets in the public reply and the PM, and the
    // PM quoted the reply back. v14 splits them: one line in public, three in
    // the PM, and the PM stands on its own. The old templates use {{specifics}}
    // and {{reply}}, which no longer exist, so they have to be replaced.
    next.templates = DEFAULT_CONFIG.templates;
    next.dmTemplates = DEFAULT_CONFIG.dmTemplates;
  }
  if (v < 12) {
    next.specifics = next.specifics ?? DEFAULT_CONFIG.specifics;
    next.templates = DEFAULT_CONFIG.templates;   // now carry a {{specifics}} slot
  }
  if (v < 11) {
    // Em dashes and "•" read as AI-written; templates rewritten without them.
    next.templates = DEFAULT_CONFIG.templates;
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
