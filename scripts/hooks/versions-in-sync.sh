#!/bin/bash
#
# Refuses a commit that leaves the two apps disagreeing about the product version.
#
# The same shape as its siblings and for the same reason. On 2026-09-02 the Android app said
# `versionName = "1.0.0"` and the Mac said `"version": "2.0.0"`; both had been there since their
# first commits, neither was wrong on its own, and nothing in the build reads both — so the
# disagreement was invisible. A fact in two places with nothing comparing them is exactly what
# defects-in-sync.sh and protocol-spec-in-sync.sh exist for.
#
# It is cheap to hold now and it will never be cheap again: an Android `versionCode` may never go
# down, so the first release freezes both numbers into everybody's installed app.
#
# Fails **open**, like its siblings: any error running the check allows the commit, and only a
# genuine `FAIL:` line blocks. An INSTRUMENT FAILURE means a version could not be read at all,
# which is a reason to look rather than a reason to stop somebody committing.
set -uo pipefail

repo="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
check="$repo/scripts/check-versions.mjs"

[ -f "$check" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0

if ! output=$(node "$check" 2>&1); then
  if printf '%s' "$output" | grep -q '  FAIL: '; then
    jq -n --arg detail "$output" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          ("The two apps disagree about what version of ConnectSuite this is, and this commit would record that.\n\n"
           + $detail
           + "\n\nOne scheme, one number: app/build.gradle.kts versionName and desktop/package.json version are the same string, and versionCode is Android'\''s own monotonic integer that nothing derives. See docs/versioning.md.\n\nRun node scripts/check-versions.mjs to re-check, and node --test scripts/check-versions.test.mjs for its fixtures.")
      }
    }'
  fi
fi
exit 0
