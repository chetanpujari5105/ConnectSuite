#!/bin/bash
#
# Defect 102's missing half: does `ActivityManager.isBackgroundRestricted()` actually reach the user?
#
# Slice 39 built the detection and proved the **decision** — 23 tests, 12 mutations, all red. What it
# could not prove is the **write**: this call has never once returned `true` on any device in this
# project, because the op was restored to `allow` on the only handset that ever had it set. That is
# the `LinkWaitStatus` split exactly, named in advance instead of discovered in six weeks.
#
# ## The control is the restore, and it is the reading that matters
#
# A card that appears is one bit. A card that appears **and then goes away** is the bit plus the
# proof that something is reading a live value rather than drawing unconditionally. A card that
# appears and never leaves is a different defect, and it would look identical at the moment of
# appearing — which is the hidden-grid failure in a new pane. So this takes **three** readings:
#
#   0. BEFORE   op=allow    the card must be ABSENT and `mirror` advertised
#   1. DURING   op=ignore   the card must be PRESENT and `mirror` withheld with the reason
#   2. AFTER    op=allow    the card must be ABSENT again and `mirror` back
#
# Reading 0 is not ceremony. Without it, reading 1 cannot distinguish *"the card appeared"* from
# *"the card was always there"*.
#
# ## And the dump gets its own positive control
#
# "The card is not in the UI dump" and "the dump is empty" are the same picture. Every dump here is
# first checked for a string known to be on that screen (`ANCHOR`); a dump missing the anchor is
# reported as NO READING rather than as an absence. That is this repo's oldest rule and it is the one
# a UI probe breaks most easily.
#
# ## It restores the op no matter how it exits
#
# The op is the owner's phone setting. A trap restores it on any exit path, including a failure
# halfway through, and the script prints the restored value rather than assuming the trap ran.
#
# Usage:  scripts/defect102-read.sh [device-label]      (default: samsung)
# Requires: the app built from this tree installed on the phone, and the phone on the Mac screen.
set -uo pipefail

LABEL="${1:-samsung}"
PKG="com.chetan.connectsuite.debug"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADB="$HERE/adb-pinned.sh"

# The headline `BackgroundRestriction.HEADLINE` puts on the card. Read from the source rather than
# typed from memory: a pass criterion quoting a string the code does not write is a test that can
# only fail, which cost two false negatives on 2026-09-10.
HEADLINE=$(grep -oE 'const val HEADLINE: String = "[^"]*"' \
  "$HERE/../core/src/main/java/com/chetan/connectsuite/core/link/BackgroundRestriction.kt" \
  | sed 's/.*= "//; s/"$//')
# Something that is on the Mac screen in every state. If this is missing, the dump is not of that
# screen and nothing below it is a reading.
ANCHOR="Paired Macs"

[ -n "$HEADLINE" ] || { echo "FAIL  could not read HEADLINE out of BackgroundRestriction.kt"; exit 2; }
echo "pass criterion, read from source: \"$HEADLINE\""
echo "dump anchor:                      \"$ANCHOR\""
echo

restore() {
  echo
  echo "--- restoring the op (runs on every exit path) ---"
  "$ADB" "$LABEL" shell cmd appops set "$PKG" RUN_ANY_IN_BACKGROUND allow >/dev/null 2>&1
  echo -n "op is now: "
  "$ADB" "$LABEL" shell cmd appops get "$PKG" RUN_ANY_IN_BACKGROUND 2>&1 | tr -d '\r'
}
trap restore EXIT

dump() {
  "$ADB" "$LABEL" shell uiautomator dump /sdcard/cs-dump.xml >/dev/null 2>&1
  "$ADB" "$LABEL" shell cat /sdcard/cs-dump.xml 2>/dev/null | tr -d '\r'
}

# Reach the Mac tab, from a dump taken now rather than from a remembered pixel.
#
# The three bottom-nav cells carry **no `content-desc` and no `text` of their own** — the labels are
# separate nodes — so there is no named target to press and this is the "genuinely unnamed surface"
# the coordinate rule allows, with its two conditions met: the geometry comes from a dump taken
# seconds earlier, and the tap is announced in the output. Adding a `contentDescription` to those
# three cells is the right fix and is cheaper than a second accident; it is noted in Slice 42.
#
# It is also **gated on what it read**, which is the decoration rule: if the cell is not where the
# dump says, nothing is tapped.
goto_mac_tab() {
  "$ADB" "$LABEL" shell uiautomator dump /sdcard/cs-dump.xml >/dev/null 2>&1
  local xml; xml=$("$ADB" "$LABEL" shell cat /sdcard/cs-dump.xml 2>/dev/null | tr -d '\r')
  if printf '%s' "$xml" | grep -qF "$ANCHOR"; then return 0; fi   # already there
  # The rightmost of the three equal cells along the bottom strip is the Mac tab.
  local cell; cell=$(printf '%s' "$xml" | tr '<' '\n' \
    | grep -oE 'bounds="\[[0-9]+,2[89][0-9]{2}\]\[[0-9]+,[0-9]+\]"' | tail -1)
  if [ -z "$cell" ]; then
    echo "  cannot locate the bottom nav in the dump — not tapping anything"
    return 1
  fi
  local x1 x2 y1 y2
  x1=$(printf '%s' "$cell" | sed -E 's/.*\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\].*/\1/')
  y1=$(printf '%s' "$cell" | sed -E 's/.*\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\].*/\2/')
  x2=$(printf '%s' "$cell" | sed -E 's/.*\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\].*/\3/')
  y2=$(printf '%s' "$cell" | sed -E 's/.*\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\].*/\4/')
  echo "  tapping the Mac nav cell at ($(( (x1+x2)/2 )),$(( (y1+y2)/2 ))) — bounds ($x1,$y1)-($x2,$y2), from a dump taken now"
  "$ADB" "$LABEL" shell input tap $(( (x1+x2)/2 )) $(( (y1+y2)/2 )) >/dev/null 2>&1
  sleep 2
}

