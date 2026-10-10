#!/usr/bin/env python3
"""
Every Sidekick logo size, on both apps, from one source: `LOGOS/head logo with outline.png`
(UX batch 2026-10-10, section 5). Run from the repo root:

    python3 scripts/brand/derive-outline-logo.py

It cuts the master with `outline-master.py` (the black background removed exactly, never keyed), crops
to the visible mask (alpha > 4), and only ever **downscales** — the source is 1774 x 887 and the
largest output is 1024 wide, so nothing here is invented. Outputs:

Mac (`desktop/`)
  src/renderer/assets/brand/mark@2x.png, mark@3x.png   the sidebar lockup and Settings card, 30 pt tall
  src/renderer/assets/brand/trayTemplate.png, @2x       menu bar: a one-colour silhouette, eyes cut out,
                                                        16 pt tall — macOS recolours a template image
                                                        for light and dark menu bars itself
  build/icon.icns                                       the packaged app's icon: the mask on a transparent
                                                        1024 canvas, 824 wide (Apple's icon grid), no tile

Android
  core/src/main/res/drawable-{m..xxxh}dpi/sidekick_mark.png   the header mark, 26 dp tall
  app/src/main/res/mipmap-{m..xxxh}dpi/ic_launcher_mask.png       adaptive-icon foreground (108 dp)
  app/src/main/res/mipmap-{m..xxxh}dpi/ic_launcher_mask_mono.png  themed-icon monochrome layer

The adaptive foreground keeps the mask inside the 66 dp safe circle every launcher shape shows in
full: a 1.87 : 1 box inscribed in a 66 dp circle is 58 dp wide, so the mask is drawn 58 dp wide.
"""
import os, subprocess, sys, tempfile
from PIL import Image

ROOT = os.getcwd()
HERE = os.path.dirname(os.path.abspath(__file__))
DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}

def master() -> Image.Image:
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, 'master.png')
        subprocess.run([sys.executable, os.path.join(HERE, 'outline-master.py'), out], check=True)
        img = Image.open(out); img.load()
    bbox = img.getchannel('A').point(lambda v: 255 if v > 4 else 0).getbbox()
    return img.crop(bbox)

def scaled(img: Image.Image, *, height=None, width=None) -> Image.Image:
    w, h = img.size
    if height is not None: size = (round(w * height / h), height)
    else: size = (width, round(h * width / w))
    assert size[0] <= w and size[1] <= h, f'refusing to upscale to {size}'
    return img.resize(size, Image.LANCZOS)

def silhouette(img: Image.Image) -> Image.Image:
    """
    One colour (black) where the mask is, transparent elsewhere, the eyes cut out so it reads as a
    mask. Worked at 520 px wide (the largest silhouette output is 232): the eye pixels (saturated and
    bright) are grown by 9 px — 1.7 % of the width — so the eyes' dark rim goes with them; without it
    each hole kept a thin ring and read as a double outline.
    """
    from PIL import ImageFilter
    small = scaled(img, width=520)
    hsv = small.convert('RGB').convert('HSV')
    _, S, V = hsv.split()
    eyes = Image.eval(S, lambda v: 255 if v > 110 else 0)
    eyes = Image.composite(eyes, Image.new('L', small.size, 0), Image.eval(V, lambda v: 255 if v > 90 else 0))
    eyes = eyes.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(3)).point(lambda v: 255 if v > 110 else 0)
    a = small.getchannel('A')
    alpha = Image.composite(Image.new('L', small.size, 0), a, eyes)
    out = Image.new('RGBA', small.size, (0, 0, 0, 0))
    out.putalpha(alpha)
    return out

def on_canvas(img: Image.Image, canvas: int, body_w: int) -> Image.Image:
    art = scaled(img, width=body_w)
    c = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
    c.paste(art, ((canvas - art.width) // 2, (canvas - art.height) // 2), art)
    return c

def main() -> None:
    m = master()
    print(f'visible mask {m.size[0]}x{m.size[1]} ({m.size[0] / m.size[1]:.2f}:1)')
    brand = os.path.join(ROOT, 'desktop/src/renderer/assets/brand')
    for k in (2, 3):
        scaled(m, height=30 * k).save(os.path.join(brand, f'mark@{k}x.png'), optimize=True)
    sil = silhouette(m)
    scaled(sil, height=16).save(os.path.join(brand, 'trayTemplate.png'), optimize=True)
    scaled(sil, height=32).save(os.path.join(brand, 'trayTemplate@2x.png'), optimize=True)
    with tempfile.TemporaryDirectory() as tmp:
        iconset = os.path.join(tmp, 'Sidekick.iconset'); os.mkdir(iconset)
        big = on_canvas(m, 1024, 824)
        for s in (16, 32, 128, 256, 512):
            big.resize((s, s), Image.LANCZOS).save(os.path.join(iconset, f'icon_{s}x{s}.png'))
            big.resize((s * 2, s * 2), Image.LANCZOS).save(os.path.join(iconset, f'icon_{s}x{s}@2x.png'))
        subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', os.path.join(ROOT, 'desktop/build/icon.icns')], check=True)
    for name, k in DENSITIES.items():
        d = os.path.join(ROOT, f'core/src/main/res/drawable-{name}'); os.makedirs(d, exist_ok=True)
        scaled(m, height=round(26 * k)).save(os.path.join(d, 'sidekick_mark.png'), optimize=True)
        mip = os.path.join(ROOT, f'app/src/main/res/mipmap-{name}'); os.makedirs(mip, exist_ok=True)
        px = round(108 * k)
        on_canvas(m, px, round(58 * k)).save(os.path.join(mip, 'ic_launcher_mask.png'), optimize=True)
        mono = on_canvas(sil, px, round(58 * k))
        # Android tints the monochrome layer itself; it only reads alpha. White keeps previews legible.
        r, g, b, a = mono.split(); white = Image.new('L', mono.size, 255)
        Image.merge('RGBA', (white, white, white, a)).save(os.path.join(mip, 'ic_launcher_mask_mono.png'), optimize=True)
    print('derived: Mac mark@2x/3x, trayTemplate@1x/2x, icon.icns; Android sidekick_mark x5, ic_launcher_mask x5, mono x5')

if __name__ == '__main__':
    main()
