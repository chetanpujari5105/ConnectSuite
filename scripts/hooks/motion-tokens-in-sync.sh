#!/bin/bash
#
# Refuses a commit that writes a duration or an easing curve outside `tokens.css`, or leaves a
# motion token that nothing reads.
#
# The thirteenth of these, and the colour hook's argument one unit across. `tokens.css` has carried
# a motion scale since 2026-09-17 — `--dur-press`, `--dur-release`, `--dur-state`, `--ease` — with a
# paragraph of reasoning above each. It was still possible, and five surfaces did it, to type the
# number instead:
#
#   .clip-tab                 background 180ms var(--ease)        <- EXACTLY --dur-state, by hand
#   .hero-phone-spinner svg   hero-spin 1.2s linear infinite
#   .security-card ... svg    hero-spin 1.2s linear infinite
#   .state-block ... svg      state-spin 900ms linear infinite
#   .deep-reveal              deep-reveal-flash 1.4s ease-out 1
#
# `.clip-tab` is why this is a hook rather than a tidy-up. Nothing was wrong on screen and nothing
# ever would have been — until somebody moves `--dur-state` to 200ms and eleven surfaces follow while
# the clipboard tabs stay behind. That is the colour pass's finding in a different unit: a literal is
# not drift while there is one author, and it is wrong in the mode nobody is looking at the moment
# there are two.
#
# The second rule is the colour guard's prune rule pointed at motion. `--dur-bar: 600ms` sat in
# tokens.css marked FIGMA and was read by nothing; the bar it names animates at `--dur-ring`, the
# same 600ms under a different name. Two tokens with one value are two places for the next person to
# disagree about a duration, and the disagreement is invisible because both are "the token".
#
# The discriminator is the one this repo has now paid for five times: **comments are stripped
# first.** check-motion-tokens.mjs's own header quotes `180ms`, `1.2s` and `900ms` while forbidding
# them, and tokens.css explains every duration in prose directly above it. There are fixtures
# asserting that prose passes.
#
# What it does NOT check is whether a thing should animate at all, or what the motion looks like
# once it runs. That is `scripts/motion-sweep.mjs`, which needs the app up and therefore cannot be a
# commit hook.
#
# Fails **open**, like its siblings: any error running the check allows the commit. A checker that
# can wedge the repo gets deleted by the first person it wedges. It blocks only on a real finding,
# never on an instrument failure — and `check-motion-tokens.mjs` reports an empty read as a problem
# of its own rather than as a pass.
set -uo pipefail

repo="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
check="$repo/scripts/check-motion-tokens.mjs"

[ -f "$check" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0
command -v jq >/dev/null 2>&1 || exit 0

detail=""
if ! out=$(node "$check" 2>&1); then
  detail="$out"
fi

if [ -n "$detail" ]; then
  jq -n --arg detail "$detail" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        ("A duration or easing curve is being written outside tokens.css, or a motion token has no reader.\n\n"
         + $detail
         + "\n\ntokens.css owns motion. Everything else reads it with var(). The scale, and what each step is for:\n  --dur-press    100ms  the press going DOWN. Feedback lands on pointer-down\n  --dur-release  160ms  the press coming back UP. Slower: nobody is waiting on it\n  --dur-state    180ms  a colour or label changing because a state changed\n  --dur-toggle   160ms  a switch knob, a segment\n  --dur-hover    200ms  hover, behind @media (hover: hover)\n  --dur-pill     200ms  the nav pill travelling\n  --dur-route-fade 140ms the route change, opacity only\n  --dur-float    220ms  the toast\n  --dur-arrive   220ms  one new row entering a list\n  --dur-ring     600ms  a value arc travelling to a new reading\n  --dur-spin     1.2s   one turn of an indeterminate spinner\n  --dur-spin-fast 900ms the smaller state-block spinner\n  --dur-flash    1.4s   the deep-link reveal, once\n  --ease                the default. A strong ease-out: anything ARRIVING\n  --ease-in-out         a thing moving BETWEEN two resting places\n\nIf a literal genuinely must stay literal, add it to ALLOWED in scripts/check-motion-tokens.mjs WITH the reason - the reduced-motion kill values and the spinners linear are the existing entries. An entry that stops matching a real declaration fails the check, so the list cannot rot.\n\nIf you need to write ABOUT a duration, put it in a comment: CSS comments are stripped before matching, and there are fixtures asserting that prose passes.\n\nThe inventory, and what must NOT animate:  docs/sidekick-motion-system.md\n\nRe-check:  node scripts/check-motion-tokens.mjs\nFixtures:  node --test scripts/check-motion-tokens.test.mjs\nRuntime:   node scripts/motion-sweep.mjs   (needs the app up)")
    }
  }'
fi
exit 0
