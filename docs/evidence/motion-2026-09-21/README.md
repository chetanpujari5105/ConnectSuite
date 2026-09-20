# Motion pass evidence — 2026-09-21

Taken against `baf5664` + the press-channel change, on the owner's MacBook Pro, Electron 43.4.1
(Chromium 150). The app was **not linked to a phone** for this run, which is stated in every
artifact rather than left to be inferred.

| File | What it is |
|---|---|
| `motion-sweep.txt` | `node scripts/motion-sweep.mjs` — dark theme. 9 pass, 0 fail, 0 NO READING, 12 of 12 routes |
| `motion-sweep-light.txt` | the same sweep with the app in **light** theme. 9 pass, 0 fail |
| `check-motion-tokens.txt` | the commit guard: 73 motion declarations, 19 tokens, no raw literals |
| `overview-dark.png` | Overview, dark, 1440×841 @2x |
| `overview-light.png` | Overview, light, same geometry |

## What the numbers mean

**Press.** 8316 of 8316 enabled buttons ease their press, over 12 routes, at `--dur-release`
(0.16s) releasing and `--dur-press` (0.1s) pressing. Before this pass it was **131 of 265** in a
single-route read; the sweep's larger denominator is cumulative across routes.

**The excluded 48.** `recent-row (48)` is reported as *excluded, inline transition mid-FLIP*. Those
nodes carry an inline `transition` written by `overview.ts`'s FLIP and cleared inside
`afterNextPaint`. **`requestAnimationFrame` does not run in an occluded window**, and this sweep is
driven from a terminal, so the cleanup has not run and the nodes report no transition at all —
which reads exactly like a missing press rule. Measured: `rafFired: 0` after 1.88s,
`visibilityState: "hidden"`, four `.recent-row` nodes with `style.transition === "none"`.

**That is an instrument finding, not a product defect**, and the distinction is load-bearing: rAF
runs before the first paint anyone sees, so the state is cleared before a user can observe it. The
sweep names the condition on the line rather than scoring it, and prints the window's visibility at
the top of every run.

## Reduced motion

| | with the setting off | with `prefers-reduced-motion: reduce` |
|---|---|---|
| elements transitioning a transform | **163** | **0** |
| running animations | **3** | **0** |

The control is the before column. An emulation that silently failed and a stylesheet that correctly
removed every transform produce the same reading — zero — so only the disagreement separates them,
and the sweep reports NO READING when the two columns match.

## Reduced transparency

4 backdrop-filtered surfaces with the setting off, **0** with it on. Same control shape: a zero
after means nothing without a non-zero before, and the sweep says so when `before` is 0.

## Stability

Ten consecutive runs, 9 pass / 0 fail each. One earlier run failed on the forced-`:active` reading
before the settle predicate landed — `CSS.forcePseudoState` triggers a style recalc on the
renderer's own schedule, and three consecutive samples of an unchanged app read **5, then 18, then
23** of the same 23 buttons. The fix is agreement across two consecutive force-and-read pairs,
copied from `shell-parity-sweep.mjs`, not a sleep.

## What this evidence does not cover

- **No phone was linked.** Notification rows, activity chips with live data, photo albums and call
  rows are thinner or absent. A run with a phone would see more buttons, not different rules.
- **Only one disabled control was on screen**, so the "disabled controls do not animate" row is
  proven on a denominator of 1. It is a real reading and a thin one.
- **No Figma render.** The Figma MCP is not connected on this account; every motion value is built
  to the handoff and to the two design references named in `docs/sidekick-motion-system.md` §0.
- **Screenshots cannot show motion.** They are here for theme parity — that the light theme did not
  regress while the motion work was done. The motion claims are the sweep's numbers, not the images.
