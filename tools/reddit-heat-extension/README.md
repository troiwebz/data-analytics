# Reddit Lead Threads v1.0 (private Chrome extension)

Crawls subreddits page by page from inside your own browser, matches hundreds of keywords locally, scores every thread on **lead evidence**, tracks how fast each one is heating up, and saves a CSV after every run. Not on the Chrome Web Store; you load it unpacked.

## How it works

1. **Crawl.** For each subreddit it walks the `new` listing 100 posts a page (Reddit caps listings at ~1000 posts) until it reaches your look-back window.
2. **Match.** Every post is checked against all your keywords locally, so 250 or 2,500 keywords cost the same. A post is kept if any keyword matches or it looks like an offer / demand / freebie / value post.
3. **Read comments.** The most active kept threads have their comments read and classified (up to 150 per run by default).
4. **Snapshot.** Upvotes and comments are stored per run so "heat" is measurable across runs.
5. **Export.** A ranked CSV lands in `Downloads/reddit-lead-threads/` after each run.

**Speed.** Without an API key Reddit allows ~10 requests a minute, so 17 subreddits × 10 pages + 150 comment reads ≈ 35 minutes. With a free Reddit "installed app" client id (Options page explains, two minutes to create) the limit is 100 a minute and the same run takes about 4 minutes. The key is read-only; the extension never posts or acts as you.

## Columns

| Column | Meaning |
|---|---|
| **Lead** | `hands × 5 + buyer questions × 4 + OP replies × 2 + 20 if OP said booked/closed + unique commenters (max 10) − heckles × 2` |
| **Heat** | `Δcomments (48h) × 3 + Δupvotes (48h) + Lead`. Needs two or more runs. |
| Hands | Hand-raises: "DM'd you", "interested", "send me", "can I get one", "+1". The conversion signal on freebie and value-bomb posts. |
| Buyer | Client-style questions: "how much", "can you build", "for my restaurant", "timeline", "deposit". |
| OP↩ | The poster replying to other people. |
| booked/closed | OP wrote "fully booked", "slots are full", "found someone", "filled". Strongest public proof of conversion. |
| Heckle | "race to the bottom", "why so cheap", "scam". Subtracts. |
| Type | `offer`, `freebie`, `value`, `demand`, `other`, from title patterns. |
| Category / keywords | Which of your keyword categories (the `#` headers) and which exact keywords matched. |
| Price | First flat or hourly price in title/body; "from" for starting prices; "free" for freebies. |

The CSV also carries author, flair, upvote ratio, the first 1,200 characters of the post body, the outbound link if any, and up to five classified replies.

## Install (once) and update (two clicks)

Load the extension from a git checkout so updates are a pull away:

```
git clone https://github.com/troiwebz/data-analytics.git
cd data-analytics
git checkout claude/brave-fermat-6ysqd0
```

1. `chrome://extensions` → **Developer mode** on → **Load unpacked** → pick `data-analytics/tools/reddit-heat-extension`.

**To update after a new push:** run `update.sh` (macOS/Linux) or double-click `update.bat` (Windows) inside the extension folder, then click **Reload code** in the popup. Chrome re-reads the files from disk; all collected threads, snapshots, and your options are kept because they live in Chrome storage, not in the files. The popup shows the loaded version next to the buttons.

Once the branch is merged to `main`, check out `main` instead; the scripts pull whichever branch is checked out.
2. Icon → **Options**. Paste a Reddit client id (instructions on the page), click **Test**. Edit keywords: it ships with ~250 in five categories (Offers, Freebies, Value bombs, Demand, Niches). Lines starting with `#` are category headers.
3. Icon → **Refresh now**. Close the popup; progress shows when you reopen it. It re-runs every 3 hours while Chrome is open.

## Read it

- Filter by **type**, **category**, or a **single keyword** (counts shown), plus days and free text. Default sort is Lead.
- A `·` in Lead means comments not read yet; raise "comment reads per run" in Options if too many rows show it.
- Turn on **Also run keyword searches** in Options for busy subreddits like r/smallbusiness where 1000 posts is less than your window.

## Test

```
node test.js
```

## Limits

- Regex heuristics, tuned on r/forhire and r/smallbusiness language. Treat Lead as a ranking, not a customer count.
- Reddit's `new` listing caps at ~1000 posts per subreddit; the search option reaches further back but only for keyword hits.
