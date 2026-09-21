# Motion pass evidence — 2026-09-21

Every artifact here was **re-taken at the close of the pass**, against the tree that is being
committed, on the owner's MacBook Pro, Electron 43.4.1 (Chromium 150), 1440×920 @2x, no zoom.
The intermediate captures taken mid-pass have been replaced rather than kept beside these, so
nothing in this directory carries two numbers for one measurement.

**A phone was linked for every run** — `Samsung SM-S938B`, `link: connected` on the third line of
each sweep. That is a change from the mid-pass captures, which were taken disconnected, and it
matters: notification rows, call rows and the 128 app tiles only exist with a phone on the other
end, and they are inside these counts.

| File | What it is |
|---|---|
| `motion-sweep.txt` | `node scripts/motion-sweep.mjs`, **dark**. 13 pass, 0 fail, 0 NO READING, 12 of 12 routes |
| `motion-sweep-light.txt` | the same sweep, **light**. 13 pass, 0 fail, 0 NO READING |
| `check-motion-tokens.txt` | the commit guard: 74 motion declarations, 20 tokens, no raw literals |
| `shell-parity-dark.txt` | focus rings, modals, tooltips, reduced transparency — 853 of 853 controls ringed across 12 routes |
| `brand-lockup-dark.txt` / `brand-lockup-light.txt` | `scripts/brand-lockup-probe.mjs` — geometry, clipping, affordance and the breath's gating, from the resolved cascade |
| `brand-pixels-dark.txt` / `brand-pixels-light.txt` | `scripts/brand-pixels.py` — the wing / eye / ground classes, at both ends of the breath |
| `brand-mark-before-dark.png` | the lockup as the browser **actually drew it** while `.brand-mark` was declared twice |
| `brand-mark-after-dark.png` | the same frame with one rule |
| `brand-after.png` / `brand-light.png` | the shipped lockup, dark and light |
| `brand-before.png` | kept from earlier in the pass: the lockup **before the stage existed** |
| `overview-dark.png` / `overview-light.png` | Overview in both themes, with their `.json` sidecars |

## The brand lockup

### What was wrong, and it is not what the mid-pass write-up said

`shell.css` declared `.brand-mark` **twice**, six lines apart — a 57px/centre block whose comment
explained the stage, and the pre-existing 65px/`left center` block below it. Equal specificity,
later rule wins, silently. So the fix described in the stylesheet was never the fix the browser
applied: `getComputedStyle` returned `width: 65px` and `object-position: 0% 50%`, and the artwork
sat pinned to the left of its box.

Measured from the pixels rather than from the CSS, by locating the artwork's own eye pixels in each
capture (control: 453 of 598 eye pixels matched at the best offset, in both):

| | artwork inside the 69px stage | bare stage left | bare stage right |
|---|---|---|---|
| `brand-mark-before-dark.png` | x 2 → 59 | **2px** | **10px** |
| `brand-mark-after-dark.png` | x 6 → 63 | **6px** | **6px** |

Ten pixels of halo on one side and two on the other, under a comment specifying six and six. The
two crops are the same frame with the breath pinned to its rest keyframe, so they differ by the
geometry and not by when the shutter fell.

`stylesheets.test.ts` already had a guard for one selector declared twice in one sheet, and it
passed: its discriminator is **distance**, and this pair was adjacent. It now also refuses a
same-property contradiction at any distance — see the new test and its control.

### The contrast numbers, which are small and are the honest ones

The classifier is the artwork's **own alpha channel** (`mark@2x.png`, RGBA, exactly the rendered
device size), never a brightness threshold over the screenshot: a threshold cannot separate a dark
wing from the dark ground behind it, and that inability is the whole problem. Every class prints
its pixel count so a collapsed class is visible rather than silently producing a ratio.

The halo breathes 0.5 → 0.72 over 6s, so the ground is a moving number. The animation is pinned at
each keyframe extreme and the reading is a **band**:

| dark | wings | ground | ratio |
|---|---|---|---|
| on the bare sidebar, no stage | `L=0.0093` | `rgb(14,14,14)` | **1.09:1** |
| on the stage, breath at rest | `L=0.0093` | `L=0.0195` | **1.17:1** |
| on the stage, breath at peak | `L=0.0093` | `L=0.0253` | **1.27:1** |

