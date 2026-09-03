#!/usr/bin/env python3
"""Local control panel for the outreach sender.

  python3 web.py      then open http://localhost:5055

Runs only on your machine. Nothing is exposed to the internet.
"""

import os
import sys
import threading
import time
import traceback
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from flask import Flask, jsonify, render_template, request

import core
from settings import Settings

HERE = os.path.dirname(os.path.abspath(__file__))
SETTINGS_PATH = os.path.join(HERE, "settings.local.json")

app = Flask(__name__, template_folder=os.path.join(HERE, "templates"))
cfg = Settings(SETTINGS_PATH)

# ── Background job runner ────────────────────────────────────────────────────
# Browser work takes minutes, so it runs on a thread and the page polls.

JOB = {"name": None, "running": False, "lines": [], "started": None, "finished": None}
JOB_LOCK = threading.Lock()


def log(line):
    stamp = datetime.now().strftime("%H:%M:%S")
    with JOB_LOCK:
        JOB["lines"].append("%s  %s" % (stamp, line))
        JOB["lines"][:] = JOB["lines"][-300:]
    print("%s  %s" % (stamp, line), flush=True)


def job_running():
    with JOB_LOCK:
        return JOB["running"]


def start_job(name, fn):
    """Runs fn on a thread. Refuses if something is already going."""
    with JOB_LOCK:
        if JOB["running"]:
            return False
        JOB.update(name=name, running=True, lines=[], finished=None,
                   started=datetime.now().strftime("%H:%M:%S"))

    def wrapper():
        try:
            fn()
        except Exception as err:
            log("ERROR  %s" % err)
            for frag in traceback.format_exc().strip().splitlines()[-3:]:
                log("       %s" % frag)
        finally:
            with JOB_LOCK:
                JOB["running"] = False
                JOB["finished"] = datetime.now().strftime("%H:%M:%S")
            log("— finished —")

    threading.Thread(target=wrapper, daemon=True).start()
    return True


# ── Prospect loading ─────────────────────────────────────────────────────────

def read_local_prospects():
    if not os.path.exists(cfg.CSV_PATH):
        return []
    with open(cfg.CSV_PATH) as f:
        return core.parse_prospects(f.read())


def queue_snapshot():
    """What would go out next, and who's being skipped and why."""
    state = core.State(cfg.STATE_PATH)
    prospects = read_local_prospects()
    suppression = core.load_suppression(cfg.SUPPRESSION_PATH)
    queue, skipped = core.select_queue(prospects, state, suppression, cfg.PER_RUN)
    return state, prospects, queue, skipped


# ── Pages ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("outreach.html")


@app.route("/api/status")
def api_status():
    state, prospects, queue, skipped = queue_snapshot()
    contacted = set(state.data["sent"])
    rows = []
    for row in prospects:
        email = row["email"]
        if email.lower() in contacted:
            status = "sent"
        elif any(email == s[0] for s in skipped):
            status = "skipped"
        elif any(email == q["email"] for q in queue):
            status = "next"
        else:
            status = "waiting"
        rows.append({
            "email": email, "first_name": row["first_name"], "site": row["site"],
            "personal_line": row["personal_line"], "status": status,
            "reason": dict(skipped).get(email, ""),
        })

    with JOB_LOCK:
        job = {"name": JOB["name"], "running": JOB["running"],
               "lines": list(JOB["lines"]), "finished": JOB["finished"]}

    return jsonify({
        "warmup_day": state.warmup_day(),
        "allowance": core.daily_allowance(state, cfg),
        "sent_today": state.sent_today(),
        "remaining": core.daily_remaining(state, cfg),
        "contacted_ever": len(contacted),
        "in_window": core.within_send_window(cfg),
        "window_reason": core.window_reason(cfg),
        "signed_in": os.path.isdir(cfg.CHROME_PROFILE_DIR)
                     and bool(os.listdir(cfg.CHROME_PROFILE_DIR)),
        "prospect_count": len(prospects),
        "queued": len(queue),
        "rows": rows,
        "warnings": cfg.warnings(),
        "job": job,
    })


@app.route("/api/settings", methods=["GET", "POST"])
def api_settings():
    if request.method == "GET":
        return jsonify({"settings": cfg.as_dict(), "warnings": cfg.warnings()})
    problems = cfg.update(request.json or {})
    if problems:
        return jsonify({"ok": False, "problems": problems}), 400
    problems = cfg.save()
    if problems:
        return jsonify({"ok": False, "problems": problems}), 400
    return jsonify({"ok": True, "settings": cfg.as_dict(), "warnings": cfg.warnings()})


