"""Tests for the settings layer used by both the CLI and the web UI."""

import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from settings import Settings

FAILS = []

def check(label, got, want):
    ok = got == want
    print("  %s  %-54s got=%r" % ("ok  " if ok else "FAIL", label, got))
    if not ok:
        FAILS.append(label)


def fresh():
    fd, path = tempfile.mkstemp(suffix=".json"); os.close(fd); os.remove(path)
    return Settings(path)


print("\ndefaults load from config.py")
s = fresh()
check("day-1 limit", s.WARMUP_START, 5)
check("daily cap", s.DAILY_MAX, 20)
check("paths made absolute", os.path.isabs(s.STATE_PATH), True)

print("\na valid update commits")
check("no problems", s.update({"FROM_NAME": "Hema", "DAILY_MAX": 25}), [])
check("name applied", s.FROM_NAME, "Hema")
check("cap applied", s.DAILY_MAX, 25)

print("\nREGRESSION: a rejected update must not mutate live config")
before = dict(s.as_dict())
problems = s.update({"SEND_HOUR_START": 18, "SEND_HOUR_END": 9})
check("rejected", problems, ["Start hour must be before end hour"])
check("start hour unchanged", s.SEND_HOUR_START, before["SEND_HOUR_START"])
check("end hour unchanged", s.SEND_HOUR_END, before["SEND_HOUR_END"])
check("nothing else moved", s.as_dict(), before)

print("\nREGRESSION: errors don't accumulate across calls")
check("only its own error", s.update({"DAILY_MAX": 1}),
      ["Daily cap can't be below the day-1 limit"])
check("cap still the old value", s.DAILY_MAX, 25)

print("\nunknown placeholders are caught before they reach an email")
p = s.update({"BODY": "Hi {first_name}, about {company_name}"})
check("flagged", len(p), 1)
check("names the bad one", "{company_name}" in p[0], True)
check("lists the valid ones", "{personal_line}" in p[0], True)
check("body unchanged", "{company_name}" in s.BODY, False)
check("known placeholders pass", s.update({"BODY": "Hi {first_name} {site} {signature}"}), [])

print("\nother validation")
for label, payload, want in [
    ("negative gap",      {"GAP_MIN_SEC": -5},                 "Gap can't be negative"),
    ("gap min > max",     {"GAP_MIN_SEC": 300, "GAP_MAX_SEC": 60},
                          "Minimum gap can't exceed the maximum"),
    ("per-run below 1",   {"PER_RUN": 0},   "Emails per run must be at least 1"),
    ("hour out of range", {"SEND_HOUR_START": 99}, "Send hours must be between 0 and 24"),
]:
    check(label, want in s.update(payload), True)

print("\nnon-numeric input is rejected, not crashed on")
check("text in a number field", s.update({"DAILY_MAX": "twenty"}),
      ["DAILY_MAX is not a valid value"])
check("cap survived", s.DAILY_MAX, 25)

print("\ncheckbox coercion")
for raw, want in [(True, True), (False, False), ("true", True), ("on", True),
                  ("", False), ("false", False)]:
    s.update({"SEND_WEEKDAYS_ONLY": raw})
    check("weekdays from %r" % raw, s.SEND_WEEKDAYS_ONLY, want)

print("\npersistence")
s.update({"FROM_NAME": "Hema", "SUBJECT": "Guest post for {site}"})
check("saved cleanly", s.save(), [])
reloaded = Settings(s._path)
check("name survives reload", reloaded.FROM_NAME, "Hema")
check("subject survives reload", reloaded.SUBJECT, "Guest post for {site}")
check("only editable keys stored", set(json.load(open(s._path))) <= set(s.as_dict()), True)

print("\na corrupt override file falls back to defaults instead of crashing")
fd, bad = tempfile.mkstemp(suffix=".json"); os.close(fd)
open(bad, "w").write("{ this is not json")
check("recovered", Settings(bad).DAILY_MAX, 20)
os.remove(bad)

print("\nwarnings fire without blocking the save")
s.update({"DAILY_MAX": 500})
check("high cap accepted", s.DAILY_MAX, 500)
check("but warns", any("high for a free Gmail" in w for w in s.warnings()), True)

print("\n" + ("ALL PASS" if not FAILS else "FAILURES:\n  " + "\n  ".join(FAILS)))
sys.exit(1 if FAILS else 0)
