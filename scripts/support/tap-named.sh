#!/bin/bash
# Tap a view by its text or content-desc, resolved from a fresh uiautomator dump.
#
# The coordinate rule in CLAUDE.md: never tap a remembered pixel. This resolves the target at the
# moment of tapping and REFUSES on 0 matches or >1 matches, which is `__probe.one()`'s discipline
# — a tap that lands on "whichever of two things came first in the dump" is a coordinate guess
# wearing a name.
#
# Usage: tap-named.sh "Advanced" [--dry]
set -uo pipefail
needle="$1"; dry="${2:-}"
T=$(cd "$(dirname "$0")/../.." && scripts/target-device.sh 2>/dev/null) || { echo "FAIL no target"; exit 2; }
adb -s "$T" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
dump=$(adb -s "$T" shell cat /sdcard/ui.xml 2>/dev/null)
matches=$(printf '%s' "$dump" | tr '<' '\n' | grep -E "(text|content-desc)=\"$needle\"" | grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"')
n=$(printf '%s' "$matches" | grep -c 'bounds' )
if [ "$n" -eq 0 ]; then echo "FAIL  no node with text/desc exactly \"$needle\" — refusing to guess"; exit 1; fi
if [ "$n" -gt 1 ]; then echo "FAIL  $n nodes match \"$needle\" — ambiguous, refusing to tap"; printf '%s\n' "$matches"; exit 1; fi
read -r x1 y1 x2 y2 < <(printf '%s' "$matches" | grep -oE '[0-9]+' | paste -sd' ' -)
cx=$(( (x1 + x2) / 2 )); cy=$(( (y1 + y2) / 2 ))
echo "OK    \"$needle\" at [$x1,$y1][$x2,$y2] → tap ($cx,$cy)"
[ "$dry" = "--dry" ] && exit 0
adb -s "$T" shell input tap "$cx" "$cy"
