# Resume here — written 2026-09-19: Sidekick Batches 1–3, for the demo

> A state report, not a note to myself. Written to be handed to someone who was not here.

## 0 · State

| Commit | What |
|---|---|
| `832b332` | **Batch 1** — Figma tokens, Figma-vector icons, `LOGOS/` brand art through dev and packaged builds, the shell (232 sidebar, lockup under the traffic lights, Search = ⌘K palette, no dock) |
| `c06506b` | **Batch 2** — the Overview rebuilt to handoff §6: hero + phone visual, media remote, four-row Recent, two metric cards, Connection & security; connected / connecting / disconnected / permission states |
| `e315c72` | **Batch 3** — Mirror (Session card, one of Start/Stop), Settings → File transfer (brand tile, Show in Finder verified), pairing (code draws on arrival — a real defect) |

Every commit: typecheck clean, `npm test` 818 → 831 green, all commit guards exit 0. Nothing pushed.
Evidence: `docs/testing.md` → *Sidekick Batch 1/2/3*; departures D13–D25 in
`docs/design-departures.md`; screenshots in `docs/evidence/sidekick-batch{1,2,3}/`.

## 1 · The Figma MCP was rate-limited for the whole sitting

Every `get_screenshot` returned the Starter-plan limit. **No pixel overlay against any Figma frame
exists.** Everything was built against `docs/sidekick-figma-handoff.md`'s numbers and the component
values already extracted (icons, D13–D18). One Figma call per frame is owed: `6:2`, `22:184`,
`31:1566`, `34:10843`, `34:11219`.

## 2 · Not proven on hardware

- **Media remote with a real session.** Idle, permission and offline are real; *playing* was only
  rendered from a synthetic state. Play something on the phone before any demo.
- **A live mirror session** after the Session-card change (consent needs a tap on the phone).
- **Connecting** was rendered synthetically (a real reconnect takes ~250 ms).

## 3 · Next

Batches 4–5 in `docs/sidekick-implementation-plan.md`: Messages, Notifications, Clipboard, Calls;
Apps, Activity (per-event badge tone — D23), Settings → Device info (D22's real home), Camera, the
four-step pairing column.

---

# Resume here — written 2026-09-17: the native-macOS pass

> A state report, not a note to myself. Written to be handed to someone who was not here.
>
> **Nothing is committed.** The tree holds this pass **and** the 2026-09-17 O19–O21 follow-up below
> it, uncommitted together.

## 0 · Read first: which design authority this pass answers to

The owner briefed a visual + motion pass ("native macOS, not a vibe-coded dashboard") and, **when
asked, chose: the brief wins where it disagrees with the handoff, and every disagreement is a
departure row.** Those rows are **N-P1–N-P3, N-M2, N-M4, N-M7–N-M10** at the end of
`docs/design-departures.md`. The handoff is still the authority for everything not named there. This
is recorded so it does not repeat 2026-09-16's unnamed second reference (§ below, and that file's top).

| | |
|---|---|
| The audit and plan, written before code | `docs/native-mac-pass-audit.md` |
| The evidence | `docs/testing.md` → **Phase 7 Slice 63** |
| The departures | `docs/design-departures.md` → *The native-macOS pass* |

## 1 · What changed

- **Defect: Start and Stop mirroring were both on screen.** Nothing held whether a session existed.
  `src/shared/mirrorSession.ts` (8 tests, red-first) now decides; exactly one is shown.
- **Rings → readout + bar** (N-P2). The rings had *never* animated — rebuilt at their final value on
  every update. Bars now travel from the previous reading (`transform: scaleX`, 600ms ease-in-out).
- **Colour roles** (tokens.css): hue means one thing. Battery is neutral until low; capability chips
  are not green (N-P1). One two-state selection rule (`--selection-*`, `--unselected-text`) across
  capability chips, Activity chips, Notifications filter pills, Settings tabs and quality rows.
