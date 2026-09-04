# Phase 7 panes, build against design — 2026-09-04

Each `*-build.png` is the running app; each `*-design.png` is the same artboard of
`design_handoff_connectsuite/ConnectSuite.dc.html`. Open them side by side.

**Both are 1440 wide and neither is zoomed.** `innerWidth === outerWidth` is asserted before every
build shot and the run aborts otherwise — Chromium persists a per-origin zoom level into Electron's
user data directory, so a stray ⌘− survives every relaunch and would render a design specified to
the half-pixel at 72% with nothing on screen saying so. The design shots are clipped to the one
`div` whose inline `style.width` is `1440px`, with the clip read *after* the artboard settled.

## What is in each

| File | What it shows |
|---|---|
| `calls-build.png` | Three columns. The flanks are the design's `300px`; the middle is `1fr` and therefore **depends on the scrollbar** — `519px` on a page that is not scrolling, `508px` when it is. Real data: 50 calls off the phone, 45 with a contact name, 9 missed. Departures **C1–C7** |
| `calls-design.png` | The handoff. The four things it draws that the build refuses are the waveform, Mute, Speaker and the "End-to-end encrypted" badge |
| `clipboard-build.png` | The real history, which had **one** entry — honest, and says almost nothing about the pane |
| `clipboard-build-synthetic.png` | **Synthetic rows, said so out loud.** Six entries covering every badge and every timeline branch, because a screenshot of one row says nothing about the design comparison. Nothing in it is a reading, and the pane was put back on the phone's real data afterwards. Its one genuine control: the `displaced` row's text is `REDACTED-NEVER-DRAWN` and a DOM-wide search for it returned `false` |
| `clipboard-design.png` | The handoff. Three of its five badges cannot occur on this wire; its first timeline step is the wrong sentence rather than a missing timestamp (**K5**) |
| `settings-build.png` | **General**, the new pane. Three columns, the two fixed ones exactly the design's `200px` and `320px`; the middle measures `583px` unscrolled and `572px` scrolled against the design's `599px`, which is gap arithmetic plus an 11px scrollbar |
| `settings-build-transfer.png` | **File transfer**, every row a value rather than a control, with the real destination read from `main/downloads.ts` |
| `settings-design.png` | The handoff. Its eight rail panes are six here: Mirror is the Mirror screen's own panel, Security is cut by X2 |
| `overview-build.png` | Quick actions and Recent activity, both new. The strip at the foot is below the fold in a 865px viewport — scroll for it |
| `overview-design.png` | The handoff. Its Device status rings are **not** built and must not be: `battery.state` has no handler on either side (**S4/S5**, **O4**) |
| `mirror-build.png` | Not a Phase 7 pane — included because the tool rail grew a third slot, **Transfer** (**M5**) |

## What the build shots do NOT show

**They are from the dev run, not the packaged app**, and the reason is worth reading rather than
being taken as laziness. The packaged app **could not be started unattended**: it stalls on a
macOS Keychain password dialog before its window is ever created. `cd9de69` predicted exactly this
and labelled it unmeasured; this run measured it. See `docs/phase-9-distribution-audit.md` → D15.

The renderer is byte-identical between the two — both load the same `dist/` — so every layout,
colour and string here is what the packaged app draws. What is **not** identical is native
notification registration (defect 81), and nothing in these screenshots is about that.

## The numbers in the table above

They were re-taken through **`scripts/phase7-panes-probe.mjs`**, which is `probe.mjs` — a control on
every reading, no fixed sleeps, and a stimulus that reports its effect rather than its request. The
first version of the same readings was a hand-rolled CDP eval in a scratchpad, which
`probe.test.mjs`'s scan did not catch because a scratchpad file is not under `scripts/`. That is the
hole `CLAUDE.md` says lives permanently in the one-off read, found in the sitting that wrote about
it.

It printed **`{inner: 1440, outer: 1440, scrollbarPx: 11, pageScrolls: true}`** before any width, and
that line is why the `1fr` figures moved: the ad-hoc read had caught the same grids on a page that
was not scrolling. Neither reading is wrong. They are two content column widths, and the scrollbar
state belongs beside the number.
