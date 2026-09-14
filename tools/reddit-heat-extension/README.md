# Reddit Lead Threads v2.1 (private Chrome extension)

Scrapes the Reddit pages you browse while logged in, walks next pages and threads for you, matches hundreds of keywords, scores every thread on **lead evidence**, and saves a ranked CSV. No API key, no rate limits, nothing published to the Chrome Web Store.

## Co-founder hunt (start here)

One job, one screen. Click the extension icon → **Co-founder hunt** → **Start watching**.

Every minute it checks a rotating handful of subreddits where people ask for a partner (r/cofounder, r/CoFounderHunt, r/startups, r/Entrepreneur, r/indiehackers, r/SideProject, r/SaaS, r/ycombinator and others) plus one site-wide search, and keeps only real asks: recruiters, agencies, job seekers and people *offering* to be a co-founder are dropped. Each keeper is tagged with the role they want (technical, marketing, design, business), their stage, and whether they have money or are equity-only, then ranked so the freshest, best-fit post is in front of you.

Then it is the same three moves, one post at a time:

1. **Open the post, reply filled in ↗** — one click opens the thread on old.reddit.com with the two-line reply already sitting in Reddit's comment box, highlighted, cursor in it. Read it, edit if you like, click Reddit's own **save**. The post is marked *replied* the moment you do — no button to press afterwards. (The text is also on your clipboard, in case the thread is locked or you are logged out.) Two lines only: one observation about their exact situation, one free useful thing plus "sent it to your DMs". No link, no price, no pitch.
2. **Copy + open the DM ↗** — one click copies the letter and opens Reddit's compose window with subject and body already filled. Pick the length first: **Short** (five lines), **Medium** (diagnosis plus three steps), **Long** (the full Laurel Portié letter). Read it, edit it, send it.
3. **Posted the reply** (`1`), **Sent the DM** (`2`), **Skip** (`s`), **Not relevant** (`x`). Sending moves you to the next post.

**Under every post, a reading of it.** Who they are (solo founder, company owner, freelancer, agency, student), what they actually want, which country, stage, whether it is equity-only or they have money, how much equity is on offer, traction, and whether it is full-time or a side project — pulled from their own words.

**Click any counter to see the table behind it.** *In queue* lists everyone waiting with who / wants / country / age / fit, and clicking a row jumps straight to that person. *Contacted today* and *Contacted ever* show the database: who, how, where, when.

**Your details live on the hunt page.** The header's **Your details** panel holds your name, what you do, your Reddit username, WhatsApp and Telegram, and opens by itself the first time. No hunting through Options.

**Written for the post, not filled in.** Header → **AI writing** picks who writes each post's public reply and three DMs: **Anthropic API (Claude)** with your own key from console.anthropic.com — best quality, a few cents per post; **Chrome built-in (Gemini Nano)** — free, on your machine, plainer writing, one-time model download on Chrome 138+; or **Templates only**. Either model reads the whole post and writes to it — their own words, their real next step, your free offer and WhatsApp/Telegram line kept. Results are cached on the post so nothing is paid or computed twice; **rewrite** asks again; if the engine fails on a post the templates show for that post with the reason above them.

**Five options, not one line repeated.** The public reply is built per post from what that person actually wrote, so an equity-only idea-stage post opens on equity, a funded one opens on being able to pay, a crowded thread opens short. Click any option to load it, edit it, copy it. No two options open the same way and nothing is reused post to post.

**Last 24 or 48 hours.** The window chips in the header are 24h / 48h / 7d, default 48h. Anything older never enters the queue, so you are always early rather than the fortieth comment.

**It checks whether you already replied.** Set your Reddit username in Options (or let it ask your logged-in tab once). Before a post reaches the screen — the current card and the next few — it reads the thread and looks for your username. If you commented there already, the post is dropped and that person goes on the contacted list.

**Nobody twice.** The moment you mark a reply or a DM, that username goes on a contacted list. Every future post by that person — a repost, a different idea, six months later — is hidden and counted under "Already contacted, hidden". **Undo last** puts the most recent one back if you misclicked.

