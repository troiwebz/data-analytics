# Reddit Lead Threads v1.4 (private Chrome extension)

Scrapes the Reddit pages you browse while logged in, walks next pages and threads for you, matches hundreds of keywords, scores every thread on **lead evidence**, and saves a ranked CSV. No API key, no rate limits, nothing published to the Chrome Web Store.

## Semi-automatic collection (the main way)

An orange panel appears bottom-right on every `old.reddit.com` page.

**On a listing or search page** (for example `old.reddit.com/r/forhire/new` or a search sorted by Top, past year):

- **Save this page**: stores every post on the page that matches a keyword or looks like an offer / demand / freebie / value post.
- **Save + walk next pages ▶**: saves this page, then follows "next" automatically, one page every 3 seconds, for as many pages as the box says. Stop any time with the red button.
- **Read comments of top threads ▶**: opens the most-commented saved threads one after another, scrapes and classifies every comment on each, and moves to the next one automatically.

**On a thread page**: the panel shows the counts it found (hand-raises, buyer questions, OP replies, booked) and a **Save this thread's comments** button.

## Where the results live: the dashboard

Click the extension icon → **Open dashboard** (or the **Dashboard** button on the orange panel). It opens as a full browser tab with:

- **Stat tiles**: threads saved, threads with comments read, hand-raises, buyer questions, threads where the poster got booked, last collected.
- **Collection log**: every page and thread you scraped, newest first, with what each one captured. This is the record of your search scrapes.
- **Offers by price band**: lead evidence found in offer threads grouped by their stated price. This answers "which price gets buyers".
- **Keywords that found leads**: which of your keywords matched threads that had buyer replies.
- **Filters** down the left: type, category, keyword, subreddit, price band, date, and "only threads with lead evidence".
- **Results table** sorted by Lead score. Click a row to expand the post body, matched keywords, and the classified replies. **Export CSV (filtered)** saves what you are looking at.

A good first session: r/forhire search `"for hire" website` sorted Top past year, walk 10 pages; r/forhire search `hiring website`, walk 5; r/smallbusiness search `"need a website"`, walk 10; then "Read comments of top threads" with 30. About 10 minutes, mostly waiting.

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

## Install and update

1. Unzip into a permanent folder. `chrome://extensions` → **Developer mode** on → **Load unpacked** → pick the folder.
2. Optional: icon → **Options** to edit the ~250 prefilled keywords (lines starting with `#` are categories).
3. **Update**: unzip the new version over the same folder, then click **Reload code** in the popup. All saved threads and settings are kept.

## Optional background crawler

The **Crawl in background** button walks each subreddit's `new` listing through Reddit's JSON endpoints without you browsing. Without an API key Reddit allows ~10 requests a minute (about 35 minutes for the default 17 subreddits); with a free "installed app" client id pasted in Options it is ~4 minutes. It shares the same store as the page scraper.

## Test

```
node test.js
```

## Limits

- Regex heuristics, tuned on r/forhire and r/smallbusiness language. Treat Lead as a ranking, not a customer count.
- The scraper reads old.reddit.com markup only. Use `old.reddit.com`, not `www.reddit.com`.
