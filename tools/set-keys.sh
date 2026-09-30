#!/bin/bash
# Put your Anthropic key, Telegram bot token and chat id into HAF Watcher from
# Terminal. Typed keys are hidden. Leave any one empty to keep what is there.
#
#   bash ~/haf-watcher/tools/set-keys.sh
#
# Writes haf-keys.json (readable by you only) into every folder Chrome loads
# HAF Watcher from. The extension loads it within a minute and says so on
# Telegram and on the dashboard's key line. The file is git-ignored and the
# updaters never ship or overwrite it.
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"

DIRS=$(python3 - <<'PYX'
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
[ -z "$DIRS" ] && DIRS="$REPO/chrome-extension"
echo "HAF Watcher is loaded from:"; echo "$DIRS" | sed 's/^/  /'; echo

printf "Anthropic API key (sk-ant-..., hidden, Enter to keep): "; read -rs AK; echo
printf "Telegram bot token (123456:ABC..., hidden, Enter to keep): "; read -rs TT; echo
printf "Telegram chat id (digits, Enter to keep): "; read -r CI

if [ -n "$AK" ] && [[ "$AK" != sk-ant-* ]]; then echo "That Anthropic key does not start with sk-ant- - nothing written."; exit 1; fi
if [ -n "$TT" ] && ! [[ "$TT" =~ ^[0-9]+:[A-Za-z0-9_-]{20,}$ ]]; then echo "That bot token does not look like 123456:ABC... - nothing written."; exit 1; fi
if [ -n "$CI" ] && ! [[ "$CI" =~ ^-?[0-9]{4,}$ ]]; then echo "The chat id should be digits only - nothing written."; exit 1; fi
if [ -z "$AK$TT$CI" ]; then echo "Nothing entered - nothing changed."; exit 0; fi

echo "$DIRS" | while IFS= read -r dir; do
  [ -z "$dir" ] && continue
  AK="$AK" TT="$TT" CI="$CI" OUT="$dir/haf-keys.json" python3 - <<'PYX'
import json, os, time
out = os.environ['OUT']
try: d = json.load(open(out))
except Exception: d = {}
for k, env in (('anthropicKey', 'AK'), ('telegramToken', 'TT'), ('telegramChatId', 'CI')):
    if os.environ.get(env): d[k] = os.environ[env]
d['writtenAt'] = time.strftime('%Y-%m-%dT%H:%M:%S')
old = os.umask(0o077)
with open(out, 'w') as f: json.dump(d, f, indent=2)
os.umask(old); os.chmod(out, 0o600)
PYX
  echo "Written: $dir/haf-keys.json"
done
echo
echo "HAF Watcher loads them within a minute - watch for '🔑 Loaded from Terminal' on Telegram,"
echo "or the 🔑 line on the dashboard. Then send the bot: test claude"
