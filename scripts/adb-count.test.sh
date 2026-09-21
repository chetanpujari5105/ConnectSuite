#!/bin/bash
# Fixtures for adb-count.sh: three that must refuse, two that must read.
#
# The matcher without fixtures is a rule you are guessing about — no-force-stop.sh's lesson, applied
# to a guard whose whole job is to refuse. The refusals are the interesting half here: this exists
# because a REFUSAL that scrolled past on stderr was wrapped in a pipeline that printed a confident
# 0 on stdout.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

pass=0; fail=0
check() { # check <name> <expect: READING|NO READING> <expected exit> <output> <actual exit>
  local name="$1" want="$2" wantrc="$3" got="$4" rc="$5"
  if [[ "$got" == "$want"* ]] && [ "$rc" = "$wantrc" ]; then
    echo "  ok    $name"; pass=$((pass+1))
  else
    # `'$want…'` — bash takes the ellipsis bytes as part of the name, so under `set -u` the FAIL
    # branch died with `want?: unbound variable` and printed no diagnosis at all. It had never run:
    # this suite was green until adb-pinned.sh stopped being fakeable, and then reported its first
    # failure by crashing. Braces, so the name ends where it ends.
    echo "  FAIL  $name"; echo "        wanted '${want}…' exit ${wantrc}"; echo "        got    '${got}' exit ${rc}"; fail=$((fail+1))
  fi
}

export CONNECTSUITE_ADB="scripts/support/fake-adb.sh"
SAMSUNG='RZCY12330DT SM-S938B 36'

# --- must REFUSE ------------------------------------------------------------------------------
out=$(FAKE_DEVICES="" scripts/adb-count.sh samsung 'x' -- shell echo hi 2>/dev/null); rc=$?
check "no device on the bus refuses" "NO READING" 1 "$out" "$rc"

out=$(FAKE_DEVICES="$SAMSUNG" scripts/adb-count.sh nosuchlabel 'x' -- shell echo hi 2>/dev/null); rc=$?
check "unknown label refuses" "NO READING" 1 "$out" "$rc"

out=$(FAKE_DEVICES="$SAMSUNG" scripts/adb-count.sh samsung 'x' -- shell emptyoutput 2>/dev/null); rc=$?
check "ran but produced nothing refuses" "NO READING" 1 "$out" "$rc"

# --- must READ, and carry a denominator ---------------------------------------------------------
out=$(FAKE_DEVICES="$SAMSUNG" scripts/adb-count.sh samsung 'SM-S938B' -- shell getprop ro.product.model 2>/dev/null); rc=$?
check "a real match reads" "READING  1 of 1" 0 "$out" "$rc"

out=$(FAKE_DEVICES="$SAMSUNG" scripts/adb-count.sh samsung 'nothing-matches-this' -- shell getprop ro.product.model 2>/dev/null); rc=$?
check "a genuine zero is still a READING" "READING  0 of 1" 0 "$out" "$rc"

echo
echo "adb-count.test.sh: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