- **Material:** top-level panels (`.card`, `.pane`, `.files-panel`, `.unbuilt-screen`) are
  `--material-card` + blur; the one primary card stays opaque; nested panels never blur.
- **Motion:** route 410ms → 140ms opacity (N-M2); halo once on connect, not forever (N-M4); island
  words fade on a *tone* change only; ⌘K opens in one frame (N-M8); dock without overshoot (N-M9);
  one press scale (N-M7); no hover on non-interactive cards (N-M10); new Recent activity rows arrive,
  keyed on `seq`, survivors slide (FLIP).
- **Type:** 18 literal sizes → 12; `--text-caption` added.
- **Accessibility:** reduced motion keeps opacity fades on `.motion-fade`; reduced transparency now
  handled (it was ignored while chrome drew blur).

## 2 · What is NOT done or NOT proven

- **`/review-animations` has not been run.** It is user-invocable only. The brief's last step.
- **Start/Stop during a live session is proven by test, not on hardware.** Stimulus: press Start with
  the phone connected; Stop should replace it at once, before consent.
- **No overflow measurement after the 0.5px type moves** — checked by eye on five panes at
  1440×920. A DOM double has no layout; the one tool that can see it is a CDP probe.
- **Card blur cost is unmeasured.** `backdrop-filter` over the animated blobs; the plan said measure
  frame time with the scroll-rate probe and fall back to opaque if it regresses. Not done.
- **The sidebar footer wraps "Chetans-MacBook-Pro" onto three lines at 1440px.** Seen, not caused by
  this pass, not fixed.
- The literal durations in **styles.css** (180ms ×4, 160ms ×2) were not tokenised; shell.css's were.
- The brief named `redesign-existing-projects` and `high-end-visual-design`; **neither is installed**.
  `impeccable` stood in for the audit.

## 3 · Verified, as run

```
npm test (desktop)   767 / 767          all eight .mjs guards + check-defects.sh   exit 0
```
Live CDP reads of every motion value are in Slice 63 §3, from an Electron started after the build.

---

# The previous sitting's brief, kept until its work is committed

# Resume here — written 2026-09-16: Overview re-scored against the handoff, and a second design authority retired

> A state report, not a note to myself. Written to be handed to someone who was not here.
>
> **Committed as `f6384a3`** (the four stacked sittings, one commit). **2026-09-17 follow-up, not yet
> committed:** O19 (storage ring to the handoff's assignment), O20 (the handoff's phone render), O21
> (the strip below the fold at 920px, recorded as a departure), and the 761 count settled — §3.

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
- **~~`#caps-card` and `#overview-strip` below the fold at 920px~~ — resolved 2026-09-17.** The
  capability list is reference and may scroll. The strip carries state, and cannot be made visible at
  rest without departing from the handoff: the handoff's **own** footer sits at 872–930 against a
  scroll band ending at 865. Recorded as departure **O21** rather than left open.
- **~~The suite measures 757 and this file claimed 761~~ — settled 2026-09-17 by measurement.**
  Parent `59c9475` runs **681**, HEAD `f6384a3` runs **757**, and the test diff is +86/−10 = +76
  exactly, including Slice 58's five deleted Quick-actions tests. 761 was Slice 57's figure, stale
  since Slice 58; it is consistent with the chain but cannot be re-measured (no tree at that state
  exists). Slice 62 §6 carries the table.
- **The storage ring and the phone render were not withdrawn as conformance** — only as defects.
  Both now match the handoff: `490 GB` in the ring over `9.0 GB free` (47.0px of text in a 50.4px
  span, so it stays 13px), and the violet→teal wallpaper with its notch pill (O19, O20).
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
| the departures | `docs/design-departures.md` → **O6–O21**, and the superseded-reference block at the top |
| the defects | `docs/defects.md` → **122** (open), **123** (fixed) |
| what Phase 7 has left | `docs/phase-7-next.md`, and `docs/phase-7-state.md` §1 for the re-scoring note |
