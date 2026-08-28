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
register="docs/defects.md"
evidence="docs/testing.md"
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

if [ "$fail" -eq 0 ]; then
  echo "check-defects: $(printf '%s\n' "$in_register" | grep -c .) numbered rows, all with records; open defects all carry a fix direction"
fi
exit "$fail"
