# Phase 7 Slice 53 — evidence, 2026-09-15

## `float-rail.png`

The floating window with the permanent control strip, captured with **no pointer inside it** —
which is the whole point, since the controls it replaces were `opacity: 0` until the window was
hovered. Defect 115, `docs/design-departures.md` → M16.

**What it shows:** Back, Home, Recents and Screenshot down the right edge, with the reveal control
(defect 117) at the foot behind a hairline because it acts on this Mac's windows rather than on the
phone. The strip is 36pt of the window's *width* — `RAIL` in `shared/floatGeometry.ts` — so the
picture keeps the phone's exact aspect and nothing sits over a part of the screen the canvas accepts
taps on.

**What it is not:**

- **Not proof the controls work.** It is a picture of a window. That they resolve to real icons
  rather than empty rings is `floatRail.test.ts`; that they are visible, unhovered, counted as
  elements rather than matched as text, is `scripts/float-open-probe.mjs`, whose readings are in
  `docs/testing.md` → Phase 7 Slice 53.
- **Not proof of the rotation fix.** The phone is portrait here. Defect 114's evidence is the two
  log lines quoted in the slice, taken across a real turn in both directions.
- **Not a measurement of anything in it.** A screenshot carries no scale unless something in it
  does. Every number in the slice came from `scripts/probe.mjs` or from a log line, never from
  looking at this file.

**The phone's own screen is the user's home screen**, including contact photographs and a calendar.
It is here because it is what the phone happened to be showing; nothing in this slice chose it.
