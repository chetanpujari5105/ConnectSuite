/**
 * The brand art's guard: what `index.html` asks for exists, reaches `dist/`, and is the visible
 * mask at one pixel density.
 *
 * **What this is named for.** The lockup is a raster in a markup `<img>`, which is the one kind of
 * asset in this renderer that nothing type-checks: a wrong path builds clean, typechecks clean, and
 * ships a broken-image box in the sidebar of every screen. And the art is *derived* from `LOGOS/`
 * by `scripts/derive-brand.mjs`, so a re-derivation can quietly change its aspect.
 *
 * **Shown to fail**: renaming `mark@3x.png` turns "every brand path the page references exists"
 * red; re-deriving at the alpha > 0 bounds (1719 × 799, the invisible haze included) produces a
 * 129 × 60 file and turns the aspect test red; removing the `assets` copy from copy-assets.mjs
 * turns the pipeline test red. All three were put back.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const RENDERER = __dirname;
const DESKTOP = join(__dirname, '..', '..');

/** Width and height from a PNG's IHDR chunk, which always starts at byte 16. */
function pngSize(file: string): { w: number; h: number } {
  const b = readFileSync(file);
  assert.equal(b.toString('ascii', 12, 16), 'IHDR', `${file} is not a PNG`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/** Every `assets/…` path in index.html, from `src` and from each `srcset` candidate. */
function referencedAssets(): string[] {
  const html = readFileSync(join(RENDERER, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const paths = new Set<string>();
  for (const m of html.matchAll(/(?:src|srcset)="([^"]+)"/g)) {
    for (const candidate of m[1]!.split(',')) {
      const path = candidate.trim().split(/\s+/)[0]!;
      if (path.startsWith('assets/')) paths.add(path);
    }
  }
  return [...paths];
}

test('control_the reference scan finds the lockup mark at both densities', () => {
  const found = referencedAssets();
  assert.ok(found.includes('assets/brand/mark@2x.png'), `found: ${found.join(', ')}`);
  assert.ok(found.includes('assets/brand/mark@3x.png'), `found: ${found.join(', ')}`);
});

test('every brand path the page references exists in the source tree', () => {
  for (const path of referencedAssets()) {
    assert.ok(existsSync(join(RENDERER, path)), `${path} is referenced by index.html and missing`);
  }
});

test('the mark is the visible mask — 1515 × 797 in LOGOS/ — at one density on both axes', () => {
  const visible = 1515 / 797;
  const two = pngSize(join(RENDERER, 'assets/brand/mark@2x.png'));
  const three = pngSize(join(RENDERER, 'assets/brand/mark@3x.png'));
  assert.equal(two.h, 60, 'the lockup box is 30px tall');
  assert.equal(three.h, 90, 'the lockup box is 30px tall');
  for (const { w, h } of [two, three]) {
    // One pixel of rounding in the width is 1% at 2x; anything past that is a different crop.
    assert.ok(Math.abs(w / h - visible) / visible < 0.01, `${w} × ${h} is not the visible mask's aspect`);
  }
});

test('the tiles are square at each size and density they are derived for', () => {
  for (const size of [44, 56]) {
    for (const scale of [2, 3]) {
      const { w, h } = pngSize(join(RENDERER, `assets/brand/tile-${size}@${scale}x.png`));
      assert.deepEqual([w, h], [size * scale, size * scale], `tile-${size}@${scale}x`);
    }
  }
});

test('the build copies the whole assets directory into dist/, which the package ships', () => {
  // copy-assets.mjs is the only route from src/renderer to dist/renderer for a non-.ts file, and
  // electron-builder.yml packages `dist/**/*`. A missing copy builds clean and ships no lockup.
  const copy = readFileSync(join(DESKTOP, 'scripts/copy-assets.mjs'), 'utf8');
  assert.match(copy, /cp\(resolve\(root, 'src\/renderer\/assets'\), resolve\(root, 'dist\/renderer\/assets'\), \{ recursive: true \}\)/);
  const builder = readFileSync(join(DESKTOP, 'electron-builder.yml'), 'utf8');
  assert.match(builder, /^\s*- dist\/\*\*\/\*$/m);
});
