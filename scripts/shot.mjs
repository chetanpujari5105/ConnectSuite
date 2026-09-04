#!/usr/bin/env node
/**
 * A screenshot of one pane of the running app, with the two preconditions that make it comparable.
 *
 * `docs/evidence/phase-7-panes-2026-09-04/README.md` has named this file since the last design pass
 * and it did not exist — the shots were taken by a scratchpad script that no longer survives, which
 * is the exact complaint `phase7-panes-probe.mjs` opens with about its own numbers. An image whose
 * instrument is gone cannot be re-taken by the next person, so it is here now.
 *
 * ### Why a screenshot needs preconditions at all
 *
 * A picture is not a reading and this file quotes no pixels. But an image *taken wrong* is worse
 * than a wrong number, because nothing in a PNG says what it was taken of. Two things have already
 * gone wrong in this repo and both are silent:
 *
 *  - **Zoom.** Chromium persists a per-origin zoom level into Electron's user data directory, so a
 *    stray ⌘− survives every relaunch. A design specified to the half-pixel then renders at 72%
 *    with nothing on screen saying so.
 *  - **The wrong pane.** `shell.route` on a blocked route is a no-op. The previous screen stays up,
 *    the file is written under the new pane's name, and the mismatch is invisible forever after.
 *
 * So both are asserted before the capture and the run **refuses** rather than writing a file it
 * cannot vouch for. That is the decoration rule applied to an instrument: a check that does not gate
 * the capture is a log line that makes the eventual confusion harder to explain.
 *
 * It also writes a sidecar `.json` beside every image carrying the window size, the DPR, the zoom
 * state, the scrollbar state and the screen id — every bound the instrument imposed, in what it
 * reports, so a result shaped by one of them is not read as a result about the app.
 *
 *   node scripts/shot.mjs --out=docs/evidence/x/photos-build.png --screen=photos
 *   node scripts/shot.mjs --out=/tmp/a.png --screen=photos --settle=1200
 *
 * `--full` captures the whole scroll height rather than the viewport.
 */
import { openProbe } from './probe.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { argv, exit } from 'node:process';

const arg = (name, fallback = null) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const out = arg('out');
const screen = arg('screen');
const settleMs = Number(arg('settle', '400'));
if (!out) {
  console.error('shot.mjs: --out=<path.png> is required');
  exit(2);
}

const probe = await openProbe({ port: Number(arg('port', '9222')) });

/** The zoom precondition. `innerWidth !== outerWidth` is the tell, and it is silent otherwise. */
const geom = await probe.rawEvaluate(`(() => ({
  inner: innerWidth, outer: outerWidth, innerH: innerHeight,
  dpr: devicePixelRatio,
  scrollbarPx: innerWidth - document.documentElement.clientWidth,
  pageScrolls: (() => { const p = document.querySelector('#page'); return !!p && p.scrollHeight > p.clientHeight; })(),
}))()`);

if (geom.inner !== geom.outer) {
  console.error(
    `shot.mjs REFUSED: the window is zoomed (innerWidth ${geom.inner} !== outerWidth ${geom.outer}). ` +
      'A shot taken now would be compared against a design it does not share a scale with. ' +
      'Reset with ⌘0 in the app window.',
  );
  exit(1);
}

if (screen) {
  const acted = await probe.act({
    what: `route to ${screen}`,
    run: `shell.route(${JSON.stringify(screen)});`,
    // The stimulus reports its effect. A blocked route leaves the previous pane up, and the file
    // would be written under this pane's name carrying a picture of another one.
    expect: `document.querySelector('section.screen[data-screen="${screen}"]') !== null
      && document.querySelector('section.screen[data-screen="${screen}"]').hidden === false
      && shell.screen === ${JSON.stringify(screen)}`,
    within: 6000,
  });
  if (!acted.landed) {
    console.error(
      `shot.mjs REFUSED: did not land on "${screen}" after ${acted.waitedMs}ms. ` +
        'Nothing was captured — an image of the wrong pane under the right name is unrecoverable.',
    );
    exit(1);
  }
}

// Not a bare sleep dressed up: this is settling *paint*, after the route has already been confirmed
// landed by its own predicate above. There is nothing to poll for — a transition's final frame is
// not observable from script — so the wait is declared in the sidecar rather than hidden.
await new Promise((r) => setTimeout(r, settleMs));

const clip = flag('full')
  ? await probe.rawEvaluate(`(() => { const d = document.documentElement;
      return { x: 0, y: 0, width: d.clientWidth, height: d.scrollHeight, scale: 1 }; })()`)
  : undefined;

const png = await probe.rawCapture({ clip });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(png, 'base64'));

const sidecar = {
  file: out,
  screen: screen ?? '(not routed)',
  takenAt: new Date().toISOString(),
  window: { inner: geom.inner, innerH: geom.innerH, dpr: geom.dpr },
  scrollbarPx: geom.scrollbarPx,
  pageScrolls: geom.pageScrolls,
  settleMs,
  full: flag('full'),
  zoomChecked: 'innerWidth === outerWidth',
};
writeFileSync(out.replace(/\.png$/, '.json'), JSON.stringify(sidecar, null, 2));

console.log(
  `wrote ${out}  [${geom.inner}x${geom.innerH} @${geom.dpr}x, scrollbar ${geom.scrollbarPx}px, ` +
    `pageScrolls=${geom.pageScrolls}, settled ${settleMs}ms, screen=${sidecar.screen}]`,
);
exit(0);
