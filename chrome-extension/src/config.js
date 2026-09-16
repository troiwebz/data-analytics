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


  // Every time shown to you is rendered in this zone, on a 12 hour clock.
  // '' means "use this computer's own zone".
  timezone: 'Asia/Kolkata',

  // Your own words about the business, handed to Claude with every thread.
  // Optional, and empty by default: what goes in here is what Claude knows
  // about you that the thread cannot tell it.
  brief: '',

  // A sound when new threads land, so the machine can sit in the background.
  soundEnabled: true,
  sound: 'chime',              // new threads
  soundHot: 'alert',           // at least one lead at or above stageScore
  soundVolume: 0.5,

  // Telegram, straight from this extension. The bot token lives in the vault.
  telegramEnabled: true,       // send every new lead to Telegram automatically
  telegramChatId: '',          // from @userinfobot
  telegramSend: 'both',        // 'both' (PM first, then the reply) | 'pm' | 'reply'

  // Approval buttons under each Telegram message. Tapping one on your phone
  // makes Chrome do it: send the PM, or post the public reply.
  //
  // This is the ONLY thing in the extension that posts by itself, and it does
  // so only because you tapped. Nothing is ever posted or sent on a timer, on
  // a score, or because a lead looked good. No tap, nothing leaves.
  //
  // It needs no server. Chrome asks Telegram "any taps?" on a timer, which
  // means CHROME HAS TO BE RUNNING - a tap while the Mac is asleep is acted on
  // when Chrome wakes, not lost.
  telegramApprovals: false,    // off until you turn it on
  telegramPollSeconds: 30,     // Chrome clamps alarms to 30s, so lower is the same

  webhookUrl: '',              // Apps Script /exec URL (optional, legacy relay)
  sharedSecret: '',            // must match SHARED_SECRET in Apps Script

  notifyScore: 0,              // send everything; Telegram decides what buzzes
  autoPost: true,              // act on 🚀 taps from Telegram and the dashboard (nothing posts without one)
  maxPostsPerDay: 10,          // hard cap on 🚀 posts, resets at local midnight
  minSecondsBetweenPosts: 180, // spacing between two sent replies; 0 = none
  maxDmsPerDay: 8,             // hard cap on sent DMs — unsolicited PMs are what
                               // BHW moderators act on, so keep this low
  minSecondsBetweenDms: 120,   // spacing between two sent PMs; 0 = none

  // Staging: for strong leads, open the thread in a background tab and type the
  // reply in WITHOUT submitting. A 🚀 tap then just clicks Submit — sub-second.
  stageScore: 10,              // stage leads at or above this score
  maxStagedTabs: 3,            // never hold more than this many tabs open
  stageTtlMinutes: 20,         // close a staged tab if you haven't decided by then

  // ---- Reading the thread ----------------------------------------------
  // The feed gives a title and sometimes a description; a thread found on a
  // listing page gives a title and nothing else. That is not a brief, and
  // answering a title you have misread is the worst thing a reply can do.
  // So the thread page itself is read before drafting: the buyer's post in
  // full, and the replies already on it from the other freelancers bidding.
  // Signed in, one thread at a time, at a human pace.
  readThreads: true,           // off = go on the title and feed description alone
  maxThreadReads: 8,           // per poll; 0 = no limit
  secondsBetweenThreadReads: 2,

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
  // it.
  //
  // No salutation, and no @name. Look at what actually gets posted on HAF and
  // nobody opens by tagging the buyer - they start with the claim ("I have
  // over 10 years in Google & Meta Ads...") and end with "check your PM".
  // Opening every one of our replies with "Hi @buyer," would be a pattern of
  // its own, and tagging the thread starter pings them for a post they are
  // already reading. So the tip is the first line.
  //
  // No question either. Nobody on HAF opens a public reply with a question -
  // they state what they can do and move to PM, and a question posted in the
  // open invites the other freelancers to answer it for you. The question is
  // still written; it is held back for the private message.
  //
  // So the public reply is two lines: the technical claim, then the PM. What
  // varies per thread is that claim, which Claude writes against the thread's
  // own post and the replies already on it, plus the closer below.
  templates: {
    seo: `{{tip}}

{PM sent with the detail|Sent you a PM with the specifics|Dropped you a PM}.`,

    ads: `{{tip}}

{Sent you a PM|PM sent with how we would approach it|Dropped you a PM with the detail}.`,

    design: `{{tip}}

{PM sent|Sent you a PM with examples|Dropped you a PM}.`,

    social: `{{tip}}

{Sent you a PM|PM sent with the specifics|Dropped you a PM with the detail}.`,

    web: `{{tip}}

{PM sent|Sent you a PM|Dropped you a PM with the detail}.`,

    content: `{{tip}}

{PM sent with samples|Sent you a PM|Dropped you a PM}.`,

    generic: `{{tip}}

{Sent you a PM|PM sent with the detail|Dropped you a PM}.`
  },
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
  // Each is one sentence. The line about starting immediately and the sign-off
  // come after them, from the template, so no close repeats either.
  offers: {
    pilot: `{Easiest way in is a small first order|Simplest start is one small order|If it helps, start small}: {one page, one listing, one article, whatever the smallest useful unit is here|a single item at the normal rate}, {so you see the actual work before committing to volume|so you can judge it before scaling}.`,

    ready: `{The list and the accounts are already built our side|We already have the list built and cleaned|The groundwork is already done our side}, {so day one is delivery rather than research|so there is nothing to wait for|so we start on the actual work and not the setup}.`,

    formula: `{That is the whole method, in that order|That is the entire approach, and the order matters|Those three, in that order, are the whole method}. {The sequence is the part most people get wrong|Run it out of order and the later work inherits the earlier errors|Most of the failures we see are that sequence run backwards}.`,

    terms: `{Happy to invoice after the first batch lands|We can deliver the first batch and invoice after|Payment after the first batch suits us fine}, {so you are judging finished work rather than a promise|so you see it before anything is paid}.`,

    // The one close that asks something. It asks Claude's own question about
    // THIS thread - "mainstream German news sites or niche editorial outlets?",
    // "one chain and exchange pair, or multi chain?" - rather than demanding
    // the market and the volume from every buyer regardless of what they
    // posted. Same close, a question worth answering.
    //
    // {{question}} is filled per thread. If Claude did not run there is no
    // question to ask, and renderDm falls back to another close rather than
    // leaving a dangling "One thing:".
    scope: `{One thing before I price it|One question and I can price it|Quick one so I can price it properly}: {{question}} {Answer that and I will come back today with a fixed price and a date|Tell me and you will have a fixed price and a date today}. {No call needed|Nothing to book}.`
  },

  // ---- Private message ---------------------------------------------------
  // Fixed shape, every time:
  //
  //   Hi <author>,
  //   Came across your thread on HAF: <link>
  //   Why We Can Do It:            <- bold in the BHW editor
  //   1. 2. 3.                     <- what we have done, from Claude
  //   <one of the five closes>
  //   Just send a reply and we can get started.
  //   Thanks!!
  //
  // Only the numbered lines and the close change between threads. **bold**
  // renders as bold when the extension types it into BHW; everything that
  // copies the draft strips the markers.
  dmTemplates: {
    generic: `Hi {{author}},

{Came across your thread on HAF|Saw your thread on HAF|Just read your HAF thread}: {{url}}

**Why We Can Do It:**

{{tips}}

{{offer}}

{Just send a reply and we can get started|Send a reply and we can get going|Reply here and we can get started|Drop a reply and we can make a start}.

Thanks!!`,

    seo: `Hi {{author}},

{Came across your thread on HAF|Saw your thread on HAF|Just read your HAF thread}: {{url}}

**Why We Can Do It:**

{{tips}}

{{offer}}

{Just send a reply and we can get started|Send a reply and we can get going|Reply here and we can get started|Drop a reply and we can make a start}.

Thanks!!`,

    ads: `Hi {{author}},

{Came across your thread on HAF|Saw your HAF thread|Just read your thread on HAF}: {{url}}

**Why We Can Do It:**

{{tips}}

{{offer}}

{Just send a reply and we can get started|Send a reply and we can get going|Reply here and we can get started|Drop a reply and we can make a start}.

Thanks!!`,

    design: `Hi {{author}},

{Came across your thread on HAF|Saw your thread on HAF|Just read your HAF thread}: {{url}}

**Why We Can Do It:**

{{tips}}

{{offer}}

{Just send a reply and we can get started|Send a reply and we can get going|Reply here and we can get started|Drop a reply and we can make a start}.

Thanks!!`,

    social: `Hi {{author}},

{Came across your thread on HAF|Saw your HAF thread|Just read your thread on HAF}: {{url}}

**Why We Can Do It:**

{{tips}}

{{offer}}

{Just send a reply and we can get started|Send a reply and we can get going|Reply here and we can get started|Drop a reply and we can make a start}.

Thanks!!`,

    web: `Hi {{author}},

{Came across your thread on HAF|Saw your thread on HAF|Just read your HAF thread}: {{url}}

**Why We Can Do It:**

{{tips}}

{{offer}}

{Just send a reply and we can get started|Send a reply and we can get going|Reply here and we can get started|Drop a reply and we can make a start}.

Thanks!!`,

    content: `Hi {{author}},

{Came across your thread on HAF|Saw your HAF thread|Just read your thread on HAF}: {{url}}

**Why We Can Do It:**

{{tips}}

{{offer}}

{Just send a reply and we can get started|Send a reply and we can get going|Reply here and we can get started|Drop a reply and we can make a start}.

Thanks!!`
  }
};

