#!/usr/bin/env node
/**
 * The Sidekick brand lockup, read from the running app rather than from `shell.css`.
 *
 * ### Why this is a script and not a paragraph
 *
 * The lockup's fix shipped in `63b4d77` and **did not take**. `shell.css` declared `.brand-mark`
 * twice — a 57px/centre block whose comment explained the change, and the pre-existing 65px/left
 * block six lines below it. Equal specificity, later wins. The file read correctly top to bottom
 * and the browser drew the old rule: the artwork pinned to the left of a 65px box inside a 69px
 * stage, eight empty pixels on the right showing the lime half of the halo through.
 *
 * Nothing could have caught it by reading CSS, which is the same conclusion the motion sweep
 * reached about transitions. So every number here comes from `getComputedStyle` or from the
 * screenshot's own pixels, and never from the stylesheet.
 *
 * ### The pixel readings, and how the classes are separated
 *
 * "Is the mask readable" is a question about the **wings**, not the eyes. The eyes were bright all
 * along and were never the problem — a naive 5th/95th percentile crop reports 13.66:1 and is
 * measuring them. So the classifier is not a brightness threshold on the screenshot, which would
 * be the same mistake in a different unit. It is **the artwork's own alpha channel**: `mark@2x.png`
 * is RGBA, so the asset says which rendered pixels are mask and which are ground, and the asset's
 * own colour separates the near-black wings from the bright eyes. A threshold over the rendered
 * image would have no way to tell a dark wing from a dark ground, which is the entire defect.
 *
 * Every class prints its pixel count, so a class that collapsed to nothing is visible rather than
 * silently producing a confident ratio.
 *
 *   node scripts/brand-lockup-probe.mjs                 # the theme the app is in
 *   node scripts/brand-lockup-probe.mjs --theme=light   # flips appearance, and puts it back
 *   node scripts/brand-lockup-probe.mjs --crop=out.png  # also writes the stage crop
 */
import { openProbe, format } from './probe.mjs';
import { writeFileSync } from 'node:fs';
import { argv } from 'node:process';

const arg = (n, d = null) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const wantTheme = arg('theme');
const cropPath = arg('crop');

const probe = await openProbe({ port: 9222 });
let restoreAppearance = null;
let failures = 0;

const check = (label, ok, detail) => {
  if (ok === null) console.log(`  NO READING ${label}${detail ? ` — ${detail}` : ''}`);
  else console.log(`  ${ok ? 'PASS' : 'FAIL'}       ${label}${detail ? ` — ${detail}` : ''}`);
  if (ok === false) failures += 1;
};

/* ---- Theme ------------------------------------------------------------------------------------ */

if (wantTheme) {
  restoreAppearance = JSON.parse(
    await probe.rawEvaluate(`(async () => {
      const before = await window.connect.appearanceGet();
      await window.connect.appearanceSet(${JSON.stringify(wantTheme)});
      return JSON.stringify(before.data.appearance);
    })()`),
  );
  await new Promise((r) => setTimeout(r, 400));
}

const theme = JSON.parse(
  await probe.rawEvaluate(`JSON.stringify(document.documentElement.getAttribute('data-theme'))`),
);
console.log(`\nbrand-lockup-probe — theme: ${theme}\n`);

/* ---- 1 · Geometry, from the resolved cascade --------------------------------------------------- */

const geometry = await probe.read({
  question: 'the mark and the stage, as the browser resolves them',
  control: () => document.querySelectorAll('.brand-stage, .brand-mark, .brand-halo').length,
  read: () => {
    const stage = __probe.one('.brand-stage');
    const mark = __probe.one('.brand-mark');
    const cs = getComputedStyle(mark);
    const sr = stage.getBoundingClientRect();
    const mr = mark.getBoundingClientRect();
    return {
      stageW: +sr.width.toFixed(1),
      markW: +mr.width.toFixed(1),
      cssWidth: cs.width,
      objectPosition: cs.objectPosition,
      naturalWidth: mark.naturalWidth,
      leftGap: +(mr.left - sr.left).toFixed(1),
      rightGap: +(sr.right - mr.right).toFixed(1),
      dpr: window.devicePixelRatio,
      rect: { x: sr.left, y: sr.top, w: sr.width, h: sr.height },
      markRect: { x: mr.left, y: mr.top, w: mr.width, h: mr.height },
    };
  },
});
console.log('geometry');
console.log(`  ${format(geometry)}`);
const g = geometry.value;
check(
  'the mark is drawn at the artwork width, not at its 65px slot',
  g.markW === g.naturalWidth,
  `${g.markW}px drawn, artwork is ${g.naturalWidth}px, cssWidth=${g.cssWidth}`,
);
check(
  'the artwork is centred in the stage — equal ground either side',
  Math.abs(g.leftGap - g.rightGap) < 0.51,
  `left ${g.leftGap}px, right ${g.rightGap}px  [control: an asymmetry is what the 65px rule produced — 2 and 10]`,
);