# One phase: nudge the app so `refresh()` runs, dump, and report all three facts together.
phase() {
  local name="$1" expect="$2"
  echo "=== $name (expect the card ${expect}) ==="
  # Resume the app: refresh() runs on resume, which is the path a user following the card takes.
  "$ADB" "$LABEL" shell am start -n "$PKG/com.chetan.connectsuite.MainActivity" >/dev/null 2>&1
  sleep 3
  goto_mac_tab
  local xml; xml=$(dump)

  if [ -z "$xml" ] || ! printf '%s' "$xml" | grep -qF "$ANCHOR"; then
    echo "  NO READING — the dump is empty or is not the Mac screen (anchor \"$ANCHOR\" absent)."
    echo "               Open ConnectSuite's Mac tab on the phone and re-run. An absent card in a"
    echo "               dump of the wrong screen is not an absence."
    return 1
  fi
  local n; n=$(printf '%s' "$xml" | grep -cF "$HEADLINE")
  echo "  control:  anchor present, dump $(printf '%s' "$xml" | wc -c | tr -d ' ') bytes"
  echo "  card:     $n occurrence(s) of the headline"

  echo -n "  op:       "
  "$ADB" "$LABEL" shell cmd appops get "$PKG" RUN_ANY_IN_BACKGROUND 2>&1 | tr -d '\r'

  # The app's own view. Printed with its own timestamp — `Capabilities now:` is written only on a
  # CHANGE, so a line pulled out without its clock is a memory presented as the present.
  echo "  caps:     $("$ADB" "$LABEL" shell run-as "$PKG" tail -200 files/logs/link.log 2>/dev/null \
    | tr -d '\r' | grep '\[caps\]' | tail -1)"
  echo

  case "$expect" in
    ABSENT)  [ "$n" -eq 0 ] || { echo "  ✗ the card is showing when it should not be"; return 1; } ;;
    PRESENT) [ "$n" -gt 0 ] || { echo "  ✗ the card is NOT showing — this is the finding"; return 1; } ;;
  esac
  echo "  ✓ as expected"
  echo
  return 0
}

"$ADB" "$LABEL" shell true >/dev/null 2>&1 || { echo "FAIL  device $LABEL is not on the bus"; exit 2; }

# --- the precondition, and it is not a formality ----------------------------------------------
#
# `LinkRoute` holds its diagnostics as `remember(capabilities) { … }` — keyed on the ADVERTISED SET.
# So the card moves only when `mirror` actually enters or leaves that set. `mirror` needs the video
# channel served, which needs a Mac connected; on a phone with no Mac, `mirror` is already withheld,
# the set does not change when the op is set, and the card never appears.
#
# That would read as *"detection does not work"*. It is a different sentence — *this reading cannot
# be taken in this state* — and the two must not be confused, which is the whole subject of the
# register entry this script exists for. So it is checked first and refuses rather than proceeding.
echo '--- precondition: is a Mac connected, so that mirror is in the advertised set? ---'
# `run-as PKG sh -c '…'` returns an empty string on this handset while the direct form works —
# measured 2026-09-12, and it cost this script its first run: the precondition read `<none logged>`
# and told the operator to connect a Mac that was already connected. A dead query is a NO READING,
# never a negative, so the log is proven readable before anything is concluded from its contents.
log_lines=$("$ADB" "$LABEL" shell run-as "$PKG" wc -l files/logs/link.log 2>/dev/null \
  | tr -d '\r' | awk '{print $1}')
if [ -z "${log_lines:-}" ] || [ "${log_lines:-0}" -eq 0 ]; then
  echo "  NO READING — files/logs/link.log is unreadable or empty, so nothing below it is evidence."
  echo "               This is not a statement about the Mac or about mirror."
  exit 2
fi
echo "  control: link.log is readable, $log_lines lines"
caps_line=$("$ADB" "$LABEL" shell run-as "$PKG" tail -400 files/logs/link.log 2>/dev/null \
  | tr -d '\r' | grep -o 'Capabilities now: [a-z,]*' | tail -1)
echo "  last advertised set: ${caps_line:-<none logged>}"
if ! printf '%s' "$caps_line" | grep -q 'mirror'; then
  echo
  echo 'REFUSED — mirror is not in the advertised set, so setting the op cannot change it and'
  echo "          the card cannot appear. This is NOT evidence that detection is broken."
  echo "          Connect the Mac (mirror needs the video channel served), then re-run."
  exit 2
fi
echo "  ✓ mirror is advertised — the stimulus has something to change"
echo

ok=0
phase "0 · BEFORE  op=allow" ABSENT || ok=1

echo "--- stimulus: setting RUN_ANY_IN_BACKGROUND to ignore ---"
"$ADB" "$LABEL" shell cmd appops set "$PKG" RUN_ANY_IN_BACKGROUND ignore || exit 2
echo

phase "1 · DURING  op=ignore" PRESENT || ok=1

echo "--- control: setting RUN_ANY_IN_BACKGROUND back to allow ---"
"$ADB" "$LABEL" shell cmd appops set "$PKG" RUN_ANY_IN_BACKGROUND allow || exit 2
echo

phase "2 · AFTER   op=allow" ABSENT || ok=1

echo "======================================================================"
if [ "$ok" -eq 0 ]; then
  echo "ALL THREE READINGS AS PRE-REGISTERED — appeared on the stimulus and left on the control."
else
  echo "AT LEAST ONE READING DID NOT MATCH. Read the phases above; a NO READING is not a negative."
fi
exit "$ok"
