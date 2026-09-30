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
  echo "$(date '+%F %T')  repo already up to date ($before on $branch)"
else
  git pull -q --ff-only origin "$branch"
  echo "$(date '+%F %T')  repo updated $before -> $(git rev-parse --short HEAD)"
fi

# Chrome may be running the extension from another folder (a zip unzipped into
# Downloads, say). Find every folder Chrome loads HAF Watcher from and bring it
# up to this version too - keys file and all your own files are left alone.
SRC="$(pwd)/chrome-extension"
version=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$SRC/manifest.json" | head -1)
LOADED=$(python3 - <<'PYX'
import json, glob, os
seen = set()
for p in glob.glob(os.path.expanduser('~/Library/Application Support/Google/Chrome/*/Secure Preferences')):
    try: e = json.load(open(p)).get('extensions', {}).get('settings', {}).get('ecbaioaldmoknfledmopnpfegkeljnkd')
    except Exception: continue
    path = (e or {}).get('path', '')
    if path.startswith('/') and os.path.isdir(path) and path not in seen:
        seen.add(path); print(path)
PYX
)
if [ -z "$LOADED" ]; then
  echo "Chrome does not have HAF Watcher loaded from any folder yet - load: $SRC"
fi
echo "$LOADED" | while IFS= read -r dir; do
  [ -z "$dir" ] && continue
  if [ "$(cd "$dir" && pwd -P)" = "$(cd "$SRC" && pwd -P)" ]; then
    echo "Chrome loads $dir - v$version"
    continue
  fi
  was=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$dir/manifest.json" 2>/dev/null | head -1)
  if [ "$was" = "$version" ]; then echo "Chrome loads $dir - already v$version"; continue; fi
  # everything first, manifest.json last, so Chrome reloads once it is all there
  rsync -a --exclude .git --exclude node_modules --exclude test --exclude docs --exclude package.json \
        --exclude package-lock.json --exclude .DS_Store --exclude haf-secrets.json --exclude haf-keys.json --exclude manifest.json "$SRC/" "$dir/"
  cp "$SRC/manifest.json" "$dir/manifest.json"
  echo "Chrome loads $dir - updated v$was -> v$version. It reloads itself within a minute."
done
