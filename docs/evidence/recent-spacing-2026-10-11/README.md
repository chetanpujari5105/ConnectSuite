# Recent activity row spacing + Overview Send files — 2026-10-11 evening

- `before/sweep.txt`, `before/readings.json` — `scripts/tile-centre-sweep.mjs`, every pane × 1100x700,
  1440x900, 1920x1050, 1100x700@1.2 × dark/light, on build `a96e0ab`. **FAIL**: 32 Recent-row readings
  × 2 rules — ink between the lines 1.63 px (line boxes 14 + 12 px touching), detail descenders cut
  0.74 px (12 px font in a 12 px `overflow: hidden` box). Nothing else in the app failed.
- `after/` — same run on this build. **PASS**: ink gap 6.63 px, box gap 2 px, descenders inside their
  boxes (+0.58 / +1.26), clearance to the divider 10.26 px (unchanged), row 52 px, tile optical
  offset −0.17 px (was −0.67), worst offset anywhere 0.47 px.
- `compare-1480x900-dark.png` — before captured from the running `a96e0ab` app; after from this build.
- `compare-1480x900-zoom1.2-dark.png` — the *before* half is a **reconstruction**: the old card was
  below the fold at that zoom, so the four old declarations (`min-height:48px`, `gap:0`, line-heights
  14/12) were re-applied over this build through a constructed stylesheet; it measures 265 px, the
  same as the real old build.
- `synthetic-*.{png,json}` — **synthetic** rows (long title, long detail, device chip, version badge;
  1 row; empty) drawn through `OverviewView.refresh` with a stand-in `activityEvents`; the real bridge
  was put back and refreshed after.
