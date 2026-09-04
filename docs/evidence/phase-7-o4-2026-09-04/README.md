# O4 — Device status rings · 2026-09-04

`device-status-rings.png` — the dev run at 1440×865, unzoomed, Overview scrolled to the card.

Real data from the phone, not synthetic: `battery.state` and `storage.state` arrived over the wire
during this capture (`[vitals]` lines in the phone's `link.log` at 16:06:53).

- **Battery 79%, green, "Charging"** — the arc is 79% of the circle.
- **Storage 13.7 GB, amber, "free of 490 GB"** — amber because 2.8% free is below the 10% threshold.
  The arc fills with what is **used**; the number says what is **free**.
- **Two rings, not the design's three.** There is no memory ring — see `docs/design-departures.md`
  → O4 and the header of `src/shared/deviceVitals.ts`.

The word *free* is in the caption rather than in the ring because `13.7 GB free` **overflowed the
72px ring** — visible in the first capture of this card and in no test, since the DOM double has no
layout.
