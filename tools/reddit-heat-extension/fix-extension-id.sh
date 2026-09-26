#!/usr/bin/env bash
# One-time fix for the "extension id keeps changing" problem.
#
# Run this ONE script, then do the 2 clicks it tells you to do. That's it,
# forever. What it does:
#   1. Moves this folder to one permanent spot (~/reddit-heat-extension) so
#      you never again have five half-updated copies in Downloads fighting
#      each other.
#   2. Downloads the latest files and turns automatic updates on there.
#   3. Opens chrome://extensions for you so you don't have to go find it.
# Chrome will not let a script remove or load an extension for you (that is
# a deliberate security wall) — that is the only part left to click.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET="$HOME/reddit-heat-extension"

if [ "$HERE" != "$TARGET" ]; then
  echo "Moving this to one permanent folder: $TARGET"
  echo "(so Downloads copies like ' 2', ' 7' etc. never cause a mismatch again)"
  rm -rf "$TARGET"
  cp -R "$HERE" "$TARGET"
  cd "$TARGET"
else
  cd "$HERE"
fi

chmod +x ./*.sh 2>/dev/null || true
./update.sh
./autoupdate-install.sh

echo
echo "=================================================================="
echo " ONE-TIME STEP LEFT (about 10 seconds):"
echo "   1. On the page that just opened, find 'Reddit Lead Threads"
echo "      (private)' and click its trash-can Remove icon."
echo "   2. Click 'Load unpacked' and choose this exact folder:"
echo "         $TARGET"
echo "   3. Check the address bar of the Growth Board — it should say"
echo "         chrome-extension://fkaifecebaffgdnldpeghgekinfilkee/..."
echo "=================================================================="
echo

if command -v open >/dev/null 2>&1; then
  open "chrome://extensions" 2>/dev/null || true
  open "$TARGET" 2>/dev/null || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "chrome://extensions" 2>/dev/null || true
fi
