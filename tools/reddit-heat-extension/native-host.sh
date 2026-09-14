#!/usr/bin/env bash
# Native messaging host for the extension's "Update now" button.
# Chrome starts this script and talks to it over stdin/stdout: every message is
# a 4-byte little-endian length followed by JSON. We accept {"cmd":"update"} or
# {"cmd":"status"} and stream back {"line":"..."} messages, then {"done":true}.
# stdout is the protocol channel, so nothing else may print to it. Framing is
# done with perl (present on every Mac) because macOS ships bash 3.2, which
# cannot emit NUL bytes from printf.
# Running update.sh overwrites THIS file while bash is still reading it, which
# kills the host mid-run. So the first thing we do is run from a throwaway copy.
if [ "$RLT_HOST_SELF" != "1" ]; then
  export RLT_HOST_SELF=1
  export RLT_HOST_HOME="$(cd "$(dirname "$0")" && pwd)"
  SELF="$(mktemp "${TMPDIR:-/tmp}/rlt-host.XXXXXX")"
  cat "$0" > "$SELF"
  bash "$SELF" "$@"; CODE=$?
  rm -f "$SELF"
  exit $CODE
fi
HERE="${RLT_HOST_HOME:-$(cd "$(dirname "$0")" && pwd)}"
export LC_ALL=C
exec 2>>"$HERE/native-host.log"
echo "--- $(date '+%Y-%m-%d %H:%M:%S') host started (bash $BASH_VERSION)" >&2

esc() { printf '%s' "$1" | tr '\t' ' ' | tr -d '\000-\010\013-\037' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
send() { perl -e 'use bytes; binmode STDOUT; my $m = $ARGV[0]; print pack("V", length $m), $m;' -- "$1"; }
line() { send "{\"line\":\"$(esc "$1")\"}"; }

# read one request: exact 4 bytes (sysread, unbuffered), then that many bytes
LEN=$(perl -e 'my $b; sysread(STDIN, $b, 4) == 4 or exit 1; print unpack("V", $b);')
[ -n "$LEN" ] || { echo "no request length" >&2; exit 0; }
REQ=$(head -c "$LEN")
CMD=$(printf '%s' "$REQ" | grep -o '"cmd" *: *"[a-z]*"' | grep -o '[a-z]*"$' | tr -d '"')
echo "cmd=$CMD" >&2

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

send "{\"error\":\"unknown command: $(esc "$CMD")\"}"
