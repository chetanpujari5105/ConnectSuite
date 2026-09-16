# Phase 7 Slice 54 — evidence, 2026-09-15

## `float-bottom-bar.png`

The floating window with the control strip moved from the right edge to the bottom — defect 118,
`docs/design-departures.md` → M18. Captured with **no pointer inside the window**, which is the point:
the controls this replaced were `opacity: 0` until hovered (defect 115).

**What it shows:** Back, Home and Recents in a row under the picture, then a hairline, then
Screenshot and the reveal control. The picture spans the whole window width, because `BOTTOM_BAR` is
a height taken below it rather than a width taken from the side.

**How it was taken, and why that matters here.** Through `scripts/shoot-page.mjs`, which captures the
**page viewport over CDP**. The first three attempts used `screencapture -R` with a rectangle from
System Events and produced, in order: a correct capture of a stale rectangle (the phone rotated
between the read and the shot), a capture taken after a gate compared two identical *error strings*
and called them agreement, and then nothing at all once System Events began returning an empty window
list for a process whose windows plainly existed. A page capture has no coordinate to go stale — and
it contains the window rather than whatever else was on the owner's screen, which the first attempt
did not.

**What it is not:**

- **Not the measurement.** Every number in the slice — bar height 40, `spansTheWindow: true`,
  `overlapsPicture: false`, gap 0, order read from the buttons' own rects, picture aspect against the
  phone's announced one — came from `scripts/float-open-probe.mjs`. A screenshot carries no scale.
- **Not proof the hairline is in the right place.** That was found *wrong* by measurement and would
  have stayed wrong here: `:first-of-type` matched the first `button`, so the separator drew nothing,
  and a missing 1px hairline in a screenshot looks like a design choice. The reading is
  `getComputedStyle(b, '::before')` on all five buttons.
- **Not the landscape case.** The phone turned during the probe run and the landscape figures are in
  the slice (picture 1494 × 688, announced 0.462); no usable landscape screenshot was taken, because
  the two attempts at one are the failures described above.
- **Not the tooltip.** It is dismissed on pointer-leave, so a capture with no pointer in the window
  cannot contain one. Its readings — text, `pointer-events: none`, 24 px of picture overlap, immediate
  on keyboard focus — are in the slice.

**The phone's own screen is the owner's home screen**, including contact photographs and a calendar.
It is here because it is what the phone happened to be showing.
