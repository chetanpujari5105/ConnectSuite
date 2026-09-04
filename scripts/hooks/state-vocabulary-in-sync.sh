#!/bin/bash
#
# Refuses a commit that leaves docs/empty-and-failure-states.md disagreeing with its own tables.
#
# That document is an argument FROM its numbers — "28 sentences for one idea" is the finding, not a
# caption on it — so a heading claiming 24 over a table of 28 understates the case by four and reads
# as authoritative while doing it. Its first version had four such numbers wrong, typed while
# grouping rather than counted afterwards.
#
# Fails **open**, like the others: a checker that can wedge the repo gets deleted by the first
# person it wedges.
set -uo pipefail

repo="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
check="$repo/scripts/check-state-vocabulary.mjs"

[ -f "$check" ] || exit 0
[ -f "$repo/docs/empty-and-failure-states.md" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0

if ! output=$(cd "$repo" && node "$check" 2>&1); then
  if printf '%s' "$output" | grep -q '  FAIL: '; then
    jq -n --arg detail "$output" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          ("docs/empty-and-failure-states.md disagrees with its own tables, and this commit would record that.\n\n"
           + $detail
           + "\n\nThe tables are the source and the prose is derived from them. Fix the prose, never the tables.\n\nRun node scripts/check-state-vocabulary.mjs to re-check.")
      }
    }'
  fi
fi
exit 0