**1.09 → 1.17–1.27 is a very small ratio change and no part of this work should be read as a
contrast win.** The mask is near-black by design; lifting a ground *towards* it reduces the
difference, and reaching even 3:1 would need an `rgb(99,99,99)` slab in the sidebar. **What makes
the lockup readable is the stage's edge and the clipped halo behind the mark — a shape against a
gradient — not a ratio.** The ratio is published only so nobody later reads the screenshot as a
number it did not earn.

The control is the **eyes**, measured in the same frame at **10.24:1** (rest) and **9.48:1** (peak):
they were bright all along and are not what changed. A run where the wings and eyes converge is an
alignment that is wrong for both classes, not a finding about the lockup — which is exactly how the
first version of this instrument was caught, reporting 1.28:1 for the eyes because a `clip.scale`
on a dpr-2 display returns a **4x** image that a 2x asset cannot be indexed into.

In **light** the mask never needed help and the stage slightly lowers its ratio, which is the
expected direction and is the evidence that light is not over-glowed:

| light | wings | ground | ratio |
|---|---|---|---|
| on the bare sidebar | `L=0.0104` | `rgb(249,249,252)` | **16.55:1** |
| on the stage, rest | `L=0.0104` | `L=0.8086` | **14.22:1** |
| on the stage, peak | `L=0.0104` | `L=0.7961` | **14.01:1** |

The halo contributes a channel spread of **5–6** over the sidebar's own **3**. That is the whole
glow in light: two or three levels.

### The sidebar is not tinted, and the control is what makes that mean anything

Sampled in the sidebar's **left gutter** — 14px of padding every row shares, which no text or
control enters — beside the lockup and again far below it:

| | beside the stage | far below | difference | the stage itself |
|---|---|---|---|---|
| dark | `rgb(14,14,14)` | `rgb(14,14,14)` | **0** | `rgb(30,39,37)`, spread 9–13 |
| light | `rgb(249,249,252)` | `rgb(249,249,252)` | **0** | `rgb(229,233,234)`, spread 5–6 |

The stage's spread is the control: something *must* be tinted eight pixels away, or "no tint on the
sidebar" is a statement about a query that can see nothing. The first version of this band sat to
the *right* of the stage and caught the **wordmark** — `rgb(33,33,34)` against `rgb(14,14,14)`,
read as a 20-point leak with all three channels moving together. Light text is not a tint.

### The rest of the lockup, from the resolved cascade

All in `brand-lockup-dark.txt` / `brand-lockup-light.txt`, both themes, all PASS:

- the halo is a **child of the stage**, `overflow: hidden`, `isolation: isolate`, and it overflows
  by **31px on each side** — so the clip is load-bearing rather than incidental;
- the stage is a `<span>` with no role, `tabIndex -1`, not focusable, `cursor: auto` — against the
  control that a real nav row in the same sidebar reads `cursor: pointer`. It does not present
  itself as something to click;
- the **wordmark is static**: `animation: none`, `transform: none`;
- the breath is `brand-breathe 6s` at rest and **`none`** under `prefers-reduced-motion: reduce`,
  with the control that the emulation changed the halo's animation count 1 → 0;
- under `reduce` the halo sits at **`opacity: 0.5`** — its designed rest value — with no animation
  attached. It is declared **inside** `@media (prefers-reduced-motion: no-preference)` rather than
  overridden under `reduce`, so there is nothing for the global kill to freeze mid-cycle, which is
  the fault this pass found in `hero-spin`;
- **no keyframe animation survives** reduced motion: 1 (`brand-breathe`) → 0.

That last row needed its own correction. `getAnimations()` returns CSSAnimation **and**
CSSTransition, and under the emulation the page reports **191 transitions of 0.01ms** — `tokens.css`'s
own reduced-motion kill, created *by* applying the media change. Counted together they read as
"191 ambient animations survived reduced motion", the exact opposite of what happened. Ambient
motion is a keyframe animation, and that is what the row counts.

## The sweep

13 pass, 0 fail, 0 NO READING in both themes, 12 of 12 routes. The two files are no longer
byte-identical: **the theme is on line 3**, because a dark run and a light run previously came back
identical to the byte — correctly, since no rule in the sweep is about colour — and two
indistinguishable files are one reading and a claim, not two readings.

**Both final runs were taken with the window occluded**, which the sweep declares on its own second
line, and that is the better evidence rather than a compromise: occlusion stalls `requestAnimationFrame`,
so `overview.ts`'s FLIP never clears its marks, and the run therefore exercises the mid-FLIP
exclusion instead of skipping past it.

