#!/bin/bash
#
# Refuses a commit whose prose claims a message type works that the debt list says is unimplemented.
#
# The reason this is a hook: the debt list was already correct, complete, and printed on every run —
# and `docs/RESUME.md` still said two unimplemented types were "already on the wire", and a sitting
# started on that. A list that can only inform is decoration. This is the list being able to deny.
#
# Fails **open**, like every other checker here.
set -uo pipefail

repo="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
check="$repo/scripts/check-debt-claims.mjs"

[ -f "$check" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0

if ! output=$(cd "$repo" && node "$check" 2>&1); then
  if printf '%s' "$output" | grep -q '  FAIL: '; then
    jq -n --arg detail "$output" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          ("A document claims a message type works that the debt list says is unimplemented, and this commit would record that.\n\n"
           + $detail
           + "\n\nThis is the failure that cost the O4 sitting its premise: the debt list was right and printed on every run, and nobody read it. Either implement the type and take it off the list in scripts/check-protocol-spec.mjs, or fix the sentence.\n\nRun node scripts/check-debt-claims.mjs to re-check, and node --test scripts/check-debt-claims.test.mjs for its fixtures.")
      }
    }'
  fi
fi
exit 0
