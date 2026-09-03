#!/bin/bash
# Defect 64: did a REAL BOOT start the link, and did it claim connectedDevice only?
#
# ## Why this script was rewritten after its first run
#
# Version 1 printed "DEFECT 64 CLOSED" over a phone that had not rebooted and still had the
# competing grant enabled. It did so by grepping the WHOLE 3024-line log and counting two lines
# from the previous day — the stale-artifact failure in CLAUDE.md, committed by the tool written
# to avoid it. Two things were wrong and only one of them was the greps:
#
#  1. **The greps had no time bound.** "since boot" appeared in the section headers and nowhere in
#     the code. An artifact older than the run is a memory, not a result.
#  2. **The controls were printed and then ignored.** uptime said 13 hours, the grant control said
#     1 entry, and the verdict was computed anyway — a check that reads a value and then acts
#     regardless is decoration, and it made the transcript worse than useless because it showed the
#     right readings immediately above the wrong conclusion.
#
# ## The rule this script now embodies, added 2026-09-03 (defects 77 and 78)
#
# **Uptime is the witness for WHETHER a boot happened. The log is the witness only for WHAT the boot
# did.** These are two questions and the log has an honest answer to only one of them.
#
# `/proc/uptime` is the kernel's own counter: no app can write it, no broadcast can forge it, and it
# resets on every restart. A `[autostart] BOOT:` line cannot carry that weight, because
# `LinkAutoStart.reasonFor` maps both `BOOT_COMPLETED` and `QUICKBOOT_POWERON` onto the name `BOOT`,
# and `QUICKBOOT_POWERON` is NOT a protected broadcast on this handset — so anything on the device
# can produce a line this script cannot tell from a restart. Two such lines are in the log already,
# at 2026-09-03T02:13, over a kernel that had been up for twenty-two hours.
#
# So: no tightening of the greps below can fix this, and none should be attempted. The boot is
# established by uptime BEFORE any line is read, and the greps only ever describe a boot that has
# already been witnessed.
#
# **Defect 77 is fixed as of 2026-09-03 and this paragraph still stands.** The log now says BOOT or
# QUICKBOOT, so the two actions are distinguishable in the data — but that only means a forged line
# has to carry the other word. Uptime remains the witness; the reason names make the log honest about
# WHICH action arrived, not about whether a boot happened.
#
# So the controls are now a GATE: this refuses to emit a verdict unless the preconditions hold, and
# says which one failed. And every count is bounded to lines written since the current boot.
set -uo pipefail
cd "$(dirname "$0")/.."
PKG=com.chetan.connectsuite.debug
T=$(scripts/target-device.sh) || exit 1

# --- when did this phone actually boot? (device clock minus /proc/uptime) -----------------------
up=$(adb -s "$T" shell cut -d. -f1 /proc/uptime | tr -d '\r')
now=$(adb -s "$T" shell date +%s | tr -d '\r')
bootepoch=$(( now - up ))
bootiso=$(adb -s "$T" shell date -d @$bootepoch +%Y-%m-%dT%H:%M:%S 2>/dev/null | tr -d '\r')
[ -n "$bootiso" ] || bootiso=$(date -r "$bootepoch" +%Y-%m-%dT%H:%M:%S)
grant=$(adb -s "$T" shell settings get secure enabled_notification_listeners | grep -c connectsuite)

LOG=$(adb -s "$T" shell run-as $PKG cat files/logs/link.log 2>/dev/null)
lines=$(printf '%s\n' "$LOG" | wc -l | tr -d ' ')
# Lines since boot, by ISO timestamp. Same timezone throughout, so lexical compare is exact.
# Anchored to a timestamp on purpose (defect 78). `$1 >= b` alone admits every untimestamped line
# in the file: a stack-trace continuation starts with `at `, and "at" > "2026" lexically, so it
# passes whatever its age. That inflated this control 8.5x on the 2026-09-03 boot -- 549 reported
# against 64 real -- while the verdict counts below stayed correct, which is the worst combination:
# a wrong number certifying right ones.
SINCE=$(printf '%s\n' "$LOG" | awk -v b="$bootiso" '/^[0-9]{4}-[0-9]{2}-[0-9]{2}T/ && $1 >= b')
sincecount=$(printf '%s\n' "$SINCE" | grep -c . )

