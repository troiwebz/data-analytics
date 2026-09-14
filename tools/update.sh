#!/bin/bash
# Pull the latest HAF Watcher code. The extension notices the new manifest on
# disk within 2 minutes and reloads itself; Apps Script updates via /update.
# Run by launchd every 5 minutes (see install-autoupdate-mac.sh) or by hand.
set -e
cd "$(dirname "$0")/.."
git fetch -q origin
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$(git rev-parse HEAD)" != "$(git rev-parse "origin/$BRANCH")" ]; then
  git pull -q --ff-only origin "$BRANCH"
  echo "$(date '+%F %T') updated to $(git rev-parse --short HEAD)"
fi
