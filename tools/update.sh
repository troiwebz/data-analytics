#!/bin/bash
# Pull the latest HAF Watcher code into this clone.
#
#   bash ~/haf-watcher/tools/update.sh
#
# The extension checks the folder every minute and reloads itself when the
# manifest version changes; press "Update now" on the dashboard to skip the
# wait. Run by launchd every 5 minutes (see install-autoupdate-mac.sh).
set -e
cd "$(dirname "$0")/.."

before=$(git rev-parse --short HEAD)
branch=$(git rev-parse --abbrev-ref HEAD)
git fetch -q origin "$branch"

if [ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$branch")" ]; then
  echo "$(date '+%F %T')  already up to date ($before on $branch)"
  exit 0
fi

git pull -q --ff-only origin "$branch"
version=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' chrome-extension/manifest.json | head -1)
echo "$(date '+%F %T')  updated $before -> $(git rev-parse --short HEAD)  (extension v$version)"
echo "Chrome reloads it within a minute — or press \"Update now\" on the dashboard."
