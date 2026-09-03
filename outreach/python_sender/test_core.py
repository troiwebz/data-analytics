"""Tests for the pacing and selection logic. No browser, no network."""

import os
import sys
import tempfile
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as cfg
import core

FAILS = []

def check(label, got, want):
    ok = got == want
    print("  %s  %-52s got=%r" % ("ok  " if ok else "FAIL", label, got))
    if not ok:
        FAILS.append("%s: got %r, wanted %r" % (label, got, want))


def fresh_state(days_ago=0):
    fd, path = tempfile.mkstemp(suffix=".json"); os.close(fd); os.remove(path)
    st = core.State(path)
    if days_ago:
        st.data["warmup_start"] = (date.today() - timedelta(days=days_ago)).isoformat()
        st.save()
    return st


print("\nwarmup ramp (start=5, step=3, max=20)")
for days, want in [(0, 5), (1, 8), (2, 11), (3, 14), (4, 17), (5, 20), (6, 20), (30, 20), (365, 20)]:
    check("day %d" % (days + 1), core.daily_allowance(fresh_state(days), cfg), want)

print("\ndaily cap")
st = fresh_state()
check("remaining at start", core.daily_remaining(st, cfg), 5)
for i in range(3):
    st.record("p%d@x.com" % i, "s")
check("after 3 sends", core.daily_remaining(st, cfg), 2)
for i in range(3, 7):
    st.record("p%d@x.com" % i, "s")
check("cannot go negative", core.daily_remaining(st, cfg), 0)
check("sent_today counted", st.sent_today(), 7)

print("\nstate persists across restart")
st2 = core.State(st.path)
check("sent count survives", len(st2.data["sent"]), 7)
check("recognises prior send", st2.already_sent("P0@X.COM"), True)
check("case-insensitive", st2.already_sent("p0@x.com"), True)
check("unknown address", st2.already_sent("nobody@x.com"), False)

print("\nsend window (Mon-Fri 09:00-17:00)")
cases = [
    ("Thu 09:00", datetime(2026, 9, 3, 9, 0), True),
    ("Thu 08:59", datetime(2026, 9, 3, 8, 59), False),
    ("Thu 16:59", datetime(2026, 9, 3, 16, 59), True),
    ("Thu 17:00", datetime(2026, 9, 3, 17, 0), False),
    ("Thu 03:00", datetime(2026, 9, 3, 3, 0), False),
    ("Sat 11:00", datetime(2026, 9, 5, 11, 0), False),
    ("Sun 11:00", datetime(2026, 9, 6, 11, 0), False),
    ("Mon 11:00", datetime(2026, 9, 7, 11, 0), True),
]
for label, when, want in cases:
    check(label, core.within_send_window(cfg, when), want)

print("\nqueue selection")
rows = core.parse_prospects(
    "email,first_name,site,personal_line,idea_1,idea_2\n"
    "good@a.com,Sam,a.com,real specific line,i1,i2\n"
    "dupe@b.com,Pat,b.com,another line,i1,i2\n"
    "not-an-email,Kim,c.com,line,i1,i2\n"
    "blocked@d.com,Lee,d.com,line,i1,i2\n"
    "nopersonal@e.com,Ray,e.com,,i1,i2\n"
    "noname@f.com,,f.com,line,i1,i2\n")
check("parsed rows", len(rows), 6)

st3 = fresh_state()
st3.record("dupe@b.com", "s")
queue, skipped = core.select_queue(rows, st3, {"blocked@d.com"}, limit=10)
check("queued", [r["email"] for r in queue], ["good@a.com"])
reasons = dict(skipped)
check("invalid flagged", reasons.get("not-an-email"), "invalid address")
check("suppressed flagged", reasons.get("blocked@d.com"), "suppressed")
check("blank personal_line flagged", reasons.get("nopersonal@e.com"),
      "missing first_name or personal_line")
check("blank first_name flagged", reasons.get("noname@f.com"),
      "missing first_name or personal_line")
check("already-sent is silent", "dupe@b.com" in reasons, False)

print("\nqueue respects limit")
many = core.parse_prospects("email,first_name,site,personal_line,idea_1,idea_2\n" +
    "".join("u%d@x.com,N%d,x.com,line %d,i1,i2\n" % (i, i, i) for i in range(50)))
q, _ = core.select_queue(many, fresh_state(), set(), limit=2)
check("limit honoured", len(q), 2)

print("\nsheet URL -> CSV export URL")
check("with gid",
      core.sheet_to_csv_url("https://docs.google.com/spreadsheets/d/1AbC-x_9/edit#gid=8675309"),
      "https://docs.google.com/spreadsheets/d/1AbC-x_9/export?format=csv&gid=8675309")
check("without gid",
      core.sheet_to_csv_url("https://docs.google.com/spreadsheets/d/1AbC-x_9/edit"),
      "https://docs.google.com/spreadsheets/d/1AbC-x_9/export?format=csv&gid=0")
try:
    core.sheet_to_csv_url("https://example.com/not-a-sheet")
    check("rejects non-sheet URL", "no error", "ValueError")
except ValueError:
    check("rejects non-sheet URL", "ValueError", "ValueError")

print("\ntemplating")
row = rows[0]
body = core.render(cfg.BODY, row, cfg)
check("no unfilled placeholders", core.unfilled_placeholders(body), [])
check("first name inserted", "Hi Sam," in body, True)
check("signature inserted", cfg.SIGNATURE.splitlines()[0] in body, True)
try:
    core.render("Hello {not_a_column}", row, cfg)
    check("unknown column raises", "no error", "KeyError")
except KeyError:
    check("unknown column raises", "KeyError", "KeyError")

print("\ngap timing")
gaps = [core.gap_seconds(cfg) for _ in range(500)]
check("within configured range", all(cfg.GAP_MIN_SEC <= g <= cfg.GAP_MAX_SEC for g in gaps), True)
check("actually varies", len(set(round(g) for g in gaps)) > 20, True)

print("\n" + ("ALL PASS" if not FAILS else "FAILURES:\n  " + "\n  ".join(FAILS)))
sys.exit(1 if FAILS else 0)
