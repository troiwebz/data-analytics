#!/usr/bin/env python3
"""Gmail outreach sender — drives your own Chrome, one email at a time.

  python3 send.py --setup      sign into Gmail once (opens Chrome)
  python3 send.py --status     show today's allowance, send nothing
  python3 send.py --preview    render the next email to the terminal, no browser
  python3 send.py --dry-run    compose into Gmail Drafts, send nothing
  python3 send.py --send       actually send
"""

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config as cfg
import core


def _resolve_paths():
    """Everything lives beside this script, whatever directory you run it from."""
    here = os.path.dirname(os.path.abspath(__file__))
    for name in ("CHROME_PROFILE_DIR", "STATE_PATH", "SUPPRESSION_PATH",
                 "SCREENSHOT_DIR", "CSV_PATH"):
        value = getattr(cfg, name)
        if value and not os.path.isabs(value):
            setattr(cfg, name, os.path.join(here, value))


def load_prospects(browser=None):
    """From the Sheet via the logged-in browser, or from a local CSV."""
    if cfg.SHEET_URL:
        if browser is None:
            raise RuntimeError("SHEET_URL needs the browser — use --dry-run or --send.")
        url = core.sheet_to_csv_url(cfg.SHEET_URL)
        return core.parse_prospects(browser.fetch_csv(url)), "sheet"
    if not os.path.exists(cfg.CSV_PATH):
        raise SystemExit("No prospects found. Set SHEET_URL in config.py, or create %s"
                         % cfg.CSV_PATH)
    with open(cfg.CSV_PATH) as f:
        return core.parse_prospects(f.read()), os.path.basename(cfg.CSV_PATH)


def cmd_status(state):
    print()
    print("  Warmup day      %d" % state.warmup_day())
    print("  Allowed today   %d" % core.daily_allowance(state, cfg))
    print("  Sent today      %d" % state.sent_today())
    print("  Remaining       %d" % core.daily_remaining(state, cfg))
    print("  Contacted ever  %d" % len(state.data["sent"]))
    print("  Send window     %s" % core.window_reason(cfg))
    print()


def cmd_preview(state):
    prospects, source = load_prospects()
    suppression = core.load_suppression(cfg.SUPPRESSION_PATH)
    queue, skipped = core.select_queue(prospects, state, suppression, 1)

    print("\n  %d prospects in %s" % (len(prospects), source))
    for email, why in skipped:
        print("  skip  %-34s %s" % (email, why))
    if not queue:
        print("\n  Nothing queued to preview.\n")
        return

    row = queue[0]
    subject = core.render(cfg.SUBJECT, row, cfg)
    body = core.render(cfg.BODY, row, cfg)
    print("\n" + "─" * 68)
    print("  To:       %s" % row["email"])
    print("  Subject:  %s" % subject)
    print("─" * 68)
    print(body)
    print("─" * 68)
    leftover = core.unfilled_placeholders(subject + body)
    if leftover:
        print("  WARNING unfilled placeholders: %s" % ", ".join(set(leftover)))
    print()


def cmd_send(state, dry_run):
    from gmail_driver import GmailBrowser

    if not within_or_explain(dry_run):
        return

    remaining = core.daily_remaining(state, cfg)
    if remaining <= 0 and not dry_run:
        print("  Daily allowance used up (%d). Nothing to do."
              % core.daily_allowance(state, cfg))
        return

    budget = min(cfg.PER_RUN, remaining if not dry_run else cfg.PER_RUN)

    with GmailBrowser(cfg.CHROME_PROFILE_DIR, cfg.SCREENSHOT_DIR,
                      channel=cfg.CHROME_CHANNEL,
                      executable_path=cfg.CHROME_PATH) as browser:
        browser.open_gmail()
        if not browser.is_signed_in():
            print("  Not signed in. Run:  python3 send.py --setup")
            return
        print("  Signed in as %s" % browser.account_email())

        prospects, source = load_prospects(browser)
        suppression = core.load_suppression(cfg.SUPPRESSION_PATH)
        queue, skipped = core.select_queue(prospects, state, suppression, budget)

        print("  %d prospects in %s | %d queued this run" % (len(prospects), source, len(queue)))
        for email, why in skipped:
            print("  skip  %-34s %s" % (email, why))
        if not queue:
            print("  Nothing to send.")
            return

        for i, row in enumerate(queue):
            subject = core.render(cfg.SUBJECT, row, cfg)
            body = core.render(cfg.BODY, row, cfg)
            try:
                result = browser.send(row["email"], subject, body, dry_run=dry_run)
                if dry_run:
                    print("  draft %-34s (nothing sent)" % row["email"])
                else:
                    state.record(row["email"], subject)
                    print("  sent  %-34s %d left today"
                          % (row["email"], core.daily_remaining(state, cfg)))
            except Exception as err:
                shot = browser.screenshot("fail_%s" % row["email"].split("@")[0])
                print("  FAIL  %-34s %s" % (row["email"], err))
                if shot:
                    print("        screenshot: %s" % shot)
                break

            if i < len(queue) - 1:
                pause = core.gap_seconds(cfg)
                print("        waiting %.0fs" % pause)
                time.sleep(pause)


def within_or_explain(dry_run):
    if core.within_send_window(cfg):
        return True
    reason = core.window_reason(cfg)
    if dry_run:
        print("  (outside send window — %s — continuing anyway for dry run)" % reason)
        return True
    print("  Not sending: %s. Window is %02d:00-%02d:00%s."
          % (reason, cfg.SEND_HOUR_START, cfg.SEND_HOUR_END,
             ", weekdays only" if cfg.SEND_WEEKDAYS_ONLY else ""))
    return False


def cmd_setup():
    from gmail_driver import GmailBrowser
    with GmailBrowser(cfg.CHROME_PROFILE_DIR, cfg.SCREENSHOT_DIR,
                      channel=cfg.CHROME_CHANNEL,
                      executable_path=cfg.CHROME_PATH) as browser:
        if browser.wait_for_manual_login():
            print("  Signed in and saved. You won't need to do this again.")
            print("  Next:  python3 send.py --preview")
        else:
            print("  Timed out waiting for sign-in. Run --setup again.")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--setup",   action="store_true", help="sign into Gmail once")
    g.add_argument("--status",  action="store_true", help="show today's numbers")
    g.add_argument("--preview", action="store_true", help="render next email, no browser")
    g.add_argument("--dry-run", action="store_true", help="compose to Drafts, send nothing")
    g.add_argument("--send",    action="store_true", help="actually send")
    args = ap.parse_args()

    _resolve_paths()

    if args.setup:
        return cmd_setup()

    state = core.State(cfg.STATE_PATH)
    if args.status:
        return cmd_status(state)
    if args.preview:
        return cmd_preview(state)
    return cmd_send(state, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
