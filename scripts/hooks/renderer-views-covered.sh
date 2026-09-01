#!/bin/bash
#
# Refuses a commit that adds a renderer view class nobody's test constructs.
#
# The fourth of these hooks, and the one with the most sightings behind it: `showsState`, defect 58
# and defect 59 were three renderer-only breaks with a green suite, all from the same structural
# cause — the view classes are reachable by no test, and `clipboard.test.ts` literally deleted one
# from the source before evaluating it.
#
# It does not demand the nine existing views be retro-fitted; those are on a printed debt list with
# a reason each. What it stops is a *tenth* arriving unaccounted for, and a debt entry being left in
# place after the view is covered.
#
# Fails **open**, like its three siblings: any error running the check allows the commit, because a
# checker that can wedge the repo gets deleted by the first person it wedges. It blocks only on a
# FAIL line, never on an INSTRUMENT FAILURE — a scan that read nothing has found nothing.
set -uo pipefail

repo="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
check="$repo/scripts/check-renderer-views.mjs"

[ -f "$check" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0

if ! output=$(node "$check" 2>&1); then
  if printf '%s' "$output" | grep -q '  FAIL: '; then
    jq -n --arg detail "$output" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          ("A renderer view class is drawn by nobody'"'"'s test, and this commit would record that.\n\n"
           + $detail
           + "\n\nThree renderer-only defects have shipped with a green suite for exactly this reason — the Files pane'"'"'s showsState (twice, in opposite directions), defect 58'"'"'s missing Restore row, and defect 59'"'"'s invisible watcher send.\n\nWrite a test that constructs the view: src/renderer/domDouble.testkit.ts is the harness and src/renderer/clipboardView.test.ts is the worked example — mount it, fire the bridge callbacks, assert on the drawn tree. If it genuinely cannot be covered yet, add it to UNCOVERED in scripts/check-renderer-views.mjs with the reason, and expect to be asked about it.\n\nRun node scripts/check-renderer-views.mjs to re-check, and node --test scripts/check-renderer-views.test.mjs for its fixtures.")
      }
    }'
  fi
fi
exit 0