**That exclusion was incomplete and this pass fixed it.** `overview.ts` marks a row two ways and
clears both in one `afterNextPaint`: `classList.add('is-arriving')` always, and an inline
`transition: none` **only when the row actually moved**. The sweep read the inline half only, so a
row that arrived *without* moving carried the class alone, computed `transition-property: none`,
and was reported as `snapping: recent-row (12)` — indistinguishable from a missing press rule. One
mechanism, two marks, an exclusion that knew about one. A run during this pass caught exactly that,
and the fixed sweep names both: `recent-row/inline (36), recent-row/is-arriving (12)`.

It is proven at the layer it lives in rather than by waiting for the state to recur: three real
`.recent-row` buttons were given the class with no inline style, and the exclusion read **3 snapped
/ 0 excluded** without the branch and **0 snapped / 3 excluded** with it.

**A second instrument fault in the same run, and it is the sharper one.** `press-down` forces
`:active` and settles on `scaled` and `visible` agreeing across two samples. It never compared how
many nodes the force had *reached* against how many the reader *scored* — so a sample where
`CSS.forcePseudoState` had reached 573 nodes while the reader walked 697 counted as settled, and the
124 it had not reached reported their **at-rest** duration, `--dur-release` 0.16s. That was written
up as *"128 apps tiles snap their press"*. The tell was in the line the run already printed:

```
569 of 697 at 0.1s; others: apps-tile=0.16s …  [forced=573]
```

Two numbers that must be equal for the reading to exist, side by side, differing, with the verdict
computed from the other one. A predicate over independent clocks must settle on **every** clock.
`forced` is now in the predicate, the line reads `[forced=721 of 721 matched; 4 mid-FLIP skipped]`,
and a mismatch is a **NO READING** that names the shortfall rather than a FAIL. Shown red against
the verbatim case: narrowing the force selector by `.apps-tile` produces
*"the force reached 593 nodes and the reader matched 721 — the 128 it did not reach report their
AT-REST duration"*.

## Reduced motion

| | with the setting off | with `prefers-reduced-motion: reduce` |
|---|---|---|
| elements transitioning a transform | **168** | **0** |
| running animations | **4** | **0** |

The control is the before column. An emulation that silently failed and a stylesheet that correctly
removed every transform produce the same reading — zero — so only the disagreement separates them,
and the sweep reports NO READING when the two columns match.

## Reduced transparency

4 backdrop-filtered surfaces with the setting off, **0** with it on. Same control shape, and
`shell-parity-dark.txt` takes it independently: 5 translucent surfaces at rest, none still blurred
and none still transitioning under `reduce`.

## Disabled controls, and focus

- **`a disabled control does not animate` — 1 disabled control on screen, 0 carrying a press.** A
  real reading on a denominator of 1. The summary line counts 12 disabled buttons across all routes;
  the check reads the routed pane, and one is what was there.
- **Focus rings: 853 of 853 visible controls across 12 routes** take a ring under forced
  `:focus-visible`, with the control that **0** are outlined at rest. `shell-parity-dark.txt`.

## Keyboard, and "no animation blocks an action"

- the ⌘K palette opens with **`animation: none` and `transition-duration: 0s`**;
- focus is on `#palette-input` the moment it opens;
- **a real `Escape` keydown** closes it, read synchronously in the same turn — a dispatched event
  rather than a call to `closePalette()`, because "the handler runs" and "the keystroke reaches it"
  are different claims;
- nothing invisible is swallowing clicks, with a three-part control: elements scanned, elements big
  enough to block a click, elements at opacity 0 — the empty answer is the *intersection* being
  empty rather than the query matching nothing.

## What this evidence does not cover

- **No Figma render, and the Figma MCP is not connected on this account.** No value here has been
  compared against a Figma file. Every motion and brand value is built to the handoff and to the two
  design references named in `docs/sidekick-motion-system.md` §0, and nothing in this directory is a
  Figma comparison.
- **Screenshots cannot show motion.** The images are here for the lockup's geometry and for theme
  parity. The motion claims are the sweep's numbers.
- **`prefers-contrast: more` is handled nowhere** and is not measured here. It is a colour-and-border
  question, not a motion one.
- **`.toast` uses `@keyframes`**, so it restarts rather than retargets. Accepted while toasts do not
  stack.
- **The `is-arriving` half of the mid-FLIP exclusion has not been seen firing on a state the app
  produced by itself in a capture kept here** — the run that produced it is quoted above, and the
  constructed three-row stimulus is what proves the predicate. A row arriving with `dy === 0` is not
  a state that can be demanded.
