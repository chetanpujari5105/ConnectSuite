#!/usr/bin/env python3
"""
The brand lockup's pixel readings, classified by the artwork's own alpha channel.

### Why the classifier is the asset and not a threshold

"Is the mask readable" is a question about the **wings**. The eyes were bright before any of this
work and were never the problem — a 5th/95th percentile over a crop reports 13.66:1 and is
measuring them, which is the denominator mistake in a different unit.

A brightness threshold over the *rendered* crop cannot help either: it has no way to separate a
dark wing from the dark ground behind it, and that inability is the entire defect being measured.

So the classifier is `mark@2x.png` itself. It is RGBA at exactly the rendered device size (114x60
for a 57x30 mark at dpr 2), so its alpha says which rendered pixels are mask and which are ground,
and its own colour separates the near-black wings from the bright eyes. Every class prints its
pixel count: a class that collapsed to nothing is then visible rather than silently producing a
confident ratio.

    python3 scripts/brand-pixels.py --shot=/tmp/brand-viewport-dark.png --dpr=2 \
        --stage=20,43,69,36 --mark=26,46,57,30 --sidebar=97,43,127,36 --label=dark

All rects are CSS pixels as `brand-lockup-probe.mjs` read them; this multiplies by `--dpr`. The
shot is a plain viewport capture: a `clip` would set `captureBeyondViewport` and re-lay-out the
page under the rects, and `clip.scale` multiplies on top of the dpr rather than replacing it, so a
clip at `scale: 2` on a dpr-2 display returns a 4x image that a 2x asset cannot be indexed into.
That went wrong once and **the eyes control is what caught it** — wings and eyes agreeing to two
decimal places is an alignment that is wrong for both, not a reading about the lockup.
"""
import argparse
import sys
from PIL import Image

ASSET = 'desktop/src/renderer/assets/brand/mark@2x.png'


def srgb_to_linear(c: float) -> float:
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luminance(rgb) -> float:
    r, g, b = (srgb_to_linear(v) for v in rgb[:3])
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(l1: float, l2: float) -> float:
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


