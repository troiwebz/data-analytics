#!/usr/bin/env bash
# Render hunt.html in an ordinary browser with a fake chrome.* and sample posts,
# so a layout change can be screenshotted before it ships.
#   bash dev/preview-hunt.sh      then open http://localhost:8765/hunt.html
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${TMPDIR:-/tmp}/rlt-hunt-preview"
rm -rf "$OUT"; mkdir -p "$OUT"
cp "$HERE/lib.js" "$HERE/hunt.js" "$HERE/hunt-simple.js" "$HERE/dev/mock-chrome.js" "$OUT/"
sed 's#<script src="lib.js"></script>#<script src="mock-chrome.js"></script>\n<script src="lib.js"></script>#' "$HERE/hunt.html" > "$OUT/hunt.html"
echo "Preview: http://localhost:8765/hunt.html  (Ctrl+C to stop)"
exec python3 -m http.server 8765 --bind 127.0.0.1 --directory "$OUT"