**Inbox: their replies, answered by a plan.** Header → **Inbox** (the badge is how many are waiting). Every minute the extension reads your private messages through the same logged-in tab; any conversation with someone you DM'd shows up with their original post attached. Pick one and a reply is drafted from the whole conversation by the engine you chose under AI writing (Claude / Chrome / templates), following **The plan** — editable on the page. The default plan: answer what they asked → deliver the free thing promised → when they show interest, present the $350 (a dedicated VA from your team completes the task end to end, daily updates, revisions, they keep everything, you stay on as their technical partner) → handle objections honestly → close on WhatsApp/Telegram with how to pay. Each draft carries its stage and a one-line note. **Open the reply, filled in ↗** opens the message thread with the reply already in Reddit's box; clicking Reddit's save marks the thread handled. A new message from them reopens it.

**How it reads Reddit.** Reddit answers 403 to JSON requested by an extension on its own — no cookies, no referrer, not a browsing session. So the hunt keeps one **pinned old.reddit.com tab** and reads through it: a same-origin request carrying your normal logged-in session, the same thing as scrolling the page yourself, a few pages a minute. It opens that tab by itself the first time. If it ever gets nothing back, the page tells you what to check (tab closed, logged out, or Reddit rate-limiting you).

**The DM ends where the deal happens.** Every letter closes with a free, specific 48-hour deliverable (a clickable 3-screen prototype and build list for technical asks, an offer rewrite plus one channel and twenty named places for marketing asks, and so on — theirs to keep either way), then pushes them to **WhatsApp or Telegram**, because Reddit DMs get buried. Put your number and handle in Options; leave them blank and it falls back to replying on Reddit.

**No files.** Nothing is ever downloaded. Every post, status and contact lives in the extension's own database; **Contacted list** in the header shows it — who, how, where, when, searchable. CSV auto-save for the old scraper is off unless you switch it on in Options.

Nothing is ever posted or sent for you. The extension reads, fills in the text, and you click send on Reddit's own page. Names come out human: the letter opens "Hi Jane," not "Hi u/jane_builds92," and falls back to "Hi there," for throwaway handles.

## Collect around the clock (optional server)

`server/hunt-server.js` is a small Node service that watches the same subreddits
24/7 and hands the keepers to the extension, so the queue is already full when
you open the laptop. It reads only — replying and DMing stay manual, in your
browser. Point the extension at it under **Your details → Collector server**;
if it ever stops answering, the extension falls back to the pinned Reddit tab on
its own. Setup, systemd, Docker, Fly and launchd: `server/README.md`.

## Everything below is the older lead scraper (popup → Advanced tools)

## Semi-automatic collection

An orange panel appears bottom-right on every `old.reddit.com` page.

**On a listing or search page** (for example `old.reddit.com/r/forhire/new` or a search sorted by Top, past year):

- **Save this page**: stores every post on the page that matches a keyword or looks like an offer / demand / freebie / value post.
- **Save + walk next pages ▶**: saves this page, then follows "next" automatically, one page every 3 seconds, for as many pages as the box says. Stop any time with the red button.
- **Read comments of top threads ▶**: opens the most-commented saved threads one after another, scrapes and classifies every comment on each, and moves to the next one automatically.

**On a thread page**: the panel shows the counts it found (hand-raises, buyer questions, OP replies, booked) and a **Save this thread's comments** button.

## Keyword sweep: what is in demand this week or month

Batch sweep → section 2. Pick keyword categories (Demand, AI-era demand, Niches, Offers…), a time window (24 hours, week, month, year), and a ranking (relevance in window, top voted, newest). Each category's keywords are OR-ed four at a time into site-wide Reddit searches and walked N pages each. No subreddit list needed: Reddit search returns matching posts from every subreddit, and the dashboard's subreddit panel then shows where they came from. On the dashboard, **Demand by keyword** and **Demand by category** count demand posts per keyword for the chosen window, so you can compare this week against last month.

## Batch sweep: bulk-select subreddits, run N pages each

Popup → **Batch sweep**. About 60 candidate subreddits are listed in groups (AI and no-code builders, business owners, niche owners, marketing, hiring boards, regional) plus your confirmed ones and a box for your own. Tick subreddits one by one or a whole group, tick any of the eight site-wide discovery searches, set pages per item (default 5), sort (newest, top this week, top this month), how many of the newest threads to read comments on afterwards, and the delay between pages.