/* ---- 2 · The halo is clipped to the stage ------------------------------------------------------ */

const clip = await probe.read({
  question: 'is the halo inside the stage, and does the stage clip it',
  control: () => document.querySelectorAll('.brand-halo').length,
  read: () => {
    const stage = __probe.one('.brand-stage');
    const halo = stage.querySelector('.brand-halo');
    const hs = getComputedStyle(halo);
    const ss = getComputedStyle(stage);
    const hr = halo.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    return {
      haloIsChildOfStage: halo.parentElement === stage,
      stageOverflow: ss.overflow,
      stageIsolation: ss.isolation,
      // The halo box is deliberately larger than the stage — inset: -45% — so the blur's soft edge
      // is cropped rather than fading inside. That it overflows is the design; that the stage
      // clips it is what keeps it off the sidebar.
      haloOverflowsBy: {
        left: +(sr.left - hr.left).toFixed(1),
        right: +(hr.right - sr.right).toFixed(1),
      },
      haloOpacity: hs.opacity,
      haloBlur: hs.filter,
    };
  },
});
console.log('\nhalo');
console.log(`  ${format(clip)}`);
check(
  'the halo is a child of the stage and the stage clips',
  clip.value.haloIsChildOfStage && clip.value.stageOverflow === 'hidden',
  `child=${clip.value.haloIsChildOfStage}, overflow=${clip.value.stageOverflow}, isolation=${clip.value.stageIsolation}`,
);
check(
  'and it does overflow, so the clip is load-bearing rather than incidental',
  clip.value.haloOverflowsBy.left > 0 && clip.value.haloOverflowsBy.right > 0,
  `${clip.value.haloOverflowsBy.left}px left and ${clip.value.haloOverflowsBy.right}px right of the stage would be painted without it`,
);

/* ---- 3 · The stage is not a control ------------------------------------------------------------ */

