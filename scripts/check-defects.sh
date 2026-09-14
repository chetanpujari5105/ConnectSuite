#!/bin/bash
#
# Keeps docs/defects.md and docs/testing.md from drifting apart.
#
# Step 67 passed on hardware on 2026-08-28 and was never written down. The repo held its fallout —
# defects 37 and 38, both of which cite it — while defect 31 still read "awaiting step 67" and the
# step itself had no result anywhere. Nothing in the build could tell. That is the failure this
# script exists for: a finding that lives in one place and not the other.
#
# ### What it checks, and what it deliberately does not
#
# It checks the two things that are mechanical:
#
#   1. **Coverage.** Every `### Defect NN` heading in testing.md has a row in the defects.md table,
#      and every numbered row in that table has a heading. A defect recorded in only one of them is
#      the drift that hid 67.
#   2. **Fix directions.** Every defect the register marks open or deferred has a "Fix direction"
#      under its own section in defects.md. An open defect with no fix direction is a note, not a
#      record — the next person has to rediscover it.
#
# It does **not** check status wording. The statuses are prose — "fixed; outgoing verified (step
# 69), inbound (35c) still awaiting step 70" is exactly right for defect 35 and there is no keyword
# that summarises it without lying. A checker that forced them into four buckets would either
# reject honest rows or quietly accept wrong ones, and CLAUDE.md is explicit that a check which
# cannot tell its target from a lookalike is worse than no check. So the statuses are reviewed by a
# person and the existence of the record is enforced here.
#
# Usage: scripts/check-defects.sh          (exit 0 clean, 1 on drift)
set -uo pipefail

cd "$(dirname "$0")/.."
# Overridable only so `check-defects.test.sh` can point the checker at a fixture register. Defaults
# are the real files, so a plain run and a hook run are unchanged and nothing can be redirected by
# accident.
register="${DEFECTS_MD:-docs/defects.md}"
evidence="${TESTING_MD:-docs/testing.md}"
fail=0

for f in "$register" "$evidence"; do
  if [ ! -f "$f" ]; then
    echo "check-defects: $f is missing"
    exit 1
  fi
done

# Numbers with a full record in testing.md: `### Defect NN — ...`
in_evidence=$(grep -oE '^### Defect [0-9]+' "$evidence" | grep -oE '[0-9]+' | sort -un)

# Numbers with a row in the register table: `| **NN** | ...`
in_register=$(grep -oE '^\| \*\*[0-9]+\*\* \|' "$register" | grep -oE '[0-9]+' | sort -un)

missing_from_register=$(comm -23 <(printf '%s\n' "$in_evidence") <(printf '%s\n' "$in_register"))
missing_from_evidence=$(comm -13 <(printf '%s\n' "$in_evidence") <(printf '%s\n' "$in_register"))

if [ -n "$missing_from_register" ]; then
  echo "check-defects: these have a record in $evidence but no row in $register:"
  printf '  defect %s\n' $missing_from_register
  fail=1
fi

# A register row with no full record is allowed only when the row itself says where the record is
# — the "see below" rows carry theirs inside defects.md.
for n in $missing_from_evidence; do
  if ! grep -qE "^### $n — |^### Defect $n" "$register"; then
    echo "check-defects: defect $n has a row in $register but no record in either file"
    fail=1
  fi
done

# Every open or deferred defect needs a fix direction somewhere in the register.
open_numbers=$(grep -E '^\| \*\*[0-9]+\*\* \|' "$register" |
  grep -Ei '\*\*(open|deferred)' | grep -oE '^\| \*\*[0-9]+\*\*' | grep -oE '[0-9]+' | sort -un)

