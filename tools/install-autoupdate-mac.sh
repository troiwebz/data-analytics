#!/bin/bash
# One-time: make this Mac pull the repo every 5 minutes, forever.
# Usage: bash tools/install-autoupdate-mac.sh
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.hafwatcher.update.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.hafwatcher.update</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$REPO/tools/update.sh</string></array>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/hafwatcher-update.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/hafwatcher-update.log</string>
</dict></plist>
PL
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Installed. The repo at $REPO now pulls every 5 minutes."
echo "Log: ~/Library/Logs/hafwatcher-update.log"
echo "Now load the extension from: $REPO/chrome-extension"
