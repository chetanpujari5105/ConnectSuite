# Resume here — written 2026-09-16: Overview re-scored against the handoff, and a second design authority retired

> A state report, not a note to myself. Written to be handed to someone who was not here.
>
> **Nothing has been committed.** Four sittings of work are stacked in one working tree — defects
> 111–118 and the float's bottom bar, then the light theme, then the Overview card rebuilds, then
> this. `git status` is large.

## 0 · The one thing to read before touching the Overview pane

**There were two design authorities for one day, and one of them is now retired.**

`docs/testing.md` Slices **59**, **60** and **61** (2026-09-16) each say *"rebuilt against a
reference mockup"* and **none of them says which**. It was not
`design_handoff_connectsuite/ConnectSuite.dc.html`. That second reference is recorded as
**superseded** at the top of `docs/design-departures.md`, with the six differences it produced
measured; `docs/phase-7-state.md` §1 now states what "Built to the handoff" is scored against for
each of the four panes it names.

**Do not rebuild against it again.** The transferable rule is in the same place: *a rebuild is
scored against a named authority or it is not scored at all* — nothing in the build can compare two
designs, so a second authority stays invisible until somebody reads both.

## 1 · What this sitting did

A reported 26-item audit of the Overview pane, resolved against the handoff and its `README.md`.
Full evidence: `docs/testing.md` → **Phase 7 Slice 62**. Departure rows **O6–O18**.

**Nine of the 26 were withdrawn by measurement, before any code changed**, and two of those are the
ones worth knowing about:

- The **storage ring** was reported as wrongly bound. It is not — the arc is bound to *used*, which
  is the handoff's binding too. Fixing it as filed would have drawn the ring nearly **empty** on a
  phone with 2% free, which is the alarming direction.
- The **phone preview** was reported as an empty black rectangle needing an empty state. It is the
  handoff's *"150px phone render"* — decoration, not a preview. No device screenshot exists on this
  wire and cannot (Slice 59 §2).

The sticky-pill report and the duplicated-track-title report did not reproduce at all; the dock, the
`MENU` group header and the tinted activity tiles are all specified in the README verbatim.

**Thirteen changes landed.** Eight are the build coming *back* to the handoff and are marked
**corrected** rather than given a departure status; five are genuine departures over surfaces the
handoff never drew.

| | |
|---|---|
| Recent activity rows | 104px → **52px**, tile 56 → **26**, time column 62 → **44** (O8) |
| Column imbalance | **227px → 139px**, measured (O6, O8) |
| Heading sizes on the pane | **4 → 3** (31 / 21 / 15) — O9, O10 |
| Battery renderings on one viewport | **3 → 2**; storage **2 → 1** (O11) |
| Overflow triggers | **2 → 1** (O16) |
| Activity time column | relative-only → **absolute**, with the age on the aria-label and `title` (O17) |
| Capability chips | raw wire ids → readable names; a `check`/`lock` glyph; reasons as **standing copy** (O13, O14, O15) |
| A past failure row | `--destructive` tile → grey + `alert-circle` (O7) |

## 2 · Two defects nothing in the build could have seen

- **123 — the app's most advertised accelerator was bound to a log line. Fixed.** `⌘⇧M` is printed
  on the Overview hero's primary action *and* in the ⌘K palette, and `main.ts` registered it as a
  **`globalShortcut`** for the **mark diagnostic**. A global shortcut is taken before the page sees
  the key, so it had never once started a mirror. Nothing reported it because
  `globalShortcut.register` returned `true` — the only signal available said *the shortcut works*,
  and it did. The mark is on `⌃⌥⌘M` now, unadvertised; mirroring is bound **in the page**, where it
  belongs.
