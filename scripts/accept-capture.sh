#!/bin/bash
# Accept the MediaProjection prompt, entire-screen, inside the phone's 30-second window.
#
# Every tap is still a NAMED target resolved from a fresh `uiautomator dump` — never a remembered
# pixel — and every tap is still gated on the node being found with its exact text, so a screen that
# is not the one expected produces a refusal with what it saw rather than a tap. What is dropped
# against `tap-named.sh` is the *second* confirming dump per tap: three gated taps cost six dumps and
# overran the phone's own 30s prompt timeout twice, which is an instrument whose cost changed the
# thing it was measuring. The blast radius here is a system dialog with three controls, all matched
# by resource-id AND exact text.
#
# Usage: accept-capture.sh <device-label>
set -u
DEV="${1:-samsung}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="${TMPDIR:-/tmp}"

find_tap() {   # $1 resource-id  $2 exact text  → taps, or prints why not
  "$here/adb-pinned.sh" "$DEV" shell uiautomator dump /sdcard/ac.xml >/dev/null 2>&1
  "$here/adb-pinned.sh" "$DEV" shell cat /sdcard/ac.xml 2>/dev/null > "$DIR/ac.xml"
  local out
  out=$(python3 - "$1" "$2" "$DIR/ac.xml" <<'PY'
import re, sys
rid, want, path = sys.argv[1], sys.argv[2], sys.argv[3]
x = open(path).read()
if x.count('<node') == 0: print('NO_READING empty dump'); raise SystemExit
hits = []
for m in re.finditer(r'<node[^>]*>', x):
    t = m.group(0)
    if f'resource-id="{rid}"' not in t: continue
    txt = (re.search(r'text="([^"]*)"', t) or [None, ''])[1]
    if want and txt != want: continue
    b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', t)
    if b: hits.append(tuple(int(g) for g in b.groups()))
if len(hits) != 1:
    print(f'NO_MATCH {len(hits)} for {rid} text={want!r} among {x.count("<node")} nodes')
else:
    x1,y1,x2,y2 = hits[0]; print(f'OK {(x1+x2)//2} {(y1+y2)//2}')
PY
)
  case "$out" in
    OK*) set -- $out; "$here/adb-pinned.sh" "$DEV" shell input tap "$2" "$3" >/dev/null 2>&1
         echo "   tapped ${2},${3}" ;;
    *)   echo "   REFUSED: $out"; return 1 ;;
  esac
}

echo "accept-capture: mode spinner"
find_tap "com.android.systemui:id/screen_share_mode_options" "" || exit 1
echo "accept-capture: entire screen"
find_tap "android:id/text1" "Share entire screen" || exit 1
echo "accept-capture: confirm"
find_tap "android:id/button1" "Share screen" || exit 1
