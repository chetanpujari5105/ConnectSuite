# Clipboard pane silence — defect 85 · 2026-09-04

`clipboard-pane.png` — the **packaged** build (`release/mac-arm64`) on :9222, unzoomed
(`innerWidth === outerWidth`), full viewport, uncropped. This is what the user was looking at.

What to see in it, in the order it matters:

1. **The left column is fully on screen and says nothing about the phone direction.** Its live strip
   reads *"On this Mac's clipboard now — ⌘V to paste."* — the direction that works.
2. **The right column ends mid-explanation of the _Mac_ direction** — "…so you can put it back."
   `#clip-wall-phone`, which is the Android explanation, starts below that at `top=828` in an 865 px
   window and is 21% visible. It is not legible in this image, which is the defect.
3. **`From phone 1`** in the filter strip — the pane already counts the directions separately.
4. **`Gucgu · Phone · 12:15:32 PM`** is in the list. The clip did arrive, once the app was opened on
   the phone; the user's reading of "nothing arrived" was about the moment before that.

The detail pane on the right is showing the user's own report, because they had copied it.

Geometry and copy were read with `scripts/clipboard-silence-probe.mjs`, not from this image — a
screenshot carries no scale unless something in it does.
