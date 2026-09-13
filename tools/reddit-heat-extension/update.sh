#!/usr/bin/env bash
# Reddit Lead Threads - one-command updater (Mac/Linux, no Git needed).
# Downloads the latest extension files from GitHub into THIS folder.
# The extension notices the new version and reloads itself within a minute.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
echo "Downloading latest version..."
curl -sSL "https://github.com/troiwebz/data-analytics/archive/refs/heads/claude/brave-fermat-6ysqd0.zip" -o "$TMP/rlt.zip"
unzip -q "$TMP/rlt.zip" -d "$TMP"
SRC="$(find "$TMP" -type d -name reddit-heat-extension | head -1)"
[ -n "$SRC" ] || { echo "extension folder not found in download"; exit 1; }
cp -R "$SRC"/. "$HERE"/
rm -rf "$TMP"
V="$(grep -o '"version": *"[^"]*"' "$HERE/manifest.json" | head -1 | cut -d'"' -f4)"
echo "Updated to v$V. The extension reloads itself within a minute (or click Reload code)."
