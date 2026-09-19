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

/*
 * `--viewport=1440x920` emulates the layout viewport, because the design's demo size is taller than
 * the owner's display allows a window to be. Cleared on every exit path below — an emulated live
 * window is an app drawn at a size nobody chose — and recorded in the sidecar as `emulated`.
 */
const viewportArg = arg('viewport');
const viewport = viewportArg
  ? (([w, h]) => ({ width: Number(w), height: Number(h) }))(viewportArg.split('x'))
  : null;
/** Every exit after this point goes through here, so emulation never outlives the run. */
const done = async (code) => {
  if (viewport) {
    try { await probe.rawEmulate(null); } catch {}
  }
  exit(code);
};

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

if (viewport) {
  await probe.rawEmulate(viewport);
  await new Promise((r) => setTimeout(r, 250));
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
    await done(1);
  }
}

// An optional stimulus after the route, for a shot that needs a state the pane does not open in —
// a photo selected, a thread open, a tab picked. It is an `act` like any other, so `--prep-expect`
// is **required** with it: a shot of the state you meant to set up and did not is the same failure
// as a shot of the wrong pane, and it is the harder one to notice afterwards.
const prep = arg('prep');
const prepExpect = arg('prep-expect');
const ready = arg('ready');

/*
 * `--ready` gates `--prep` on the pane having finished loading.
 *
 * Added after the first `--prep` run refused: the click fired against a grid that had not been
 * filled yet, so `run` found nothing to click, `expect` never came true, and the shot was correctly
 * declined. That refusal was the tool working — but the cause was the stimulus arriving before the
 * thing it acts on existed, which is `CLAUDE.md`'s eighth control-table row exactly: an absence read
 * before the action had happened is not a negative reading, it is no reading at all.
 */
if (ready) {
  const deadline = Date.now() + 20000;
  for (;;) {
    if (await probe.rawEvaluate(ready)) break;
    if (Date.now() >= deadline) {
      console.error(`shot.mjs REFUSED: --ready never became true within 20000ms — the pane had not loaded, so any set-up below it would have acted on nothing.`);
      await done(1);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}
if (prep && !prepExpect) {
  console.error('shot.mjs: --prep requires --prep-expect. A stimulus with no effect to check is a request, not a set-up.');
  await done(2);
}
// Not a bare sleep dressed up: this is settling *paint*, after the route has already been confirmed
// landed by its own predicate above. There is nothing to poll for — a transition's final frame is
// not observable from script — so the wait is declared in the sidecar rather than hidden.
await new Promise((r) => setTimeout(r, settleMs));

/*
 * The set-up runs **after** the settle, not before it, and that ordering was a bug first.
 *
 * The first version clicked as soon as `--ready` came true. The click landed, its `expect` went
 * true — and then the pane's own in-flight `refresh()` completed during the settle and cleared the
 * selection, so the shot showed an empty detail column under a stimulus that had genuinely
 * succeeded. The stimulus reported its effect honestly; the effect was simply undone afterwards.
 * A set-up is only a set-up if nothing overwrites it before the shutter.
 */
if (prep) {
  const prepped = await probe.act({ what: 'prep', run: prep, expect: prepExpect, within: 6000 });
  if (!prepped.landed) {
    console.error(`shot.mjs REFUSED: --prep did not land after ${prepped.waitedMs}ms. Nothing was captured.`);
    await done(1);
  }
}


/*
 * The page is scrolled to the top before the shutter, and this was a bug first.
 *
 * `#page` keeps its scroll position across routes, so a shot taken after any earlier probe that
 * scrolled — or after a `--prep` that clicked something low in a list — captures a pane with its
 * own title off screen and its first card cut. The Overview shot did exactly that: the page heading
 * and the top of the sidebar were missing, and the image looked like a *design* difference rather
 * than like an instrument that had not been told where to start.
 *
 * It is done after `--prep` rather than before, because a set-up may legitimately scroll to reach
 * what it clicks; the shutter still opens at the top.
 */
await probe.rawEvaluate(
  `(() => { const p = document.querySelector('#page'); if (p) p.scrollTop = 0; scrollTo(0, 0); return true; })()`,
);
await new Promise((r) => setTimeout(r, 120));

/*
 * And then it is **checked**, because resetting the scroll is not the same as knowing the page is
 * at the top — the difference between a reading and an intention, which this repo has paid for
 * before.
 *
 * The Overview shot went out twice with the page heading and the top of the sidebar missing.
 * Nothing was scrolled — `document.scrollingElement.scrollTop` and `#page.scrollTop` both read 0 —
 * and yet `.page-head` measured at **y = −121**: the whole window's content sat above the viewport.
 * It did not reproduce after a clean relaunch, so the cause is **not established** and is not
 * claimed here; what is established is that a session's accumulated probing can leave the page in a
 * state where every scroll offset reads zero and the picture is still wrong.
 *
 * So this is a precondition on the image rather than a fix for a defect: if the pane's own head is
 * not where it should be, the run refuses and says what it measured, instead of writing a file that
 * will be read as a design difference. Relaunching the app is the remedy and the message says so.
 */
const anchored = await probe.rawEvaluate(`(() => {
  const head = document.querySelector('.page-head');
  if (!head) return { ok: true, why: 'no .page-head to check' };
  const y = Math.round(head.getBoundingClientRect().top);
  return { ok: y >= 0 && y < 200, y };
})()`);
if (!anchored.ok) {
  console.error(
    `shot.mjs REFUSED: the page head sits at y=${anchored.y}, so the window's content is not at ` +
      'the top of the viewport and the shot would be missing the pane heading. Nothing was ' +
      'captured. Relaunch the app and re-run — this has been seen after a long probing session ' +
      'with every scroll offset still reading zero.',
  );
  await done(1);
}

// A short second settle for the set-up's own paint.
if (prep) await new Promise((r) => setTimeout(r, 350));

const clip = flag('full')
  ? await probe.rawEvaluate(`(() => { const d = document.documentElement;
      return { x: 0, y: 0, width: d.clientWidth, height: d.scrollHeight, scale: 1 }; })()`)
  : undefined;

const png = await probe.rawCapture({ clip });
const shotGeom = await probe.rawEvaluate(`(() => ({ inner: innerWidth, innerH: innerHeight }))()`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(png, 'base64'));

const sidecar = {
  file: out,
  screen: screen ?? '(not routed)',
  takenAt: new Date().toISOString(),
  window: { inner: shotGeom.inner, innerH: shotGeom.innerH, dpr: geom.dpr },
  scrollbarPx: geom.scrollbarPx,
  pageScrolls: geom.pageScrolls,
  settleMs,
  ready: ready ?? null,
  prep: prep ?? null,
  scrolledToTop: true,
  full: flag('full'),
  zoomChecked: 'innerWidth === outerWidth (on the real window, before any emulation)',
  emulated: viewport ? `${viewport.width}x${viewport.height} layout viewport via CDP Emulation` : null,
};
writeFileSync(out.replace(/\.png$/, '.json'), JSON.stringify(sidecar, null, 2));

console.log(
  `wrote ${out}  [${shotGeom.inner}x${shotGeom.innerH} @${geom.dpr}x, scrollbar ${geom.scrollbarPx}px, ` +
    `pageScrolls=${geom.pageScrolls}, settled ${settleMs}ms, screen=${sidecar.screen}]`,
);
await done(0);
