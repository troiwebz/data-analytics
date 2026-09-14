# Updating without copy-paste

## Extension — updates itself from the repo folder

Unpacked extensions run straight from the folder on disk, so an update is
just new files landing in that folder. The extension checks its own
`manifest.json` every 2 minutes and reloads itself when the version on disk
differs from the one running. Settings and the local lead database live in
`chrome.storage`, so a reload loses nothing.

### One-time setup on the machine that runs Chrome

**Easiest — GitHub Desktop (no terminal):**
1. Install GitHub Desktop, sign in, **Clone repository** → `troiwebz/data-analytics`.
2. In the clone, switch to branch `claude/wizardly-brahmagupta-178bgm` (or `main` once merged).
3. `chrome://extensions` → Load unpacked → the clone's `chrome-extension/` folder.
4. To update: open GitHub Desktop → **Fetch origin** → **Pull**. Done — the
   extension reloads within 2 minutes.

**Update immediately, any time:**
```bash
bash ~/haf-watcher/tools/update.sh
```
Then press **Update now** on the dashboard (or wait up to a minute). The
dashboard also shows that command as a click-to-copy button.

**Zero-click — scheduled pull (terminal, once):**
```bash
git clone https://github.com/troiwebz/data-analytics.git ~/haf-watcher
bash ~/haf-watcher/tools/install-autoupdate-mac.sh
```
This registers a user launchd job that runs `tools/update.sh` (a fast-forward
`git pull`) every 5 minutes. Load the extension from `~/haf-watcher/chrome-extension`.
Private repo: git will ask for a username and a token the first time.

## Apps Script — kept stable on purpose

The Apps Script side is a relay: Sheet + Telegram + button callbacks. The
extension can send it a pre-rendered card (`lead.card`) and its own lint
result (`lead.lint`), so changes to what you see on the phone no longer need
a script change. When a script update is genuinely needed, it is one paste
of `apps-script/single-file/Code.gs` plus **Deploy → Manage deployments →
✏️ → New version**. Secrets live in Script Properties and are never touched.
