#!/bin/bash
#
# Refuses a commit that gives the clipboard echo interlock a second home.
#
# The third of these, and the same shape as its two siblings. What makes it worth a hook rather than
# a comment is that the rule became load-bearing on the day auto-apply landed: before it, a cycle
# needed a person to press a button once per hop, which is not a cycle; after it, the comparison in
# ClipEcho is the only thing between two auto-applying clipboards and a runaway.
#
# The rule already had two homes once — `shouldSend` in clipboardHistory.ts and
# ClipboardPayloads.shouldSend on the phone — each with its own passing test. Moving the rule would
# have left both green over functions nothing called, which reads exactly like coverage.
#
# Fails **open**, like both siblings: any error running the check allows the commit. A checker that
# can wedge the repo gets deleted by the first person it wedges, and then there is no checker. It
# blocks only on a FAIL line, never on an INSTRUMENT FAILURE — a scan that read nothing has found
# nothing, in either direction.
set -uo pipefail

repo="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
check="$repo/scripts/check-clip-echo.mjs"

[ -f "$check" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0

if ! output=$(node "$check" 2>&1); then
  if printf '%s' "$output" | grep -q '  FAIL: '; then
    jq -n --arg detail "$output" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          ("The clipboard echo interlock has grown a second home, and this commit would record that.\n\n"
           + $detail
           + "\n\nThe interlock is what stops two auto-applying clipboards writing each other in a circle, and it is proven by clipEcho.test.ts and ClipEchoTest driving it against a peer that echoes everything back forever. A copy of the rule outside ClipEcho is a copy those tests do not reach: it will be the one that rots, and its own test will keep passing while it does.\n\nCall ClipEcho.maySend / arrived / appliedLocally instead of holding the value. If the new state genuinely is not the interlock, name it something that is not lastReceived or lastSent.\n\nRun node scripts/check-clip-echo.mjs to re-check, and node --test scripts/check-clip-echo.test.mjs for its fixtures.")
      }
    }'
  fi
fi
exit 0
