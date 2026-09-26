#!/usr/bin/env bash
# Turn on automatic updates (macOS / Linux).
# Schedules update.sh to run every hour in the background. The extension then
# notices the new version on disk and reloads itself within a minute, so the
# whole chain is hands-off. Run once; it survives restarts and logout.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.reddit-lead-threads.update"
# manifest.json now carries a fixed "key", so the extension's id is the same
# every time it is loaded — same folder, a different folder, removed and
# reloaded ten times, a different machine entirely. That id never has to be
# copied from chrome://extensions again.
DEFAULT_EXT_ID="fkaifecebaffgdnldpeghgekinfilkee"
# Arguments, in any order: a number = seconds between background updates
# (default 120); a 32-letter word = an extension id, only needed if you are
# deliberately pointing this at a different build.
INTERVAL=120; EXT_ID="$DEFAULT_EXT_ID"
for a in "$@"; do
  case "$a" in
    [0-9]*) INTERVAL="$a" ;;
    [a-p]*) EXT_ID="$a" ;;
  esac
done

HOST="com.redditleadthreads.updater"
chmod +x "$HERE/native-host.sh" 2>/dev/null || true
# Every Chromium-based browser keeps its own NativeMessagingHosts folder, so
# the host is registered with each of them — whichever one is actually
# running this extension will find it. A missing folder is skipped silently.
for DIR in "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" \
           "$HOME/Library/Application Support/Google/Chrome Beta/NativeMessagingHosts" \
           "$HOME/Library/Application Support/Chromium/NativeMessagingHosts" \
           "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts" \
           "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts" \
           "$HOME/Library/Application Support/Arc/User Data/NativeMessagingHosts" \
           "$HOME/Library/Application Support/Vivaldi/NativeMessagingHosts" \
           "$HOME/Library/Application Support/com.operasoftware.Opera/NativeMessagingHosts" \
           "$HOME/.config/google-chrome/NativeMessagingHosts" \
           "$HOME/.config/google-chrome-beta/NativeMessagingHosts" \
           "$HOME/.config/chromium/NativeMessagingHosts" \
           "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts" \
           "$HOME/.config/microsoft-edge/NativeMessagingHosts" \
           "$HOME/.config/vivaldi/NativeMessagingHosts" \
           "$HOME/.config/opera/NativeMessagingHosts"; do
  case "$DIR" in "$HOME/Library/"*) [ "$(uname)" = "Darwin" ] || continue ;; *) [ "$(uname)" = "Darwin" ] && continue ;; esac
  mkdir -p "$DIR" 2>/dev/null || continue
  cat > "$DIR/$HOST.json" <<EOF
{
  "name": "$HOST",
  "description": "Reddit Lead Threads: runs update.sh for the Update now button",
  "path": "$HERE/native-host.sh",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF
done
echo "Update now button connected for extension $EXT_ID (registered with every browser found on this machine)."

if [ "$(uname)" = "Darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$HERE/update.sh</string></array>
  <key>StartInterval</key><integer>$INTERVAL</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HERE/autoupdate.log</string>
  <key>StandardErrorPath</key><string>$HERE/autoupdate.log</string>
</dict></plist>
EOF
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  echo "Automatic updates ON (every $INTERVAL seconds)."
  echo "Log: $HERE/autoupdate.log"
  echo "Turn off with: ./autoupdate-uninstall.sh"
else
  MIN=$(( INTERVAL / 60 )); [ "$MIN" -lt 1 ] && MIN=1
  LINE="*/$MIN * * * * /bin/bash $HERE/update.sh >> $HERE/autoupdate.log 2>&1"
  ( crontab -l 2>/dev/null | grep -v "$HERE/update.sh" ; echo "$LINE" ) | crontab -
  echo "Automatic updates ON (every $MIN minutes via cron). Log: $HERE/autoupdate.log"
fi