def mean(values):
    return sum(values) / len(values) if values else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--shot', required=True, help='a plain viewport capture at --dpr')
    ap.add_argument('--dpr', type=int, required=True)
    ap.add_argument('--stage', required=True, help='x,y,w,h of the stage in CSS px')
    ap.add_argument('--mark', required=True, help='x,y,w,h of the mark in CSS px')
    ap.add_argument('--sidebar', required=True, help='x,y,w,h of sidebar gutter beside the stage, CSS px')
    ap.add_argument('--sidebar-far', required=True, help='x,y,w,h of sidebar well away from the lockup, CSS px')
    ap.add_argument('--label', default='')
    args = ap.parse_args()

    d = args.dpr
    gx, gy, gw, gh = (int(round(float(v))) * d for v in args.stage.split(','))
    mx, my, mw, mh = (int(round(float(v))) * d for v in args.mark.split(','))
    bx, by, bw, bh = (int(round(float(v))) * d for v in args.sidebar.split(','))
    fx, fy, fw, fh = (int(round(float(v))) * d for v in args.sidebar_far.split(','))

    asset = Image.open(ASSET).convert('RGBA')
    shot = Image.open(args.shot).convert('RGB')
    if asset.size != (mw, mh):
        print(f'NO READING — the asset is {asset.size} and the mark renders at {(mw, mh)} device px. '
              'The classifier only works when they are the same grid; nothing was measured.')
        return 1

    # Index into the viewport shot directly. `stage` here is the whole shot with absolute
    # coordinates, and ox/oy are the mark's device-pixel origin in it.
    stage = shot
    ox, oy = mx, my
    sl, st, sr, sb = gx, gy, gx + gw, gy + gh
    sidebar = shot.crop((bx, by, bx + bw, by + bh))
    sidebar_far = shot.crop((fx, fy, fx + fw, fy + fh))

    aw, ah = asset.size
    apx = asset.load()
    spx = stage.load()

    wings, eyes, ground = [], [], []

    for y in range(ah):
        for x in range(aw):
            r, g, b, alpha = apx[x, y]
            sx, sy = ox + x, oy + y
            if not (0 <= sx < stage.width and 0 <= sy < stage.height):
                continue
            rendered = spx[sx, sy]
            if alpha > 250:
                # The asset's own colour decides which part of the mark this is. The near-black body
                # is the silhouette; anything bright is the eyes.
                if max(r, g, b) < 60:
                    wings.append(rendered)
                elif max(r, g, b) > 150:
                    eyes.append(rendered)

    # Ground is every stage pixel the artwork does not cover, inside the stage box (so the 4px pad
    # around the crop — which is sidebar, not stage — is excluded).
    for y in range(st, min(sb, stage.height)):
        for x in range(sl, min(sr, stage.width)):
            ax, ay = x - ox, y - oy
            covered = 0 <= ax < aw and 0 <= ay < ah and apx[ax, ay][3] > 5
            if not covered:
                ground.append(spx[x, y])

    if not wings or not ground:
        print(f'NO READING — wings={len(wings)} ground={len(ground)}: a class collapsed, so no ratio exists')
        return 1

    lw, le, lg = mean([luminance(p) for p in wings]), mean([luminance(p) for p in eyes]) if eyes else None, mean([luminance(p) for p in ground])

    def rgb_mean(ps):
        return tuple(round(mean([p[i] for p in ps])) for i in range(3))

    sidebar_px = [sidebar.getpixel((x, y)) for y in range(sidebar.height) for x in range(sidebar.width)]
    sb_mean = rgb_mean(sidebar_px)
    sb_spread = max(sb_mean) - min(sb_mean)
    far_px = [sidebar_far.getpixel((x, y)) for y in range(sidebar_far.height) for x in range(sidebar_far.width)]
    far_mean = rgb_mean(far_px)
    # Per channel, because a leak is a hue shift and a mean would let blue and lime cancel.
    leak = max(abs(a - b) for a, b in zip(sb_mean, far_mean))
    st_mean = rgb_mean(ground)
    st_spread = max(st_mean) - min(st_mean)

    # The baseline the stage replaced: the same wings, on the bare sidebar, with no stage under
    # them. It is computed from the sidebar band measured in the same frame rather than quoted from
    # an old document, so the before and the after are one reading taken two ways.
    l_bare = luminance(sb_mean)

    label = f' [{args.label}]' if args.label else ''
    print(f'brand pixels{label}')
    print(f'  wings   n={len(wings):5d}  rgb={rgb_mean(wings)}  L={lw:.4f}')
    if eyes:
        print(f'  eyes    n={len(eyes):5d}  rgb={rgb_mean(eyes)}  L={le:.4f}')
    print(f'  ground  n={len(ground):5d}  rgb={st_mean}  L={lg:.4f}   (stage + halo, under and around the mark)')
    print()
    print(f'  wings on the bare sidebar       {ratio(lw, l_bare):.2f}:1'
          f'   <- what a mask with no stage under it gets')
    print(f'  wings against their ground      {ratio(lw, lg):.2f}:1'
          f'   <- with the stage and halo')
    if eyes:
        print(f'  eyes  against the same ground   {ratio(le, lg):.2f}:1'
              f'   <- the control: these were always bright and are NOT what was fixed.')
        print('        A run where this comes back near the wings is an alignment that is wrong for')
        print('        both classes, not a finding about the lockup.')
    print()
    print(f'  sidebar beside the stage  rgb={sb_mean}  channel spread {sb_spread}')
    print(f'  sidebar far from it       rgb={far_mean}  largest per-channel difference {leak}')
    print(f'  stage ground              rgb={st_mean}  channel spread {st_spread}'
          f'   <- the control: the halo MUST tint here, or "no tint on the sidebar" means nothing')
    print()

    failures = []

    def verdict(ok, label, detail):
        print(f'  {"PASS" if ok else "FAIL"}  {label} — {detail}')
        if not ok:
            failures.append(label)

    # A tint is a channel imbalance. The sidebar is a neutral ground in both themes, so a blue or
    # lime cast on it shows up as a spread between its channels and nowhere else. `SPREAD_NEUTRAL`
    # is 3 rather than 0 because PNG quantisation and the window's own translucency move a channel
    # by a point; the stage's spread beside it is what says 3 is a floor and not a blindfold.
    verdict(
        leak <= 2,
        'the sidebar is not tinted blue or lime',
        f'the gutter beside the stage reads rgb{sb_mean} and the gutter far below it reads '
        f'rgb{far_mean} — largest per-channel difference {leak}  '
        f'[control: the stage ground itself reads {st_mean}, spread {st_spread}]',
    )
    verdict(
        st_spread > sb_spread,
        'and the halo is genuinely there, so that reading means something',
        f'stage ground spread {st_spread} against the sidebar\'s {sb_spread}',
    )
    if eyes:
        # Theme-independent, and the first version was not: it asserted the *eyes* had the higher
        # ratio, which is true in dark and false in light, where a lime eye on a near-white ground
        # is the LOW-contrast class and the dark wings are the high one. What the control is
        # actually for is that the classifier separated two different populations at all, and that
        # is a statement about their luminances rather than about either one's ratio.
        verdict(
            abs(lw - le) > 0.2,
            'the wing and eye classes are separated, so the alignment is right',
            f'wings L={lw:.4f} against eyes L={le:.4f} — a run where these converge is an '
            f'alignment wrong for both classes, not a finding about the lockup',
        )

    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
