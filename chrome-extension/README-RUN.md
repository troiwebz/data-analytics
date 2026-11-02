# HAF Watcher 1.1 — running it on this Mac

Chrome extension (Manifest V3). Watches BlackHatWorld for threads you can answer,
sends each one to Telegram, and posts your answer through Chrome. Nothing posts
without your tap.

## Load it (one time)
1. Chrome → `chrome://extensions/` → toggle **Developer mode** (top right).
2. **Load unpacked** → pick this folder: `~/Desktop/HAF Watcher` (the one holding manifest.json).
3. Open the extension's **Details → Extension options** (Settings page).
   Already loaded an older version from this folder? It reloads itself within a minute.

## Keys
`haf-secrets.json` here is the 17 Sep 2026 settings export from the cloud machine: chat id,
webhook URL, categories, templates, limits. It holds NO API keys. Get them one of two ways:
- **Sync**: sign this Chrome into the same Google account (Sync on) as the cloud Chrome.
  The Claude key + bot token arrive by themselves. Settings → "Check sync status" confirms.
- **Manual**: Settings → paste Anthropic key → Save key; paste bot token → Save token.

## Three sources
1. **Hire a Freelancer** — as before: scored, Claude-drafted reply + PM, 🚀 to post.
2. **Watched forums** — Settings → "More sources" → one forum URL per line
   (`url | label | bump`). Google Ads is in by default. Every new thread there is a lead.
3. **Site-wide feed** — every new thread on BHW, kept where a **watch word** hits
   (`word | bump`, one per line). Sales/marketplace threads are dropped.

Threads from 2 and 3 are **public reply only**. Their card has 📋 Material, ✍️ My answer, ⏭ Skip.
🚀 Post appears once the card holds an answer.

## The answer loop (from your phone)
1. Card arrives → tap **📋 Material**: the question, every existing reply, similar past
   answers from the bank, and a prompt block.
2. Copy the blocks into Claude or ChatGPT on your phone, get your answer.
3. **Reply to the card** (swipe it) with the answer text. The card updates and shows 🚀.
4. Tap **🚀 Post Public Now**. Chrome opens the thread, types it, submits. Card says Posted.

## Telegram commands
- `next` / `next 3` — next unanswered thread(s), newest first · `next reset` starts over
- `haf` / `haf 24` — Hire a Freelancer threads with no DM and no reply yet (48h default)
- `casino` — every casino thread in the 7-day index · `casino new` / `casino bump` / `casino done`
- `watch casino` / `watch casino bump` / `watch <forum url>` · `unwatch …` · `watching`
- `seed Google Ads` — read that forum's recent replies into the answer bank
- `stats` — today's hunt numbers · `help` — the full list

## Check it works
Settings → **🧪 Test everything**. Tap the button on the Telegram test message.
Send the bot `watching`, then `stats`. Be logged in to blackhatworld.com in this Chrome
profile (thread reads and posting use it). Chrome must stay running.