echo "controls"
echo "  log readable      : $lines lines total, [tls] x$(printf '%s\n' "$LOG" | grep -c '\[tls\]')  ← a known-present tag"
echo "  last real boot    : $bootiso  (uptime ${up}s = $(( up / 3600 ))h $(( (up % 3600) / 60 ))m)"
echo "                      ^ /proc/uptime is the ONLY witness that a boot happened; no line is (77/78)"
echo "  lines since boot  : $sincecount   ← every count below is bounded to these"
echo "  listener grant    : $grant connectsuite entry(ies)   ← MUST be 0, or the competing route is live"
echo

gate_ok=1
if [ "$up" -gt 1800 ]; then
  echo "GATE FAIL  uptime is $(( up / 3600 ))h — this phone has not rebooted for this test."
  gate_ok=0
fi
if [ "$grant" -ne 0 ]; then
  echo "GATE FAIL  the notification-listener grant is still enabled — the route defect 64 is about"
  echo "           being hidden by is still armed, so a boot now proves nothing either way."
  gate_ok=0
fi
if [ "$gate_ok" -eq 0 ]; then
  echo
  echo "=> NO READING. Not a negative result: the experiment did not run. Nothing is concluded."
  echo "   [autostart] lines since boot, for context only:"
  printf '%s\n' "$SINCE" | grep '\[autostart\]' | sed 's/^/     /' | tail -5
  exit 3
fi

echo "=== [autostart] lines since boot ==="
printf '%s\n' "$SINCE" | grep '\[autostart\]' | sed 's/^/  /'
echo "=== foreground claims since boot ==="
printf '%s\n' "$SINCE" | grep 'Foreground as\|startForeground refused' | sed 's/^/  /'
echo

# Anchored on the tag and the space: "QUICKBOOT:" CONTAINS "BOOT:", so an unanchored grep counts
# the unprotected action as the protected one — which is the confusion defect 77 just removed from
# the log, reintroduced in the reader. The instrument has to make the distinction the data now has.
boot_start=$(printf '%s\n' "$SINCE" | grep -c '\[autostart\] BOOT: .*link not running — starting LinkService')
boot_noop=$(printf '%s\n'  "$SINCE" | grep -c '\[autostart\] BOOT: already listening')
boot_zero=$(printf '%s\n'  "$SINCE" | grep -c '\[autostart\] BOOT: 0 paired')
fg_boot=$(printf '%s\n'    "$SINCE" | grep -c 'Foreground as BOOT, types=0x10')
quickboot=$(printf '%s\n'  "$SINCE" | grep -c '\[autostart\] QUICKBOOT:')
fg_other=$(printf '%s\n'   "$SINCE" | grep 'Foreground as BOOT, types=' | grep -cv 'types=0x10')

echo "=== VERDICT ==="
echo "  startOrLog reached for BOOT      : $boot_start  (no-op branch: $boot_noop, '0 paired': $boot_zero)"
echo "  'Foreground as BOOT, types=0x10' : $fg_boot  (BOOT at some other type: $fg_other)"
echo "  QUICKBOOT lines since boot        : $quickboot  ← a DIFFERENT action; unprotected on this handset (77)"
if [ "$boot_start" -ge 1 ] && [ "$fg_boot" -ge 1 ]; then
  echo "  => DEFECT 64 CLOSED on a real boot with the competing route removed."
elif [ "$boot_noop" -ge 1 ]; then
  echo "  => STILL UNPROVEN: BOOT ran and took the no-op branch. A no-op branch is not a pass."
else
  echo "  => NO READING: the BOOT branch did not run. Check the receiver was delivered to before"
  echo "     reading this as a negative."
fi
