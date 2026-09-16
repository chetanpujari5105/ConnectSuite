#!/bin/bash
#
# Refuses a commit that writes a colour outside `tokens.css`, or leaves a colour token with only one
# theme.
#
# The twelfth of these, and the first written because a *sweep* found a pattern rather than because
# one defect bit. Four sightings before light mode existed — styles.css's own `:root`, which loaded
# second and silently beat the token sheet on `--accent` and `--bg`; `.nav-pill`'s hardcoded tint;
# the `#111219` well with no token; and `accent-color: auto` drawing the user's own macOS accent on
# two sliders. Every one was found by eye, after it shipped, and none of them errored, warned, or
# failed a test.
#
# Light mode is why four became a pattern worth a hook. A raw literal in a one-theme app is merely
# unthemed; in a two-theme app it is **wrong in one of them**, and wrong in the theme whoever wrote
# it is not looking at. The sweep that preceded this found 150 raw literals against 856 colour-valued
# declarations, plus five colour sources outside CSS entirely — where no stylesheet checker could
# ever have seen them.
#
# It runs two checks, because they fail differently:
#
#   check-color-tokens.mjs  — a colour written anywhere but tokens.css, and a dark token with no
#                             light value. The second is the one that keeps light mode alive: it is
#                             silent, renders perfectly in the theme you are in, and is found by a
#                             user on the other one.
#   check-contrast.mjs      — all 58 token pairs per theme against WCAG AA. It caught
#                             `--text-on-warning` (3.53:1 on the darkened light amber) before it was
#                             ever drawn, and the Muted pill's 2.23:1 is why contrast is checked as
#                             a pair rather than trusted as a value.
#
# The discriminator both share is the one this repo has now paid for four times: **comments are
# stripped first**, in CSS, in TypeScript and in HTML. tokens.css quotes `#f3f2f2`, `#ec3013` and
# `#8b6bff` in its own prose; index.html explains a "6px green dot"; float.html explains the green
# traffic light. Every one is a mention, and the first run of this checker reported all of them.
#
# Fails **open**, like its siblings: any error running the check allows the commit. A checker that
# can wedge the repo gets deleted by the first person it wedges. It blocks only on a real finding,
# never on an instrument failure — a scan that read nothing has found nothing, in either direction.
set -uo pipefail

repo="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
tokens="$repo/scripts/check-color-tokens.mjs"
contrast="$repo/scripts/check-contrast.mjs"

[ -f "$tokens" ] || exit 0
[ -f "$contrast" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0
command -v jq >/dev/null 2>&1 || exit 0

detail=""
if ! out=$(node "$tokens" 2>&1); then
  printf '%s' "$out" | grep -q '✗' && detail="$out"
fi
if ! out=$(node "$contrast" 2>&1); then
  # An instrument that disagrees with the published reference pairs has not measured anything, so
  # it must not deny a commit on the strength of numbers it has just disowned.
  if printf '%s' "$out" | grep -q 'BAD  control'; then
    :
  elif printf '%s' "$out" | grep -q 'FAIL'; then
    detail="${detail}${detail:+$'\n\n'}$out"
  fi
fi

if [ -n "$detail" ]; then
  jq -n --arg detail "$detail" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        ("A colour is being written outside tokens.css, or a colour token has only one theme.\n\n"
         + $detail
         + "\n\ntokens.css owns colour. Everything else reads it with var(). Three shapes cover almost every case:\n  a surface or text colour        -> the named token\n  a hover, divider or subtle fill -> rgba(var(--overlay-rgb), <alpha>), which flips base and keeps your alpha\n  a category tint drawn as text   -> color-mix(in srgb, rgb(var(--tint-X-rgb)), #000 var(--tint-darken))\n\nIf a value genuinely must be identical in both themes, add it to SAME_IN_BOTH in scripts/check-color-tokens.mjs WITH the reason - a scrim over a user photo and the macOS traffic lights are the existing entries. An entry that stops matching a real token fails the check, so the list cannot rot.\n\nIf you need to write ABOUT a colour, put it in a comment: CSS, TypeScript and HTML comments are all stripped before matching, and there are fixtures asserting that prose passes.\n\nRe-check:  node scripts/check-color-tokens.mjs\n           node scripts/check-contrast.mjs --all\nFixtures:  node --test scripts/check-color-tokens.test.mjs scripts/check-contrast.test.mjs")
    }
  }'
fi
exit 0
