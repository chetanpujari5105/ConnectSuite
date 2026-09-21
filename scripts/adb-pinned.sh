#!/bin/bash
# adb, with the device pinned and the serial never passing through the caller's hands.
#
# ## Why this exists when `target-device.sh` already does
#
# The pin has been correct since 2026-09-05 and was defeated on 2026-09-10 by its **caller**:
#
#     S=$(./scripts/target-device.sh samsung 2>&1 | tail -1)     # ← the banner, not the serial
#     adb -s "$S" shell dumpsys deviceidle whitelist | grep -i connectsuite || echo "NOT exempt"
#
# `target-device.sh` prints its `OK target …` banner on **stderr** and the serial on **stdout**,
# precisely so the two cannot be confused. `2>&1` merges them, `tail -1` then picked whichever line
# came last, `adb -s ""` errored — and the `||` turned that error into *"NOT in the deviceidle
# whitelist"*, a confident, specific, wrong claim about the user's phone. Nothing in the output said
# the command had not run.
#
# `CLAUDE.md`'s control table already names this failure — a stream carrying two writers read as one
# text — and it happened anyway, in the same session that cites it. **So the table is not the
# enforcement point.** The table is consulted by someone who already suspects a problem, and nobody
# suspects one while capturing a serial they have captured twenty times.
#
# The enforcement point is to **remove the serial from the call site entirely**. There is no value to
# capture, so there is no capture to get wrong:
#
#     scripts/adb-pinned.sh samsung shell dumpsys deviceidle whitelist
#
# Two further properties, both learned the same day:
#
#  - **An empty serial is a refusal, never an argument.** `adb -s ""` is a command that runs and
#    fails; this exits non-zero before adb is reached, so a `||` fallback cannot turn it into a
#    finding.
#  - **stdin is closed.** `adb shell` reads stdin, so an `adb` inside a `while read` loop eats the
#    loop's input and the loop silently runs once. That cost a control set of eight packages the
#    same afternoon.
set -u

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$#" -lt 2 ]; then
  echo "usage: adb-pinned.sh <device-label> <adb args…>" >&2
  echo "       e.g. adb-pinned.sh samsung shell getprop ro.product.model" >&2
  exit 2
fi

label="$1"
shift

# stdout only. The banner stays on stderr where the caller can read it and cannot capture it.
serial="$("$here/target-device.sh" "$label")" || exit 1

if [ -z "$serial" ]; then
  echo "REFUSED: the pin resolved to an empty serial for '$label'." >&2
  echo "         This is the 2>&1 fault: no command was run and no reading exists." >&2
  echo "         Do not treat this as a negative result about the device." >&2
  exit 1
fi

#  - **One name for adb, shared with the pin.** `target-device.sh` resolves the binary through
#    `${CONNECTSUITE_ADB:-adb}` so its refusal branches can be exercised against a fake; this line
#    used to say `adb` literally, so a caller that faked the pin got a fake pin and a real adb —
#    two halves of one command talking to two different devices. It cost `adb-count.test.sh` its
#    two positive fixtures, which could only pass with an SM-S938B on the cable and were red on
#    every machine without one.
exec "${CONNECTSUITE_ADB:-adb}" -s "$serial" "$@" < /dev/null
