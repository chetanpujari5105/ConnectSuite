#!/bin/bash
#
# Refuses a commit that leaves docs/defects.md and docs/testing.md disagreeing about which defects
# exist, or that leaves an open defect with no fix direction.
#
# The reason this is a hook and not a line in CLAUDE.md is the same reason the force-stop rule is:
# the doc did not work. Step 67 passed on hardware and went unrecorded, and defect 31 sat reading
# "awaiting step 67" while it had in fact been verified — for a whole sitting, with nobody
# suspecting, because nobody suspects that while writing a commit message.
#
# It fails **open**. Any error running the check — missing file, unreadable docs, a bad awk on some
# future shell — allows the commit rather than blocking work on a checker's own bug. A checker that
# can wedge a repo gets deleted by the first person it wedges, and then there is no checker.
set -uo pipefail

repo="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
check="$repo/scripts/check-defects.sh"

[ -x "$check" ] || exit 0

if ! output=$("$check" 2>&1); then
  # Only block on a genuine drift report; anything else is the checker misbehaving.
  if printf '%s' "$output" | grep -q '^check-defects: '; then
    jq -n --arg detail "$output" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          ("docs/defects.md and docs/testing.md disagree, and this commit would record that.\n\n"
           + $detail
           + "\n\nThe register is the index and docs/testing.md holds the evidence; a defect in one and not the other is how step 67 went unrecorded. Add the missing row or section, then commit.\n\nRun scripts/check-defects.sh to re-check. It checks existence, not status wording — the statuses are prose and are reviewed by a person.")
      }
    }'
  fi
fi
exit 0
