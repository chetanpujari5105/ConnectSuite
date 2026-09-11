#!/bin/bash
#
# Refuses a commit whose touched half of the suite is red, unrun, or older than the change — and on
# every commit says plainly **which half it did not check**.
#
# `ProtocolNamespaceTest` was committed red and lived on the branch for days. The commit that broke
# it ran `npm test` in `desktop/`, saw 623 green, and never asked the phone. Nothing could have
# noticed: a green is a statement about the suite that ran, and a suite nobody runs is invisible in
# it. The other nine hooks all read documents; not one of them reads a test result.
#
# It does **not** run the suites. Both on every commit is ~15 s warm and minutes cold, and a hook
# that slow is a hook people route around — which is how a guard stops guarding. It reads what the
# runners left behind and reports the age of each artifact beside its verdict, which is the repo's
# own rule about the stale results XML: an artifact older than the run is a memory, not a result.
#
# It fails **open** on its own errors, like defects-in-sync.sh. A checker that can wedge the repo
# gets deleted by the first person it wedges, and then there is no checker. Exit 2 from the checker
# means the checker itself broke and the commit is allowed.
set -uo pipefail

repo="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
check="$repo/scripts/check-suites-run.mjs"

[ -f "$check" ] || exit 0

output=$(node "$check" --staged 2>&1)
code=$?

# 0 = nothing to say. 2 (or anything unexpected) = the checker misbehaved; allow.
[ "$code" -eq 1 ] || exit 0

jq -n --arg detail "$output" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason:
      ("A half of the suite this commit touches is red, unrun, or older than the change.\n\n"
       + $detail
       + "\n\nThis is the ProtocolNamespaceTest failure: it was committed RED and survived for days because the commit that broke it ran npm test in desktop/, saw 623 green, and never asked the phone. A green is a statement about the suite that ran.\n\nRun the half named above:\n  phone:  JAVA_HOME=\"/Applications/Android Studio.app/Contents/jbr/Contents/Home\" ./gradlew testDebugUnitTest\n  Mac:    cd desktop && npm test\n\nSTALE means the artifact is older than the source and proves nothing about these bytes; UNRUN means that half has never said anything at all; RED means it has, and the answer was no. They are three different findings and are not collapsed.\n\nRun node scripts/check-suites-run.mjs --staged to re-check, and node --test scripts/check-suites-run.test.mjs for its fixtures.")
  }
}'
exit 0
