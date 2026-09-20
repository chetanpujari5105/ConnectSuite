# Motion pass evidence — 2026-09-21

Taken against `baf5664` + the press-channel change, on the owner's MacBook Pro, Electron 43.4.1
(Chromium 150). The app was **not linked to a phone** for this run, which is stated in every
artifact rather than left to be inferred.

| File | What it is |
|---|---|
| `motion-sweep.txt` | `node scripts/motion-sweep.mjs` — dark theme. **13 pass, 0 fail, 0 NO READING**, 12 of 12 routes |
| `motion-sweep-light.txt` | the same sweep with the app in **light** theme. 13 pass, 0 fail |
| `check-motion-tokens.txt` | the commit guard: 74 motion declarations, 20 tokens, no raw literals |
| `overview-dark.png` | Overview, dark, 1440×841 @2x |
| `overview-light.png` | Overview, light, same geometry |
| `brand-before.png` | the lockup before the stage — the mask at **1.08:1**, only its eyes reading |
| `brand-after.png` | the lockup with the charcoal stage, hairline and clipped halo, dark |
| `brand-light.png` | the same in light, where the mask never needed help |

## What the numbers mean

**Press.** **Every enabled button** — 6149 of 6149 in the dark capture, 8652 of 8652 in the light
one; the two differ because panes accumulate rows as they are visited, not because the rule differs
— eases its press ease their press, over 12 routes, at `--dur-release`
(0.16s) releasing and `--dur-press` (0.1s) pressing. Before this pass it was **131 of 265** in a
single-route read; the sweep's larger denominator is cumulative across routes, so the two numbers
are not the same measurement and the ratio between them means nothing. What they share is the
**zero**: no enabled button snaps.

**Both captured runs had a visible window** — the first line of each file says so. That matters
because of the next paragraph.

**The mid-FLIP exclusion, which did not fire here.** `overview.ts` writes an inline
`transition: none` on the recent-activity rows to do its FLIP and clears it inside `afterNextPaint`,
which is two nested `requestAnimationFrame`s. **rAF does not run in an occluded window.** Run from a
terminal with the app behind it, this sweep reported `snapping: recent-row (48)` — reproducibly —
because those rows report no transition at all, which reads exactly like a missing press rule.
Measured at the time: `rafFired: 0` after 1.88s, `visibilityState: "hidden"`, four `.recent-row`
nodes carrying `style.transition === "none"`.

**That is an instrument finding, not a product defect**, and the distinction is load-bearing: rAF
runs before the first paint anyone sees, so the state is cleared before a user can observe it. The
sweep therefore prints the window's visibility on its first line, excludes elements carrying an
inline `transition`, and names them and the reason when it does. In these two captures it had
nothing to exclude.

## The brand lockup

| | wings | their ground | ratio |
|---|---|---|---|
| before | `L=0.0085` | bare sidebar `L=0.0044` | **1.08:1** |
| after | `L=0.0056` | stage + halo `L=0.0193` | **1.25:1** |

**1.08 → 1.25 is a modest ratio and it is the honest one.** A naive crop of `brand-after.png`
reports `13.66:1` between its 5th and 95th percentiles — the 95th percentile is the **eyes**, which
were bright all along and were never the problem. Quoting that would be the denominator mistake in a
different unit. What makes the lockup legible is the stage's *edge* and the halo's *gradient*, not
the ratio; the ratio is published so nobody later reads the screenshot as a contrast win it did not
earn.

`brand-before.png` is a crop of the shipped build before this change, at the same scale, so the two
are comparable.

## Reduced motion

| | with the setting off | with `prefers-reduced-motion: reduce` |
|---|---|---|
| elements transitioning a transform | **169** | **0** |
| running animations | **4** | **0** |

The fourth animation is the brand halo's breath, which is declared **inside**
`@media (prefers-reduced-motion: no-preference)` rather than overridden under `reduce` — so under
`reduce` there is no animation to stop, and nothing can freeze mid-cycle the way `hero-spin` did.

The control is the before column. An emulation that silently failed and a stylesheet that correctly
removed every transform produce the same reading — zero — so only the disagreement separates them,
and the sweep reports NO READING when the two columns match.

## Keyboard, and "no animation blocks an action"

Four readings, all pass:

- the ⌘K palette opens with **`animation: none` and `transition-duration: 0s`** — asserted rather
  than trusted, because `AUDIT.md` §1 puts a 100+/day surface in the never-animate row and a 120ms
  fade here is the regression nobody would file and everybody would feel;
- focus is on `#palette-input` the moment it opens;
- **a real `Escape` keydown** closes it, read synchronously in the same turn — a dispatched event
  rather than a call to `closePalette()`, because "the handler runs" and "the keystroke reaches it"
  are different claims;
- nothing invisible is still swallowing clicks, with a three-part control: **3854 elements scanned,
  45 big enough to block a click, 42 at opacity 0** — so the empty answer is the *intersection*
  being empty rather than the query matching nothing.

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