@app.route("/api/preview")
def api_preview():
    _, _, queue, skipped = queue_snapshot()
    if not queue:
        return jsonify({"empty": True, "skipped": skipped})
    row = queue[0]
    try:
        subject = core.render(cfg.SUBJECT, row, cfg)
        body = core.render(cfg.BODY, row, cfg)
    except KeyError as err:
        return jsonify({"empty": True, "error": str(err).strip('"'), "skipped": []})
    return jsonify({
        "empty": False, "to": row["email"], "subject": subject, "body": body,
        "unfilled": sorted(set(core.unfilled_placeholders(subject + body))),
    })


@app.route("/api/prospects", methods=["POST"])
def api_prospects():
    """Accepts pasted CSV and writes it to the local prospects file."""
    text = (request.json or {}).get("csv", "").strip()
    if not text:
        return jsonify({"ok": False, "problems": ["Nothing pasted."]}), 400
    rows = core.parse_prospects(text)
    if not rows:
        return jsonify({"ok": False, "problems": [
            "No usable rows. The first line must be the header: %s"
            % ",".join(core.FIELDS)]}), 400
    with open(cfg.CSV_PATH, "w") as f:
        f.write(text if text.endswith("\n") else text + "\n")
    return jsonify({"ok": True, "count": len(rows)})


# ── Actions ──────────────────────────────────────────────────────────────────

def _browser():
    from gmail_driver import GmailBrowser
    return GmailBrowser(cfg.CHROME_PROFILE_DIR, cfg.SCREENSHOT_DIR,
                        channel=cfg.CHROME_CHANNEL,
                        executable_path=cfg.CHROME_PATH)


def do_setup():
    log("Opening Chrome. Sign into the Gmail account you want to send from.")
    with _browser() as b:
        if b.wait_for_manual_login():
            log("Signed in. Chrome will remember this — you won't repeat it.")
        else:
            log("Timed out waiting for sign-in. Try again.")


def do_send(dry_run):
    label = "DRY RUN — composing to Drafts, nothing sends" if dry_run else "SENDING FOR REAL"
    log(label)

    if not dry_run and not core.within_send_window(cfg):
        log("Not sending: %s. Window is %02d:00–%02d:00%s."
            % (core.window_reason(cfg), cfg.SEND_HOUR_START, cfg.SEND_HOUR_END,
               ", weekdays only" if cfg.SEND_WEEKDAYS_ONLY else ""))
        return

    state = core.State(cfg.STATE_PATH)
    remaining = core.daily_remaining(state, cfg)
    if not dry_run and remaining <= 0:
        log("Daily allowance of %d is used up." % core.daily_allowance(state, cfg))
        return

    budget = cfg.PER_RUN if dry_run else min(cfg.PER_RUN, remaining)

    with _browser() as b:
        b.open_gmail()
        if not b.is_signed_in():
            log("Not signed in. Use 'Sign in to Gmail' first.")
            return
        log("Signed in as %s" % b.account_email())

        if cfg.SHEET_URL:
            log("Reading your Google Sheet through the signed-in browser...")
            prospects = core.parse_prospects(b.fetch_csv(core.sheet_to_csv_url(cfg.SHEET_URL)))
        else:
            prospects = read_local_prospects()

        suppression = core.load_suppression(cfg.SUPPRESSION_PATH)
        queue, skipped = core.select_queue(prospects, state, suppression, budget)
        log("%d prospects, %d queued this run" % (len(prospects), len(queue)))
        for email, why in skipped:
            log("  skip  %s — %s" % (email, why))
        if not queue:
            log("Nothing to send.")
            return

        for i, row in enumerate(queue):
            subject = core.render(cfg.SUBJECT, row, cfg)
            body = core.render(cfg.BODY, row, cfg)
            try:
                b.send(row["email"], subject, body, dry_run=dry_run)
                if dry_run:
                    log("  draft  %s  (check Gmail Drafts)" % row["email"])
                else:
                    state.record(row["email"], subject)
                    log("  sent   %s  — %d left today"
                        % (row["email"], core.daily_remaining(state, cfg)))
            except Exception as err:
                shot = b.screenshot("fail")
                log("  FAILED %s — %s" % (row["email"], err))
                if shot:
                    log("  screenshot saved: %s" % shot)
                break

            if i < len(queue) - 1:
                pause = core.gap_seconds(cfg)
                log("  waiting %.0fs before the next one" % pause)
                time.sleep(pause)


@app.route("/api/run/<action>", methods=["POST"])
def api_run(action):
    jobs = {
        "setup":   ("Signing in", do_setup),
        "dry_run": ("Dry run", lambda: do_send(True)),
        "send":    ("Sending", lambda: do_send(False)),
    }
    if action not in jobs:
        return jsonify({"ok": False, "problems": ["Unknown action"]}), 400
    name, fn = jobs[action]
    if not start_job(name, fn):
        return jsonify({"ok": False, "problems": ["Something is already running."]}), 409
    return jsonify({"ok": True, "name": name})


if __name__ == "__main__":
    print("\n  Outreach control panel  →  http://localhost:5055\n")
    app.run(host="127.0.0.1", port=5055, debug=False, threaded=True)