export const CONFIG_VERSION = 26;

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
    for (const k of ['dmTitle', 'maxDmsPerDay']) {
      if (next[k] == null) next[k] = DEFAULT_CONFIG[k];
    }
  }
  if (v < 25 && next.timezone == null) next.timezone = DEFAULT_CONFIG.timezone;
  if (v < 24 && next.telegramSend == null) next.telegramSend = DEFAULT_CONFIG.telegramSend;
  if (v < 23 && next.brief == null) next.brief = DEFAULT_CONFIG.brief;
  if (v < 22) {
    // Spacing moves from whole minutes to seconds, so it can be set below a
    // minute. Carry over whatever was set, and bring the PM default down.
    next.minSecondsBetweenPosts = next.minSecondsBetweenPosts
      ?? (next.minMinutesBetweenPosts != null ? next.minMinutesBetweenPosts * 60 : DEFAULT_CONFIG.minSecondsBetweenPosts);
    next.minSecondsBetweenDms = next.minSecondsBetweenDms
      ?? (next.minMinutesBetweenDms === 5 ? DEFAULT_CONFIG.minSecondsBetweenDms
          : next.minMinutesBetweenDms != null ? next.minMinutesBetweenDms * 60 : DEFAULT_CONFIG.minSecondsBetweenDms);
    delete next.minMinutesBetweenPosts;
    delete next.minMinutesBetweenDms;
  }
  if (v < 21) {
    // The sign-off asked for a reply instead of announcing availability.
    next.dmTemplates = DEFAULT_CONFIG.dmTemplates;
    next.offers = DEFAULT_CONFIG.offers;
  }
  if (v < 20) {
    // Checking every 3 minutes is the point of the thing; a config still on
    // the old 10-minute default is lifted. A figure you chose is left alone.
    if (next.pollMinutes === 10) next.pollMinutes = DEFAULT_CONFIG.pollMinutes;
  }
  if (v < 19) {
    for (const k of ['soundEnabled', 'sound', 'soundHot', 'soundVolume']) {
      if (next[k] == null) next[k] = DEFAULT_CONFIG[k];
    }
  }
  if (v < 18) {
    // The PM gains a bold heading and a fixed sign-off, the public reply drops
    // the filler after the tip, and the five closes lose their trailing
    // "we can start today" now that the template carries it once.
    next.templates = DEFAULT_CONFIG.templates;
    next.dmTemplates = DEFAULT_CONFIG.dmTemplates;
    next.offers = DEFAULT_CONFIG.offers;
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
  if (v < 26) {
    // Every template change shipped since the first time Save was pressed was
    // invisible. setConfig writes the WHOLE merged config, so pressing Save
    // once froze a copy of the templates into storage, and from then on the
    // stored copy beat anything the code shipped. The public reply kept its
    // "Hi @buyer," salutation and its question for exactly that reason - both
    // were removed in the source and neither reached the browser.
    //
    // This resets the wording to what the code now ships. It is a one-time
    // reset and it does discard hand-edited template text; from here on the
    // fingerprint below makes this automatic and only for wording nobody has
    // touched, so it will not need doing again.
    for (const k of TEXT_KEYS) next[k] = DEFAULT_CONFIG[k];
  }
  next.templateDefaults = textStamp(DEFAULT_CONFIG);
  next.configVersion = CONFIG_VERSION;
  await chrome.storage.local.set({ config: next });
  return next;
}

