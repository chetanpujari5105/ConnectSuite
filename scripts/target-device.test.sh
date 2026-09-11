#!/bin/bash
# Fixtures for scripts/target-device.sh.
#
# Defect 68's record says all three directions were exercised — refuses the wrong device, passes the
# right one, refuses a serial whose model does not match. They were, once, by hand, on the day. This
# file is that claim made re-runnable, plus the direction a second handset invented on 2026-09-05:
# **two known devices attached and nothing saying which**, which the single-device pin could not
# represent at all.
#
# Every case carries its opposite. A refusal fixture that would also refuse a healthy bus proves
# nothing, so the PASS cases sit beside the FAIL ones and both are counted.

cd "$(dirname "$0")/.." || exit 2
export CONNECTSUITE_ADB="scripts/support/fake-adb.sh"

SAMSUNG="RZCY12330DT SM-S938B 36"
MOTO="ZA222JT75K moto g34 5G 35"
OPPO="9WKQTQVQ8Q7XQ CPH1859 28"          # the actual device from defect 68

pass=0; fail=0

# want: PASS <expected-stdout> | FAIL <substring the stderr must contain>
check() {
  local name="$1" devices="$2" arg="$3" want="$4" expect="$5"
  local out err rc
  err=$(mktemp); out=$(FAKE_DEVICES="$devices" bash scripts/target-device.sh $arg 2>"$err"); rc=$?
  local stderr; stderr=$(cat "$err"); rm -f "$err"

  if [ "$want" = "PASS" ]; then
    if [ $rc -eq 0 ] && [ "$out" = "$expect" ]; then
      pass=$((pass+1)); printf '  ok    %s\n' "$name"
    else
      fail=$((fail+1)); printf '  FAIL  %s\n        rc=%s stdout=%q expected=%q\n' "$name" "$rc" "$out" "$expect"
    fi
  else
    if [ $rc -ne 0 ] && [ -z "$out" ] && grep -qF "$expect" <<< "$stderr"; then
      pass=$((pass+1)); printf '  ok    %s\n' "$name"
    else
      fail=$((fail+1)); printf '  FAIL  %s\n        rc=%s stdout=%q (must be empty)\n        stderr lacked: %s\n%s\n' \
        "$name" "$rc" "$out" "$expect" "$stderr"
    fi
  fi
}

echo "target-device.sh fixtures"
echo
echo "  -- passes the right one (the control: these must NOT refuse) --"
check "samsung alone, no arg"        "$SAMSUNG"            ""        PASS "RZCY12330DT"
check "moto alone, no arg"           "$MOTO"               ""        PASS "ZA222JT75K"
check "samsung alone, named"         "$SAMSUNG"            "samsung" PASS "RZCY12330DT"
check "moto alone, named"            "$MOTO"               "moto"    PASS "ZA222JT75K"
check "both attached, named samsung" "$SAMSUNG
$MOTO"                                                     "samsung" PASS "RZCY12330DT"
check "both attached, named moto"    "$SAMSUNG
$MOTO"                                                     "moto"    PASS "ZA222JT75K"
check "known + stranger, no arg"     "$MOTO
$OPPO"                                                     ""        PASS "ZA222JT75K"

echo
echo "  -- refuses the wrong device --"
check "stranger alone (defect 68)"   "$OPPO"               ""        FAIL "no device this repo knows is attached"
check "stranger alone, named moto"   "$OPPO"               "moto"    FAIL "'moto' is not attached"
check "empty bus"                    ""                    ""        FAIL "no device on the bus"
check "samsung absent, named"        "$MOTO"               "samsung" FAIL "'samsung' is not attached"
check "unknown label"                "$MOTO"               "pixel"   FAIL "not a device label this repo knows"

echo
echo "  -- refuses a serial whose model does not match --"
check "samsung serial, wrong model"  "RZCY12330DT SM-G998B 36" ""    FAIL "reports model 'SM-G998B', expected 'SM-S938B'"
check "moto serial, wrong model"     "ZA222JT75K moto g54 5G 35" ""  FAIL "reports model 'moto g54 5G', expected 'moto g34 5G'"

echo
echo "  -- refuses ambiguity (new: the direction two handsets invented) --"
check "both attached, no arg"        "$SAMSUNG
$MOTO"                                                     ""        FAIL "nothing says which one you mean"

echo
echo "  -- the stranger is named rather than silently ignored --"
errf=$(mktemp)
FAKE_DEVICES="$MOTO
$OPPO" bash scripts/target-device.sh >/dev/null 2>"$errf"
if grep -qF "9WKQTQVQ8Q7XQ" "$errf" && grep -qF "WARN" "$errf"; then
  pass=$((pass+1)); echo "  ok    warns by serial when a stranger shares the bus"
else
  fail=$((fail+1)); echo "  FAIL  a stranger on the bus was not named"; cat "$errf"
fi
rm -f "$errf"

echo
echo "  -- the instrument's own control: the fake adb must be able to answer --"
if [ "$(FAKE_DEVICES="$MOTO" CONNECTSUITE_ADB=scripts/support/fake-adb.sh scripts/support/fake-adb.sh -s ZA222JT75K shell getprop ro.product.model)" = "moto g34 5G" ]; then
  pass=$((pass+1)); echo "  ok    fixture adb returns a known positive (model with spaces survives)"
else
  fail=$((fail+1)); echo "  FAIL  fixture adb cannot answer — every FAIL above may be measuring the fixture"
fi

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
