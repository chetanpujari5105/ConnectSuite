#!/bin/bash
#
# Read-only overnight sampler. Touches nothing on the phone: no input, no settings, no service
# commands. Every line is a `dumpsys`/`/proc` read.
#
# It exists for the one Phase 6 reading that cannot be forced under this session's rules — the phone
# going to sleep and waking on its own. Forcing it needs a key event, and key events are input; so
# instead of producing the transition, this waits for the one that happens anyway and records what
# the link did across it.
#
# What it reports about itself, because a sampler that hides its interval produces error bars nobody
# can see: the requested interval, the observed mean gap, and the sample count. A transition shorter
# than the observed gap is invisible to this run and the run says so rather than reporting an
# absence.
#
# What it CANNOT tell you: the phone is on the cable, so it will not enter deep Doze on its own and
# nothing here describes an unplugged night. That is H3 and it needs the cable out.
set -uo pipefail
PKG=com.chetan.connectsuite.debug
OUT="${1:?output file}"
INTERVAL_S="${2:-60}"

echo "# link-night-watch — read-only, started $(date '+%Y-%m-%dT%H:%M:%S%z')" >> "$OUT"
echo "# requested interval ${INTERVAL_S}s. Columns: time screen wakefulness deep light sockets established wakelock_acq pid" >> "$OUT"
echo "# ON CABLE: deep Doze will not occur unaided. Wakelock column is the live ACQ elapsed from dumpsys power." >> "$OUT"

n=0; start=$(python3 -c 'import time;print(time.time())')
while :; do
  n=$((n+1))
  t=$(date '+%H:%M:%S')
  wake=$(adb shell dumpsys power 2>/dev/null | grep -m1 'mWakefulness=' | tr -d ' \r')
  screen=$(adb shell dumpsys display 2>/dev/null | grep -m1 -oE 'mScreenState=[A-Z_]+' | tr -d '\r')
  deep=$(adb shell dumpsys deviceidle get deep 2>/dev/null | tr -d '\r')
  light=$(adb shell dumpsys deviceidle get light 2>/dev/null | tr -d '\r')
  sock=$(adb shell "cat /proc/net/tcp6 /proc/net/tcp 2>/dev/null | awk '{print \$2}' | grep -icE ':(A605|A606|A607)\$'" 2>/dev/null | tr -d '\r')
  est=$(adb shell "cat /proc/net/tcp6 2>/dev/null | awk '\$4==\"01\" {print \$2}' | grep -icE ':A605\$'" 2>/dev/null | tr -d '\r')
  wl=$(adb shell dumpsys power 2>/dev/null | grep -m1 "ConnectSuite:link" | grep -oE 'ACQ=[-0-9a-z ]+' | tr -d '\r')
  pid=$(adb shell "ps -A | grep '^u0_a' | grep '$PKG\$' | awk '{print \$2}'" 2>/dev/null | tr -d '\r')
  if [ -z "$pid" ]; then pid="GONE"; fi
  if [ -z "$wl" ]; then wl="ACQ=none"; fi
  echo "$t ${screen:-?} ${wake:-?} deep=${deep:-?} light=${light:-?} sockets=${sock:-?}/4 est=${est:-?} ${wl} pid=${pid}" >> "$OUT"
  now=$(python3 -c 'import time;print(time.time())')
  obs=$(python3 -c "print(f'{($now-$start)/max($n,1):.1f}')")
  echo "$t   [samples=$n observed_mean_gap=${obs}s]" >> "$OUT"
  sleep "$INTERVAL_S"
done
