#!/usr/bin/env bash
# Turn on automatic updates (macOS / Linux).
# Schedules update.sh to run every hour in the background. The extension then
# notices the new version on disk and reloads itself within a minute, so the
# whole chain is hands-off. Run once; it survives restarts and logout.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.reddit-lead-threads.update"
INTERVAL="${1:-3600}"   # seconds; pass e.g. 1800 for every 30 minutes

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
  echo "Automatic updates ON (every $((INTERVAL/60)) minutes)."
  echo "Log: $HERE/autoupdate.log"
  echo "Turn off with: ./autoupdate-uninstall.sh"
else
  LINE="0 * * * * /bin/bash $HERE/update.sh >> $HERE/autoupdate.log 2>&1"
  ( crontab -l 2>/dev/null | grep -v "$HERE/update.sh" ; echo "$LINE" ) | crontab -
  echo "Automatic updates ON (hourly via cron). Log: $HERE/autoupdate.log"
fi
