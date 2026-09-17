# Set the VPS up once, in order

Everything here happens **on the Windows VPS**, over RDP. Keep your Mac's
Chrome closed the whole time — two installs polling the same bot means
whichever asks first eats the tap and the other never sees it.

Work top to bottom. Each step says how you know it worked.

---

## 1. Install v0.76.0

Copy `haf-watcher-0.76.0.zip` to the VPS and unzip it **over** the existing
extension folder, replacing the files.

Then `chrome://extensions` → the **reload** arrow on HAF Watcher.

> **Check:** dashboard → Settings → 🧪 **Test everything**. Line one must say
> `✓ Running v0.76.0`. If it still says 0.71, the files did not land on top of
> the old ones — find the folder Chrome actually loaded (the path is shown on
> the extension's card at `chrome://extensions`) and unzip into that one.

Your settings are untouched by this. They live in Chrome's storage, not the
folder.

---

## 2. Get a Claude key in place

The key you pasted into chat is compromised and has to go. Anthropic never
shows an existing key twice, so there is nothing to recover — make a new one.

1. <https://console.anthropic.com> → API keys.
2. **Revoke** the old key (`sk-ant-api03-uphnuk…`).
3. **Create key** → copy it.
4. VPS → Settings → paste it in the Claude key box → **Save**.

> **Check:** Settings shows `✓ Key stored`. If it says *"Replies are being
> written from the built-in rules"*, it did not save.

Do this on the VPS, not the Mac. The VPS already has your Telegram side
working (`@troi_haf_bot`, chat `8812664414`), so once the Claude key is there,
the VPS is the machine with the complete setup — and step 3 captures it.

---

## 3. Make the seed file, so this is the last time

Still on the VPS:

1. Settings → **Download haf-secrets.json**. Confirm the warning.
2. Move that file from Downloads into the **extension folder**, next to
   `manifest.json`.
3. **Delete it from Downloads.**

> **Check:** Settings → the *Set it up once* panel says
> `✓ haf-secrets.json is in the folder — it carries the Claude key, the bot
> token, your chat id…`

From now on, that folder configures itself anywhere you copy it. No retyping,
on any future machine.

**This makes the folder a secret.** Anyone who has it has both keys. Don't mail
the zip, don't put it in shared storage. If it ever gets out: new Anthropic key
in the console, `/revoke` in BotFather, download a fresh `haf-secrets.json`.

---

## 4. Clear the phantom "already sent" flags

Dashboard → **Check my BHW messages** (press it once).

> **Check:** the message says something like *"N were marked sent by mistake
> and have been put back, with their PM slots refunded."*

That is the fix for PMs you never sent showing as duplicates — and for the PM
cap filling up on its own, which was the same bug spending your quota.

If it says *"Could not read your BHW username off the page"*, you are not
logged in to BlackHatWorld in this Chrome. Log in once and press it again.

---

## 5. Make Windows stop killing Chrome

This is what caused the silence, and none of it is the extension.

1. **`chrome://settings/system`** → turn **on** *Continue running background
   apps when Google Chrome is closed*.
2. **`chrome://settings/performance`** → **Memory Saver off**, **Energy Saver
   off**.
3. Admin command prompt:
   ```
   powercfg /change standby-timeout-ac 0
   powercfg /change hibernate-timeout-ac 0
   powercfg /change monitor-timeout-ac 0
   ```
4. **The habit that matters most:** when you leave, **close the RDP window**.
   Never *Start → your name → Sign out*. Disconnecting leaves Chrome running;
   signing out kills it.

Reboot recovery (autologon + a logon task that starts Chrome) is in
`docs/ALWAYS_ON.md` — worth doing, but it can wait until the above is proven.

---

## 6. Prove it end to end

1. Settings → 🧪 **Test everything**. Every line should be `✓`, including the
   new one: `✓ The tap checker last ran 12s ago`.
2. Tap the test button on your phone. The panel should confirm your taps reach
   Chrome.
3. Now the real one: on your phone, tap **Post DM Now** on a live lead.
4. Close the RDP window. Walk away.
5. Come back and read the log at the bottom of the dashboard.

What you should see, and what each means:

| In the log | Meaning |
|---|---|
| `Telegram tap: d on "…" - starting` then `DM sent → …` | Working. Done. |
| `starting`, tab opened, nothing sent | Not logged in to BHW on the VPS. Log in, retry. |
| `Might be a duplicate` | Working as designed — check your phone, there is a card with **Send anyway**. |
| `starting` and then nothing | Send me this. It means the job is stalling after the tap. |
| No line at all | Read the `tap checker last ran` line — Chrome was not running. |

---

## What changed underneath, in case something looks different

- **PM cap is 30**, not 8, and `0` in Settings means no cap. Your stored 8 is
  lifted automatically on reload.
- **Duplicate detection is stricter.** A PM counts as sent only if *you*
  started the conversation and its subject is that thread. A buyer messaging
  you no longer counts — that was the bug.
- **A possible duplicate asks you** on Telegram (Open conversation · Send
  anyway · Skip) instead of refusing flatly.
- **The worker is held awake** through a post, so a long job no longer dies
  halfway on an idle machine.
- **Telegram requests time out at 15s** and say so, instead of hanging silently.
