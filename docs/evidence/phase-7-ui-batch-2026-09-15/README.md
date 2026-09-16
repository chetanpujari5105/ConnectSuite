# Phase 7 UI batch — 2026-09-15

Taken with `scripts/shot.mjs`, which asserts the zoom and the routed screen before capturing and
refuses rather than writing a file it cannot vouch for. Every shot is 1440×920 @2x, the design's
size. Sidecar `.json` beside each carries the window size, DPR, zoom and screen id.

| File | What it shows |
|---|---|
| `01-battery-overview.png` | Defect 109. `46%` in the sidebar device card, `Battery 46% · Charging` as the hero's fifth fact, and the O4 ring agreeing at the same instant |
| `02-advanced-battery.png` | Settings → Advanced reading `battery: 47% · charging · received 12s ago`, where it read `not subscribed on this build` |
| `03-deep-trust.png` | The `Trusted device` deep link's landing — Settings, **Connection** pane, `Forget this phone`. Reached from Photos with Settings' last pane set to *About*, so the pane is the link's doing and not where we already were |
| `04-p5-stale.png` | P5. A real token, expired on the real clock after 180 s: *"This code has expired. Show a fresh code to pair."* |

**What these are not.** A picture is not a reading and no number in `docs/testing.md` is quoted from
one. The numbers come from `scripts/probe.mjs` with a control on every read; these show the thing
sitting where a person would see it, which is the half a probe cannot report — and is how the dead
`.button-primary` class in `04`'s first version was caught, with `tsc` clean and its own test green.
