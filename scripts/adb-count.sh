#!/bin/bash
# A tally that cannot be produced by a command that did not run.
#
# ## The hole this closes
#
# `adb-pinned.sh` refuses correctly when no device is on the bus — it exits non-zero and prints
# `FAIL no device on the bus`. On 2026-09-10 that refusal was wrapped in a pipeline anyway:
#
#     before=$(adb -s "$S" shell dumpsys package "$P" | grep -c "granted=true")
#     echo "grants before: $before"          # → "grants before: 0"
#
# `grep -c` over an empty stream prints `0`, and `0` reads as a measurement. **The refusal went to
# stderr and scrolled past; the number went to stdout and was believed.** That is worse than having
# no wrapper: a wrapper that refuses invisibly while the caller still prints a confident figure has
# moved the failure from "wrong device" to "wrong number", which is harder to notice.
#
# So the tally is not the caller's to compute. This runs the command, checks that it **ran** and
# that it **produced output**, and only then counts — and it prints the denominator beside the
# count, because a count with nothing to give it scale is the thing `CLAUDE.md` opens with.
#
#   scripts/adb-count.sh samsung 'granted=true' -- shell dumpsys package com.chetan.connectsuite.debug
#
# Output is one line, and it is either a reading or a refusal. There is no third form and no way to
# get a bare integer out of it:
#
#   READING  28 of 1043 lines match 'granted=true'
#   NO READING  the pinned command exited 1 — nothing ran, so nothing was counted
#   NO READING  the command ran and produced no output — 0 matches of 0 lines is not a count of zero
#
# `--` separates the pattern from the adb arguments so a pattern beginning with a dash cannot be
# read as a flag.
set -u

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$#" -lt 4 ]; then
  echo "usage: adb-count.sh <device-label> <pattern> -- <adb args…>" >&2
  exit 2
fi

label="$1"; pattern="$2"; shift 2
if [ "$1" != "--" ]; then
  echo "usage: adb-count.sh <device-label> <pattern> -- <adb args…>   (missing --)" >&2
  exit 2
fi
shift

out="$("$here/adb-pinned.sh" "$label" "$@" 2>/dev/null)"
rc=$?

if [ $rc -ne 0 ]; then
  echo "NO READING  the pinned command exited $rc — nothing ran, so nothing was counted"
  exit 1
fi

total=$(printf '%s' "$out" | grep -c '' 2>/dev/null)
if [ -z "$out" ] || [ "$total" -eq 0 ]; then
  echo "NO READING  the command ran and produced no output — 0 matches of 0 lines is not a count of zero"
  exit 1
fi

matches=$(printf '%s\n' "$out" | grep -c -- "$pattern")
echo "READING  $matches of $total lines match '$pattern'"
