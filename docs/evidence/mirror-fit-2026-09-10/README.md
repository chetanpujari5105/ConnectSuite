# The mirror stage, taking the shape of the stream — 2026-09-10

Defect 99, `docs/testing.md` → Phase 7 Slice 37.

Taken from the **packaged** app (`desktop/release/mac-arm64/ConnectSuite.app`, relaunched after the
build), not `npm start`, at 1440×841 @2x with no zoom. Each PNG has a sidecar `.json` carrying the
window size, DPR, zoom and scrollbar state — every bound the instrument imposed.

| file | what it shows |
|---|---|
| `stage-default-portrait.png` | no session: the CSS fallback, a phone-shaped rectangle. This is the only one of the three that is the app's own state |
| `stage-moto-portrait.png` | `--capture-aspect` driven to **720/1600** — the moto g34 and g45 |
| `stage-samsung-landscape.png` | `--capture-aspect` driven to **2408/1080** — the Samsung turned. **The box is landscape**, rather than a portrait box with a strip of picture in it |

## What these images are, and what they are not

**The last two are simulated states.** No phone was mirroring; `--capture-aspect` was set by hand to
the value `mirror.ts` would set from the phone's announced geometry. So they show what the
**stylesheet** does with a given ratio, which is exactly the half that had been wrong, and they show
nothing about whether `mirror.ts` writes that property when a real `mirror.state` or `mirror.rotate`
arrives.

Said here rather than in a commit message because an image carries no provenance of its own: a
picture of a landscape stage looks identical whether the ratio came from a phone or from a probe,
and the next person to open this directory has no way to tell. The hardware run that would settle it
is named in Slice 37 — three handsets, a physical rotation, and a tap near an edge.

The numeric readings behind them are in the slice; these are the pictures, and a picture is not a
reading.
