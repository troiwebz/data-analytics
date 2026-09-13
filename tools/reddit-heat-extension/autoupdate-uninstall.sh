#!/usr/bin/env bash
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.reddit-lead-threads.update"
if [ "$(uname)" = "Darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
else
  crontab -l 2>/dev/null | grep -v "$HERE/update.sh" | crontab - || true
fi
echo "Automatic updates OFF. Run ./update.sh by hand when you want a new version."
