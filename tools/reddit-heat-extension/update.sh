#!/usr/bin/env bash
# Reddit Lead Threads - one-command updater (Mac/Linux, no Git needed).
# Downloads the latest extension files from GitHub into THIS folder and tells
# you exactly what you now have on disk.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
BEFORE="$(grep -o '"version": *"[^"]*"' "$HERE/manifest.json" 2>/dev/null | head -1 | cut -d'"' -f4 || true)"
echo "Folder:  $HERE"
echo "Now on:  v${BEFORE:-none}"
echo "Downloading latest version..."
# the ?t= and no-cache defeat GitHub's zip cache, which can serve a stale copy
curl -sSL -H 'Cache-Control: no-cache' -H 'Pragma: no-cache' \
  "https://codeload.github.com/troiwebz/data-analytics/zip/refs/heads/claude/brave-fermat-6ysqd0?t=$(date +%s)" -o "$TMP/rlt.zip"
unzip -q "$TMP/rlt.zip" -d "$TMP"
SRC="$(find "$TMP" -type d -name reddit-heat-extension | head -1)"
[ -n "$SRC" ] || { echo "extension folder not found in download"; exit 1; }
cp -R "$SRC"/. "$HERE"/
rm -rf "$TMP"
V="$(grep -o '"version": *"[^"]*"' "$HERE/manifest.json" | head -1 | cut -d'"' -f4)"
echo "Now on:  v$V"
if [ "$BEFORE" = "$V" ]; then
  echo "Same version as before - you already had the latest files."
else
  echo "Updated v${BEFORE:-none} -> v$V."
fi
echo
echo "Chrome keeps showing the OLD version number until the extension reloads."
echo "Go to chrome://extensions and click Reload on Reddit Lead Threads,"
echo "or wait a minute and it reloads itself."
