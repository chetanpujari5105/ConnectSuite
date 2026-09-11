#!/bin/bash
#
# Refuses a commit that leaves a tracked test file no runner can discover.
#
# The ninth of these, and the one guarding a failure with no symptom of any kind.
# desktop/core/src/test/java/.../ScreenGeometryRegistryTest.kt was tracked for a week and had never
# compiled: there is no :desktop:core module, so Gradle never saw the directory. Six tests over the
# geometry stamp that stops a tap landing in the wrong place, sitting green-looking and unexecuted.
# It passed when finally run, which is luck - the same file could have been red throughout and
# nothing in the repo would have said so. No count here has ever included it.
#
# Scope is the two runners that DISCOVER files - Gradle's include list and npm test's own glob,
# both read from the files that define them rather than hardcoded. A runner given an explicit path
# cannot silently miss a file, so scripts/*.test.mjs are counted and reported, not checked.
#
# Fails open, like its siblings.
set -uo pipefail

repo="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
check="$repo/scripts/check-orphan-tests.mjs"

[ -f "$check" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0

if ! output=$(node "$check" 2>&1); then
  if printf '%s' "$output" | grep -q 'ORPHAN:'; then
    jq -n --arg detail "$output" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          ("A tracked test file sits where no runner can discover it, so it will never execute.\n\n"
           + $detail
           + "\n\nThis is not a failing test - it is a test that does not run at all, and nothing else in this repo can see that. A suite total counts the files a runner found; a file no runner found is absent from the total rather than visible as a gap. ScreenGeometryRegistryTest.kt sat in this state for a week over the stamp that keeps a tap from landing on the wrong app.\n\nFix: move a Kotlin test under a module settings.gradle.kts includes, or add the module. Move a .test.ts under the glob in desktop/package.json, or widen the glob - the check reads both from those files, so changing them changes the check.\n\nRun node scripts/check-orphan-tests.mjs to re-check, and node --test scripts/check-orphan-tests.test.mjs for its fixtures.")
      }
    }'
  fi
fi
exit 0
