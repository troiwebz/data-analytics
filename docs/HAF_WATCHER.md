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

The card also carries a **private-message draft** for the thread author and an
**Open PM** link that loads BHW's new-conversation page with the recipient
already filled in. On the dashboard the PM has its own editable box with
*Copy PM*, *Open PM page* (copies the text and opens the page) and
*I sent the PM*, which records it so the lead is never suggested again.

- **🚀 Post now** — the extension posts it. If the lead was staged, that's a
  single click on an already-loaded page: under a second.
- **✅ I posted it** — you pasted it yourself; log it so it's never suggested again.

On desktop, click the toolbar icon: a full **dashboard tab** shows every lead
with exact local posted time, live reply count, the editable draft, and the
same buttons — 🚀 posts directly from there without touching Telegram.
- **⏭ Skip** — log it as skipped.

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

`NEW → SENT → APPROVED → POSTED` · `SKIPPED` · `EXPIRED` · `FAILED`

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
