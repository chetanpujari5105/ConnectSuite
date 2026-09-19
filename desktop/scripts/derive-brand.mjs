// Derives the renderer's brand art from the originals in `LOGOS/`, which are never edited, resized
// or loaded at runtime (docs/sidekick-figma-handoff.md §13). Run by hand when an original changes:
//
//   node scripts/derive-brand.mjs
//
// The outputs are committed under src/renderer/assets/brand/ and reach dist/ — and so the packaged
// app — through copy-assets.mjs. This is not part of `npm run build` because it needs macOS `sips`
// and the originals are 2 MB of source art the build should not depend on.
//
// **Why it crops to the _visible_ mask, and what alpha > 0 would have said instead.** `head_logo.png`
// is 1774 × 887. Its alpha > 0 bounds are (17, 42)–(1736, 841), 1719 × 799, a 2.15 : 1 box — and
// that is not the mask: it includes a haze of alpha ≤ 4 that nobody can see. Above alpha 4 the
// bounds are (130, 43)–(1645, 840), 1515 × 797, 1.90 : 1, and they do not move between thresholds
// 4 and 128. The 2.15 figure (docs/sidekick-figma-handoff.md §13) was read at alpha > 0, and it
// briefly made a correct 114 × 60 derivation look horizontally squashed. So: crop to the visible
// bounds, then scale to the lockup's height, which keeps one pixel density on both axes. The
// 65 × 30 box in the lockup draws it with `object-fit: contain`, left-aligned.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const logos = resolve(desktop, '../LOGOS');
const out = resolve(desktop, 'src/renderer/assets/brand');

/** The visible mask inside head_logo.png: PIL getbbox on the A channel thresholded at > 4. */
const HEAD_CONTENT = { x: 130, y: 43, w: 1515, h: 797 };
/** The visible tile inside main_logo.png: alpha > 4, measured as HEAD_CONTENT was. 1100 × 1076. */
const TILE_CONTENT = { x: 77, y: 86, w: 1100, h: 1076 };
/** The body of a macOS app icon on its 1024 canvas (Apple's icon grid). */
const ICON_BODY = 824;
/** The lockup's mark box, Figma `61:24256`. */
const MARK_BOX = { h: 30 };

const sips = (...args) => execFileSync('sips', args, { stdio: ['ignore', 'ignore', 'inherit'] });
const tmp = mkdtempSync(join(tmpdir(), 'brand-'));
try {
  const cropped = join(tmp, 'head-cropped.png');
  sips('--cropToHeightWidth', `${HEAD_CONTENT.h}`, `${HEAD_CONTENT.w}`,
    '--cropOffset', `${HEAD_CONTENT.y}`, `${HEAD_CONTENT.x}`,
    join(logos, 'head_logo.png'), '--out', cropped);
  for (const scale of [2, 3]) {
    const h = MARK_BOX.h * scale;
    const w = Math.round((HEAD_CONTENT.w * h) / HEAD_CONTENT.h);
    const file = join(out, `mark@${scale}x.png`);
    sips('--resampleHeightWidth', `${h}`, `${w}`, cropped, '--out', file);
  }
  // The app tile (main_logo.png is already square): Settings' brand card at 44, pairing at 56.
  for (const size of [44, 56]) {
    for (const scale of [2, 3]) {
      const px = size * scale;
      sips('--resampleHeightWidth', `${px}`, `${px}`, join(logos, 'main_logo.png'),
        '--out', join(out, `tile-${size}@${scale}x.png`));
    }
  }

  // The packaged app's icon — build/icon.icns, named by `mac.icon` in electron-builder.yml.
  //
  // main_logo.png is already a macOS tile on a transparent canvas, but its body fills ~88% of that
  // canvas and Apple's grid puts an 824 body on a 1024 canvas (80.5%), so used as-is it would sit
  // visibly larger than every other icon in the Dock. So: crop to the visible bounds (alpha > 4, as
  // for the mark — which also drops the invisible haze), scale **uniformly** so the longer side is
  // 824 (the tile is 1100 × 1076 there, and is not stretched square), and centre it on a transparent
  // 1024 canvas. `iconutil` then packs the ten sizes macOS asks for.
  const tile = join(tmp, 'tile-cropped.png');
  sips('--cropToHeightWidth', `${TILE_CONTENT.h}`, `${TILE_CONTENT.w}`,
    '--cropOffset', `${TILE_CONTENT.y}`, `${TILE_CONTENT.x}`,
    join(logos, 'main_logo.png'), '--out', tile);
  const k = ICON_BODY / Math.max(TILE_CONTENT.w, TILE_CONTENT.h);
  const scaled = join(tmp, 'tile-scaled.png');
  sips('--resampleHeightWidth', `${Math.round(TILE_CONTENT.h * k)}`, `${Math.round(TILE_CONTENT.w * k)}`,
    tile, '--out', scaled);
  const master = join(tmp, 'icon-1024.png');
  sips('--padToHeightWidth', '1024', '1024', scaled, '--out', master);
  const iconset = join(tmp, 'Sidekick.iconset');
  mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    sips('--resampleHeightWidth', `${size}`, `${size}`, master, '--out', join(iconset, `icon_${size}x${size}.png`));
    sips('--resampleHeightWidth', `${size * 2}`, `${size * 2}`, master, '--out', join(iconset, `icon_${size}x${size}@2x.png`));
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', resolve(desktop, 'build/icon.icns')], { stdio: 'inherit' });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log('derived brand art into', out, 'and build/icon.icns');
