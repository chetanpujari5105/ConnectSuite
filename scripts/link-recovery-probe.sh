#!/bin/bash
#
# Watches LinkService come back after a deliberate process death, and reports its own bounds.
#
# Every number this prints carries the thing that gives it meaning, because a recovery time with no
# sample interval beside it is a number whose error bar is invisible — and this project has already
# recorded a 263 ms window that fell between two 320 ms samples and was nearly written down as an
# absence. So: the interval is printed, the deadline is printed, and a run that hits the deadline
# says `stopped=deadline` rather than reporting the deadline as the answer.
#
# Usage: link-recovery-probe.sh <label> <interval-ms> <deadline-s> [command-to-run-at-t0...]
set -uo pipefail
PKG=com.chetan.connectsuite.debug
LABEL="${1:?label}"; INTERVAL_MS="${2:-500}"; DEADLINE_S="${3:-120}"; shift 3

port_count() {
  adb shell "cat /proc/net/tcp6 /proc/net/tcp 2>/dev/null | awk '{print \$2}' | grep -ciE ':(A605|A606|A607)$'" 2>/dev/null | tr -d '\r'
}
# Only user 0. This handset carries a dual-app clone under u95 with the same package name, so
# `pidof` returns two pids and stays non-empty through a crash of the real one — the probe would
# have reported "process never died" about a process that had died. Caught by the control run.
pid_of() { adb shell "ps -A | grep '^u0_a' | grep '$PKG\$' | awk '{print \$2}'" 2>/dev/null | tr -d '\r'; }

echo "### $LABEL"
echo "instrument: sample interval ${INTERVAL_MS}ms, deadline ${DEADLINE_S}s — both are bounds on what this run can see"
echo "t0-1  pid=$(pid_of) listening_sockets=$(port_count)/4"

if [ $# -gt 0 ]; then
  echo "t0    running: $*"
  "$@" 2>&1 | sed 's/^/      /'
fi

start=$(python3 -c 'import time;print(time.time())')
deadline=$(python3 -c "print($start + $DEADLINE_S)")
sleep_s=$(python3 -c "print($INTERVAL_MS/1000)")
samples=0; first_gone=""; first_back=""; first_ports=""
seen_gone=0
while :; do
  now=$(python3 -c 'import time;print(time.time())')
  if python3 -c "import sys;sys.exit(0 if $now >= $deadline else 1)"; then
    echo "stopped=deadline after ${samples} samples — this run holds no reading about recovery, only that it did not happen inside ${DEADLINE_S}s"
    break
  fi
  samples=$((samples+1))
  sleep "$sleep_s"
  p=$(pid_of); c=$(port_count)
  el=$(python3 -c "print(f'{$now-$start:7.3f}')")
  if [ -z "$p" ] && [ $seen_gone -eq 0 ]; then seen_gone=1; first_gone=$el; echo "  ${el}s  process gone"; fi
  if [ -n "$p" ] && [ $seen_gone -eq 1 ] && [ -z "$first_back" ]; then first_back=$el; echo "  ${el}s  process back (pid=$p)"; fi
  if [ -n "$first_back" ] && [ "$c" -ge 3 ] && [ -z "$first_ports" ]; then
    first_ports=$el; echo "  ${el}s  listening again ($c/4 sockets)"
    echo "stopped=recovered after ${samples} samples"
    break
  fi
done
end=$(python3 -c 'import time;print(time.time())')
# The *observed* mean gap, not the requested one: adb round-trips dominate and a probe that reports
# what it asked for rather than what it did is the push-resume probe's fault in a smaller costume.
obs=$(python3 -c "print(f'{($end-$start)*1000/max($samples,1):.0f}')")
echo "summary: samples=$samples requested_interval=${INTERVAL_MS}ms observed_mean_gap=${obs}ms " \
     "gone_at=${first_gone:-never} back_at=${first_back:-never} listening_at=${first_ports:-never}"
