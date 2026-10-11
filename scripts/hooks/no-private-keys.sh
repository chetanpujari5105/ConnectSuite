#!/bin/bash
#
# Refuses a commit that would record private key material — above all the beta trial's Ed25519
# signing key, which lives on the owner's Mac and nowhere else (2026-10-12).
#
# Unlike its siblings this one also refuses on an INSTRUMENT FAILURE (a staged file it could not
# read). The others fail open because a wedged repo gets its guard deleted; here the failure being
# prevented is irreversible — a key in git is in every clone and backup — so an unreadable file is
# a reason to stop and look, and the message says how. Missing node still fails open.
set -uo pipefail

repo="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
check="$repo/scripts/check-no-private-keys.mjs"

[ -f "$check" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0

if ! output=$(node "$check" 2>&1); then
  jq -n --arg detail "$output" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        ("This commit would record private key material, or a staged file could not be read to rule it out.\n\n"
         + $detail
         + "\n\nA private key that reaches git is copied to every clone and backup and cannot be taken back. Unstage it (git restore --staged <path>) and keep it outside the repository - the trial key belongs in the owner'"'"'s ~/.sidekick-trial-key/, mode 600.\n\nA PUBLIC key is committed as base64 text in source (desktop/src/main/trialKey.ts), never as a .pem file.\n\nRe-check: node scripts/check-no-private-keys.mjs; fixtures: node --test scripts/check-no-private-keys.test.mjs")
    }
  }'
fi
exit 0