**Run this selection now** opens one tab that walks every item page by page, then reads the comments, then stops. Progress and a Stop button are on the sweep page and on the orange panel. **Save batch** stores the selection under a name so future runs are one click; the page remembers your last selection. If Reddit shows its "too many requests" page mid-sweep, the tab waits 60 seconds and retries instead of skipping.

**Parallel tabs.** Settings → Parallel tabs (1 to 4, default 2) and Max pages per minute across all tabs (default 24). All tabs pull from one shared queue under one global speed limit with random jitter. If Reddit answers "too many requests", every tab pauses 90 seconds and the cap drops 30 percent for the rest of the run. Closing a worker tab puts its item back in the queue for the others. Reading pages does not get an account banned; automated posting does, and this extension never posts.

Suggested batches: *Discovery* (all eight searches, 5 pages, monthly) to find new subreddits, then confirm them on the dashboard; *Daily recent* (confirmed subreddits, newest, 3 pages, read 30 threads).

## Central database, statuses, one file

Everything lives in one database inside the extension. The dashboard opens on **Buyers · last 7 days · New**. Top bar: Time (Today / 7 / 30 / All), Who (Buyers / Sellers / Everything), Status tabs with counts (New, Seen, Replied, DM'd, Quoted, Won, Lost, Not a lead), a find box, keyword and subreddit dropdowns, a run dropdown, and Sort. Each row has a status dropdown, a Reply button, and a details toggle with a note field. The orange panel on a thread page also shows the status dropdown, so you can mark "Replied" right after posting. Statuses and notes survive future sweeps; a thread never comes back as New once you've touched it.

**Central file.** Click **Choose central file…** in the header once and pick `reddit-leads.csv` anywhere on your disk. From then on the dashboard rewrites that same file after every sweep and every status or note change (while the dashboard is open), sorted by status. No more downloads. After a Chrome restart click **Reconnect file** once. Trends (stats, demand by keyword, subreddits, phrases, collection log) are on the second tab.

## Runs and duplicates

The bar at the top of the dashboard lists your runs newest first with thread counts and how many were new, and defaults to the latest run. Every thread is stored once. When you view a run, each row is tagged **new** (first found in that run) or **seen ×N** (found by N runs before). Tick **only new in this run** to see what a batch added. "All runs" shows everything.

## Where the results live: the dashboard

Click the extension icon → **Open dashboard** (or the **Dashboard** button on the orange panel). It opens as a full browser tab with:

- **Stat tiles**: threads saved, threads with comments read, hand-raises, buyer questions, threads where the poster got booked, last collected.
- **Collection log**: every page and thread you scraped, newest first, with what each one captured. This is the record of your search scrapes.
- **Offers by price band**: lead evidence found in offer threads grouped by their stated price. This answers "which price gets buyers".
- **Keywords that found leads**: which of your keywords matched threads that had buyer replies.
- **Filters** down the left: type, category, keyword, subreddit, price band, date, and "only threads with lead evidence".
- **Results table** sorted by Lead score. Click a row to expand the post body, matched keywords, and the classified replies. **Export CSV (filtered)** saves what you are looking at.

A good first session: r/forhire search `"for hire" website` sorted Top past year, walk 10 pages; r/forhire search `hiring website`, walk 5; r/smallbusiness search `"need a website"`, walk 10; then "Read comments of top threads" with 30. About 10 minutes, mostly waiting.

## Value-bomb replies

Tick threads in the dashboard table, click **Replies for selected**. Each thread gets a ready-to-edit reply in the Laurel Portié value-bomb style: open with their exact situation, name the real cause, give the complete fix in numbered steps they can do today, a "watch out for" line, and an open door at the end. No link, no price, no pitch. Seven playbooks are chosen automatically from the post: AI-built site broken, not showing on Google, designer ghosted, pricing question, landing page for ads, slow or broken on mobile, need a website. Edit, **Copy reply**, open the thread, paste, then **Mark replied** so the dashboard shows it. Set your sign-off name in Options.

## Cleaner results

- Job seekers ("looking for a … job", "immediate joiner", "open to remote opportunities") and job postings (salary, full-time, years required) are typed `job` and never counted as demand.
- Demand, offers and freebies must be about a website, landing page, store, app, domain, hosting or SEO. A keyword hit inside an unrelated thread is dropped.
- Expand any row to click **Not a lead** (hides it everywhere, keeps it out of ideas) or change its type; your choice is kept on future scrapes. **re-check types** re-runs the classifier on everything saved after an update.
- Every sweep has a **run name**; threads remember which runs found them, and the dashboard's **Run** filter shows one run at a time. Starting a sweep while one is running is refused.

## Campaign planner: ten offers, you decide

Popup → **Campaign planner** (or the button on the dashboard). It turns the demand you scraped into ten service ideas, ranked by how many demand threads each one would answer, each with a suggested price, target subreddits, a ready-to-edit post title and body, and the live threads you could reply to with that offer right now.

You stay in control: edit the name, price, wording, and target subreddits; **Approve** or **Reject** each one; then **Start campaign**. Starting only unlocks a checklist per approved offer (posted, replied, DMs answered, results logged). The extension never posts or replies for you. **Regenerate ideas** refreshes the evidence from new scrapes and keeps your edits and decisions. **Export approved** saves them as a text file.

## What "lead evidence" means

Real leads on r/forhire arrive by DM and are invisible. The extension reads comments and counts the closest public proxies:

| Column | Meaning |
|---|---|
| **Lead** | `hands × 5 + buyer questions × 4 + OP replies × 2 + 20 if OP said booked/closed + unique commenters (max 10) − heckles × 2` |
| **Heat** | `Δcomments (48h) × 3 + Δupvotes (48h) + Lead`. Needs the same thread saved on two different days. |
| Hands | Hand-raises: "DM'd you", "interested", "send me", "can I get one", "+1". The conversion signal on freebie and value-bomb posts. |
| Buyer | Client-style questions: "how much", "can you build", "for my restaurant", "timeline", "deposit". |
| OP↩ | The poster replying to other people. |
| booked/closed | OP wrote "fully booked", "slots are full", "found someone", "filled". Strongest public proof of conversion. |
| Heckle | "race to the bottom", "why so cheap", "scam". Subtracts. |
| Type | `offer`, `freebie`, `value`, `demand`, `other`, from title patterns. |
| Category / keywords | Which keyword categories (the `#` headers in Options) and which exact keywords matched. |
| Price | First flat or hourly price in title/body; "from" for starting prices; "free" for freebies. |

The CSV also carries author, flair, the post body excerpt, the outbound link if any, and up to five classified replies.

## Install once, update with one click

1. Unzip into a permanent folder. `chrome://extensions` → **Developer mode** on → **Load unpacked** → pick the folder.
2. Optional: icon → **Options** to edit the ~250 prefilled keywords (lines starting with `#` are categories).
3. **Update**: double-click `update.bat` (Windows) or run `./update.sh` (Mac/Linux) inside the folder. It downloads the latest files from GitHub into that same folder, no Git and no unzipping. Within a minute the extension notices the new version on disk and reloads itself; the popup's version number changes. It never reloads while a sweep is running. Saved threads, batches and settings are kept.

**Fully automatic updates.** Run `./autoupdate-install.sh` once (Mac/Linux) or double-click `autoupdate-install.bat` (Windows). It schedules the updater every hour in the background; the extension sees the new version on disk and reloads itself within a minute, never mid-sweep. Turn it off with `autoupdate-uninstall.sh` / `.bat`. Pass a number of seconds to change the interval, e.g. `./autoupdate-install.sh 1800` for every 30 minutes. Progress is logged to `autoupdate.log` in the same folder.

## Optional background crawler

The **Crawl in background** button walks each subreddit's `new` listing through Reddit's JSON endpoints without you browsing. Without an API key Reddit allows ~10 requests a minute (about 35 minutes for the default 17 subreddits); with a free "installed app" client id pasted in Options it is ~4 minutes. It shares the same store as the page scraper.

## Test

```
node test.js
```

## Limits

- Regex heuristics, tuned on r/forhire and r/smallbusiness language. Treat Lead as a ranking, not a customer count.
- The scraper reads old.reddit.com markup only. Use `old.reddit.com`, not `www.reddit.com`.
