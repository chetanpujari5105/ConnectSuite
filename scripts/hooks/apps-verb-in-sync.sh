#!/bin/bash
#
# Refuses a commit that puts `apps.launch` into shipping source.
#
# The seventh of these, and the one guarding a rule the contract states in words: exactly one of
# `apps.launch` / `apps.open.ask` may ever exist, and the measurement chose. What makes it worth a
# hook rather than the sentence already in docs/protocol.md is that the forbidden name is the
# *better* one — shorter, the obvious verb, what anybody would autocomplete to. This is not guarding
# against carelessness; it is guarding against the more attractive option.
#
# And the failure it prevents is silent in the way this repo keeps paying for. Adding the constant
# breaks nothing, registering a handler breaks nothing, and the whole thing is only wrong at the far
# end — where a Mac dims a tile because the launch "succeeded" and a person watches an app not open.
# Measured on this handset 2026-09-03: a backgrounded startActivity returns normally, logs nothing,
# and does not bring the app to the front.
#
# The checker separates a *use* from a *mention* — quoted literals and identifiers, with comments
# stripped — so prose about the prohibition stays legal. That is defect 41's lesson: a guard that
# forbids writing its own other half has broken the pair it is supposed to be, and this one has a
# fixture asserting exactly that case passes.
#
# Fails **open**, like all six siblings: any error running the check allows the commit. A checker
# that can wedge the repo gets deleted by the first person it wedges. It blocks only on a FAIL line,
# never on an INSTRUMENT FAILURE — a scan that read nothing has found nothing, in either direction.
set -uo pipefail

repo="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
check="$repo/scripts/check-apps-verb.mjs"

[ -f "$check" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0

if ! output=$(node "$check" 2>&1); then
  if printf '%s' "$output" | grep -q '  FAIL: '; then
    jq -n --arg detail "$output" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          ("A launch verb has reappeared in the apps namespace, and this commit would record that.\n\n"
           + $detail
           + "\n\nThere is no apps.launch. Measured on this handset 2026-09-03 (docs/phase-7-apps-proposal.md 2.4): with ConnectSuite backgrounded, startActivity for a third-party package threw nothing, logged nothing, and did not bring the app to the front. A verb built on that reports success and does nothing, which is worse than an absent feature.\n\nThe verb that ships is apps.open.ask. Its ack means the phone ASKED its user - a notification was posted - and it carries no field saying whether the app opened, because the phone does not know and will not learn.\n\nIf you need to write ABOUT the forbidden name, put it in a comment or in docs/: the checker strips comments and does not read Markdown, and has a fixture asserting prose passes.\n\nRun node scripts/check-apps-verb.mjs to re-check, and node --test scripts/check-apps-verb.test.mjs for its fixtures.")
      }
    }'
  fi
fi
exit 0
