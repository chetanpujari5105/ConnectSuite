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
| `calls-build.png` | Three columns, `300px 519px 300px` — measured, and exactly the design's. Real data: 50 calls off the phone, 45 with a contact name, 9 missed. Departures **C1–C7** |
| `calls-design.png` | The handoff. The four things it draws that the build refuses are the waveform, Mute, Speaker and the "End-to-end encrypted" badge |
| `clipboard-build.png` | The real history, which had **one** entry — honest, and says almost nothing about the pane |
| `clipboard-build-synthetic.png` | **Synthetic rows, said so out loud.** Six entries covering every badge and every timeline branch, because a screenshot of one row says nothing about the design comparison. Nothing in it is a reading, and the pane was put back on the phone's real data afterwards. Its one genuine control: the `displaced` row's text is `REDACTED-NEVER-DRAWN` and a DOM-wide search for it returned `false` |
| `clipboard-design.png` | The handoff. Three of its five badges cannot occur on this wire; its first timeline step is the wrong sentence rather than a missing timestamp (**K5**) |
| `settings-build.png` | **General**, the new pane. Three columns `200px 583px 320px` against the design's `200px 599px 320px` — the 16px is gap arithmetic |
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
