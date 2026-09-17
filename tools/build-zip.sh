#!/bin/bash
# Package the extension for loading somewhere else (a VPS, another Mac).
#
#   bash tools/build-zip.sh
#
# Runtime files only: no tests, no node_modules, no git history. Load the
# unzipped folder with chrome://extensions -> Developer mode -> Load unpacked.
#
# It contains NO keys and NO personal settings, on purpose. Carry those over
# with Settings -> "Download settings file" on the machine that already works,
# then "Restore from a file..." on the new one. That file is exact, where
# anything baked in here would be a guess.
set -e
cd "$(dirname "$0")/.."

ver=$(grep -o '"version": *"[^"]*"' chrome-extension/manifest.json | head -1 | cut -d'"' -f4)
out="haf-watcher-$ver.zip"
rm -f "$out"

cd chrome-extension
zip -qr "../$out" . \
  -x 'test/*' -x 'node_modules/*' -x 'package.json' -x 'package-lock.json' \
  -x '.*' -x '*/.*' -x '*.zip'
cd ..

echo "$out  $(du -h "$out" | cut -f1)"
unzip -l "$out" | tail -1
