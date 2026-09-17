# Keeping it running on the Windows VPS

The goal: you tap a button on your phone, and the reply goes up — with your
desktop closed, your laptop shut, and nobody logged in to the server.

Nothing in the extension needs changing for that. What breaks it is Windows.

## How it actually works

There is no server component. Telegram never connects to your VPS — it can't,
the VPS has no public address. The arrow points the other way:

```
  phone            Telegram                 VPS
  ─────            ────────                 ───
  tap  ──────────▶ queued (kept 24h)
                        ▲
                        │  Chrome asks "any taps?" every 30s
                        └──────────────────  chrome.alarms wakes the worker
                                             → opens BHW in a tab
                                             → types and submits
                                             → edits the message on your phone
```

So exactly one thing has to be true: **Chrome is running on the VPS.** Not
visible, not focused — running. Everything below is about making that true
without you watching it.

A useful consequence: if Chrome is *not* running, your tap is not lost. Telegram
holds it for 24 hours and the poller picks it up when Chrome next starts
(`chrome.runtime.onStartup` re-arms the alarms). Tap at midnight, boot at 8am,
it posts at 8am. See the caveat at the bottom.

## The checklist

### 1. Disconnect. Never sign out.

This is the one that most likely caused the silence.

- **Closing the RDP window** (the X, or `mstsc` disconnect) leaves the Windows
  session running. Chrome keeps polling. This is what you want.
- **Start → your name → Sign out** ends the session and kills Chrome with it.
  Never do this.

If you're unsure which happened, `query session` at a command prompt shows the
session as `Disc` (good) or absent (signed out).

### 2. Let Chrome live without a window

`chrome://settings/system` → turn **on**:

> Continue running background apps when Google Chrome is closed

Without this, closing the last Chrome window quits Chrome entirely on Windows —
extension and all.

### 3. Stop Chrome throttling itself

`chrome://settings/performance`:

- **Memory Saver — off.** It discards background tabs, including a BHW tab
  mid-post.
- **Energy Saver — off.**

### 4. Stop Windows sleeping

At an **admin** command prompt:

```
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 0
```

Zero means never. Confirm with `powercfg /query` if you like.

### 5. Survive a reboot by itself

Windows Update will reboot the box eventually, and a reboot means nobody is
logged in, which means no Chrome. Two pieces fix that:

**Autologon.** Use Sysinternals Autologon
(<https://learn.microsoft.com/sysinternals/downloads/autologon>), not the
registry `DefaultPassword` key — Autologon stores the password as an LSA secret
instead of in plaintext where anyone with registry access can read it. It is
still a real tradeoff: a machine that logs itself in is a machine that is
unlocked after every reboot. Only do this on a VPS whose RDP is locked down to
your own IP, with a long password and a non-default port.

**A task that starts Chrome at logon.** Task Scheduler → Create Task:

- **General** → *Run only when user is logged on* (it needs an interactive
  desktop — do not choose "whether user is logged on or not", Chrome cannot do
  anything useful in session 0).
- **Triggers** → New → *At log on*, your user. Add a 30-second delay so the
  desktop is ready.
- **Actions** → Start a program → `C:\Program Files\Google\Chrome\Application\chrome.exe`
- **Conditions** → untick *Start the task only if the computer is on AC power*.
- **Settings** → untick *Stop the task if it runs longer than…*

Don't pass `--user-data-dir`: Chrome must open the **same profile** that holds
your settings vault and your BHW login.

Also set Windows Update **active hours** so reboots land at a predictable time.

### 6. Check the extension came back up

Unpacked extensions need developer mode, and Chrome shows a bubble after some
restarts offering to disable developer-mode extensions. If that ever gets
accepted, HAF Watcher is switched off and everything goes quiet.

After any reboot, glance at `chrome://extensions` and confirm HAF Watcher is
still enabled.

### 7. Keep your desktop Chrome closed

Two installs polling the same bot means whichever asks first consumes the tap
and the other never sees it. That failure looks identical to everything else in
this document, so don't create it. One machine polls, and it's the VPS.

## Proving it works

On the VPS, dashboard → **Settings → 🧪 Test everything**. The line to read:

```
✓ The tap checker last ran 12s ago (nothing waiting).
```

That is the only line that distinguishes *running* from *scheduled but dead* —
`chrome.alarms.get()` reads the same either way, which is why this exists.

Then the real test, and the one that matters:

1. Tap **Post DM Now** on a lead from your phone.
2. Disconnect RDP. Close your desktop Chrome. Walk away.
3. Come back and check the log at the bottom of the dashboard.

The log now records the tap **as it arrives**, before the tab opens:

```
Telegram tap: d on "..." - starting
```

| What you see | What it means |
|---|---|
| Line present, DM sent | Working. |
| Line present, tab opened, nothing sent | Not logged in to BHW on the VPS. Sign in there once. |
| Line present, tab never opened | Something is blocking `chrome.tabs.create`. |
| No line at all | The tap never reached Chrome — read the heartbeat line above. |

## If the tab opens but never fills

A disconnected RDP session has no composited desktop, and a few things that
depend on one misbehave. If you see the BHW tab open and just sit there, keep
the session interactive by redirecting it to the console after connecting:

```
tscon %SESSIONNAME% /dest:console
```

That disconnects your RDP view but leaves the session active rather than
merely disconnected. Only reach for this if you actually see that symptom —
it is not needed for normal polling.

## The caveat on delayed taps

A tap collected hours late is currently posted **blind**. Nothing re-reads the
thread first, so a reply written at midnight can go up at 8am to a thread that
has moved on, or that six other people have already answered.

That is a sharp edge, not a feature. If you start leaving the VPS off
overnight and relying on the queue, say so and it's worth adding a staleness
check before this bites you.
