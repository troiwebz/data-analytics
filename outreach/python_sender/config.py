"""Settings for the Gmail outreach sender. Edit this file, nothing else."""

# ── Who you are ──────────────────────────────────────────────────────────────
FROM_NAME = "Jen"
SIGNATURE = "Jen\nlishawn.com\n123 Your Street, Your City, Country"

# ── Where the prospects come from ────────────────────────────────────────────
# Either a Google Sheet URL (read through your logged-in Chrome — no sharing,
# no API), or a path to a local .csv file. Sheet URL wins if both are set.
SHEET_URL = ""                      # e.g. "https://docs.google.com/spreadsheets/d/1AbC.../edit#gid=0"
CSV_PATH  = "prospects.csv"

# ── Volume ───────────────────────────────────────────────────────────────────
# Tuned for a free @gmail.com account. Raising these is how accounts get
# suspended — add more accounts instead.
WARMUP_START = 5      # emails allowed on day 1
WARMUP_STEP  = 3      # added each day
DAILY_MAX    = 20     # hard ceiling, never raise
PER_RUN      = 2      # emails per invocation

# ── Timing ───────────────────────────────────────────────────────────────────
SEND_HOUR_START    = 9      # local time
SEND_HOUR_END      = 17
SEND_WEEKDAYS_ONLY = True
GAP_MIN_SEC        = 45     # random pause between two sends
GAP_MAX_SEC        = 180

# ── The email ────────────────────────────────────────────────────────────────
SUBJECT = "Quick idea for {site}"

BODY = """Hi {first_name},

{personal_line}

I write about the same space and had two pieces in mind that would fit {site}:

  1. {idea_1}
  2. {idea_2}

Happy to send an outline for whichever is more useful. And if this isn't a fit,
just reply "no" and I won't follow up.

{signature}"""

# ── Browser ──────────────────────────────────────────────────────────────────
# Leave both blank to use Playwright's bundled Chromium (run once:
#   python3 -m playwright install chromium
#
# Better option: use your real Google Chrome instead. It's the browser Gmail
# expects, so it behaves more normally. Set CHROME_CHANNEL = "chrome" if Chrome
# is installed the usual way, or give the full binary path in CHROME_PATH.
CHROME_CHANNEL = ""      # "chrome", "msedge", or "" for bundled Chromium
CHROME_PATH    = ""      # full path to a browser binary, overrides the above

# ── Files ────────────────────────────────────────────────────────────────────
CHROME_PROFILE_DIR = ".chrome_profile"   # your login lives here; never commit it
STATE_PATH         = "state.json"        # what's been sent, daily counts
SUPPRESSION_PATH   = "suppression.txt"   # one email per line, never contacted
SCREENSHOT_DIR     = "screenshots"       # captured when a send fails
