"""Pure logic: state, prospect loading, templating, pacing. No browser here."""

import csv
import io
import json
import os
import random
import re
from datetime import date, datetime

FIELDS = ["email", "first_name", "site", "personal_line", "idea_1", "idea_2"]
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# ── State ────────────────────────────────────────────────────────────────────

class State:
    """Tracks what's been sent and how many went out today. Survives restarts."""

    def __init__(self, path):
        self.path = path
        self.data = {"warmup_start": None, "sent": {}, "daily": {}}
        if os.path.exists(path):
            with open(path) as f:
                self.data.update(json.load(f))
        if not self.data["warmup_start"]:
            self.data["warmup_start"] = date.today().isoformat()
            self.save()

    def save(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(self.data, f, indent=2)
        os.replace(tmp, self.path)          # atomic, so a crash can't corrupt it

    def already_sent(self, email):
        return email.lower() in self.data["sent"]

    def record(self, email, subject):
        self.data["sent"][email.lower()] = {
            "at": datetime.now().isoformat(timespec="seconds"),
            "subject": subject,
        }
        today = date.today().isoformat()
        self.data["daily"][today] = self.data["daily"].get(today, 0) + 1
        self.save()

    def sent_today(self):
        return self.data["daily"].get(date.today().isoformat(), 0)

    def warmup_day(self):
        start = date.fromisoformat(self.data["warmup_start"])
        return (date.today() - start).days + 1        # day 1 on the first day


def daily_allowance(state, cfg):
    """Ramps from WARMUP_START by WARMUP_STEP per day, never past DAILY_MAX."""
    days_elapsed = state.warmup_day() - 1
    return min(cfg.WARMUP_START + days_elapsed * cfg.WARMUP_STEP, cfg.DAILY_MAX)


def daily_remaining(state, cfg):
    return max(0, daily_allowance(state, cfg) - state.sent_today())


# ── Send window ──────────────────────────────────────────────────────────────

def within_send_window(cfg, now=None):
    now = now or datetime.now()
    if cfg.SEND_WEEKDAYS_ONLY and now.weekday() > 4:      # 5=Sat, 6=Sun
        return False
    return cfg.SEND_HOUR_START <= now.hour < cfg.SEND_HOUR_END


def window_reason(cfg, now=None):
    """Human-readable explanation of why we're not sending."""
    now = now or datetime.now()
    if cfg.SEND_WEEKDAYS_ONLY and now.weekday() > 4:
        return "it's the weekend"
    if now.hour < cfg.SEND_HOUR_START:
        return "before %d:00" % cfg.SEND_HOUR_START
    if now.hour >= cfg.SEND_HOUR_END:
        return "after %d:00" % cfg.SEND_HOUR_END
    return "within send window"


def gap_seconds(cfg):
    return random.uniform(cfg.GAP_MIN_SEC, cfg.GAP_MAX_SEC)


# ── Prospects ────────────────────────────────────────────────────────────────

def sheet_to_csv_url(url):
    """Turns a normal Sheet URL into its CSV export URL, preserving the tab."""
    m = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", url)
    if not m:
        raise ValueError("Not a Google Sheets URL: %s" % url)
    gid = re.search(r"[#&?]gid=(\d+)", url)
    return "https://docs.google.com/spreadsheets/d/%s/export?format=csv&gid=%s" % (
        m.group(1), gid.group(1) if gid else "0")


def parse_prospects(text):
    """Reads CSV text into rows, keeping only the columns we use."""
    rows = []
    for raw in csv.DictReader(io.StringIO(text)):
        row = {k: str(raw.get(k, "") or "").strip() for k in FIELDS}
        if row["email"]:
            rows.append(row)
    return rows


def load_suppression(path):
    if not os.path.exists(path):
        return set()
    with open(path) as f:
        return {line.strip().lower() for line in f if line.strip()}


def is_valid_email(s):
    return bool(_EMAIL_RE.match(s or ""))


def select_queue(prospects, state, suppression, limit):
    """Picks who to email this run, and says why anyone was skipped."""
    queue, skipped = [], []
    for row in prospects:
        email = row["email"]
        if not is_valid_email(email):
            skipped.append((email, "invalid address"))
        elif email.lower() in suppression:
            skipped.append((email, "suppressed"))
        elif state.already_sent(email):
            continue                                  # normal, not worth reporting
        elif not row["first_name"] or not row["personal_line"]:
            skipped.append((email, "missing first_name or personal_line"))
        else:
            queue.append(row)
        if len(queue) >= limit:
            break
    return queue, skipped


# ── Templating ───────────────────────────────────────────────────────────────

def render(template, row, cfg):
    values = dict(row)
    values["signature"] = cfg.SIGNATURE
    try:
        return template.format(**values)
    except KeyError as e:
        raise KeyError("Template uses {%s}, which is not a column" % e.args[0])


def unfilled_placeholders(text):
    return re.findall(r"\{(\w+)\}", text)
