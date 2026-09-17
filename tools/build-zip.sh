#!/bin/bash
# Package the extension for loading somewhere else (a VPS, another Mac).
#
#   bash tools/build-zip.sh
#
# Runtime files only: no tests, no node_modules, no git history. Load the
# unzipped folder with chrome://extensions -> Developer mode -> Load unpacked.
#
# By default it contains NO keys: the zip is something you copy over RDP, mail
# to yourself, or leave in Downloads, and a live key in it is a live key in all
# of those places.
#
#   bash tools/build-zip.sh --with-secrets
#
# includes chrome-extension/haf-secrets.json if you have one, so the unzipped
# folder sets itself up with no retyping. That zip IS a secret - treat it like
# the keys themselves and delete it once it is in place.
set -e
cd "$(dirname "$0")/.."

secrets=0
for arg in "$@"; do
  case "$arg" in
    --with-secrets) secrets=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

ver=$(grep -o '"version": *"[^"]*"' chrome-extension/manifest.json | head -1 | cut -d'"' -f4)
out="haf-watcher-$ver.zip"
rm -f "$out"

cd chrome-extension
exclude=(-x 'test/*' -x 'node_modules/*' -x 'package.json' -x 'package-lock.json'
         -x '.*' -x '*/.*' -x '*.zip')
if [ "$secrets" -eq 0 ]; then
  exclude+=(-x 'haf-secrets.json')
elif [ ! -f haf-secrets.json ]; then
  echo "--with-secrets asked for, but chrome-extension/haf-secrets.json does not exist." >&2
  echo "Make one with Settings -> \"Download haf-secrets.json\" and put it there first." >&2
  exit 1
fi
zip -qr "../$out" . "${exclude[@]}"
cd ..

echo "$out  $(du -h "$out" | cut -f1)"
unzip -l "$out" | tail -1
if [ "$secrets" -eq 1 ]; then
  echo "!! This zip contains your live keys. Do not share it; delete it once installed."
fi
