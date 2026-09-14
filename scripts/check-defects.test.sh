#!/bin/bash
#
# Fixtures for the heading-agrees-with-row half of `check-defects.sh`.
#
# Written because the guard was shipped after an audit, and a guard written after a failure and
# never run against that failure has not been tested against the only case it is known to have
# missed. The first fixture is therefore **defect 101 as it actually stood** on 2026-09-14 — heading
# `**open**`, row `**fixed** 2026-09-10` — and not a cleaner invention.
#
# Each case carries its opposite, per the repo's control rule.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
pass=0; fail=0

# A register with one row and one heading, plus the surrounding shape the checker needs.
register() {
  cat > "$tmp/defects.md" <<EOF
# Defect register

| # | One line | Status | Verified by | Full record |
|---|---|---|---|---|
| **$1** | a one-line description | $2 | some evidence | \`docs/testing.md\` |

### $1 — a one-line description · $3 · found 2026-01-01

**Fix direction:** something.
EOF
  printf 'defect %s\n' "$1" > "$tmp/testing.md"
}

check() {
  local name="$1" want="$2"
  local out code
  out=$(cd "$repo" && DEFECTS_MD="$tmp/defects.md" TESTING_MD="$tmp/testing.md" \
        scripts/check-defects.sh 2>&1); code=$?
  if [ "$code" -eq "$want" ]; then
    pass=$((pass+1)); printf 'ok    %s\n' "$name"
  else
    fail=$((fail+1)); printf 'FAIL  %s (exit %s, wanted %s)\n%s\n' "$name" "$code" "$want" "$out"
  fi
}

# 1. THE REAL CASE — defect 101 exactly as it stood before it was corrected.
register 101 '**fixed** 2026-09-10, and the emitter is named' '**open**'
check 'the verbatim 101: heading open over a fixed row is refused' 1

# 2. Its control — the same defect once the heading agrees.
register 101 '**fixed** 2026-09-10, and the emitter is named' '**fixed 2026-09-10**'
check 'control: heading and row both resolved passes' 0

# 3. The other direction, which is how 102 and 105 drifted: row stale, heading current.
register 102 '**open.** Detection exists and is one call' '**fixed 2026-09-11**'
check 'the reverse drift: row open over a fixed heading is refused' 1

# 4. Synonyms are not a contradiction. This is the calibration, and it fired before it was set.
register 60 '**closed** — proven on hardware' '**fixed**'
check 'control: fixed against closed is a synonym, not drift' 0

# 5. Two outstanding words differ meaningfully and are deliberately NOT caught. Asserted so the
#    limit is a decision on the record rather than something a reader discovers.
register 17 '**open** — needs a second device' '**deferred**'
check 'known gap: deferred against open is allowed through, on purpose' 0

echo
echo "check-defects fixtures: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
