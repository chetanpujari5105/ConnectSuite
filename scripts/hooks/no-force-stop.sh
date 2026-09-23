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
#
# 2026-09-01: the alternatives this hook offers were themselves wrong in one place, and it took a
# hardware reading to notice. It recommended `am kill`, which **does nothing while LinkService is
# running** — a foreground service is not "safe to kill", and the pid is identical before and after.
# Anyone following that advice would have concluded the process had died and then measured a
# "restart" that never happened. `am crash` is the one that works, and it keeps the accessibility
# grant, which is the whole reason this hook exists. See docs/testing.md → Slice 9 §2.
#
# ---------------------------------------------------------------------------------------------
# Defect 41, 2026-08-29: this used to grep the whole command for `force-stop` and `connectsuite`
# independently, anywhere, in any order. That denied every command that merely *talked* about the
# rule — a heredoc writing docs/defects.md, `grep -rn force-stop docs/`, a commit message
# explaining a fix to this file. It was found by being denied while writing the register.
#
# CLAUDE.md says of the hook-and-prose pairing: "a hook can carry a sentence but not an argument —
# the two are a pair". A matcher that forbids writing the argument breaks its own half of that.
#
# So the matching is now in two steps, and both matter:
#
#   1. Remove the parts of the command that are *content* rather than instruction — heredoc
#      bodies, which is how files get written here. Text inside them is being saved, not run.
#   2. Require the real invocation shape in what is left: `am` immediately followed by
#      `force-stop`, and our package as a following argument on the same command, rather than the
#      two words appearing somewhere in a few kilobytes of prose.
#
# The deny is unchanged for every form that actually reaches the device. See the fixtures in
# no-force-stop.test.sh, which are the reason this is a rewrite rather than a loosening.
set -euo pipefail

command=$(jq -r '.tool_input.command // ""')

# 1. Drop heredoc bodies. `<<EOF`, `<<'EOF'`, `<<"EOF"` and `<<-EOF` all delimit content that is
#    being written somewhere, not executed. A force-stop hidden inside one cannot run the phone;
#    it can only end up in a file, which is exactly what documenting the rule looks like.
executable=$(printf '%s' "$command" | awk '
  BEGIN { skipping = 0 }
  skipping == 1 {
    line = $0
    gsub(/^[ \t]+/, "", line)
    if (line == terminator) { skipping = 0 }
    next
  }
  {
    if (match($0, /<<-?[ \t]*['"'"'"]?[A-Za-z_][A-Za-z0-9_]*['"'"'"]?/)) {
      tag = substr($0, RSTART, RLENGTH)
      gsub(/^<<-?[ \t]*/, "", tag)
      gsub(/['"'"'"]/, "", tag)
      terminator = tag
      skipping = 1
    }
    print
  }
')

# 1b. Drop `-m`/`--message` values for the same reason: a commit message describing this rule is
#     content being written, not an instruction being run. Only the quoted value is removed, so a
#     real command chained after it with `;` or `&&` still survives to be matched.
executable=$(printf '%s' "$executable" | sed -E \
  -e 's/(-m|--message)[ \t]+"[^"]*"/\1 <message>/g' \
  -e "s/(-m|--message)[ \t]+'[^']*'/\1 <message>/g")

# 2. The real shape: `am force-stop` (allowing `adb shell` and quoting around it) with the package
#    as an argument that follows, not merely a word that co-occurs.
# 3. Defect 144: `am start -S` force-stops the target before launching it — the same grant loss
#    under a different verb. It ran once, on the emulator, on 2026-09-23 and cleared the
#    accessibility grant (1 → 0). Matched per command segment: an `am start` (or `start-activity`),
#    a short-flag token whose letters include `S` — alone or clustered, `-S`, `-SW`, `-WS` — and our
#    package, in any order within the segment. Lowercase `-s` (adb's serial flag) has no `S`.
starts_with_stop() {
  printf '%s\n' "$executable" | tr ';&|' '\n\n\n' | while IFS= read -r segment; do
    if printf '%s' "$segment" | grep -Eq 'am[[:space:]]+start(-activity)?([[:space:]]|$)' &&
       printf '%s' "$segment" | grep -Eq "(^|[[:space:]\"'])-[A-Za-z]*S[A-Za-z]*([[:space:]\"']|\$)" &&
       printf '%s' "$segment" | grep -Eq 'com\.chetan\.connectsuite'; then
      echo yes
      break
    fi
  done
}

if printf '%s' "$executable" |
   grep -Eq 'am[[:space:]]+force-stop[[:space:]]+[^;&|]*com\.chetan\.connectsuite' ||
   [ -n "$(starts_with_stop)" ]; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        "force-stop on the ConnectSuite package — `am force-stop`, or `am start -S`, which force-stops before launching — clears enabled_accessibility_services — the grant, not just the binding — and it cannot be restored except by hand in Settings > Accessibility. Every `input` step is untestable until someone does that.\n\nTo drop the link instead, use one of:\n  - the Mac app'"'"'s Disconnect button (same \"link dropped\" contract, costs nothing)\n  - `adb shell am crash com.chetan.connectsuite.debug` (real process death, no grant loss). It may print `Shell does not have permission to crash packages for user 150` and work anyway — read the pid, not the exit line.\n  - `adb shell am kill com.chetan.connectsuite.debug` — but note it does NOTHING while the foreground service is running: measured 2026-09-01, identical pid before and after. Use it only for a backgrounded process.\n  - turn Wi-Fi off on the phone\n\nSee docs/testing.md, \"Force-stopping the phone app costs the accessibility grant\"."
    }
  }'
fi
