#!/bin/bash
#
# Blocks `am force-stop` on the ConnectSuite package.
#
# `am force-stop com.chetan.connectsuite.debug` clears `enabled_accessibility_services` — not just
# the binding, the grant itself — and an AccessibilityService cannot be granted programmatically.
# So a force-stop reached for as a convenience during a test costs a trip to Settings by hand
# before any `input` step can run again. That is written up in docs/testing.md.
#
# It is a hook rather than a line in a doc because the doc did not work: the rule was written on
# 2026-08-28 and broken four sections later by the person who wrote it, inside the same day.
#
# Only this project's package is denied. Force-stopping anything else is not our business.
set -euo pipefail

command=$(jq -r '.tool_input.command // ""')

if printf '%s' "$command" | grep -q 'force-stop' &&
   printf '%s' "$command" | grep -qi 'connectsuite'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        "force-stop on the ConnectSuite package clears enabled_accessibility_services — the grant, not just the binding — and it cannot be restored except by hand in Settings > Accessibility. Every `input` step is untestable until someone does that.\n\nTo drop the link instead, use one of:\n  - the Mac app'"'"'s Disconnect button (same \"link dropped\" contract, costs nothing)\n  - `adb shell am kill com.chetan.connectsuite.debug` (no grant loss)\n  - turn Wi-Fi off on the phone\n\nSee docs/testing.md, \"Force-stopping the phone app costs the accessibility grant\"."
    }
  }'
fi