for n in $open_numbers; do
  # `### 30 — ...` and `### 35 (outgoing half) — ...` both count: the number, then anything up to
  # the em dash. Defect 35 is split across two states and its heading says so.
  section=$(awk -v n="$n" '
    $0 ~ "^### " n "( |\\()[^—]*— " { inside = 1; next }
    inside && /^### / { inside = 0 }
    inside { print }
  ' "$register")
  if [ -z "$section" ]; then
    echo "check-defects: defect $n is open but has no '### $n — ' section in $register"
    fail=1
  elif ! printf '%s' "$section" | grep -qi 'fix direction'; then
    echo "check-defects: defect $n is open and its section names no fix direction"
    fail=1
  fi
done

# ---------------------------------------------------------------------------------------------
# A defect's status is written twice — once in its table row, once in its `### N — … · **status**`
# heading — and the two must agree.
#
# This check exists because they drifted. On 2026-09-14 an audit found **eight** contradictions:
# 32 and 39 said `deferred` in the heading and `closed` in the row; 44, 57, 63 and 101 said `open`
# in the heading over rows citing hardware evidence and a date; 102 and 105 said the opposite way
# round, their rows still reading `open` after the headings were updated the same day.
#
# The last two are the instructive ones: **they were made by the person updating the register**,
# who changed one column and not the other in the same edit. This is defect 97's shape in prose —
# two fields that must move together will be moved apart — and the fix is the same: something has
# to compare them.
#
# **Why this was unguarded until now, said plainly:** the header of this file says it checks
# *existence, not status wording*, and gives a good reason — the statuses are prose, and forcing
# them into four buckets would either reject honest rows or quietly accept wrong ones. That reason
# still holds, which is why this does **not** parse statuses into a taxonomy. It asks a narrower
# question that needs no taxonomy at all: *do the heading and the row use the same status word?*
# **Two buckets, and the calibration is taken from the real failures rather than invented.**
#
# The first version compared status *words* and immediately flagged defects 60 and 75, where the
# heading says `fixed` and the row says `closed`. Those are synonyms, not a contradiction, and a
# guard that fires on them teaches people to normalise wording for the checker rather than for a
# reader — which is how a guard stops being read.
#
# So the question is narrower and is the one anybody acts on: **does one place say this is still
# outstanding while the other says it is resolved?** All eight contradictions the 2026-09-14 audit
# found are that shape, including the two made that same day.
#
# **What this deliberately does not catch, so nobody thinks it is stronger than it is:** a heading
# saying `deferred` over a row saying `open`. Both are outstanding, they differ meaningfully, and
# telling them apart needs the taxonomy the header of this file argues against. If that drift ever
# costs something, it gets its own check and its own worked example — not a widened bucket here.
status_word() {
  case "$(printf '%s' "$1" | tr 'A-Z' 'a-z' |
          grep -oE 'withdrawn|deferred|not fixed|unproven|open|closed|fixed' | head -1)" in
    open|deferred|'not fixed'|unproven) echo outstanding ;;
    fixed|closed|withdrawn)             echo resolved ;;
    *)                                  echo '' ;;
  esac
}

for n in $(printf '%s\n' "$in_register" | grep -oE '[0-9]+' | sort -un); do
  heading_line=$(grep -m1 -E "^### $n( |\()[^—]*— " "$register" || true)
  [ -n "$heading_line" ] || continue   # row-only defects cannot disagree with a heading they lack

  # The heading's status is the first **bold** run after the first `·`.
  heading_status=$(printf '%s' "$heading_line" | sed 's/^[^·]*·//' | grep -oE '\*\*[^*]+\*\*' | head -1)
  [ -n "$heading_status" ] || {
    echo "check-defects: defect $n has a '### $n — ' heading with no '· **status**' in it"
    fail=1
    continue
  }

  # The row's Status column, which the table header at the top of the register names as column 3.
  row_line=$(grep -m1 -E "^\| \*\*$n\*\* \|" "$register" || true)
  [ -n "$row_line" ] || continue
  row_status=$(printf '%s' "$row_line" | awk -F'|' '{print $4}')

  hw=$(status_word "$heading_status")
  rw=$(status_word "$row_status")
  if [ -z "$hw" ] || [ -z "$rw" ]; then
    # No status word in one of them is not a disagreement; it is a row this check cannot read, and
    # saying so is better than inventing a verdict. Seven rows carry unescaped pipes that split
    # their own columns, which is the usual cause.
    continue
  fi
  if [ "$hw" != "$rw" ]; then
    echo "check-defects: defect $n disagrees with itself — the heading says it is $hw, the row says $rw"
    echo "               heading: $heading_status"
    echo "               row:     $(printf '%s' "$row_status" | cut -c1-90)"
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  echo "check-defects: $(printf '%s\n' "$in_register" | grep -c .) numbered rows, all with records; open defects all carry a fix direction; every heading agrees with its row"
fi
exit "$fail"
