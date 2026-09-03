"""Drives Gmail in a real Chrome window via Playwright.

Your login lives in a persistent Chrome profile on disk — you sign in by hand
once and no password ever appears in this code.

Gmail's HTML is not a public interface and it changes. Every selector below has
fallbacks, and any failure captures a screenshot so you can see what changed.
"""

import os
import time
from datetime import datetime

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

GMAIL_URL = "https://mail.google.com/mail/u/0/#inbox"

# Ordered fallbacks — first match wins.
SEL = {
    "compose_button": [
        'div[gh="cm"]',
        '[role="button"][gh="cm"]',
        'div[role="button"]:has-text("Compose")',
    ],
    "to": [
        'input[aria-label="To recipients"]',
        'textarea[name="to"]',
        'input[peoplekit-id="BbVjBd"]',
        'div[aria-label="To recipients"] input',
    ],
    "subject": [
        'input[name="subjectbox"]',
        'input[aria-label="Subject"]',
    ],
    "body": [
        'div[aria-label="Message Body"]',
        'div[role="textbox"][aria-label*="Message"]',
        'div.Am.Al.editable',
    ],
    "send_button": [
        'div[role="button"][data-tooltip^="Send"]',
        'div[role="button"]:has-text("Send")',
        'div.T-I.J-J5-Ji.aoO',
    ],
    "signed_in": [
        'div[gh="cm"]',
        'a[aria-label*="Google Account"]',
    ],
}


class GmailBrowser:
    def __init__(self, profile_dir, screenshot_dir, headless=False, slow_mo=120,
                 channel="", executable_path=""):
        self.profile_dir = os.path.abspath(profile_dir)
        self.screenshot_dir = os.path.abspath(screenshot_dir)
        self.headless = headless
        self.slow_mo = slow_mo
        self.channel = channel or ""
        self.executable_path = executable_path or ""
        self._pw = None
        self.ctx = None
        self.page = None

    # ── lifecycle ────────────────────────────────────────────────────────────

    def __enter__(self):
        os.makedirs(self.profile_dir, exist_ok=True)
        os.makedirs(self.screenshot_dir, exist_ok=True)
        self._pw = sync_playwright().start()
        opts = dict(
            user_data_dir=self.profile_dir,
            headless=self.headless,
            slow_mo=self.slow_mo,
            viewport={"width": 1280, "height": 900},
            args=["--disable-blink-features=AutomationControlled"],
        )
        if self.executable_path:
            opts["executable_path"] = self.executable_path
        elif self.channel:
            opts["channel"] = self.channel
        try:
            self.ctx = self._pw.chromium.launch_persistent_context(**opts)
        except Exception as err:
            self._pw.stop()
            raise RuntimeError(
                "Could not start the browser.\n  %s\n\n"
                "Fixes, in order of preference:\n"
                "  1. Set CHROME_CHANNEL = \"chrome\" in config.py to use your "
                "installed Google Chrome.\n"
                "  2. Or install the bundled browser:  python3 -m playwright "
                "install chromium\n"
                "  3. Or point CHROME_PATH at a browser binary directly."
                % err) from err
        self.page = self.ctx.pages[0] if self.ctx.pages else self.ctx.new_page()
        return self

    def __exit__(self, *exc):
        try:
            if self.ctx:
                self.ctx.close()
        finally:
            if self._pw:
                self._pw.stop()

    # ── helpers ──────────────────────────────────────────────────────────────

    def _first(self, key, timeout=15000):
        """Returns the first selector in the fallback list that appears."""
        last = None
        per_try = max(1500, timeout // len(SEL[key]))
        for selector in SEL[key]:
            try:
                el = self.page.wait_for_selector(selector, timeout=per_try, state="visible")
                if el:
                    return el
            except PWTimeout as e:
                last = e
        raise RuntimeError(
            "Could not find '%s' in Gmail — the page layout has probably changed.\n"
            "Tried: %s" % (key, ", ".join(SEL[key]))
        ) from last

    def screenshot(self, label):
        path = os.path.join(
            self.screenshot_dir,
            "%s_%s.png" % (datetime.now().strftime("%Y%m%d_%H%M%S"), label))
        try:
            self.page.screenshot(path=path, full_page=False)
            return path
        except Exception:
            return None

    # ── actions ──────────────────────────────────────────────────────────────

    def open_gmail(self):
        self.page.goto(GMAIL_URL, wait_until="domcontentloaded", timeout=60000)

    def is_signed_in(self):
        for selector in SEL["signed_in"]:
            try:
                self.page.wait_for_selector(selector, timeout=6000, state="visible")
                return True
            except PWTimeout:
                continue
        return False

    def account_email(self):
        """Best-effort read of which account is signed in."""
        try:
            title = self.page.title()
            if "@" in title:
                return title.split("-")[-1].strip()
        except Exception:
            pass
        return "unknown"

    def wait_for_manual_login(self, timeout_sec=300):
        """Used by --setup. You log in; this just waits and confirms."""
        self.open_gmail()
        print("\n  A Chrome window is open. Sign into the Gmail account you want to")
        print("  send from, then leave it on the inbox. Waiting...\n")
        deadline = time.time() + timeout_sec
        while time.time() < deadline:
            if self.is_signed_in():
                return True
            time.sleep(3)
        return False

    def fetch_csv(self, url):
        """Downloads a Sheet's CSV through the logged-in session — no API, no sharing."""
        resp = self.ctx.request.get(url, timeout=30000)
        if not resp.ok:
            raise RuntimeError("Sheet fetch failed (HTTP %d). Is this account able "
                               "to open that sheet?" % resp.status)
        text = resp.text()
        if text.lstrip().lower().startswith("<!doctype html"):
            raise RuntimeError("Google returned a login page instead of CSV. "
                               "Run --setup and sign in first.")
        return text

    def send(self, to, subject, body, dry_run=True):
        """Composes one email. dry_run leaves it in Drafts instead of sending."""
        self._first("compose_button").click()

        self._first("to").type(to, delay=18)
        self._first("subject").type(subject, delay=12)

        body_el = self._first("body")
        body_el.click()
        body_el.type(body, delay=6)

        self.page.wait_for_timeout(700)

        if dry_run:
            self.page.keyboard.press("Control+s")       # save draft
            self.page.wait_for_timeout(600)
            self.page.keyboard.press("Escape")
            return "draft"

        self._first("send_button").click()
        self.page.wait_for_timeout(1800)
        return "sent"
