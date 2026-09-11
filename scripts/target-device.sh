#!/bin/bash
# The phones hardware readings in this repo may be taken on — docs/single-device-audit.md.
#
# It exists because on 2026-09-02 a signed release APK was very nearly installed on somebody
# else's phone: an OPPO CPH1859 was the only device on the bus, `adb install` targeted it without
# comment, and the failure that stopped it was incidental (minSdk 29 against SDK 28) rather than
# any check of ours. The tell had already appeared and been explained away — `pm list packages`
# returned no ConnectSuite package on a device where it had been installed twenty minutes earlier.
#
# Source this, or run it, before anything that writes to a device.
#
# **2026-09-05: it knows two phones now, and the second one changed its job.** With one pinned
# device the only question was *is the right phone here*. With two, there is a new way to be wrong
# that the old script could not even represent: **the right phone is here, and so is another one,
# and nothing says which the command meant.** So ambiguity is a refusal, not a default — a script
# that picks the first known device it finds is the OPPO accident with a nicer error message.
#
# Selection is an ARGUMENT, never an environment variable. `ANDROID_SERIAL` in a profile was
# considered and rejected for exactly the reason CLAUDE.md gives: invisible at the call site, gone
# in a new terminal, same silent targeting with a different default. A label in the command is
# visible in the transcript that later gets quoted as evidence, which is the whole point — every
# reading in this repo has to be able to say which handset it came from.

# label|serial|model   — model is checked against the device, so a re-flashed or swapped handset
# refuses rather than answering to a serial somebody remembers.
CONNECTSUITE_DEVICES='samsung|RZCY12330DT|SM-S938B
moto|ZA222JT75K|moto g34 5G
moto45|ZN4222NSN6|moto g45 5G
vivo|137354726800049|V2141'

# Test seam only. `scripts/target-device.test.sh` points this at a fixture adb so the refusal
# branches can be exercised without owning five phones. Nothing in the product sets it.
CONNECTSUITE_ADB="${CONNECTSUITE_ADB:-adb}"

connectsuite_target() {
  local want="${1:-}" line label serial model attached_serials found_label found_serial found_model
  local n=0 strangers=""

  attached_serials=$("$CONNECTSUITE_ADB" devices 2>/dev/null | awk '$2 == "device" {print $1}')

  if [ -z "$attached_serials" ]; then
    echo "FAIL  no device on the bus." >&2
    echo "      (a cold adb server also prints an empty list — this reads 'device' states only," >&2
    echo "       so start the daemon before believing it: adb start-server)" >&2
    return 1
  fi

  # Which known devices are attached, and which attached devices are strangers?
  local s
  while IFS= read -r s; do
    [ -z "$s" ] && continue
    local matched=0
    while IFS='|' read -r label serial model; do
      [ -z "$label" ] && continue
      if [ "$s" = "$serial" ]; then
        matched=1
        if [ -n "$want" ] && [ "$want" != "$label" ]; then continue; fi
        n=$((n + 1)); found_label="$label"; found_serial="$serial"; found_model="$model"
      fi
    done <<< "$CONNECTSUITE_DEVICES"
    [ "$matched" -eq 0 ] && strangers="${strangers}        ${s}  (not a device this repo knows)
"
  done <<< "$attached_serials"

  if [ -n "$want" ] && ! grep -q "^${want}|" <<< "$CONNECTSUITE_DEVICES"; then
    echo "FAIL  '${want}' is not a device label this repo knows." >&2
    echo "      known labels:" >&2
    awk -F'|' '{printf "        %-10s %-14s %s\n", $1, $2, $3}' <<< "$CONNECTSUITE_DEVICES" >&2
    return 1
  fi

  if [ "$n" -eq 0 ]; then
    if [ -n "$want" ]; then
      echo "FAIL  '${want}' is not attached." >&2
    else
      echo "FAIL  no device this repo knows is attached." >&2
    fi
    echo "      attached instead:" >&2
    "$CONNECTSUITE_ADB" devices -l 2>/dev/null | grep -E "[[:space:]]device[[:space:]]" | sed 's/^/        /' >&2
    echo "      Refusing to guess. Every reading in this repo names its handset;" >&2
    echo "      a reading from anything else is a different device and must say so." >&2
    return 1
  fi

  if [ "$n" -gt 1 ]; then
    echo "FAIL  ${n} known devices are attached and nothing says which one you mean." >&2
    echo "      This is the case a single-device pin could not represent, and guessing here" >&2
    echo "      would be the OPPO accident with a nicer error message." >&2
    echo "      Name one at the call site:" >&2
    while IFS='|' read -r label serial model; do
      [ -z "$label" ] && continue
      if grep -qx "$serial" <<< "$attached_serials"; then
        echo "        adb -s \"\$(scripts/target-device.sh ${label})\" …   # ${model}" >&2
      fi
    done <<< "$CONNECTSUITE_DEVICES"
    return 1
  fi

  model=$("$CONNECTSUITE_ADB" -s "$found_serial" shell getprop ro.product.model 2>/dev/null | tr -d '\r')
  if [ "$model" != "$found_model" ]; then
    echo "FAIL  $found_serial reports model '$model', expected '$found_model'." >&2
    echo "      A serial answering to the wrong model is a swapped or re-flashed handset." >&2
    return 1
  fi

  if [ -n "$strangers" ]; then
    echo "WARN  another device is on the bus and is NOT the target:" >&2
    printf '%s' "$strangers" >&2
    echo "      The command below is pinned with -s, so it cannot reach it." >&2
  fi

  # Printed so every transcript that installs anything carries the target in it.
  echo "OK    target $found_serial ($model, sdk $("$CONNECTSUITE_ADB" -s "$found_serial" shell getprop ro.build.version.sdk 2>/dev/null | tr -d '\r')) [$found_label]" >&2

  # **Just the serial, and nothing else.** An earlier version printed the flag pair `-s <serial>`
  # so callers could write `adb $TARGET install …`. That works in bash and silently does not in
  # zsh, which performs no word splitting on unquoted expansions — the whole pair arrives as one
  # argument and adb answers `-s requires an argument`. This machine's shell is zsh.
  #
  # It is fixed here rather than at the call site because a guard that is awkward to call is a
  # guard people route around, and routing around this one is how the OPPO got an install command
  # aimed at it. Callers write:  adb -s "$(scripts/target-device.sh)" install …
  printf '%s' "$found_serial"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then connectsuite_target "$@"; fi
