# HAF Watcher

Watches **[BlackHatWorld → Hire a Freelancer](https://www.blackhatworld.com/forums/hire-a-freelancer.76/)**,
emails you matching job posts with a ready-made reply, and posts that reply
after you approve it — from your phone.

```
 ┌──────────── server / always-on PC ────────────┐
 │  Chrome Extension                             │
 │   every 10 min → fetch RSS → match → draft ───┼──┐
 │   every 1 min  → ask "what did I approve?" ◄──┼──┼──┐
 │   approved? open thread, type, post ──────────┼──┤  │
 └───────────────────────────────────────────────┘  │  │
                                                    ▼  │
                            ┌──────────────────────────┴─┐
                            │ Apps Script + Google Sheet │
                            └────────────┬───────────────┘
                                         │ email        ▲ you tap
                                         ▼              │
                                  📧 Gmail on your phone
```

The extension is the only piece that can post (it holds your BHW login).
Apps Script is the brain and the phone UI. No server, no domain, no cost.

---

## Setup

### 1. Apps Script (~10 min)

1. Go to <https://script.google.com> → **New project**, name it `HAF Watcher`.
2. Create four files matching `apps-script/` in this repo and paste the contents:
   `Config.gs`, `Auth.gs`, `Sheet.gs`, `Email.gs`, `Code.gs`.
3. In **Config.gs**, set `SHARED_SECRET` to a long random string
   (run `crypto.randomUUID()` in any browser console). Optionally set `EMAIL_TO`.
4. Run `setup()` once. Approve the permission prompt. The log prints your new
   Sheet's URL — the Sheet is also where you can edit drafts from your phone.
5. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Copy the `/exec` URL.

> "Anyone" sounds alarming but is required — Gmail on your phone opens the link
> without a Google session. The shared secret protects the API, and the approval
> links are HMAC-signed and expire in 12 hours.

### 2. Chrome extension (~2 min)

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
   select the `chrome-extension/` folder.
2. Open the extension's **Options**:
   - paste the `/exec` URL and the same shared secret
   - press **Test connection** — it should print your Sheet URL
   - tick **Watcher enabled** → **Save**
3. Make sure you're logged into BlackHatWorld in that Chrome profile.

The first poll **seeds** the current threads silently, so you don't get 20
emails at once. Real watching starts from the second poll.

---

## Daily flow

1. Someone posts in HAF.
2. Within 10 minutes the extension reads it, scores it, and — if it clears
   your threshold — builds the reply and pushes it to Apps Script.
3. You get an email: their post, your ready reply, and three buttons.
4. Tap **Post this reply** → a confirm page → tap the button.
5. Within a minute the extension opens the thread, types the reply, posts it,
   and emails you the confirmation.

**Edit first** opens a mobile page with the draft in a text box.

---

## Tuning

Everything lives on the Options page.

| Setting | Default | Notes |
|---|---|---|
| `notifyScore` | 4 | Raise it if you get too many emails |
| `maxPostsPerDay` | 10 | Hard cap, resets at local midnight |
| `minMinutesBetweenPosts` | 3 | Spacing between two posts |
| `autoPost` | on | Turn off to use it as an alert-only tool |

**Scoring:** base 3 + keyword density + boosts (recurring/agency/urgent) +
budget (up to 5) + freshness (up to 3). A `$2k/mo` agency ads job scores ~21;
a vague one-off scores ~5.

**Categories** map keywords to reply templates. Adding a service means adding a
category and a template with the same `key`.

**Templates** support `{{author}}`, `{{budget}}`, `{{budgetLine}}`,
`{{category}}`, `{{title}}`, plus `{a|b|c}` spintax so no two replies are
byte-identical.

---

## Things that will bite you

- **BHW must be logged in** in the Chrome profile running the extension, and the
  machine must be awake. Approved leads queue in the Sheet until it is.
- **Cloudflare.** If the feed starts returning HTML instead of XML, the
  extension says so. Opening BHW in a tab usually clears it. Don't move the
  fetching into Apps Script — Google's IPs get challenged far more.
- **Theme updates break posting.** Every selector is in
  `src/selectors.js`; that's the only file to fix.
- **Never approve on a bare GET.** Mail scanners pre-fetch links in email — a
  one-tap approve URL *will* fire by itself. That's why the GET only renders a
  confirmation page and the state change happens on POST.
- **Volume is what gets you banned, not automation.** Eight near-identical
  replies in ten minutes is a report. The caps exist for a reason; leave them low.

---

## Files

```
chrome-extension/
  manifest.json
  src/background.js       alarms, orchestration, posting
  src/feed.js             RSS fetch + regex parse (no DOMParser in MV3 workers)
  src/matcher.js          categories, boosts, excludes, scoring, budget parsing
  src/templates.js        spintax + variable substitution
  src/selectors.js        every BHW DOM selector — the one file to fix on breakage
  src/content-post.js     types into the XenForo editor and confirms the post
  src/store.js            seen threads, lead history, rate limits, log
  src/sync.js             Apps Script client
  src/options/            full settings UI
  src/popup/              status, recent leads, manual poll
apps-script/
  Config.gs               secret, recipient, sheet id
  Auth.gs                 HMAC approval tokens
  Sheet.gs                state store + setup()
  Email.gs                the lead email
  Code.gs                 doPost API + doGet mobile pages
```
