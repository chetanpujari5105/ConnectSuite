# Sidekick Batch 7 — D67 approved: one state system, two layouts

Taken 2026-09-21 against the running app on a live link. Every PNG has a `.json` sidecar carrying
the window size, DPR, zoom state, scrollbar state and the `prep` that produced the state.

**No frame was rendered from Figma.** The MCP is disconnected, so the component design is unified
but **the exact pixel comparison remains pending** — nothing here is Figma-exact and no line claims
it is.

## The two images that made the case, kept for comparison

| Before | What it shows |
|---|---|
| `BEFORE-files-couldnt-open-1440x920.png` | a red, left-aligned, 14px-radius `files-state-card` in one column **and** a centred, transparent, 24px-padded `state-block` in the other — one pane, one screenshot, two languages for *there is nothing here* |
| `BEFORE-photos-permission-1440x920.png` | an amber `photos-banner` above the same centred block |

| After | What changed |
|---|---|
| `files-couldnt-open-SYNTHETIC-1440x920.png` | the same failure as the **Compact State Block**: the component's `x-circle` badge instead of a `!` character, the component's type scale, `Try again` as its `.state-action` pill — and visibly the same family as the block beside it |
| `photos-permission-SYNTHETIC-1440x920.png` | the refusal as a compact amber block, the phone's two sentences unjoined |

## The rest

| File | State | Layout |
|---|---|---|
| `files-couldnt-open-light-SYNTHETIC-1440x920.png` | Files error, light | Compact |
| `files-couldnt-open-SYNTHETIC-1100x700.png` | Files error, minimum size | Compact |
| `files-no-folders-SYNTHETIC-1440x920.png` | Files M2 | Compact |
| `files-sending-SYNTHETIC-1440x920.png` | a transfer in flight | — |
| `photos-permission-light-SYNTHETIC-1440x920.png` | Photos refusal, light | Compact |
| `photos-partial-SYNTHETIC-1440x920.png` | thumbnails only | Compact |
| `activity-failed-SYNTHETIC-1440x920.png` | Activity A2 — **red now, not amber** (D70) | **Full** |
| `activity-failed-light-SYNTHETIC-1440x920.png` | the same in light | **Full** |

## The readings beside the pictures

- `state-system-verify.txt` — the rules over **what the app draws**, not what the component
  defines: 93 blocks, 12 routes × 2 themes × 2 sizes, thirteen readings including a **coverage**
  check that names the states each migrated pane must have drawn. It caught two panes that had
  silently drawn nothing, which thirteen otherwise-green readings would have certified.
- `shell-parity-sweep.txt` — **841 of 841** focus rings (up from 835: the new state actions), 0
  surfaces blurred under reduced transparency, 0 transitioning under reduced motion.

**Every synthetic capture drove only the pane.** The status island and the sidebar read `Connected`
in all of them; both panes were verified back on the phone's real data afterwards — 152 albums, 128
app tiles, 2 file entries, 9 activity rows, and no state card on any of them.
