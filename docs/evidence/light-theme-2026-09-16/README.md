# The light theme, both themes, every routed pane — 2026-09-16

All 13 routed panes of the main window, captured in **dark** and **light** against the same build,
plus a side-by-side composite per pane.

| | |
|---|---|
| `<pane>-dark.png` / `<pane>-light.png` | the pane, viewport capture, 1440×920 at DPR 2 |
| `sbs-<pane>.png` | the two side by side, labelled |
| `float-dark.png` / `float-light.png` / `sbs-float.png` | the **floating window**, themed from the main window while it was open |

## How they were taken, and what gates them

`/private/tmp/.../shoot.mjs` over CDP, and the instrument is named here because
`docs/evidence/phase-7-panes-2026-09-04/README.md` records the opposite case: shots taken by a
scratchpad script that no longer survives cannot be re-taken by the next person. This one is the
same shape as `scripts/shot.mjs` and carries the same two preconditions:

- **the routed pane is the visible one.** `shell.route` on a blocked route is a silent no-op — the
  previous screen stays up and the file is written under the new pane's name, a mismatch that is
  invisible forever after. Every capture is gated on `shell.screen` matching the request *and* the
  section being unhidden with a non-zero rect. **26 of 26 landed**; nothing was skipped;
- **the theme is the one asked for.** Gated on `data-theme` reading back what was set, before any
  pane is routed. An unstamped page renders dark, which would silently produce 26 dark captures.

## What to look at

- **`sbs-mirror.png`** — defect 121. The overlay's *"Not mirroring."* sits on `--media-scrim`, which
  is the one colour that deliberately does not invert. It was 1.67:1 in light before this build.
- **`sbs-photos.png`** — the same decision working: the video-duration badges stay white-on-dark in
  both themes, because they sit on a scrim over an arbitrary user photo.
- **`sbs-settings.png`** — the Appearance control, which is a real control now. The selected segment
  and the sentence under it differ between the two captures, and the sentence names the **resolved**
  theme rather than only the preference.
- **`sbs-calls.png`** — the contact discs keep their per-contact hues in both themes. A disc is its
  own background, so `--disc-sat` and `--disc-lig` hold; tile *text* sits on the page and drops from
  78% to 25% lightness in light, which is a different token for a different reason.

## What these images are not

They are not the contrast evidence. A screenshot carries no scale and this project has already read
a 126×126 tile off one as "tall, not square". The numbers are `scripts/check-contrast.mjs` (58 token
pairs per theme) and the rendered-DOM sweep (3,302 elements per theme, 0 below AA in both), recorded
in `docs/testing.md` → Phase 7 Slice 55 §4–6.

What the images *are* for is the class of thing no checker was asked about: whether the light theme
reads as one design rather than as a dark theme with the lights turned on.
