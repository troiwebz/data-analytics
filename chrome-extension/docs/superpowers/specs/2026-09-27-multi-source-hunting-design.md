# HAF Watcher v1.1 — multi-source client hunting (design)

Date: 2026-09-27. Approved in chat.

## Goal
Hunt clients on BlackHatWorld all day from Telegram. Three sources feed one queue; the
answer material comes from the thread itself and from past replies; the user writes the
answer (with Claude/ChatGPT on the phone) and pastes it back; Chrome posts it.

## Sources
1. **Hire a Freelancer** — unchanged (score, Claude draft, reply + PM, rocket tap).
2. **Watched forums** — any BHW forum URL added in Settings (or `watch <url>` on Telegram).
   Every new thread is a lead. Per-forum switches: enabled, bump alerts.
3. **Site-wide feed** (`/forums/-/index.rss`, the "What's new" stream) filtered by
   **watch words** from Settings (or `watch <word>`). Per-word switches: enabled, bump alerts.
   Sales/marketplace threads are dropped. HAF-forum threads are left to source 1.

## Thread index (7 days)
Every item seen on sources 2 and 3 is recorded (title, url, author, snippet, source,
start date when known, last activity, bumps). A thread reappearing with newer activity
is marked BUMP. Bump alerts only fire where the switch is on; search always shows bumps.

## Answer bank
Every thread read (first post + existing replies) adds its replies to a local bank keyed
by keywords. Capped at 400 threads. Used for "similar answers" in the material pack.

## Lead kinds
- `haf` (existing) — reply + PM, drafted by rules/Claude.
- `thread` (new) — public reply ONLY. No PM button; PM refused. No draft until the user
  supplies one. Fields: source, sourceLabel, forum, intent (BUYER/QUESTION/INFO),
  watchWords, bump, bumpedAt.

## Telegram card for `thread` leads
Header: tag NEW/BUMP, intent, source. Title, author, replies, posted/last reply, link.
Buttons: [Material] [My answer] [Skip]; [Post Public Now] appears once an answer exists.

## Material pack (on Material tap)
Messages: the question (first post) in a copy block; every existing reply, numbered; up
to 3 similar answers from the bank; a short prompt block to paste into Claude/ChatGPT;
instruction to reply to the card with the final answer. Zero in-extension Claude.

## Own answer
Reply (swipe) to any card with text → becomes that lead's post (or PM on a HAF PM card)
→ card updates in place with Post. "My answer" button opens the same editor as Edit.

## Commands
- `next [n]` — next unanswered leads (all kinds), newest first, cursor advances; `next reset`.
- `haf [hours]` — HAF leads, last 48h by default, no DM sent and not posted.
- `<word> [new|bump|done]` — search index + leads; results as cards tagged NEW/BUMP/DONE.
- `stats` — today's hunt numbers.
- `watch <forum url|word>`, `unwatch <label|word>`, `watching`.
- Existing commands unchanged.

## Posting
All posting goes through the existing content-script poster (open tab, type, submit),
rate caps, spacing and compliance lint. Thread leads never stage tabs.

## Seeding
When a forum source is first polled, its first 2 listing pages go into the index (no
alerts). Bank fills from normal reading. `seed <label>` reads up to 15 recent threads of
a watched forum into the bank at a human pace.

## Files
New: src/sources.js, src/threadindex.js, src/bank.js, src/material.js.
Changed: config.js, thread.js, telegram-card.js, telegram.js, announce.js,
background.js, options/options.html, options/options.js, manifest.json (version 1.1.0).
