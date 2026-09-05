#!/bin/bash
#
# Refuses a commit that puts an `export` into a shared file the renderer loads as a plain <script>.
#
# The eighth of these, and the only one guarding a failure that nothing else in the repo can see at
# all. `tsc` is clean, `npm test` is green, and the page usually still works — because a `function`
# declaration is hoisted onto globalThis before the CommonJS preamble throws. A `class` is not, so
# the same mistake made with a class produces one symbol silently undefined in the browser and no
# error anywhere.
#
# Measured 2026-09-05: `discHue.ts` had carried `export function discHue` for a phase. Its emitted
# first line references `exports`, which does not exist in a classic script, so the file threw and
# the globalThis block at its bottom — the one its own comment credited for making it work — had
# never executed. It worked by hoisting. `ContactPhotos`, written the same way with a class, did
# not, and that is how the whole thing came out.
#
# Scope comes from index.html, not from the directory: src/shared/ also holds modules the main
# process imports normally, and those keep their exports. The matcher is anchored on a declaration
# rather than the word, so prose about the rule stays legal — defect 41's lesson, with fixtures for
# both directions.
#
# Fails **open**, like its siblings: any error running the check allows the commit, and it blocks
# only on a real finding. A checker that can wedge the repo gets deleted by the first person it
# wedges.
set -uo pipefail

repo="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
check="$repo/scripts/check-renderer-scripts.mjs"

[ -f "$check" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0

if ! output=$(node "$check" 2>&1); then
  if printf '%s' "$output" | grep -q 'carries an export'; then
    jq -n --arg detail "$output" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          ("A shared file the page loads as a plain <script> carries an export declaration.\n\n"
           + $detail
           + "\n\nWhat happens: an export makes the file a module, tsc compiles it to CommonJS, and the first emitted statement is Object.defineProperty(exports, ...). There is no `exports` in a classic script, so the file throws on its first line and every declaration below it is dead - including the globalThis block at the bottom.\n\nWhy it can look fine anyway: a function declaration is hoisted onto globalThis before the body runs, so a file exporting only functions survives by accident. A class does not, and its symbol is simply undefined in the page with nothing reporting it. discHue.ts shipped in the first state for a phase.\n\nThe fix is to drop the keyword. Declare plainly, hang the symbols on globalThis for the page, and on module.exports for the tests - see src/shared/islandRota.ts. Tests reach it with createRequire, not import.\n\nRun node scripts/check-renderer-scripts.mjs to re-check, and node --test scripts/check-renderer-scripts.test.mjs for its fixtures.")
      }
    }'
  fi
fi
exit 0
