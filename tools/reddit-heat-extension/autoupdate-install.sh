#!/usr/bin/env bash
# Turn on automatic updates (macOS / Linux).
# Schedules update.sh to run every hour in the background. The extension then
# notices the new version on disk and reloads itself within a minute, so the
# whole chain is hands-off. Run once; it survives restarts and logout.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.reddit-lead-threads.update"
# Arguments, in any order: a number = seconds between background updates
# (default 120); a 32-letter word = the extension's id from chrome://extensions,
# which registers the "Update now" button's native host for that extension.
INTERVAL=120; EXT_ID=""
for a in "$@"; do
  case "$a" in
    [0-9]*) INTERVAL="$a" ;;
    [a-p]*) EXT_ID="$a" ;;
  esac
done

if [ -n "$EXT_ID" ]; then
  HOST="com.redditleadthreads.updater"
  chmod +x "$HERE/native-host.sh" 2>/dev/null || true
  for DIR in "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" \
             "$HOME/Library/Application Support/Chromium/NativeMessagingHosts" \
             "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts" \
             "$HOME/.config/google-chrome/NativeMessagingHosts" \
             "$HOME/.config/chromium/NativeMessagingHosts"; do
    case "$DIR" in "$HOME/Library/"*) [ "$(uname)" = "Darwin" ] || continue ;; *) [ "$(uname)" = "Darwin" ] && continue ;; esac
    mkdir -p "$DIR"
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
  echo "Update now button connected for extension $EXT_ID."
fi

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