/**
 * The wording of a draft, as opposed to your settings. These are the keys the
 * code owns unless you have deliberately rewritten them.
 */
const TEXT_KEYS = ['templates', 'dmTemplates', 'offers', 'specifics', 'dmTitle'];

/** A cheap fingerprint of just that wording. */
export function textStamp(cfg) {
  const src = JSON.stringify(TEXT_KEYS.map((k) => cfg[k] ?? null));
  let h = 2166136261 >>> 0;
  for (const ch of src) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}

/**
 * Take new wording from the code, unless you have written your own.
 *
 * `templateDefaults` records the fingerprint of the defaults that were in
 * force when the config was last written. If the stored wording still matches
 * that fingerprint you never edited it, so a new version's wording is yours to
 * have. If it does not match, you changed something and it is left alone.
 */
export async function adoptNewTemplates() {
  const { config } = await chrome.storage.local.get('config');
  if (!config) return { adopted: false };
  const shipped = textStamp(DEFAULT_CONFIG);
  const stored = textStamp(config);
  if (stored === shipped) return { adopted: false };            // already current
  if (config.templateDefaults && config.templateDefaults !== stored) {
    return { adopted: false, yours: true };                     // you rewrote it; keep it
  }
  const next = { ...config };
  for (const k of TEXT_KEYS) next[k] = DEFAULT_CONFIG[k];
  next.templateDefaults = shipped;
  await chrome.storage.local.set({ config: next });
  return { adopted: true };
}

export async function getConfig() {
  const { config } = await chrome.storage.local.get('config');
  return { ...DEFAULT_CONFIG, ...(config || {}) };
}

export async function setConfig(patch) {
  const current = await getConfig();
  const next = { ...current, ...patch, configVersion: CONFIG_VERSION };
  // Record which defaults this wording came from, so a later version can tell
  // untouched wording from wording you wrote yourself.
  next.templateDefaults = textStamp(next) === textStamp(DEFAULT_CONFIG)
    ? textStamp(DEFAULT_CONFIG)          // still the shipped wording
    : current.templateDefaults;          // yours, or not yet known - do not invent one
  await chrome.storage.local.set({ config: next });
  return next;
}
