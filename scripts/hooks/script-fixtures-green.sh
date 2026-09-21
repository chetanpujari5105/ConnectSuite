#!/bin/bash
#
# Refuses a commit that leaves a fixture suite under scripts/ red.
#
# The fifteenth of these, and the one that closes a gap two of its siblings name out loud.
# check-suites-run.sh guards Gradle and npm test; orphan-tests-none.sh says in its own header that
# "scripts/*.test.mjs are counted and reported, not checked". Nineteen suites, about two seconds,
# run by nothing - so one went red on a branch and stayed red.
#
# check-renderer-scripts.test.mjs asserts that index.html loads discHue.js and that the scan sees
# it. discHue.ts was deleted with its last caller, correctly, and the control that named it rotted.
# The guard it belongs to went on passing, because its scope comes from index.html and a file no
# longer listed there is simply not in scope. A guard passing is not its fixtures passing.
#
# It RUNS them rather than reading an artifact, unlike check-suites-run: two seconds is affordable
# and there is no artifact to read. If that ever stops being true, the answer is the artifact, not
# a hook people route around.
#
# Fails open on its own errors, like its siblings. A checker that can wedge the repo gets deleted
# by the first person it wedges.
set -uo pipefail

repo="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
check="$repo/scripts/check-script-fixtures.mjs"

[ -f "$check" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0

if ! output=$(cd "$repo" && node "$check" 2>&1); then
  if printf '%s' "$output" | grep -qE '^  RED |REFUSED'; then
    jq -n --arg detail "$output" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          ("A fixture suite under scripts/ is red, or discovery found too few to be a reading.\n\n"
           + $detail
           + "\n\nThese are the tests that prove the commit guards can fail. A guard whose fixtures are red is a guard nobody has evidence about - and because nothing else runs them, a red one stays red silently while the guard it belongs to keeps reporting OK.\n\nA REFUSED line is not a failing suite: it means discovery came back empty or below its floor, which is an instrument failure rather than a pass.\n\nFix the suite, or fix what it found. Run node scripts/check-script-fixtures.mjs to re-check, node scripts/check-script-fixtures.mjs --list to see what it discovers, and node scripts/check-script-fixtures.test.mjs for its own fixtures.")
      }
    }'
  fi
fi
exit 0
