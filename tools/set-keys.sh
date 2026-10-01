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

printf "Anthropic API key (sk-ant-..., hidden, Enter to keep): "; read -rs AK_IN; echo
printf "Telegram bot token (paste anything containing it, hidden, Enter to keep): "; read -rs TT_IN; echo
printf "Telegram chat id (digits, Enter to keep): "; read -r CI_IN

# Take the key out of whatever was pasted - spaces, quotes, a line break, or
# BotFather's whole sentence around the token - rather than refusing it.
AK=$(printf '%s' "$AK_IN" | grep -oE 'sk-ant-[A-Za-z0-9_-]{20,}' | head -1 || true)
# A key pasted twice comes out glued together; keep the first copy only.
AK=$(printf '%s' "$AK" | awk '{ i = index(substr($0, 8), "sk-ant-"); print (i > 0) ? substr($0, 1, i + 6) : $0 }')
TT=$(printf '%s' "$TT_IN" | grep -oE '[0-9]{6,}:[A-Za-z0-9_-]{30,}' | head -1 || true)
CI=$(printf '%s' "$CI_IN" | grep -oE '^-?[0-9]{4,}' | head -1 || true)
mask() { local v="$1"; [ ${#v} -gt 12 ] && echo "${v:0:8}…${v: -4}" || echo "$v"; }

echo
[ -n "$AK_IN" ] && { [ -n "$AK" ] && echo "  Claude key : $(mask "$AK")  ✓" || echo "  Claude key : not found in what you pasted - skipped (the saved one stays)"; }
[ -n "$TT_IN" ] && { [ -n "$TT" ] && echo "  Bot token  : $(mask "$TT")  ✓" || echo "  Bot token  : not found in what you pasted - skipped (the saved one stays)"; }
[ -n "$CI_IN" ] && { [ -n "$CI" ] && echo "  Chat id    : $CI  ✓" || echo "  Chat id    : should be digits only - skipped (the saved one stays)"; }
if [ -z "$AK$TT$CI" ]; then echo "  Nothing new to save - what is already in HAF Watcher stays as it is."; exit 0; fi
echo

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
