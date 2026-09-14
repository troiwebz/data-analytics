# Co-founder hunt collector (24/7)

A small Node service that watches the co-founder subreddits around the clock and
hands the keepers to your extension. The queue is then already full when you
open the laptop, instead of starting from whatever the browser can read in the
minute you are looking at it.

It reads only. It never posts, never DMs, and never sees your Reddit password.
Replying and DMing still happen by hand, from your browser, as before.

## What you need

- Node 18 or newer (`node -v`), anywhere that stays on: a $5 VPS, Fly.io,
  Railway, a Raspberry Pi, or a Mac that never sleeps.
- A Reddit **installed app** client id (free, one minute):
  reddit.com/prefs/apps → *create another app* → type **installed app** →
  redirect `http://localhost` → copy the id under the app name. Without it the
  server falls back to public JSON, which Reddit throttles hard.
- A token you invent, e.g. `openssl rand -hex 24`. The extension sends it back.

## Run it

```bash
cd tools/reddit-heat-extension/server
HUNT_TOKEN=your-long-secret REDDIT_CLIENT_ID=your-installed-app-id node hunt-server.js
```

Check it: `curl localhost:8787/health` → `{"ok":true,"posts":…}`.

| Env | Default | What |
|---|---|---|
| `HUNT_TOKEN` | required | shared secret the extension sends back |
| `REDDIT_CLIENT_ID` | — | installed-app id; without it, slow public JSON |
| `PORT` | 8787 | |
| `POLL_SECONDS` | 60 | how often it reads a batch |
| `SUBS_PER_TICK` | 4 | subreddits per batch, plus one site-wide search |
| `KEEP_HOURS` | 72 | posts older than this are dropped |
| `SUBS` | built-in list | comma-separated override |
| `DATA_FILE` | ./hunt-data.json | where the posts are kept |

## Keep it running

**systemd (any Linux box)** — `/etc/systemd/system/cofounder-hunt.service`:

```ini
[Unit]
Description=Co-founder hunt collector
After=network-online.target

[Service]
WorkingDirectory=/opt/cofounder-hunt/server
Environment=HUNT_TOKEN=your-long-secret
Environment=REDDIT_CLIENT_ID=your-installed-app-id
ExecStart=/usr/bin/node hunt-server.js
Restart=always
RestartSec=10
User=hunt

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now cofounder-hunt
journalctl -u cofounder-hunt -f
```

**Docker / Fly.io / Railway** — the `Dockerfile` here is enough. Build it from the
extension folder, not from `server/`, so `lib.js` is in the context:

```bash
cd tools/reddit-heat-extension
docker build -f server/Dockerfile -t cofounder-hunt .
docker run -d --restart=always -p 8787:8787 -v hunt:/data \
  -e HUNT_TOKEN=your-long-secret -e REDDIT_CLIENT_ID=your-installed-app-id cofounder-hunt
```

On Fly.io:

```bash
fly launch --no-deploy
fly secrets set HUNT_TOKEN=your-long-secret REDDIT_CLIENT_ID=your-installed-app-id
fly deploy
```

**A Mac that stays on** — save as
`~/Library/LaunchAgents/com.cofounder-hunt.plist`, then
`launchctl load ~/Library/LaunchAgents/com.cofounder-hunt.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.cofounder-hunt</string>
  <key>ProgramArguments</key><array>
    <string>/usr/local/bin/node</string>
    <string>/Users/you/cofounder-hunt/server/hunt-server.js</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>HUNT_TOKEN</key><string>your-long-secret</string>
    <key>REDDIT_CLIENT_ID</key><string>your-installed-app-id</string>
  </dict>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/tmp/cofounder-hunt.log</string>
  <key>StandardErrorPath</key><string>/tmp/cofounder-hunt.log</string>
</dict></plist>
```

## Point the extension at it

Hunt page → **Your details** → **Collector server** (`https://your-host:8787`)
and **Server token** → **Save** → **Test server**. It should answer
*server alive · N posts held*.

From then on the extension pulls from the server and does no Reddit reading of
its own. If the server stops answering it falls back to the pinned
old.reddit.com tab automatically, so you are never stuck.

## Keep the token private

The token is the only thing standing between the internet and your queue. Put
the server behind HTTPS if it is on a public address — Fly and Railway give you
that for free; on a VPS, Caddy in front of it is two lines. `/health` is open on
purpose (so you can check it from anywhere); `/queue` needs the token.
