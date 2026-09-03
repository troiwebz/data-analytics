"""Settings layer: config.py holds the defaults, settings.local.json holds
whatever you changed in the web UI. Both the CLI and the web app read through
here, so the two can never disagree about what's configured.
"""

import json
import os
import re

import config as _defaults
from core import FIELDS

# Editable from the web UI.
EDITABLE = [
    "FROM_NAME", "SIGNATURE", "SUBJECT", "BODY", "SHEET_URL",
    "WARMUP_START", "WARMUP_STEP", "DAILY_MAX", "PER_RUN",
    "SEND_HOUR_START", "SEND_HOUR_END", "SEND_WEEKDAYS_ONLY",
    "GAP_MIN_SEC", "GAP_MAX_SEC", "CHROME_CHANNEL",
]

# Paths — set in config.py only, never through the browser.
PATHS = [
    "CSV_PATH", "CHROME_PATH", "CHROME_PROFILE_DIR",
    "STATE_PATH", "SUPPRESSION_PATH", "SCREENSHOT_DIR",
]

INT_FIELDS = {"WARMUP_START", "WARMUP_STEP", "DAILY_MAX", "PER_RUN",
              "SEND_HOUR_START", "SEND_HOUR_END", "GAP_MIN_SEC", "GAP_MAX_SEC"}
BOOL_FIELDS = {"SEND_WEEKDAYS_ONLY"}


KNOWN_PLACEHOLDERS = set(FIELDS) | {"signature"}


def _validate(d):
    """Checks a settings dict. Used on candidates before they're committed."""
    p = []
    if d["WARMUP_START"] < 1:
        p.append("Day-1 limit must be at least 1")
    if d["DAILY_MAX"] < d["WARMUP_START"]:
        p.append("Daily cap can't be below the day-1 limit")
    if d["PER_RUN"] < 1:
        p.append("Emails per run must be at least 1")
    if not 0 <= d["SEND_HOUR_START"] < 24 or not 0 < d["SEND_HOUR_END"] <= 24:
        p.append("Send hours must be between 0 and 24")
    if d["SEND_HOUR_START"] >= d["SEND_HOUR_END"]:
        p.append("Start hour must be before end hour")
    if d["GAP_MIN_SEC"] > d["GAP_MAX_SEC"]:
        p.append("Minimum gap can't exceed the maximum")
    if d["GAP_MIN_SEC"] < 0:
        p.append("Gap can't be negative")

    # A placeholder that matches no column would render as literal text in a
    # real email, so catch it at save time rather than on the way out.
    for label, text in (("Subject", d["SUBJECT"]), ("Body", d["BODY"])):
        unknown = set(re.findall(r"\{(\w+)\}", text)) - KNOWN_PLACEHOLDERS
        if unknown:
            p.append("%s uses unknown placeholder%s: %s. Available: %s"
                     % (label, "" if len(unknown) == 1 else "s",
                        ", ".join("{%s}" % u for u in sorted(unknown)),
                        ", ".join("{%s}" % k for k in sorted(KNOWN_PLACEHOLDERS))))
    return p


class Settings:
    """Attribute access over merged defaults + overrides."""

    def __init__(self, path):
        object.__setattr__(self, "_path", path)
        data = {k: getattr(_defaults, k) for k in EDITABLE + PATHS}
        if os.path.exists(path):
            try:
                with open(path) as f:
                    saved = json.load(f)
                data.update({k: v for k, v in saved.items() if k in EDITABLE})
            except (ValueError, OSError):
                pass                      # a corrupt override file falls back to defaults
        object.__setattr__(self, "_data", data)
        self._resolve_paths()

    def _resolve_paths(self):
        """Everything lives beside this file, whatever directory you run from."""
        here = os.path.dirname(os.path.abspath(__file__))
        for key in PATHS:
            value = self._data.get(key)
            if value and not os.path.isabs(value):
                self._data[key] = os.path.join(here, value)

    def __getattr__(self, key):
        try:
            return object.__getattribute__(self, "_data")[key]
        except KeyError:
            raise AttributeError(key)

    def __setattr__(self, key, value):
        self._data[key] = value

    def as_dict(self):
        return {k: self._data[k] for k in EDITABLE}

    def update(self, incoming):
        """Applies a dict from the UI, coercing types. Returns list of problems.

        Nothing is committed unless the whole set validates — a rejected save
        must not leave the running config half-changed.
        """
        candidate = dict(self._data)
        problems = []
        for key, raw in incoming.items():
            if key not in EDITABLE:
                continue
            try:
                if key in INT_FIELDS:
                    candidate[key] = int(raw)
                elif key in BOOL_FIELDS:
                    candidate[key] = bool(raw) if isinstance(raw, bool) else \
                        str(raw).lower() in ("1", "true", "yes", "on")
                else:
                    candidate[key] = str(raw)
            except (TypeError, ValueError):
                problems.append("%s is not a valid value" % key)

        problems.extend(_validate(candidate))
        if problems:
            return problems
        object.__setattr__(self, "_data", candidate)
        return []

    def validate(self):
        return _validate(self._data)

    def warnings(self):
        """Not errors — things worth saying out loud before they cost an account."""
        w = []
        if self.DAILY_MAX > 40:
            w.append("A daily cap of %d is high for a free Gmail account. "
                     "Above ~40/day is where suspensions start. Add accounts "
                     "instead of raising this." % self.DAILY_MAX)
        if self.GAP_MIN_SEC < 20:
            w.append("Gaps under 20s look automated. 45-180s is safer.")
        if not self.SEND_WEEKDAYS_ONLY:
            w.append("Weekend sending stands out in outreach. Weekdays perform better.")
        return w

    def save(self):
        problems = self.validate()
        if problems:
            return problems
        tmp = self._path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(self.as_dict(), f, indent=2)
        os.replace(tmp, self._path)
        return []
