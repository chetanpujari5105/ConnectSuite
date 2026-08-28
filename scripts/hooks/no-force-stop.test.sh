#!/bin/bash
#
# Fixtures for no-force-stop.sh. Run: scripts/hooks/no-force-stop.test.sh
#
# Defect 41. The hook is the enforcement point for a rule that has already been broken once by the
# person who wrote it, so loosening its matcher needs evidence and not confidence. Three fixtures
# that must still be DENIED and three that must now PASS; all three of the second group were denied
# before the fix, which is what made this a defect rather than a preference.
set -uo pipefail

HOOK="$(dirname "$0")/no-force-stop.sh"
fail=0

check() {
  local expect="$1" name="$2" cmd="$3"
  local out
  out=$(printf '%s' "$cmd" | jq -Rs '{tool_input: {command: .}}' | "$HOOK" 2>/dev/null || true)
  local got="pass"
  printf '%s' "$out" | grep -q '"permissionDecision": *"deny"' && got="deny"
  if [ "$got" = "$expect" ]; then
    printf '  ok    %-52s (%s)\n' "$name" "$got"
  else
    printf '  FAIL  %-52s expected %s, got %s\n' "$name" "$expect" "$got"
    fail=1
  fi
}

echo "must be DENIED — these reach the device and cost the accessibility grant:"

# The exact command that caused the grant loss on 2026-08-28.
check deny "bare adb shell am force-stop" \
  'adb shell am force-stop com.chetan.connectsuite.debug'

# Quoted, which is how it is usually typed with other arguments.
check deny "quoted adb shell \"am force-stop ...\"" \
  'adb shell "am force-stop com.chetan.connectsuite.debug"'

# Buried mid-chain. A deny that only looks at the first command is not a deny.
check deny "chained after another command" \
  'adb devices && adb shell am force-stop com.chetan.connectsuite.debug; echo done'

echo
echo "must PASS — these only talk about the rule, and were all denied before defect 41 was fixed:"

# The one that found the defect: writing docs/defects.md, whose text explains the force-stop rule
# in a repo whose package is com.chetan.connectsuite.debug.
check pass "heredoc writing docs that explain the rule" \
  "$(printf 'cat > docs/defects.md <<%s\nthe force-stop rule on com.chetan.connectsuite.debug is a hook\nEOF\necho written\n' "'EOF'")"

# Reading the rule is not breaking it.
check pass "grep for the rule in the docs" \
  'grep -rn "force-stop" docs/ | grep connectsuite'

# Explaining a fix to this very hook.
check pass "commit message quoting the rule" \
  'git commit -m "no-force-stop: match am force-stop com.chetan.connectsuite as a command, not as two words"'

echo
if [ "$fail" -eq 0 ]; then
  echo "all fixtures pass"
else
  echo "FIXTURES FAILED"
fi
exit "$fail"
