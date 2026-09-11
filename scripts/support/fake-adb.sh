#!/bin/bash
# A stand-in adb for scripts/target-device.test.sh, and nothing else.
#
# It exists so the pin's REFUSAL branches can be exercised without owning five phones. Defect 68's
# three directions were checked by hand on real hardware once, in 2026-09-02, and then never again —
# which is a rule enforced by someone remembering, in the repo that says what that is worth.
#
# FAKE_DEVICES is "serial<TAB or space>model<space>sdk" per line. FAKE_ADB_LOG, if set, records the
# argv it was called with, so a test can assert the pin asked about the device it claims to have
# checked rather than trusting the answer.
[ -n "$FAKE_ADB_LOG" ] && echo "$*" >> "$FAKE_ADB_LOG"

if [ "$1" = "devices" ]; then
  echo "List of devices attached"
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    s=$(awk '{print $1}' <<< "$line")
    if [ "$2" = "-l" ]; then
      echo "$s             device usb:2-1 product:fixture model:fixture transport_id:1"
    else
      printf '%s\tdevice\n' "$s"
    fi
  done <<< "$FAKE_DEVICES"
  exit 0
fi

if [ "$1" = "-s" ]; then
  serial="$2"; shift 2
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    s=$(awk '{print $1}' <<< "$line")
    if [ "$s" = "$serial" ]; then
      m=$(sed -E 's/^[^ ]+ +//; s/ +[0-9]+$//' <<< "$line")
      k=$(awk '{print $NF}' <<< "$line")
      case "$*" in
        *ro.product.model*)       echo "$m"; exit 0 ;;
        *ro.build.version.sdk*)   echo "$k"; exit 0 ;;
      esac
      echo ""; exit 0
    fi
  done <<< "$FAKE_DEVICES"
  echo "error: device '$serial' not found" >&2; exit 1
fi
exit 0
