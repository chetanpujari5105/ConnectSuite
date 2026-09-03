#!/bin/bash
#
# Forces deep Doze and watches what the link does, then puts the device back exactly as it was.
#
# Two things this cannot tell you, printed in its own output so nobody has to remember them:
#
#  * Which Doze path is being measured is READ AT RUN TIME, never assumed. This header used to
#    assert "this handset is in the whitelist, so everything below describes the EXEMPT path" — a
#    true sentence when it was written and a false one the moment somebody runs H1, which is the
#    entire point of running H1. An instrument that hard-codes the condition it is measuring reports
#    its author's assumption as a reading. It now prints EXEMPT or UNEXEMPT from the live whitelist,
#    beside the standby bucket it derives from.
#  * `dumpsys battery unplug` simulates being off the charger. It does not unplug anything, and the
#    USB session that is taking these readings is itself a reason the device would not idle on its
#    own. This is a forced transition, not an observed one.
#
# The device is restored on every exit path, including Ctrl-C, and the restoration is *verified*
# rather than assumed — a probe that leaves a phone believing it is on battery all night is worse
# than no probe.
set -uo pipefail
cd "$(dirname "$0")/.."
PKG=com.chetan.connectsuite.debug
# Every write below - battery unplug, force-idle, unforce, battery reset - changes a device's state,
# and this project's rule is that those go through the pin rather than at whatever is on the bus.
T=$(scripts/target-device.sh) || exit 1
adb() { command adb -s "$T" "$@"; }
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

wl=$(adb shell dumpsys deviceidle whitelist | grep connectsuite | tr -d '\r')
bucket=$(adb shell am get-standby-bucket $PKG | tr -d '\r')
if [ -n "$wl" ]; then path="EXEMPT"; else path="UNEXEMPT"; fi
echo "### Forced Doze — $path PATH  (read from the device, not assumed)"
echo "    whitelist row : ${wl:-<none — this package is NOT in the deviceidle whitelist>}"
echo "    standby bucket: $bucket   (5 = EXEMPTED, and it is derived from the row above)"
if [ "$path" = "EXEMPT" ]; then
  echo "    → Doze's network restrictions DO NOT APPLY. A clean pass says nothing about a phone"
  echo "      whose owner declined the onboarding prompt."
else
  echo "    → Doze's network restrictions APPLY. This is the population the restrictions exist for."
fi
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
