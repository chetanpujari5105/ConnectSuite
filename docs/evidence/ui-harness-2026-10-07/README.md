# Isolated renderer harness — Mac UI states, sizes, themes and route timings (2026-10-07, overnight)

**Harness:** the U1 harness (`docs/evidence/release-audit-2026-10-06/u1-layout/harness-main.cjs` +
`harness-preload.cjs`) run on scratch builds of the renderer: its own Electron process, its own profile
directory, hidden windows, no debugging port, no product main process, **synthetic data only** (the preload
is a fake bridge; names such as "Synthetic Phone" and +1 555 numbers are generated). Each job carries the
harness's own instrument control (a planted overlap, an unnamed button, a clipped control and a text overlap
must all be detected) — **32 of 32 controls detected** in the final sweep.

One change to the harness, recorded: in `failing` mode `pairingQr` now **rejects**, because the product's
`pairing-qr` handler rejects on failure; the old harness resolved a refusal shape the product cannot produce.

**Limitation:** the harness waits fixed times (1.5 s after load, 0.7 s after each route) before measuring. A
state still settling after that is not seen. Keyboard traversal and VoiceOver were not exercised here (the
measure checks every visible control has an accessible name); the real window was not used.

## Sweep: 4 states × 4 sizes × 2 themes × 13 panes (416 pane readings)

States: `populated` (with an unusually long label in names, paths and clipboard text), `empty`,
`disconnected`, `failing`. Sizes: 1100×700 (the window minimum), 1280×800, 1440×920, and 1320×840 at 120%
zoom (the smallest window that zoom level is now allowed in).

| | before (HEAD `425e578`, incl. 1100×700 at 125%) | after (this commit) |
|---|---|---|
| uncaught renderer errors | **8** — every `failing` job: `showQr` read a rejected `pairing-qr` (defect 198) | **0** |
| controls overlapping controls | **12** (all at 125% in the minimum window) | **0** |
| clipped controls | **30** (same) — Files search, sort, view and Send cut off; a Clipboard tab under *Clear all* | **0** |
| horizontal scroll | 9 jobs: Overview page, Calls centre column (~78 px), Activity table | **0** |
| unnamed controls / off-viewport / document overflow | 0 / 0 / 0 | 0 / 0 / 0 |
| text overlapping a control | Mirror overlay on the canvas (by design, all jobs) + Clipboard at 125% | Mirror overlay only |

The 125% cases are now unreachable rather than restyled: View → Zoom refuses a step that would leave the page
below 1100×700 CSS px and scales the window minimum with the zoom (defect 197). Raw summaries:
`state-sweep-before.txt`, `state-sweep-after.txt`.

## Route timings — stated workload, before/after

Workload: route away, then to the pane; let the synthetic bridge's already-resolved promises settle (three
`setTimeout(0)` turns); force style and layout (`offsetHeight`). Median of 5, one hidden 1280×800 window,
dark theme. ×1 = 80 files, 120 photos, 123 apps, 40 notifications, 60 threads, 50 calls, 20 clips, 400
activity events; ×10 and ×25 scale every list. **This measures renderer scripting + layout with in-memory
data — not network, not the phone, not frame rate, and not what a person perceives.** Single run per build.

| pane | ×1 before → after (ms) | ×10 before → after | ×25 before → after |
|---|---|---|---|
| Files | 24.2 → 25.9 | 90.0 → 85.5 | 219.8 → 219.9 |
| Photos | 29.8 → 30.3 | 156.6 → 139.0 | 376.4 → 378.3 |
| Messages | 18.3 → 18.5 | 31.1 → 33.6 | 54.8 → 56.3 |
| Notifications | 20.1 → 20.7 | 40.6 → 39.9 | 78.9 → 81.3 |
| Clipboard | 17.7 → 18.2 | 24.6 → 24.1 | 35.0 → 36.1 |
| Calls | 17.8 → 17.5 | 26.8 → 26.7 | 38.2 → 39.9 |
| Apps | 20.5 → 21.5 | 132.9 → 140.9 | 588.7 → 607.6 |
| Activity | 16.2 → 16.4 | 17.6 → 18.1 | 21.9 → 21.4 |

"Before" is a scratch build of `6b07981` (session start). **No performance change was made or is claimed**; the
differences are within single-run variation. The one number worth a later look is Apps at ×25 (3,075 apps,
~0.6 s per route) — far above a real phone's launcher count (123 on the SM-S938B), so not acted on.

## Screenshots (synthetic data)

`populated-dark-1100x700-files.png`, `populated-light-1100x700-clipboard.png`,
`populated-dark-1100x700-settings.png`, `populated-dark-1320x840-z1.2-files.png`,
`populated-dark-1320x840-z1.2-calls.png`, `failing-dark-1100x700-pairing.png` (the new *No pairing code yet* card;
its steps column shows all ticks because the harness reports a paired status while the pairing screen is
forced — an impossible combination in the product, not a finding).
