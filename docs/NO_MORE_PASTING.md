# One command, no pasting

After a five-minute setup, updating both halves is:

```bash
bash ~/haf-watcher/tools/update-all.sh
```

That pulls the newest code, pushes the Apps Script to Google, and updates the
live deployment. The extension reloads itself within a minute.

---

## One-time setup

### 1. Put the secrets in Script Properties

The deployed code is now built from the repo, so anything typed into the code
file would be overwritten on the next push. The four secrets move to Script
Properties, where a push never touches them.

Apps Script → ⚙️ **Project Settings** → **Script properties** → **Add script
property**, four times:

| Property | Value |
|---|---|
| `SHARED_SECRET` | `721c2a99-6557-4623-805e-576a3253597c` |
| `TELEGRAM_BOT_TOKEN` | *(the token from BotFather)* |
| `TELEGRAM_CHAT_ID` | `8812664414` |
| `TELEGRAM_WEBHOOK_SECRET` | `bebafdca-e622-4f2b-8382-f0402e3ab964` |

They are already in your current code file; copy each value across. The
Anthropic key is added from the extension's Settings and needs no entry here.

### 2. Allow the CLI to reach your project

Open <https://script.google.com/home/usersettings> and turn the **Google Apps
Script API** on.

### 3. Install the CLI and sign in

```bash
npm install -g @google/clasp
clasp login
```

`clasp login` opens a browser once. Nothing else needs a browser again.

### 4. Push

```bash
bash ~/haf-watcher/tools/update-all.sh
```

---

## What it does

`tools/build-apps-script.sh` concatenates `apps-script/*.gs` into
`apps-script/deploy/Code.gs`, so the deployed file can never drift from the
sources. `tools/push-apps-script.sh` runs that build, `clasp push`es it, and
points the existing deployment at the new version — the `/exec` URL and the
Telegram webhook stay exactly as they are.

`apps-script/single-file/Code.gs` is still generated as a fallback: if clasp
ever will not run, that file can be pasted by hand as before.

## If something goes wrong

**`clasp: command not found`** — `npm install -g @google/clasp`. On macOS a
permission error there means `sudo npm install -g @google/clasp`.

**`User has not enabled the Apps Script API`** — step 2 above.

**`Script API: Requested entity was not found`** — the script ID in
`apps-script/.clasp.json` does not match your project. It is the long string in
the project URL, between `/projects/` and `/edit`.

**Telegram stops replying after a push** — the Script Properties in step 1 are
missing or misspelled. Check ⚙️ Project Settings; the code falls back to
placeholder values when a property is absent.
