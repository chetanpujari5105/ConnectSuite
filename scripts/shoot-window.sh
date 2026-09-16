#!/bin/bash
# Screenshot a window by NAME, only when its bounds are a real reading and have stopped moving.
#
# Two gates, and the second exists because the first one alone was not one. A first version compared
# two `osascript` reads for equality and captured when they matched — and matched **two identical
# error strings** when the window had closed, then captured a region of somebody's desktop and
# reported success. Equality is not validity: a gate has to check that the reading is a reading
# before it checks that it is stable. `CLAUDE.md`'s own rule, in the instrument this time.
#
# Usage: shoot-window.sh <window-name> <out.png>
set -u
NAME="$1"; OUT="$2"
bounds() {
  osascript -e "tell application \"System Events\" to tell (first process whose name contains \"Electron\") to get {position, size} of (first window whose name is \"$NAME\")" 2>/dev/null
}
looks_like_bounds() { [[ "$1" =~ ^-?[0-9]+,\ -?[0-9]+,\ [0-9]+,\ [0-9]+$ ]]; }

for attempt in 1 2 3 4 5; do
  a="$(bounds)"; sleep 0.4; b="$(bounds)"
  if ! looks_like_bounds "$a"; then echo "  attempt $attempt: no reading — window '$NAME' not found"; sleep 1; continue; fi
  if [ "$a" != "$b" ]; then echo "  attempt $attempt: moved ($a → $b)"; continue; fi
  echo "  stable at $a"
  screencapture -x -R"$(echo "$a" | awk -F', ' '{printf "%d,%d,%d,%d", $1-10, $2-10, $3+20, $4+20}')" "$OUT" && echo "  captured $OUT"
  exit 0
done
echo "REFUSED: never got a stable reading of '$NAME'. No file written."
exit 1
