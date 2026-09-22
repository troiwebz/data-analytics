# Telegram announcing — the architecture

What decides whether a thread reaches your phone, in one place, so it can be
read and verified rather than trusted.

## The rule, in one sentence

**A thread is announced to Telegram once, ever, only if it was found within
the last `announceMaxAgeHours` (12 by default), and never again once it has
been decided (posted, skipped, expired, or was pre-existing history).**

That sentence is the entire policy. It lives as code in one file —
`src/announce.js` — not spread across the extension, and nowhere else is
allowed to re-derive it. If the behaviour on your phone ever disagrees with
that sentence, the bug is in that one file, and `test/announce.test.mjs`
proves the file matches the sentence without needing Chrome, Telegram, or the
forum running at all.

## The pipeline

```
BlackHatWorld ──▶ pollFeed()                    reads the forum's RSS feed
                     │                          and the listing page
                     ▼
              recordLeads()                     merges into the lead table.
                     │                          DECISIONS (status, tgSentAt,
                     │                          pmSent, …) always survive a
                     │                          re-parse — a lead never
                     │                          forgets what happened to it.
                     ▼
   ┌─────────── the lead table (chrome.storage) ───────────┐
   │  one row per thread, ever. Never deleted, only         │
   │  decided: SENT → POSTED / SKIPPED / EXPIRED             │
   └──────────────────────┬──────────────────────────────────┘
                           │
                           ▼
                  announce.js: selectQueue(leads, cfg)
                           │            ▲
              ┌────────────┴───┐        │  pure — no chrome API,
              ▼                ▼        │  no network. Testable
         send: [...]      stale: [...]  │  with a plain array.
      (new, recent,       (never          isCandidate() + isTooOld()
       undecided)          announced,
                            but too old)
              │                │
              ▼                ▼
      telegram.sendLeads()   stamped tgSentAt = "too old to announce"
              │                (never reconsidered again)
              ▼
   tgSentAt = now, tgCards = {PM, reply message ids}
   dmApproved / draftApproved = the EXACT text shown
              │
              ▼
      your phone — card with buttons
```

`announceNew(cfg)` in `src/background.js` is the only caller. It runs on
**every** check — `runCheck()` calls it whether or not the forum found
anything new, because a backlog of unsent leads has to drain even on a quiet
poll. It never re-derives what "new" means; it asks `announce.js`.

## The state a lead moves through

```
found ──▶ announced ──▶ (you decide)
  │           │              │
  │           │              ├─▶ POSTED   (reply landed on the thread)
  │           │              ├─▶ pmSent   (PM confirmed by your BHW inbox)
  │           │              └─▶ SKIPPED  (you tapped Skip)
  │           │
  │           └─▶ too old to announce   (found before the age cutoff —
  │                                       stamped once, never re-checked)
  │
  └─▶ BACKFILL   (recorded on first run / Load-48h, history only,
                   never a candidate for Telegram at all)
```

Two fields carry all of this on the lead row:

| Field | Meaning | Who sets it | Who clears it |
|---|---|---|---|
| `status` | what happened to the thread | the posting/PM code | never — only moves forward |
| `tgSentAt` | has Telegram been told, and when | `announceNew` (real timestamp), or the age filter / one-time baseline (a sentinel string) | **nobody, ever** |

`tgSentAt` is deliberately a one-way door. Once set — to a real ISO timestamp
or to one of the two sentinels (`"too old to announce"`,
`"already in the table before this version"`) — nothing in the codebase
clears it. That is what makes "announced once, ever" true regardless of what
else happens to the row: a rewrite, a reply-count refresh, someone else
bumping the thread with a new post, a merge from a Sheet sync. All of those
preserve `tgSentAt` because it is listed in `store.js`'s `DECISIONS`, the set
of fields a re-parse is never allowed to overwrite.

## Why this used to break, four different ways

Before this consolidation, "is this new" was answered by three or four
near-identical pieces of logic — one inside `announceNew`, another inside
`statusReport`, another inside `todayLine` — each with its own copy of the
list of "decided" statuses and its own age-cutoff arithmetic. Each copy was a
separate chance to be subtly wrong, and fixing one never proved the others
were also right:

- **v0.78** stamped every lead in a batch as announced, when only six per poll
  actually went out — the other twenty-seven were marked done without ever
  being sent.
- **v0.81** fixed that, but the backlog it introduced had no age limit, so it
  reached back through the entire table and re-sent history.
- **v0.83** added the age limit and a one-time baseline — but only inside
  `announceNew`. `statusReport`'s copy of the rule didn't know about either.

Each fix was real and each test passed, because each test only checked the
one function that had just been changed. None of them could catch a second
copy of the rule drifting, because there was no single rule to check against —
just several descriptions of it that happened to agree on the day they were
written.

## What changed

`src/announce.js` now owns the whole decision:

- `SILENT_STATUSES` — the one list of "already decided" statuses.
- `isCandidate(lead)` — would this lead currently qualify, ignoring age.
- `isTooOld(lead, cfg)` — is it past `announceMaxAgeHours`.
- `selectQueue(leads, cfg)` — the two lists: what to send, what to mark stale.
- `queueCounts(leads, cfg)` — the same thing, as numbers, for the status
  report and the self-test.

`announceNew`, `statusReport`, and `todayLine` all call these instead of
re-typing the rule. There is exactly one place left to get it wrong, and
`test/announce.test.mjs` checks that one place against every failure mode
listed above, plus the exact regression that prompted this: a `POSTED`,
already-announced thread that gets re-parsed after someone else replies to it
and bumps it back into the RSS feed. Nineteen assertions, no mocking, running
in milliseconds — so a future change that reintroduces any of the four bugs
above fails a test immediately, not a bug report three days later.

## Verifying it on your install

Since none of this proves anything about a version that isn't currently
running, the fastest check is the one built for exactly that: send **`status`**
to the bot.

```
📊 Today
Running v0.85.0
Found: 4 · Replies posted: 1 · PMs sent: 2
Caps: 1/10 replies · 2/30 PMs
Telegram queue: 3 waiting to be announced, 12 held back as too old
```

- **`Running v…`** — confirms which build is actually live. Everything in
  this document is true of the code; it says nothing about a build that
  predates it.
- **`Telegram queue`** — `queued` is exactly what the next check will send;
  `held back as too old` is everything the age filter is refusing to
  re-surface. If a specific thread you already posted to is still showing up,
  the dashboard row for it (search its title) is the next thing to check —
  its `status` should read `POSTED` or carry a `PM sent` badge, and if it
  doesn't, that is the actual bug to report, with that one thread's status.

## Where the boundaries are, on purpose

- **`announceMaxAgeHours` (Settings, default 12, 0 = no limit)** is a
  judgement call, not a bug: a thread nobody told you about within half a day
  is treated as no longer urgent enough to buzz your phone over, and sits on
  the dashboard instead. Raise it if you want a wider net.
- **The one-time baseline** (`settleOldLeads`, runs once ever on first start
  after it shipped) drew a line under everything in the table at that moment.
  It cannot un-draw itself — if you ever need every existing lead reconsidered
  for Telegram from scratch, that needs a deliberate reset, not automatic
  behaviour, because the failure mode of getting it wrong is the entire board
  landing on your phone at once.
