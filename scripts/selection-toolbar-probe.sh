#!/usr/bin/env bash
# Does the platform's text-selection toolbar — the one that carries ACTION_PROCESS_TEXT items —
# appear in a given app?
#
# ## Why this is a script and not eleven ad-hoc runs
#
# The question "which of my apps can reach Send to Mac" is answered one app at a time, by hand, and
# it has to be re-answerable after any app updates. It also has three outcomes, not two, and the
# third is the one an ad-hoc run loses:
#
#   PLATFORM  — Cut/Copy/Paste present. The app uses the platform Editor; PROCESS_TEXT items exist.
#   CUSTOM    — a toolbar appeared without Cut/Copy/Paste. The app drew its own.
#   NO READING— no toolbar, or no text field found. **Not a negative.** The stimulus did not land.
#
# `uiautomator dump` CANNOT see the floating toolbar (measured, Slice 19), so the only instrument
# that works here is a screenshot, and the only reader is a person. This script therefore drives the
# stimulus and captures the frame; it does not classify. A script that guessed the verdict off a
# tree that structurally cannot contain the answer would be the decoration rule with a shell prompt.
#
# Usage: scripts/selection-toolbar-probe.sh <package> [outdir]
set -u
PKG="${1:?usage: selection-toolbar-probe.sh <package> [outdir]}"
OUT="${2:-/tmp/toolbar-probe}"
mkdir -p "$OUT"
D="$(scripts/target-device.sh)" || exit 1

adb -s "$D" shell input keyevent KEYCODE_HOME >/dev/null 2>&1; sleep 1
adb -s "$D" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 6

FOCUS="$(adb -s "$D" shell dumpsys window | grep mCurrentFocus | head -1)"
echo "focus: $FOCUS"
case "$FOCUS" in
  *BiometricPrompt*|*Keyguard*)
    echo "RESULT $PKG: NO READING — app is behind a biometric/lock prompt, which needs a human finger"
    exit 0;;
esac

# Find a text field from the tree. The tree CAN see EditTexts; it is only the floating toolbar it
# cannot see. Fail loudly rather than tapping a guessed coordinate.
adb -s "$D" shell uiautomator dump /sdcard/stp.xml >/dev/null 2>&1
adb -s "$D" shell cat /sdcard/stp.xml > "$OUT/$PKG.xml" 2>/dev/null
COORD="$(python3 - "$OUT/$PKG.xml" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
nodes = len(re.findall(r'<node ', s))
best = None
for m in re.finditer(r'<node[^>]*class="android.widget.EditText"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', s):
    x1, y1, x2, y2 = map(int, m.groups())
    if x2 - x1 > 200 and y2 - y1 > 40:
        # **Press near the LEFT edge, not the centre.** The first version pressed the centre of the
        # field, which on a short string is empty space past the end of the text — a long-press
        # there selects nothing and raises no toolbar, so the run held no reading and looked like a
        # refusal. Typed text starts at the left inset, so that is where the words are.
        # (No apostrophes in this block: it lives in a heredoc inside a command substitution.)
        best = ((x1 + 70, (y1 + y2) // 2), ((x1 + x2) // 2, (y1 + y2) // 2))
        break
print(f"{nodes} {best[0][0] if best else -1} {best[0][1] if best else -1} {best[1][0] if best else -1} {best[1][1] if best else -1}")
PY
)"
NODES="$(echo "$COORD" | cut -d' ' -f1)"; X="$(echo "$COORD" | cut -d' ' -f2)"; Y="$(echo "$COORD" | cut -d' ' -f3)"
TAPX="$(echo "$COORD" | cut -d' ' -f4)"; TAPY="$(echo "$COORD" | cut -d' ' -f5)"
echo "tree: $NODES nodes"   # the control: a tree of 0 nodes means the dump failed, not that the app is empty
if [ "$X" = "-1" ]; then
  echo "RESULT $PKG: NO READING — no EditText on the first screen. Open one by hand and re-run."
  exit 0
fi

adb -s "$D" shell input tap "$TAPX" "$TAPY" >/dev/null 2>&1; sleep 2
adb -s "$D" shell input text "selectionprobe" >/dev/null 2>&1; sleep 2
adb -s "$D" shell input swipe "$X" "$Y" "$X" "$Y" 900 >/dev/null 2>&1   # a real long-press
sleep 3
adb -s "$D" shell screencap -p /sdcard/stp.png >/dev/null 2>&1
adb -s "$D" pull /sdcard/stp.png "$OUT/$PKG.png" >/dev/null 2>&1
echo "RESULT $PKG: frame captured at $OUT/$PKG.png — read it; the tree cannot answer this"
