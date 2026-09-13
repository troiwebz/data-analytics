# Reddit Lead Threads (private Chrome extension)

Searches hundreds of keywords across many subreddits from inside your own logged-in browser, scores every matching thread on **lead evidence**, tracks how fast each one is heating up, and saves a CSV after every run. Nothing is published to the Chrome Web Store; you load it unpacked.

## Why an extension

Reddit blocks datacenter IPs and crawlers. Your browser on your home connection is not blocked, and the extension uses Reddit's public `.json` endpoints without your session cookie, so it can read everything but cannot post or act as you.

## What "lead evidence" means

Real leads on r/forhire arrive by DM and are invisible. The extension reads every comment on the most active threads and counts the closest public proxies:

| Column | Meaning |
|---|---|
| **Lead** | `hands × 5 + buyer questions × 4 + OP replies × 2 + 20 if OP said booked/closed + unique commenters (max 10) − heckles × 2` |
| **Heat** | `Δcomments (48h) × 3 + Δupvotes (48h) + Lead`. Needs two or more runs to be meaningful. |
| Hands | Hand-raises: "DM'd you", "interested", "send me", "can I get one", "+1". The conversion signal on freebie and value-bomb posts. |
| Buyer | Client-style questions: "how much", "can you build", "for my restaurant", "timeline", "deposit". |
| OP↩ | The poster replying to other people, a sign they are actually working the thread. |
| booked/closed | OP wrote "fully booked", "slots are full", "found someone", "filled". The strongest public proof a thread converted. |
| Heckle | "race to the bottom", "why so cheap", "scam". Subtracts. |
| Type | `offer` (`[For Hire]`, "I'll build"), `freebie` ("free website", "first 5"), `value` ("here's how", AMA, case study), `demand` (`[Hiring]`, "need a website", "how much"). |
| Price | First flat or hourly price in title/body, "from" when it is a starting price, "free" for freebies. |
| Keywords | Which of your keywords the post actually matched. |

## Install

1. `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → pick this folder.
2. Click the icon → **Options** to edit keywords and subreddits. It ships with about 80 keywords and 17 subreddits. Add as many as you like, one per line; quoted phrases are exact.
3. Click **Refresh now**. Keywords are grouped 5 per request with OR, so the default set is roughly 300 searches plus 60 comment reads, about 35 to 40 minutes at Reddit's unauthenticated pace. Close the popup; progress shows when you reopen it.
4. It re-runs every 6 hours while Chrome is open (change in Options) and, by default, saves `Downloads/reddit-lead-threads/leads-<timestamp>.csv` after each run.

## Read it

- Default sort is **Lead**. Filter to **Freebies** or **Value bombs** to see which giveaway formats drew hand-raises; **Offers** for priced posts; **Demand** for buyers naming budgets.
- A `·` in the Lead column means that thread's comments have not been read yet. Each run reads the 60 most active unread threads (raise in Options).
- The italic line under a title is the first buyer-style reply, so you can see the tone without opening the thread.
- **Export CSV** saves the current filtered view; the auto-save after each run contains everything tracked.

## Tune it

- Rate limiting: searches are 6.5 s apart and comment reads 4 s apart. If you see `429` in the status errors, raise the interval or trim keywords.
- Scoring weights and the regexes for buyer / hand-raise / booked / heckle are at the top of `lib.js`.
- Run `node test.js` after editing `lib.js`.

## Limits

- Reddit search only returns the newest ~100 matches per query, so very old threads fall off; set the window to "past year" in Options for a one-off historical sweep, then back to "month".
- The classifiers are regex heuristics. They are tuned on r/forhire and r/smallbusiness language and will misread sarcasm. Treat Lead as a ranking, not a count of customers.
