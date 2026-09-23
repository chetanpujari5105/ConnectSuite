#!/bin/bash
#
# Fixtures for no-force-stop.sh. Run: scripts/hooks/no-force-stop.test.sh
#
# Defect 41. The hook is the enforcement point for a rule that has already been broken once by the
# person who wrote it, so loosening its matcher needs evidence and not confidence. Three fixtures
# that must still be DENIED and three that must now PASS; all three of the second group were denied
# before the fix, which is what made this a defect rather than a preference. Defect 144 added four
# denies for `am start -S` (all passed through the old matcher) and four passes around it.
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

# Defect 144: `am start -S` force-stops before launching. It slipped past the matcher above.
check deny "am start -S on our package" \
  'adb shell am start -S -n com.chetan.connectsuite.debug/com.chetan.connectsuite.MainActivity'

# The exact shape that ran on 2026-09-23, through the pin wrapper, with -S among other flags.
check deny "am start -S -W --activity-clear-task, via adb-pinned" \
  'scripts/adb-pinned.sh emu shell am start -S -W --activity-clear-task -n com.chetan.connectsuite.debug/com.chetan.connectsuite.MainActivity'

# Clustered short flags carry the same S.
check deny "am start -WS clustered" \
  'adb shell "am start -WS -n com.chetan.connectsuite.debug/com.chetan.connectsuite.MainActivity"'

# Package before the flag.
check deny "am start-activity with -S after the component" \
  'adb shell am start-activity -n com.chetan.connectsuite.debug/com.chetan.connectsuite.MainActivity -S'

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

# Defect 144's opposite: an ordinary start is how LinkService comes back after `install -r`.
check pass "ordinary am start of MainActivity" \
  'adb -s RZCY12330DT shell am start -n com.chetan.connectsuite.debug/com.chetan.connectsuite.MainActivity'

# -W alone (wait) is not a stop, and lowercase -s is adb's serial flag.
check pass "am start -W with adb -s serial" \
  'adb -s emulator-5554 shell am start -W -n com.chetan.connectsuite.debug/com.chetan.connectsuite.MainActivity'

# -S on another package is not ours to guard.
check pass "am start -S on a different package" \
  'adb shell am start -S -n com.example.other/.Main'

# -S in a different segment from our start does not stop our app.
check pass "-S belongs to another command in the chain" \
  'sort -S 10% big.txt; adb shell am start -n com.chetan.connectsuite.debug/com.chetan.connectsuite.MainActivity'

echo
if [ "$fail" -eq 0 ]; then
  echo "all fixtures pass"
else
  echo "FIXTURES FAILED"
fi
exit "$fail"
