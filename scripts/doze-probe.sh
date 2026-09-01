#!/bin/bash
#
# Forces deep Doze and watches what the link does, then puts the device back exactly as it was.
#
# Two things this cannot tell you, printed in its own output so nobody has to remember them:
#
#  * This handset is in the deviceidle whitelist, so it is exempt from Doze's network restrictions.
#    Everything below therefore describes the EXEMPT path. A clean pass here is not evidence about
#    a phone whose owner declined the onboarding prompt.
#  * `dumpsys battery unplug` simulates being off the charger. It does not unplug anything, and the
#    USB session that is taking these readings is itself a reason the device would not idle on its
#    own. This is a forced transition, not an observed one.
#
# The device is restored on every exit path, including Ctrl-C, and the restoration is *verified*
# rather than assumed — a probe that leaves a phone believing it is on battery all night is worse
# than no probe.
set -uo pipefail
PKG=com.chetan.connectsuite.debug
DURATION_S="${1:-180}"
INTERVAL_S="${2:-10}"

restore() {
  echo
  echo "--- restoring ---"
  adb shell dumpsys deviceidle unforce  >/dev/null 2>&1
  adb shell dumpsys battery reset       >/dev/null 2>&1
  sleep 2
  echo "deep=$(adb shell dumpsys deviceidle get deep | tr -d '\r')  light=$(adb shell dumpsys deviceidle get light | tr -d '\r')"
  echo "charging=$(adb shell dumpsys battery | grep -E '^  (AC|USB) powered' | tr -d '\r' | paste -sd' ' -)"
  echo "whitelist row: $(adb shell dumpsys deviceidle whitelist | grep connectsuite | tr -d '\r')"
  echo "standby bucket: $(adb shell am get-standby-bucket $PKG | tr -d '\r')"
}
trap restore EXIT INT TERM

sockets() { adb shell "cat /proc/net/tcp6 /proc/net/tcp 2>/dev/null | awk '{print \$2}' | grep -icE ':(A605|A606|A607)\$'" 2>/dev/null | tr -d '\r'; }
established() { adb shell "cat /proc/net/tcp6 2>/dev/null | awk '\$4==\"01\" {print \$2}' | grep -icE ':A605\$'" 2>/dev/null | tr -d '\r'; }

echo "### Forced Doze — EXEMPT PATH (see header)"
echo "instrument: ${DURATION_S}s run, ${INTERVAL_S}s samples. Both are bounds: a drop shorter than"
echo "            one sample gap is invisible to this run, and a run that ends still IDLE says so."
echo
echo "baseline  deep=$(adb shell dumpsys deviceidle get deep | tr -d '\r') light=$(adb shell dumpsys deviceidle get light | tr -d '\r') listen=$(sockets)/4 established=$(established)"

echo "--- unplug (simulated) + force-idle ---"
adb shell dumpsys battery unplug 2>&1 | sed 's/^/    /'
adb shell dumpsys deviceidle force-idle 2>&1 | sed 's/^/    /'

start=$(python3 -c 'import time;print(time.time())')
n=0
while :; do
  now=$(python3 -c 'import time;print(time.time())')
  el=$(python3 -c "print(f'{$now-$start:6.1f}')")
  if python3 -c "import sys;sys.exit(0 if $now-$start >= $DURATION_S else 1)"; then
    echo "stopped=duration after $n samples"
    break
  fi
  n=$((n+1))
  echo "  ${el}s  deep=$(adb shell dumpsys deviceidle get deep | tr -d '\r') light=$(adb shell dumpsys deviceidle get light | tr -d '\r') listen=$(sockets)/4 established=$(established)"
  sleep "$INTERVAL_S"
done