const affordance = await probe.read({
  question: 'does the brand stage present itself as something to click',
  control: () => document.querySelectorAll('.brand-stage, .brand-name, .sidebar .nav-row').length,
  read: () => {
    const stage = __probe.one('.brand-stage');
    const name = __probe.one('.brand-name');
    const cs = getComputedStyle(stage);
    // A real control in the same sidebar, so "no pointer cursor" is a reading rather than a
    // statement that nothing in this app has one.
    const navRow = document.querySelector('.sidebar .nav-row');
    return {
      tag: stage.tagName,
      role: stage.getAttribute('role'),
      tabIndex: stage.tabIndex,
      cursor: cs.cursor,
      navRowCursor: navRow ? getComputedStyle(navRow).cursor : null,
      focusable: stage.matches('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      wordmarkAnimation: getComputedStyle(name).animationName,
      wordmarkTransition: getComputedStyle(name).transitionProperty,
      wordmarkTransform: getComputedStyle(name).transform,
    };
  },
});
console.log('\naffordance');
console.log(`  ${format(affordance)}`);
const a = affordance.value;
check(
  'the stage is not a control — not focusable, no role, no pointer cursor',
  a.tag === 'SPAN' && a.role === null && !a.focusable && a.cursor !== 'pointer',
  `<${a.tag.toLowerCase()}> role=${a.role} tabIndex=${a.tabIndex} cursor=${a.cursor}  [control: a real nav row in the same sidebar reads cursor=${a.navRowCursor}]`,
);
check(
  'the wordmark is static — no animation, no transform',
  a.wordmarkAnimation === 'none' && a.wordmarkTransform === 'none',
  `animation=${a.wordmarkAnimation}, transform=${a.wordmarkTransform}, transition-property=${a.wordmarkTransition}`,
);

/* ---- 4 · The breath, and what reduced motion does to it ---------------------------------------- */

/*
 * `getAnimations()` returns CSSAnimation **and** CSSTransition, and the two must be counted apart
 * here or the reading is about the instrument.
 *
 * Measured: at rest the page runs 1 animation (`brand-breathe`, 6000ms) and 0 transitions. Under
 * the emulation it runs 0 animations and **191 transitions, every one of them 0.01ms** — those are
 * `tokens.css`'s own reduced-motion kill, created by the act of applying the media change, since
 * every computed value that moves gets a near-zero transition on the way. Counting them together
 * reads as "191 ambient animations survived reduced motion", which is the exact opposite of what
 * happened. Clearing the emulation returns the page to 1 and 0, which is the control.
 *
 * So: ambient motion is a **keyframe animation**, and that is what this counts.
 */
const READ_BREATH = `JSON.stringify((() => {
  const halo = document.querySelector('.brand-halo');
  const cs = getComputedStyle(halo);
  const running = document.getAnimations().filter((x) => x.playState === 'running');
  const animations = running.filter((x) => x.constructor.name === 'CSSAnimation');
  const transitions = running.filter((x) => x.constructor.name === 'CSSTransition');
  const longestTransitionMs = Math.max(0, ...transitions.map((x) => Number(x.effect.getTiming().duration) || 0));
  return {
    animationName: cs.animationName,
    animationDuration: cs.animationDuration,
    opacity: cs.opacity,
    haloAnimations: halo.getAnimations().length,
    keyframeAnimationsRunning: animations.length,
    keyframeNames: animations.map((x) => x.animationName),
    transitionsRunning: transitions.length,
    longestTransitionMs,
  };
})())`;

const atRest = JSON.parse(await probe.rawEvaluate(READ_BREATH));
const underReduce = JSON.parse(
  await probe.rawEmulateMedia({
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    read: READ_BREATH,
  }),
);
console.log('\nbreath');
console.log(`  at rest       ${JSON.stringify(atRest)}`);
console.log(`  under reduce  ${JSON.stringify(underReduce)}`);

/*
 * THE CONTROL. An emulation that silently did nothing and a halo that correctly stops breathing are
 * the same reading — no animation — and only the disagreement separates them.
 */
const emulationWorked = atRest.haloAnimations > underReduce.haloAnimations;
if (!emulationWorked) {
  check(
    'the breath is gated on prefers-reduced-motion',
    null,
    `the emulation changed nothing (halo animations ${atRest.haloAnimations} -> ${underReduce.haloAnimations}). ` +
      'Either setEmulatedMedia did not apply or there was no breath to remove — this run cannot tell which',
  );
} else {
  check(
    'the breath runs only under prefers-reduced-motion: no-preference',
    atRest.animationName === 'brand-breathe' && underReduce.animationName === 'none',
    `${atRest.animationName} (${atRest.animationDuration}) -> ${underReduce.animationName}` +
      `  [control: halo animations ${atRest.haloAnimations} -> ${underReduce.haloAnimations}]`,
  );
  check(
    'under reduce the halo is static at its designed rest value, not frozen mid-cycle',
    underReduce.animationName === 'none' && underReduce.opacity === '0.5',
    `opacity=${underReduce.opacity} with no animation attached — a declaration that never runs ` +
      'cannot be frozen, which is why this is a no-preference gate rather than a reduce override',
  );
  check(
    'and no ambient animation survives anywhere in the page',
    underReduce.keyframeAnimationsRunning === 0,
    `keyframe animations ${atRest.keyframeAnimationsRunning} (${atRest.keyframeNames.join(', ') || 'none'}) -> ` +
      `${underReduce.keyframeAnimationsRunning} (${underReduce.keyframeNames.join(', ') || 'none'}). ` +
      `The ${underReduce.transitionsRunning} transitions alongside are the global kill's own, ` +
      `longest ${underReduce.longestTransitionMs}ms — they are created BY applying the emulation and ` +
      'are not surviving motion; counting them with the animations reverses this reading',
  );
}

/* ---- 5 · Pixels ------------------------------------------------------------------------------- */

/*
 * A **plain viewport capture**, cropped afterwards by `brand-pixels.py`, and both halves of that
 * sentence are load-bearing.
 *
 *  - `Page.captureScreenshot` with a `clip` sets `captureBeyondViewport`, which **re-lays-out the
 *    page**. Any rect read before it is then a rect of a different layout, and the capture is
 *    silently of something else.
 *  - `clip.scale` multiplies on top of the device pixel ratio rather than replacing it. A clip at
 *    `scale: dpr` on a dpr-2 display returns a **4x** image. The first run of this probe did that
 *    and indexed into it with a 2x asset, so every class sampled the wrong pixels — and it was the
 *    *eyes* control that said so, coming back at 1.28:1 where the eyes are self-evidently bright.
 *    Wings and eyes agreeing to two decimal places is not a finding about the lockup, it is an
 *    alignment that is wrong for both.
 *
 * So the capture is the viewport as it stands, at dpr, and the geometry is CSS px × dpr.
 */
const dpr = g.dpr;
/*
 * And the breath is a **second clock**, which the first version of this did not name.
 *
 * The halo's opacity runs 0.5 -> 0.72 -> 0.5 over 6 seconds, so the ground the wings sit on is a
 * moving number and any single capture reports whatever phase the shutter caught. That is not a
 * property of the lockup, it is the time the screenshot was taken.
 *
 * So the animation is pinned to each keyframe extreme and captured at both, and the reading is a
 * **band** rather than a point. The pin is released afterwards — a live app left with a paused
 * animation is a condition nobody chose.
 */
const pin = async (ms) => {
  await probe.rawEvaluate(`(() => {
    const a = document.querySelector('.brand-halo').getAnimations()[0];
    if (!a) return 'none';
    a.pause();
    a.currentTime = ${ms};
    return String(a.currentTime);
  })()`);
  // One frame, so the paused value is what the compositor has.
  await new Promise((r) => setTimeout(r, 120));
};
const release = () =>
  probe.rawEvaluate(`(() => {
    const a = document.querySelector('.brand-halo').getAnimations()[0];
    if (a) a.play();
    return a ? a.playState : 'none';
  })()`);

const shots = {};
for (const [name, ms] of [['rest', 0], ['peak', 3000]]) {
  await pin(ms);
  const opacity = JSON.parse(
    await probe.rawEvaluate(`JSON.stringify(getComputedStyle(document.querySelector('.brand-halo')).opacity)`),
  );
  const data = await probe.rawCapture();
  const file = `/tmp/brand-viewport-${theme}-${name}.png`;
  writeFileSync(file, Buffer.from(data, 'base64'));
  shots[name] = { file, opacity };
}
console.log(`  breath released: ${await release()}`);

const shotFile = cropPath ?? shots.rest.file;

const sidebarRect = JSON.parse(
  await probe.rawEvaluate(`JSON.stringify((() => {
    const stage = document.querySelector('.brand-stage');
    const bar = stage.closest('[class*="sidebar"]') || document.querySelector('.sidebar');
    const br = bar.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    // Two bands. NEAR is on the stage's own row, eight pixels from its edge, where a halo leak
    // would land. FAR is the same sidebar well below the lockup, where nothing brand-related can
    // reach. (Named in capitals rather than in backticks: this comment lives inside a template
    // literal, and a backtick here ends the string four lines before the code does.) "The sidebar is not tinted" is a claim about the DIFFERENCE between them, not about
    // either one's absolute neutrality: the light sidebar is a faintly cool grey by design, so an
    // absolute threshold reports the design token as a halo leak. It did, on the first run.
    //
    // Both are in the sidebar's LEFT GUTTER, which is 14px of padding every row shares and which
    // no text or control ever enters. The first version put the near band to the right of the
    // stage and caught the wordmark: rgb(33,33,34) against the far band's rgb(14,14,14), read as a
    // 20-point leak, all three channels moving together. Light text is not a tint, and a band whose
    // contents you have not named is the haystack fault with the sidebar's own chrome in it.
    const near = { x: 3, y: Math.round(sr.top), w: 10, h: Math.round(sr.height) };
    const far = { x: 3, y: Math.round(br.bottom - 140), w: 10, h: 36 };
    return { near, far };
  })())`),
);

const rects =
  `--dpr=${dpr}` +
  ` --stage=${[g.rect.x, g.rect.y, g.rect.w, g.rect.h].map((v) => Math.round(v)).join(',')}` +
  ` --mark=${[g.markRect.x, g.markRect.y, g.markRect.w, g.markRect.h].map((v) => Math.round(v)).join(',')}` +
  ` --sidebar=${[sidebarRect.near.x, sidebarRect.near.y, sidebarRect.near.w, sidebarRect.near.h].join(',')}` +
  ` --sidebar-far=${[sidebarRect.far.x, sidebarRect.far.y, sidebarRect.far.w, sidebarRect.far.h].join(',')}`;

console.log(`  dpr ${dpr}, plain viewport capture, no clip and no captureBeyondViewport`);
for (const [name, shot] of Object.entries(shots)) {
  console.log(`  ${name.padEnd(5)} halo opacity ${shot.opacity}  ${shot.file}`);
}
console.log('  hand these to the classifier:');
for (const [name, shot] of Object.entries(shots)) {
  console.log(`    python3 scripts/brand-pixels.py --shot=${shot.file} ${rects} --label=${theme}/${name}`);
}
void shotFile;

if (restoreAppearance) {
  await probe.rawEvaluate(`window.connect.appearanceSet(${JSON.stringify(restoreAppearance)})`);
  console.log(`\n  appearance put back to "${restoreAppearance}"`);
}

console.log(`\n${'-'.repeat(78)}`);
console.log(`brand-lockup-probe: ${failures === 0 ? 'ALL READINGS OK' : `${failures} FAILED`} (theme: ${theme})`);
console.log('  The pixel classes are computed by scripts/brand-pixels.py against these crops —');
console.log('  the asset\'s alpha channel is the classifier, never a brightness threshold.');
await probe.close();
process.exit(failures > 0 ? 1 : 0);
