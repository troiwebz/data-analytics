# HAF Watcher

Watches **[BlackHatWorld → Hire a Freelancer](https://www.blackhatworld.com/forums/hire-a-freelancer.76/)**
every 3 minutes, sends every new thread to your phone on Telegram with a
ready-to-paste reply, and — only when you tap 🚀 — posts it for you.

```
 ┌──────────── server / always-on PC ──────────────┐
 │  Chrome Extension                               │
 │   every 3 min  → RSS + listing page             │
 │                → score, draft, reply count      │
 │                → push to Apps Script ───────────┼──┐
 │                → STAGE hot leads: open thread   │  │
 │                  in a background tab, type the  │  │
 │                  reply in, do NOT submit        │  │
 │   every 1 min  → "anything tapped 🚀?" ◄────────┼──┼──┐
 │                → staged tab? click Submit (<1s) │  │  │
 │                  else open + type + post        │  │  │
 └─────────────────────────────────────────────────┘  │  │
                                                      ▼  │
                              ┌───────────────────────────┴──┐
                              │ Apps Script + Google Sheet   │
                              │ dedupe · expire · lint · log │
                              └────────────┬─────────────────┘
                                           │ card + reply     ▲ 🚀 / ✅ / ⏭
                                           ▼                  │
                                    📱 Telegram on your phone
```

The extension is the only piece that can post (it holds your BHW login).
Apps Script is the brain, the Sheet is the permanent record, Telegram is the UI.

---

## What you see on your phone

Two messages per thread. The card:

```
🔥 17 pts · SEO / Links · $500
Need monthly SEO backlinks - budget $500

👤 buyerguy   💬 2 replies   ⏱ 3 min ago
📊 You'd be reply #3
💰 Suggested: $450/mo
🔎 SEO, backlink, DA40, recurring, budget:$500

Open thread
[ 🚀 Post now ] [ ✅ I posted it ]
[ ⏭ Skip      ] [ 🔗 Thread     ]
```

Then the reply on its own, in a code block — **tap once to copy the whole thing**,
paste into BHW. That's the copy-paste path; BHW sees a human typing.

Every PM follows one shape: `Hi <author>` → *"I just saw your HAF thread: <url>"*
→ the public reply (its own greeting and "PMing you now" trimmed) → one shared
closing offer, edited in Options as **PM offer** so changing that single field
changes every PM.

The card also carries a **private-message draft** for the thread author and an
**Open PM** link that loads BHW's new-conversation page with the recipient
already filled in. On the dashboard the PM has its own editable box with
*Copy PM*, *Open PM page* (copies the text and opens the page) and
*I sent the PM*, which records it so the lead is never suggested again.

- **🚀 Post now** — the extension posts it. If the lead was staged, that's a
  single click on an already-loaded page: under a second.
- **✅ I posted it** — you pasted it yourself; log it so it's never suggested again.
- **⏭ Skip** — log it as skipped.

## The dashboard

Click the toolbar icon for a full tab: one table of every lead.

| Posted | Replies | Score | Thread | Budget | Status |
|---|---|---|---|---|---|

- **Click a column header to sort** by it; click the same header again to
  reverse. The active column and direction are marked. Unknown reply counts
  sort last rather than pretending to be zero.
- A **posted** lead is struck through with a green line and ticked, so one
  glance down the table shows what is handled. Skipped and expired rows are
  dimmed but not struck; failed rows stay normal because they still need you.
- **Click a row** to open the post snippet, the public reply, the PM and the
  buttons for that lead — 🚀 posts from here without touching Telegram.
- On the reply side: **📝 Open filled** opens the thread with your reply typed
  into the quick-reply box but not submitted, so you can read it in place and
  press Post yourself — and 🚀 then fires in under a second because the tab is
  already loaded.
- On the PM side: **✉️ Send PM now** opens BHW's direct-message page, fills
  the recipient, subject and body, and sends. **📝 Open filled** does
  everything except press Send, leaving the tab focused so you can read it.
  The URL carries the recipient and subject
  (`/direct-messages/add?to=digital+value&title=…` — both form-encoded, so
  spaces are `+`); the body cannot ride in a URL, so a content script types
  it into the editor. DMs have their own daily cap and spacing, separate from
  posts:
  `maxDmsPerDay` (8) and `minMinutesBetweenDms` (5) in Options. Unsolicited
  PMs are the thing BHW moderators actually act on — keep these low.
- A search box and a "hide posted / skipped" toggle are the only filters.
- **Backfill 48h** loads the last two days; **Scrape all…** walks the forum
  listing pages (20 threads each, ~1.2 s apart) and records everything started
  inside a date window, reaching threads the RSS feed has already dropped.
  Those rows carry no post body, so they are scored on the title alone —
  treat that score as a floor.

Score decides only whether your phone **buzzes**: 🔥 and ⭐ buzz, • arrives
silently. Nothing is dropped. Change the threshold any time with `/buzz 12`.

### Commands

| | |
|---|---|
| `/stats` | today, 7 days, by category, wins |
| `/buzz 12` | buzz for score ≥ 12, silent below |
| `/pause` · `/resume` | stop / start sending (threads still logged) |
| `/pending` | what's waiting on you |
| `/won 1234567` | mark a lead won, so `/stats` learns which templates convert |

---

## The database

One Google Sheet row per thread **ever seen**, never deleted:

```
threadId · foundAt · postedAt · replyCount · score · category · author · title
budget · matched · url · snippet · draft · compliance · status · decidedAt · result · error
```

Stored status vs what the table shows:

| Stored | Shown | Meaning |
|---|---|---|
| `SENT` | **To do** | Found and drafted. Nothing posted. |
| `APPROVED` | **Queued** | You tapped Post; it goes out within a minute. |
| `POSTED` | **Posted** | Your reply is live. Title struck through. |
| `SKIPPED` | **Skipped** | You decided against it. |
| `FAILED` | **Failed** | Posting did not work; open it and retry. |
| `BACKFILL` | **History** | Loaded from the past, not new. |
| `EXPIRED` | **Too late** | Too many replies already. |

`SENT` means "sent to your Telegram", which read as "reply sent" — hence the
separate display labels. The stored values are unchanged so the Sheet and the
Apps Script relay keep working.

Enforced on every poll:
- a thread id ever recorded is **never sent twice**
- more than `EXPIRE_AFTER_REPLIES` (10) replies → `EXPIRED`, logged, not sent — the buyer already picked someone
- an author you already `POSTED` to is re-alerted with *"🔁 you pitched this author on 2026-09-10"*
  (`REALERT_KNOWN_AUTHORS = false` to hard-block instead)

## Compliance linter

Every draft is checked against `COMPLIANCE` in `Config.gs` before it's sent:

```js
mustInclude:     [{ pattern: '...', label: 'BST link' }],   // must appear
mustAppearEarly: [{ pattern: '...', within: 120 }],         // must be near the top
banned:          ['free trial'],                            // never
warn:            ['guaranteed', '100%'],                    // flagged, allowed
```

A failing draft is still sent — flagged ❌ with the broken rule named — so
nothing is silently handed to you that would break forum rules. Fill this in
from the HAF rules before going live.

---

## Setup

### 1. Telegram (2 min)
1. Message [@BotFather](https://t.me/botfather) → `/newbot` → copy the **token**.
2. Message [@userinfobot](https://t.me/userinfobot) → copy your numeric **id**.
3. Open a chat with your new bot and press Start (bots can't message you first).

### 2. Apps Script (10 min)
1. <https://script.google.com> → New project → create the files in `apps-script/`
   with the same names and paste the contents.
2. In **Config.gs** set `SHARED_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`,
   `TELEGRAM_WEBHOOK_SECRET` (any two long random strings; `crypto.randomUUID()`).
3. Run `setup()` once → approve permissions → Sheet URL in the log.
4. **Deploy → New deployment → Web app** → Execute as **Me** → Access **Anyone** → copy the `/exec` URL.
5. Run `registerTelegramWebhook()` once. Your bot says 👋.

### 3. Extension (2 min)
1. `chrome://extensions` → Developer mode → **Load unpacked** → the `chrome-extension/` folder
   (the folder that directly contains `manifest.json`).
2. Options → paste the `/exec` URL + `SHARED_SECRET` → **Test connection** → **Watcher enabled** → Save.
3. Be logged into BlackHatWorld in that Chrome profile.

First poll seeds silently. Watching starts on the second.

---

## Tuning (Options page)

| | default | |
|---|---|---|
| Poll every | 3 min | + up to 40 s random jitter |
| Min score to send | 0 | everything goes through |
| Stage leads ≥ | 10 | opened + typed in a background tab, unsent |
| Max staged tabs | 3 | auto-closed after 20 min undecided |
| Max 🚀 posts / day | 10 | copy-paste is uncapped — that's you |
| Min minutes between 🚀 | 3 | |

## On not being noticed

- **Reads** are RSS + one listing page, ~1000 requests/day with jitter, from
  your own browser with your own cookies. Indistinguishable from leaving the tab open.
- **Copy-paste posts** are literally you. There is nothing to detect.
- **🚀 posts** are a click in your own session — same as manual, but capped
  and spaced.
- What actually gets accounts flagged is **the same text across many threads,
  and volume**. Spintax + five distinct templates + the daily cap are the real
  protection. There is deliberately no fingerprint spoofing or proxying here;
  it wouldn't help against that and it breaks.

## Things that will bite you

- **Cloudflare.** If the feed comes back as HTML, the extension says so. Open
  BHW in a tab. Don't move fetching into Apps Script — Google's IPs get challenged.
- **Thread times come from the listing page, not the feed.** XenForo's forum
  RSS puts the *last post's* date in `<pubDate>`, so a months-old thread that
  someone just replied to reads as brand new. The listing page carries the
  thread's own start date, and that is what "posted" shows. If the listing
  can't be read, the time falls back to the feed and is marked `approx`.
- **Theme updates.** Every DOM selector is in `src/selectors.js`; listing regexes
  in `src/listing.js`. Those are the only two files to touch.
- **Staged tabs** live in the same Chrome profile. Don't close them by hand
  unless you mean to — the 🚀 then falls back to a full open-and-post.
- **Apps Script cannot read request headers**, so Telegram's webhook secret rides
  in the query string. That's why `registerTelegramWebhook()` exists.

## Files

```
chrome-extension/src/
  background.js    alarms, polling, staging, 🚀 handling
  feed.js          RSS fetch + regex parse
  listing.js       reply counts from the forum listing page
  matcher.js       categories, boosts, excludes, scoring, budget
  templates.js     spintax + variables
  selectors.js     every BHW DOM selector
  content-post.js  modes: full / stage / submit
  store.js         seen, leads, rate limit, staged tabs, log
  sync.js          Apps Script client
  options/ popup/  settings · live status
apps-script/
  Config.gs        secrets, behaviour, COMPLIANCE rules   ← the one you edit
  Code.gs          doPost API + Telegram routing
  Telegram.gs      cards, buttons, callbacks, /commands, /stats
  Compliance.gs    the linter
  Sheet.gs         state + setup()
  Auth.gs, Email.gs
```
