#!/bin/bash
# The phone every hardware reading in this repo was taken on — docs/single-device-audit.md.
#
# It exists because on 2026-09-02 a signed release APK was very nearly installed on somebody
# else's phone: an OPPO CPH1859 was the only device on the bus, `adb install` targeted it without
# comment, and the failure that stopped it was incidental (minSdk 29 against SDK 28) rather than
# any check of ours. The tell had already appeared and been explained away — `pm list packages`
# returned no ConnectSuite package on a device where it had been installed twenty minutes earlier.
#
# Source this, or run it, before anything that writes to a device.
CONNECTSUITE_SERIAL="RZCY12330DT"   # Samsung SM-S938B, Android 16
CONNECTSUITE_MODEL="SM-S938B"

connectsuite_target() {
  local attached serial model
  attached=$(adb devices | grep -cE "[[:space:]]device$")
  if [ "$attached" -eq 0 ]; then
    echo "FAIL  no device on the bus" >&2; return 1
  fi
  if ! adb devices | grep -qE "^${CONNECTSUITE_SERIAL}[[:space:]]+device$"; then
    echo "FAIL  ${CONNECTSUITE_SERIAL} (${CONNECTSUITE_MODEL}) is not attached." >&2
    echo "      attached instead:" >&2
    adb devices -l | grep -E "[[:space:]]device[[:space:]]" | sed 's/^/        /' >&2
    echo "      Refusing to guess. Every reading in this repo is from ${CONNECTSUITE_MODEL};" >&2
    echo "      a reading from anything else is a different device and must say so." >&2
    return 1
  fi
  serial="$CONNECTSUITE_SERIAL"
  model=$(adb -s "$serial" shell getprop ro.product.model | tr -d '\r')
  if [ "$model" != "$CONNECTSUITE_MODEL" ]; then
    echo "FAIL  $serial reports model '$model', expected '$CONNECTSUITE_MODEL'" >&2; return 1
  fi
  # Printed so every transcript that installs anything carries the target in it.
  echo "OK    target $serial ($model, sdk $(adb -s "$serial" shell getprop ro.build.version.sdk | tr -d '\r'))" >&2
  echo "-s $serial"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then connectsuite_target; fi
