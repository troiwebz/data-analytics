#!/usr/bin/env bash
# Native messaging host for the extension's "Update now" button.
# Chrome starts this script and talks to it over stdin/stdout: every message is
# a 4-byte little-endian length followed by JSON. We accept {"cmd":"update"} or
# {"cmd":"status"} and stream back {"line":"..."} messages, then {"done":true}.
# stdout is the protocol channel, so nothing else may print to it.
HERE="$(cd "$(dirname "$0")" && pwd)"
export LC_ALL=C

esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\t/ /g' | tr -d '\000-\010\013-\037'; }
send() {
  local msg="$1" len
  len=${#msg}
  printf "$(printf '\\x%02x\\x%02x\\x%02x\\x%02x' $((len & 255)) $(((len >> 8) & 255)) $(((len >> 16) & 255)) $(((len >> 24) & 255)))"
  printf '%s' "$msg"
}
line() { send "{\"line\":\"$(esc "$1")\"}"; }

# read one request
LEN=$(head -c 4 | od -An -tu4 | tr -d ' ')
[ -n "$LEN" ] || exit 0
REQ=$(head -c "$LEN")
CMD=$(printf '%s' "$REQ" | grep -o '"cmd" *: *"[a-z]*"' | grep -o '[a-z]*"$' | tr -d '"')

if [ "$CMD" = "status" ]; then
  if launchctl list 2>/dev/null | grep -q "com.reddit-lead-threads.update"; then SCHED="launchd: on"
  elif crontab -l 2>/dev/null | grep -q "$HERE/update.sh"; then SCHED="cron: on"
  else SCHED="off"; fi
  V=$(grep -o '"version": *"[^"]*"' "$HERE/manifest.json" | head -1 | cut -d'"' -f4)
  LAST=$(tail -n 3 "$HERE/autoupdate.log" 2>/dev/null | tr '\n' ' ' | cut -c1-300)
  send "{\"status\":true,\"scheduler\":\"$(esc "$SCHED")\",\"onDisk\":\"$(esc "$V")\",\"lastLog\":\"$(esc "$LAST")\",\"folder\":\"$(esc "$HERE")\"}"
  exit 0
fi

if [ "$CMD" = "update" ]; then
  line "starting update.sh in $HERE"
  bash "$HERE/update.sh" 2>&1 | while IFS= read -r l; do line "$l"; done
  CODE=${PIPESTATUS[0]}
  V=$(grep -o '"version": *"[^"]*"' "$HERE/manifest.json" | head -1 | cut -d'"' -f4)
  send "{\"done\":true,\"code\":$CODE,\"onDisk\":\"$(esc "$V")\"}"
  exit 0
fi

send "{\"error\":\"unknown command\"}"
