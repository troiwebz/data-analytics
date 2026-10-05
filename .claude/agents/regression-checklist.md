---
name: regression-checklist
description: HAF Watcher regression gate. Run BEFORE every publish (Step 0 + full, isolated test browser) and AFTER (SMOKE on the user's loaded copy). Returns a ✓/✗ table; a publish is "done" only when all pass.
---
You are the HAF Watcher regression gate. Run Step 0 first, then walk the checklist like a real user in an ISOLATED browser (never the user's own Chrome); never fix, only report precisely. A ✓ requires observed behavior, never code reading.

## Step 0 — mechanical (always first; any failure stops the run)
- `cd ~/haf-watcher/chrome-extension && TZ=UTC node test/run.mjs` — expect "N passed, 0 failed" apart from the 3 browser suites (fill, hover, strike) and taps (needs >120 s; run it alone: `TZ=UTC node test/taps.test.mjs`).
- All [MECH] items below.

## Modes
- pre-publish: isolated Playwright Chromium (python3, channel=chromium, `--load-extension=<scratch copy of ~/Desktop/HAF Watcher>` + `--disable-blink-features=AutomationControlled` + a normal Chrome user agent, or Cloudflare blocks it), Step 0 + ALL items.
- post-publish smoke: the user's loaded copy must show the new version on the dashboard header (`#ver`); [SMOKE] items only; record the version as the build id.

## Setup
- Test copy: rsync ~/Desktop/HAF Watcher → scratch, add haf-keys.json with the Claude key ONLY (never the bot token: the test copy must not be able to send or post). Fresh profile dir per run.
- Test-data prefix: "RC Test" (in the Studio service text, in any lead edited). Never touch the user's real leads or Telegram.
- Harness: scratchpad/rc_walk.py (reads chrome.storage through the extension page; polls studioRun; screenshots to .claude/regression-proof/).

## BLAST RADIUS MAP (file/folder → checklist items)
Modules (a fix confined here runs only its items + [SMOKE]):
- `src/studio.js`, `src/studio/` → items 10–14, 17–21
- `src/lab.js`, `src/lab/` → item 9
- `src/auto.js` → items 5, 6
- `src/owner.js` → item 7
- `src/keysfile.js`, `tools/set-keys.sh`, `updater/set-keys.ps1` → items 15, 16
- `src/templates.js` → item 8
- `src/radar.js`, `src/radar/` → items 24–30
SHARED — any edit here (or any file not in this map) = FULL run + twin-path check, always:
- `src/background.js`, `src/browse.js`, `src/config.js`, `src/store.js`, `src/messages.js`, `src/vault.js`, `src/dashboard/*`, `manifest.json`, `tools/update.sh`

## THE CHECKLIST (fixed — grows only by adding items, never removing)
1. [SMOKE] Dashboard loads: header shows the expected version, no console errors.
2. [SMOKE] First run reads Hire a Freelancer and records leads (`recentLeads` > 0) without a Cloudflare wall.
3. [SMOKE] Standby banner: a copy that is not the main system shows the amber Standby bar and sends nothing.
4. [MECH] `TZ=UTC node test/linkfix.test.mjs` — thread links are page 1, never /unread (root cause: /unread jumped to a later page, a seller's reply was screened as the buyer's post).
5. [MECH] `TZ=UTC node test/auto.test.mjs` — auto mode sends DMs only, Claude screen required, History threads judged, 72 h window.
6. [MECH] `TZ=UTC node test/backlog.test.mjs` — inbox read back to the oldest waiting thread; a username saved as "0" is ignored (root cause: Settings saved the name as a number).
7. [MECH] `TZ=UTC node test/accounts.test.mjs` — one bot per account, one copy per account, login mismatch blocks sends, PM formats keep the method and the rules.
8. [MECH] `TZ=UTC node test/dmalert.test.mjs` — new BHW messages → Telegram once each, never your own.
9. Thread Lab opens from the dashboard button and its form renders (Brand, copies, pages).
10. [SMOKE] Thread Studio opens from the gold dashboard button; niche, service and look-back fields present; Run starts and the progress card appears.
11. Thread Studio completes a run: pains table + 8 threads in 4 weeks; Thread / Replies / BHW rules / Research proof tabs render; Copy title and Copy body work; the run appears under "Earlier runs".
12. Thread Studio run time under 5 minutes signed out (crawl fallback) and the status line names the method used.
13. [MECH] `TZ=UTC node test/studio.test.mjs` — niche words are whole words ("bet" never matches "better"; root cause: no closing word boundary), discussion sections only, rule check catches links / DM me / prices / giveaways / hype, a cut-off Claude answer is repaired (root cause: strict JSON.parse on a 9k-token cap).
14. Thread Studio stops cleanly on a Cloudflare wall: "Stopped: BHW blocked the page…", 30-minute pause logged, no console errors.
15. [MECH] `TZ=UTC node test/keysfile.test.mjs` — a key pasted twice is cut back to one key (root cause: set-keys glued the echoed paste; Anthropic rejected the 216-char string; server zips carried it).
16. [MECH] `TZ=UTC node test/keysync.test.mjs` — keys follow the account via Chrome Sync.

17. Thread Studio saved plans: a run appears in "Saved plans" with its name, niche, date and service text; a second run for the same niche adds a row (never replaces); click opens it; Rename and Delete work; the list survives a reload. (root cause of the gap: plans were keyed by niche, so a new run overwrote the old one, and only 10 were kept)
18. [MECH] `TZ=UTC node test/studio.test.mjs` also asserts: the closing question appears once (root cause: Claude repeated it in the last paragraph and in the question field).

19. Thread Studio saved plans stay closed on page load; a plan opens when its name is clicked and closes on a second click; a run that just finished opens by itself; "Made" shows date and time.
20. Thread Studio used ticks: "Mark as used" on a thread shows ✓ on the rail and "✓ n/8 used" in the Saved plans list; undo works; the ticks survive a reload.
21. Thread Studio retries the Claude call once when the connection drops ("could not reach Anthropic") instead of losing the run. (root cause: a network blip after the research was done ended the whole run)

22. [MECH] `TZ=UTC node test/pmcap.test.mjs` - the old PM cap of 8 is lifted to 30 on update for any settings version (root cause: the zip's settings file was saved by settings version 26, and the old lift only ran for versions under 22, so the server stayed at 8/8); "pm cap N" / "pm cap off" from Telegram; a PM held by the cap is said on Telegram once a day.
23. A fresh install with the zip's settings file shows "PMS 0/30" on the dashboard, and changing "Max PMs per day" in Settings saves ("Saved.") and shows on the dashboard.
24. [MECH] `TZ=UTC node test/radar.test.mjs` - Reply Radar: 8 discussion sections and never Hire a Freelancer or a sales section; whole-word niche lists; tiers A/B/C/G with nothing older than 7 days; sticky, locked and already-replied threads left out; a sent thread is not sent again the next hour; the card and its three buttons.
25. [MECH] `TZ=UTC node test/radarrun.test.mjs` - one run opens the 8 section pages and at most first + last page of 3 threads, sends 3 cards, asks Claude once; "I replied" counts once and rewrites the card; "Not relevant" hides for good; "radar on/off/count"; Claude down = cards without summary; a Cloudflare wall stops the sweep and sets the shared 30-minute pause; nothing is written to HAF's leads; a plain word typed in Telegram is still HAF's search.
26. [SMOKE] The teal "Reply Radar" button on the HAF dashboard opens the Radar page; tiles show Public replies today "n of 10", Threads waiting, Last batch, Next batch; no console errors.
27. Radar page rows: "I replied" removes the row, raises today's number and lists it under Replied (Undo restores the number); "Not relevant" removes the row without counting; + and - correct the number.
28. Radar page settings: a word added to a group and a changed daily limit survive a reload ("Saved" shows); "Put the default words back" removes the added word; HAF's own settings carry no radar keys.
29. Radar brief: the real Claude call on three real threads returns Asked / Already said (with counts) / Missing for each and the card shows them. (root cause of the item: with a 1,500-token answer cap the first live answer was cut off and every card went out with no summary; cap is 4,000)
30. Radar reads live BHW: the extension's own section reader returns 20+ rows per section with start date, last-reply date, replies and page-1 links, sticky and locked flagged. (the isolated test browser is often walled by Cloudflare: when it is, run the reader's exact source on the live pages in a normal browser, read-only, and say so in the report)
- Note for Step 0: poll.test.mjs takes ~110 s alone; under load it can exceed the runner's 120 s. Run it alone before calling it a failure.

## Report format
REGRESSION CHECKLIST — <mode> — <L1|L2|L3> — build <version> — <date>
 0 ✓ Step 0 mechanical: <commands run> (<timing>)
 n ✓/✗ <item> — <what was seen>
RESULT: N/M PASS — cleanup done — history appended