- **122 — every other shortcut hint except ⌘K is decorative. Open, deliberately not fixed.**
  `⌘1`–`⌘9`, `⌘0`, `⌘,`, `⌘⇧.`, `⌘⇧T`, `⌘⇧4` are strings in `navModel.ts` with **nothing bound**.
  There is no application menu at all. It is shell-wide across twelve panes and this pass was scoped
  to one, so it is registered with a fix direction rather than half-done. The fix is a real
  `Menu.setApplicationMenu` reading `navModel`, **not** a `switch` on `event.key` in `shell.ts` —
  that is a second accelerator table and the menu bar is the one people discover.

## 3 · What is NOT done

- **Nothing is committed.**
- **`#caps-card` and `#overview-strip` are `reachable`, not `visible`, at the design's own 920px
  window** — fraction 0 at rest, a 317px scroll brings each fully in. The handoff's Overview scrolls
  at 920px too, so it is not a departure from it. It is recorded because defect 85's rule is that a
  card carrying a *state* must be visible at rest, and whether the capability list is a state card
  or a reference list is a judgement that belongs to the designer.
- **The suite measures 757 and this file previously claimed 761.** This pass is net **+1** test, so
  the two do not reconcile and the gap is not accounted for. Recorded rather than rounded.
- **The designer's hour is unchanged and now six panes deep** — the *unavailable / partial / failed
  / empty* vocabulary, a drawn pairing screen, and now a drawn treatment for the capability list and
  the media card, both of which this pass had to invent type sizes for because the handoff draws
  neither.

## 4 · Two regressions this pass introduced, caught by measuring rather than looking

Both are the shape where a correct-looking fix moves the problem, and both are worth carrying:

- **Putting the ring values in the mono face made `10.8 GB` overflow its arc** — 54.8px inside a
  50.4px clear span. `storageRing`'s own comment already records this exact overflow happening once
  before, *"seen in a screenshot, not in any test, because a DOM double has no layout"*. It came
  straight back because mono is wider at the same px. Long values step down a size now, at a
  measured six-character threshold.
- **The metadata column collapsed to 62px for text needing 116**, drawing `Samsung SM-S938B` as
  `Sam…` with 300px of empty row beside it. **The obvious cause was wrong and the measurement said
  so** — removing `.recent-meta`'s `min-width: 0` changed nothing, because the real floor is one
  level in at `.recent-device span`, whose `overflow: hidden` for its ellipsis zeroes *its*
  min-content and propagates up.

**And the instrument was wrong once, caught by its own output.** The first column-imbalance read
classified cards by matching their ids and reported **205px** — but `.caps-card` is
`grid-column: 1 / -1` and spans both columns, so that number was a full-width card's bottom edge
rather than a column's. A card's column is a fact the browser holds; the probe reads it from the
rect against the grid midline now.

## 5 · How this was verified, as run

```
npm test (desktop)               757 tests, 757 pass, 0 fail
scripts/check-renderer-views.mjs 12 covered, 1 debt, 0 unaccounted for
scripts/check-defects.sh         107 numbered rows, all with records
check-color-tokens · check-contrast · check-apps-verb · check-protocol-spec ·
check-debt-claims  · check-orphan-tests                                      all exit 0
```

Every DOM number in Slice 62 came through `scripts/probe.mjs` with a control, at 1920×1080 with
`innerWidth === outerWidth` (no zoom). **Before reading anything over CDP, check who owns :9222** —
`lsof -nP -iTCP:9222 -sTCP:LISTEN` then `ps -o lstart= -p <pid>`. A stale Electron holding the port
serves every query from an old renderer while the window you are screenshotting is the new one, and
a painted window is not evidence the renderer's JS thread is alive.

## 6 · Where the evidence is

| | |
|---|---|
| the slice | `docs/testing.md` → **Phase 7 Slice 62** |
| the departures | `docs/design-departures.md` → **O6–O18**, and the superseded-reference block at the top |
| the defects | `docs/defects.md` → **122** (open), **123** (fixed) |
| what Phase 7 has left | `docs/phase-7-next.md`, and `docs/phase-7-state.md` §1 for the re-scoring note |
