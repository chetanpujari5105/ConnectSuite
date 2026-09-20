# Sidekick Batch 6a — pairing · code and *No network*

Taken 2026-09-20 with `scripts/shot.mjs` against the running app. Every file has a `.json` sidecar
carrying the window size, DPR, zoom state, scrollbar state and the `prep` that produced the state.

**No frame in this batch was rendered from Figma.** The MCP is not connected on this account, so
these are *built to `docs/sidekick-figma-handoff.md`* — the weaker claim, and the one to quote.

| File | State | Frame |
|---|---|---|
| `pairing-code-1440x920.png` | the code, dark, demo size | `34:11219` |
| `pairing-code-light-1440x920.png` | the code, light | `34:11219` |
| `pairing-code-1100x700.png` | the code, minimum supported size | `34:11219` |
| `pairing-no-network-SYNTHETIC-1440x920.png` | no network, dark | `34:12152` |
| `pairing-no-network-light-SYNTHETIC-1440x920.png` | no network, light | `34:12152` |
| `pairing-no-network-SYNTHETIC-1100x700.png` | no network, 1100 × 700 | `34:12152` |

## What these images do NOT show, stated because a PNG cannot say it

- **The three no-network files are SYNTHETIC and only the card was driven.** This Mac is on the
  network carrying the session being photographed. The state comes from calling the production
  `applyPairShape(false)`; the card is put back from the live reachability afterwards.
- **So the status island, the sidebar and the device card all read `Connected`** in those three, and
  **the steps column reads all four `done`** — because this Mac is paired. A paired column beside a
  no-network card is a combination that cannot occur in the product. It is what the instrument could
  produce, not a state of the app.
- The unpaired-and-no-network column — where the first step reads *Waiting for a network* — is
  covered by `pairSteps.test.ts` and by no image here, because producing it would mean forgetting
  the owner's real phone.
- **What is not synthetic**: `scripts/pair-nonetwork-probe.mjs` reads the same states through
  `getComputedStyle`, in the browser, where a cascade exists and the DOM double's assertions do not
  reach. 9 of 9 readings OK, one row reported as `NO READING` rather than folded into a pass.
