#!/bin/bash
# Tap a node chosen by resource-id and text, never by a remembered pixel.
#
# `CLAUDE.md`: "Never drive the Mac UI or the phone by coordinates when a named target exists…
# prefer `adb shell input tap` driven from a `uiautomator dump` over a remembered pixel." And the
# gate rule beside it: a check that does not gate the action is decoration. So the screen is dumped
# twice — once to find the node, once immediately before the tap — and the tap happens only if the
# node is still there with the same bounds. If it moved, this refuses and says what it saw, because
# the next person debugging a silent no-op will delete a gate that does not explain itself.
#
# Usage: tap-named.sh <device-label> <resource-id> <expected-text>
set -u
DEV="$1"; RID="$2"; WANT="$3"
DIR="${TMPDIR:-/tmp}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

read_bounds() {
  "$here/adb-pinned.sh" "$DEV" shell uiautomator dump /sdcard/tap.xml >/dev/null 2>&1 || return 1
  "$here/adb-pinned.sh" "$DEV" shell cat /sdcard/tap.xml 2>/dev/null > "$DIR/tap.xml" || return 1
  python3 - "$RID" "$WANT" <<'PY'
import re, sys, os
rid, want = sys.argv[1], sys.argv[2]
x = open(os.environ.get('TMPDIR','/tmp') + '/tap.xml').read()
if x.count('<node') == 0:
    print('NO_READING the dump is empty'); raise SystemExit(0)
hits = []
for m in re.finditer(r'<node[^>]*>', x):
    t = m.group(0)
    if f'resource-id="{rid}"' not in t: continue
    txt = (re.search(r'text="([^"]*)"', t) or [None, ''])[1]
    if want and txt != want: continue
    b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', t)
    if b: hits.append(tuple(int(g) for g in b.groups()))
if len(hits) == 0: print(f'NO_MATCH {rid} text={want!r} among {x.count("<node")} nodes')
elif len(hits) > 1: print(f'AMBIGUOUS {len(hits)} nodes match {rid}')
else:
    x1,y1,x2,y2 = hits[0]
    print(f'OK {(x1+x2)//2} {(y1+y2)//2} {x1},{y1},{x2},{y2}')
PY
}

first="$(read_bounds)" || { echo "FAIL could not dump the screen"; exit 1; }
case "$first" in OK*) ;; *) echo "REFUSED before tapping: $first"; exit 1;; esac

second="$(read_bounds)"
if [ "$first" != "$second" ]; then
  echo "REFUSED: the screen moved between the two reads."
  echo "  first:  $first"
  echo "  second: $second"
  exit 1
fi

set -- $first
echo "tapping '$WANT' ($RID) at ${2},${3}  — bounds $4, confirmed twice"
"$here/adb-pinned.sh" "$DEV" shell input tap "$2" "$3" >/dev/null 2>&1 && echo "tapped"
