#!/bin/bash
#
# Refuses a commit that puts a message type on the wire without specifying it in docs/protocol.md.
#
# The same shape as defects-in-sync.sh, for the same reason. `media.buckets`, `media.list`,
# `media.thumb` and `media.original` were listed in the contract and specified nowhere in it for a
# whole phase; the note left behind said the migration was owed by whoever next touched `media.*`,
# which is a rule enforced by someone remembering. Two of the four were mentioned five and four times in
# prose about a different type, so the gap survived every reading of the document.
#
# It fails **open**, exactly as its sibling does: any error running the check allows the commit. A
# checker that can wedge a repo gets deleted by the first person it wedges, and then there is no
# checker. The debt list is printed on every run, pass or fail — a type that is deliberately
# unspecified stays visible rather than becoming invisible.
set -uo pipefail

repo="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
check="$repo/scripts/check-protocol-spec.mjs"

[ -f "$check" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0

if ! output=$(node "$check" 2>&1); then
  # Only block on a genuine finding; an INSTRUMENT FAILURE line means nothing was checked.
  if printf '%s' "$output" | grep -q '  FAIL: '; then
    jq -n --arg detail "$output" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          ("A message type on the wire is not specified in docs/protocol.md, and this commit would record that.\n\n"
           + $detail
           + "\n\ndocs/protocol.md is the contract: a type named in its inventory and described nowhere is a payload two implementations have to agree about silently. Specify it — a heading or a paragraph that opens with the backticked type name — or add it to the UNSPECIFIED debt list in scripts/check-protocol-spec.mjs with the reason it is not being written yet.\n\nRun node scripts/check-protocol-spec.mjs to re-check.")
      }
    }'
  fi
fi
exit 0
