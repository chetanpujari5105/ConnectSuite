#!/usr/bin/env python3
"""
The outlined Sidekick mask, cut out of its black background — the one master every logo size is
derived from (UX batch 2026-10-10, section 5).

    python3 scripts/brand/outline-master.py <out.png>

`LOGOS/head logo with outline.png` is 1774 x 887 **RGB with no alpha**: the mask, its white outline and
a soft glow, on solid black. Used as-is it would put a black rectangle — a box — on every light
surface. The outline is a closed white loop, so the background is removed exactly rather than keyed:

1. Flood-fill (4-connected) from the image border over every pixel darker than the outline core
   (luminance < CORE). The fill stops at the outline, so the mask body — also near-black — is never
   reached.
2. Everything the fill reached is the outside. Its pixels are the outline's anti-aliasing and glow over
   black, i.e. white premultiplied by coverage, so each becomes **white with alpha = luminance**. Pure
   black becomes fully transparent; the glow survives as a soft white edge on any background.
3. Everything the fill did not reach (outline core, body, eyes) is kept as drawn, fully opaque.

The original file is read, never modified. The script prints the counts it found so a run that went
wrong (an outline gap letting the fill inside) is visible: the inside must be one region the size of
the mask, not the whole image or nothing.
"""
import sys
from collections import deque
from PIL import Image

SOURCE = 'LOGOS/head logo with outline.png'
CORE = 200  # outline core luminance; the fill stops at it

def main(out_path: str) -> None:
    src = Image.open(SOURCE).convert('RGB')
    w, h = src.size
    lum = src.convert('L')
    L = lum.load()
    outside = bytearray(w * h)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if L[x, y] < CORE and not outside[y * w + x]:
                outside[y * w + x] = 1; q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if L[x, y] < CORE and not outside[y * w + x]:
                outside[y * w + x] = 1; q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not outside[ny * w + nx] and L[nx, ny] < CORE:
                outside[ny * w + nx] = 1; q.append((nx, ny))
    rgba = Image.new('RGBA', (w, h))
    S = src.load(); D = rgba.load()
    inside_count = 0
    for y in range(h):
        row = y * w
        for x in range(w):
            if outside[row + x]:
                a = L[x, y]
                D[x, y] = (255, 255, 255, a) if a > 2 else (0, 0, 0, 0)
            else:
                r, g, b = S[x, y]
                D[x, y] = (r, g, b, 255)
                inside_count += 1
    bbox = rgba.getchannel('A').point(lambda v: 255 if v > 4 else 0).getbbox()
    print(f'source {w}x{h}; inside {inside_count} px ({inside_count / (w * h):.1%}); visible bbox (alpha>4) {bbox}')
    if not (0.25 < inside_count / (w * h) < 0.75):
        sys.exit('outline-master: the inside is not mask-sized — the outline has a gap or the threshold is wrong')
    rgba.save(out_path)

if __name__ == '__main__':
    main(sys.argv[1])
