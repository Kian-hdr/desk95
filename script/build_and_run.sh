#!/bin/bash
set -euo pipefail
DESK95_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DESK95_ROOT"
DESK95_MODE="${1:-run}"
case "$DESK95_MODE" in run|--verify|--logs|--telemetry|--debug) ;; *) echo 'Usage: ./script/build_and_run.sh [--verify|--logs|--telemetry|--debug]' >&2;exit 2;; esac
# Ask Desk95 to quit through its save-aware native menu; never kill pending edits.
if /usr/bin/pgrep -x Desk95 >/dev/null; then
  echo 'Close Desk95 before rebuilding so any pending changes can finish saving.' >&2
  exit 1
fi
./script/build_macos.sh
DESK95_APP="$DESK95_ROOT/output/macos/Desk95.app"
case "$DESK95_MODE" in
 --debug) /usr/bin/lldb -- "$DESK95_APP/Contents/MacOS/Desk95" ;;
 --logs|--telemetry) /usr/bin/open "$DESK95_APP"; /usr/bin/log stream --info --style compact --predicate 'process == "Desk95"' ;;
 --verify) /usr/bin/open "$DESK95_APP"; for desk95_attempt in {1..30}; do if /usr/bin/pgrep -x Desk95 >/dev/null;then exit 0;fi;sleep .2;done;exit 1 ;;
 run) /usr/bin/open "$DESK95_APP" ;;
esac
