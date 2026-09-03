# Gmail Outreach Sender (Python + Chrome)

Drives a real Chrome window to send outreach from your Gmail, a couple at a
time, with warmup limits and pacing built in.

Your password never goes in this code. You sign into Chrome by hand once, and
the session lives in a local browser profile.

---

## What it does

- Reads prospects from a **Google Sheet** (through your logged-in browser — no
  API, no sharing the sheet) or a local CSV
- Sends **2 per run**, ramping **5/day → 20/day** over the first week, then holds
- Weekdays only, 9am–5pm, with a random 45–180s gap between sends
- Remembers who it contacted, so re-running never double-sends
- Skips anyone in `suppression.txt`
- Screenshots the browser when a send fails, so you can see what broke

---

## Install

```bash
pip install -r requirements.txt
python3 -m playwright install chromium
```

Better: skip that second command and use your real Chrome instead — Gmail
behaves more normally in it. Set this in `config.py`:

```python
CHROME_CHANNEL = "chrome"
```

---

## Two ways to drive it

**A web page on your Mac** — easier, and what most people want:

```bash
python3 web.py
```

Then open **http://localhost:5055**. You get status, the email editor with a
live preview, your prospect list, buttons for sign-in / dry-run / send, and a
running activity log. It only listens on 127.0.0.1, so it is not reachable from
outside your machine.

**Or the terminal**, if you prefer it or want to run from cron. Both read the
same settings, so changing something in one shows up in the other.

---

## First run, in order

**1. Sign in** — opens Chrome, you log into the Gmail account, it remembers.

```bash
python3 send.py --setup
```

**2. Add your prospects.** Either start from the sample:

```bash
cp prospects.example.csv prospects.csv
```

or put your Sheet's URL in `config.py` as `SHEET_URL`. Columns:

| Column | Notes |
|---|---|
| `email` | Verify before importing — bounces hurt |
| `first_name` | Required. No name, no send. |
| `site` | e.g. `exampleblog.com` |
| `personal_line` | **Required.** One specific sentence about something they published. |
| `idea_1`, `idea_2` | Two article titles that fit their site |

Rows missing `first_name` or `personal_line` are skipped and reported. That's
deliberate — an unpersonalized outreach email is worse than none.

Your `prospects.csv` is git-ignored on purpose, so a list of real people's
addresses never ends up committed. Only `prospects.example.csv` is tracked.

**3. Set your identity** in `config.py`: `FROM_NAME`, `SIGNATURE`, and the
`SUBJECT` / `BODY` text.

**4. Read it before anyone else does.**

```bash
python3 send.py --preview      # prints the next email, no browser
```

**5. Compose into Drafts without sending.**

```bash
python3 send.py --dry-run      # opens Chrome, fills compose, saves as draft
```

Open Gmail, look at the drafts. Check them on your phone too.

**6. Send for real.**

```bash
python3 send.py --send
```

Check numbers any time with `python3 send.py --status`.

---

## Running it on a schedule

Every 30 minutes on weekdays (`crontab -e`):

```
*/30 9-16 * * 1-5  cd /path/to/python_sender && /usr/bin/python3 send.py --send >> send.log 2>&1
```

The script enforces its own limits, so an over-eager cron can't overshoot —
it'll just find nothing to do.

---

## Honest limitations

**This reads Gmail's HTML, which Google changes without warning.** When a send
fails you get a clear error naming what wasn't found, plus a screenshot. Fixing
it means updating the selector lists at the top of `gmail_driver.py`. Apps
Script (see `../apps_script/`) doesn't have this problem — it uses a supported
interface. This approach trades robustness for running on your machine in a
browser you control.

**Free Gmail accounts get suspended for bulk sending** faster than Workspace
ones, and automated UI access raises that risk further. The caps here are
deliberately low for that reason. Don't raise `DAILY_MAX`; add accounts.

**Sending is capped, not unlimited.** 20/day per account is the ceiling by
design. Three accounts ≈ 1,200 emails/month.

---

## What's been tested

Verified by `test_core.py` and `test_settings.py` (75 assertions, all passing):

- Warmup ramp: starts at 5, rises by 3, holds at 20 from day 6 onward
- Daily cap decrements correctly and never goes negative
- State survives restarts; addresses are matched case-insensitively so nobody
  is contacted twice
- Send window rejects weekends and both hour boundaries
- Queue selection: skips invalid, suppressed, already-sent, and unpersonalized
  rows, with the right reason for each, and honours the per-run limit
- Sheet URL → CSV export URL, with and without a `gid`, and rejects non-Sheet URLs
- Templating fills every placeholder and raises on an unknown column
- Random gaps stay in range and actually vary
- Settings: a rejected save leaves the running config completely untouched
  (it previously did not), errors don't carry over between saves, unknown
  template placeholders are caught before they can reach a real email,
  non-numeric input is refused rather than crashing, checkbox values coerce
  correctly, saved settings survive a reload, and a corrupt override file
  falls back to defaults

Also exercised by hand against the running web app: every endpoint, each
validation failure, the CSV rejection paths, and a browser-launch failure
surfacing in the activity log and releasing the buttons.

Also verified by hand: Chromium launches with a persistent profile, the profile
directory survives, and a missing browser binary produces a readable error.

**Not tested here, because this container has no Google account and blocks
outbound browser traffic:** signing in, fetching a Sheet, and the compose/send
flow itself — including whether the Gmail selectors are current. Step 5
(`--dry-run`) is what proves those on your machine. Run it before `--send`.
