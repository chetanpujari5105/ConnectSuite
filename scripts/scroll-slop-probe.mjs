/**
 * Does one wheel notch reach the phone as a scroll, or as a tap?
 *
 * ### The question, and why it needs hardware
 *
 * `input.scroll` is dispatched by the phone as a **two-point stroke** over 100 ms
 * (`InputFeature.DEFAULT_SCROLL_MS`). Android's `View` layer only begins treating a stroke as a
 * scroll once it has travelled `ViewConfiguration.getScaledTouchSlop()`; below that it is a press
 * and a release in one place, which is a **tap**. So a scroll whose travel is under the slop does
 * not scroll — it clicks whatever is under the pointer, which on a YouTube feed is a video.
 *
 * The arithmetic is checkable without a phone and is in `sub-slop-travel.test.mjs`. What needs the
 * handset is the claim that Android actually *acts* on it: the discriminator is the resumed
 * activity, because a tap on a Settings row opens `SubSettings` and a scroll cannot.
 *
 * ### What this instrument supplies, said out loud
 *
 * **`deltaY` comes from this script, not from a physical wheel.** A synthetic `WheelEvent` reaches
 * `MirrorView.onWheel` by the same `addEventListener('wheel')` every real one does, and everything
 * downstream — the 60 ms coalescing window, `WHEEL_SCALE`, `input.scroll`, the phone's stroke — is
 * the shipping path. The OS→Chromium conversion is the one step not exercised, which is why the
 * magnitudes swept here are **taken from the Mac's own log of real wheel use** rather than invented:
 * `-3, -5, -10, -17, -20, -22` capture px all appear there, unprompted, from this user's own mouse
 * and trackpad.
 *
 * The effect is read at the boundary the stimulus crosses — the `input.scroll` line in the Mac's log
 * (the `dy` that actually went) and the phone's resumed activity (what Android did with it) — never
 * from the request. A probe reporting its own intention is how 12 MB that never left the machine was
 * once recorded as delivered.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { openProbe, format, formatAct } from './probe.mjs';

const MAC_LOG = join(homedir(), 'Library', 'Application Support', 'connectsuite-desktop', 'logs', 'connectsuite.log');
const DEVICE = process.argv[2] ?? 'samsung';

const adb = (...args) =>
  execFileSync('bash', ['-c', `scripts/adb-pinned.sh ${DEVICE} ${args.join(' ')}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

/** The phone's own idea of the smallest travel that is not a tap. Asked, never assumed. */
function touchSlopPx() {
  const density = Number(adb('shell', 'wm', 'density').match(/(\d+)/)?.[1] ?? 0);
  if (!density) throw new Error('could not read the phone density — no reading is possible');
  return { density, slop: Math.round((8 * density) / 160) };
}

function resumedActivity() {
  const out = adb('shell', 'dumpsys', 'activity', 'activities');
  const m = out.match(/topResumedActivity=ActivityRecord\{\S+ \S+ (\S+)/);
  if (!m) throw new Error('no topResumedActivity in the dump — the query, not the phone, is the suspect');
  return m[1];
}

/** Every `input.scroll` the Mac has logged, newest last. The boundary the stimulus crosses. */
function scrollLines() {
  return readFileSync(MAC_LOG, 'utf8')
    .split('\n')
    .filter((l) => l.includes('input.scroll'));
}


/**
 * The phone's own line for the last scroll it dispatched.
 *
 * Read through `run-as`, which is the same store the app writes to — not a second copy and not a
 * shell tool asking a different question. Returns null when there is none, which is a real answer:
 * it means the build on the phone does not write this line, which is the build without the fix.
 */
function phoneScrollLine() {
  const out = adb('shell', 'run-as', 'com.chetan.connectsuite.debug', 'tail', '-40', 'files/logs/link.log');
  const hits = out.split('\n').filter((l) => /\[input\] Scroll \d+px \+ \d+px slop headroom|Scroll headroom short by/.test(l));
  return hits.length ? hits[hits.length - 1] : null;
}

const probe = await openProbe({ port: 9222, window: 'index' });
const { density, slop } = touchSlopPx();

console.log(`phone: density ${density}dpi → touch slop 8dp = ${slop} display px`);
console.log(`control on the slop read: a density of 0 would have thrown above, so ${slop} came from the handset\n`);

const geom = await probe.read({
  question: 'live capture geometry and canvas box (the scale a dy is multiplied by)',
  read: `(() => {
     const c = __probe.one('#mirror-canvas');
     const m = (document.getElementById('mirror-actual').textContent || '');
     return JSON.stringify({ actual: m.trim(), rect: { w: Math.round(c.getBoundingClientRect().width), h: Math.round(c.getBoundingClientRect().height) } });
   })()`,
  control: `__probe.count('#mirror-canvas')`,
});
console.log('  ' + format(geom));

const DISPLAY = { w: 1440, h: 3120 };
const CAPTURE = { w: 1080, h: 2340 };
const scale = DISPLAY.h / CAPTURE.h;
console.log(`  capture ${CAPTURE.w}x${CAPTURE.h} → display ${DISPLAY.w}x${DISPLAY.h}: one capture px is ${scale.toFixed(4)} display px\n`);

/*
 * ---- The control, and the run refuses without it -------------------------------------------------
 *
 * The sweep's whole finding is **an absence** — "none of these navigated". An absence is worth
 * nothing until the query has been shown to return a known positive, and this query has a specific
 * way of being silently broken: if `topResumedActivity` does not move when Android really does
 * navigate, every row reads `scroll` on any build, fixed or not.
 *
 * So a real tap is dispatched first, **through the product's own path** — a pointer press and
 * release on the mirror canvas, which is `input.tap` — and the resumed activity must change. It is a
 * refusal rather than a warning: a sweep whose discriminator cannot fire is not a weak reading, it
 * is no reading, and this repo has a table of clean confident numbers that were exactly that.
 *
 * Settings is the surface for the same reason it is the surface for the sweep: a tap on a row opens
 * `SubSettings` and BACK undoes it, where the same tap on a home screen launches somebody's app.
 */
const controlBefore = resumedActivity();
const controlTap = await probe.act({
  what: 'CONTROL — one real tap on the canvas, to prove a navigation is visible at all',
  run: `(() => {
     const c = __probe.one('#mirror-canvas');
     const r = c.getBoundingClientRect();
     const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height * 0.35, bubbles: true, pointerId: 1, button: 0, isPrimary: true };
     c.dispatchEvent(new PointerEvent('pointerdown', at));
     globalThis.__ctlTap = true;
     setTimeout(() => c.dispatchEvent(new PointerEvent('pointerup', at)), 120);
     return true;
   })()`,
  expect: `globalThis.__ctlTap === true`,
  within: 3000,
});
console.log('  ' + formatAct(controlTap));
await new Promise((r) => setTimeout(r, 2500));
const controlAfter = resumedActivity();
const controlFired = controlAfter !== controlBefore;
console.log(
  `  control: ${controlBefore.split('/').pop()} → ${controlAfter.split('/').pop()}  ` +
    `— a navigation is ${controlFired ? 'VISIBLE to this query' : 'NOT visible; the sweep below would read "scroll" on any build'}`,
);
if (!controlFired) {
  console.log('\nREFUSED: the discriminator never fired, so an absence from it is not a finding.');
  probe.close();
  process.exit(1);
}
// Put the phone back on the list the sweep expects.
adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
await new Promise((r) => setTimeout(r, 1200));
console.log(`  returned to ${resumedActivity().split('/').pop()}\n`);

/** Every magnitude below was seen in the Mac's real log; none is invented for this run. */
const SWEEP = [3, 10, 17, 22, 40, 120];
const rows = [];

for (const deltaY of SWEEP) {
  const before = scrollLines().length;
  const wasOn = resumedActivity();

  const act = await probe.act({
    what: `one wheel event, deltaY=${deltaY}, on the canvas centre`,
    run: `(() => {
       const c = __probe.one('#mirror-canvas');
       const r = c.getBoundingClientRect();
       const ev = new WheelEvent('wheel', {
         deltaY: ${deltaY}, deltaX: 0, deltaMode: 0, bubbles: true, cancelable: true,
         clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
       });
       // dispatchEvent returns false when the handler called preventDefault, which onWheel does on
       // its first line. So this records that the handler RAN — not that anything was sent.
       globalThis.__wheelReached = !c.dispatchEvent(ev);
       return globalThis.__wheelReached;
     })()`,
    expect: `globalThis.__wheelReached === true`,
    within: 2000,
  });
  console.log('  ' + formatAct(act));
  if (!act.landed) {
    rows.push({ deltaY, sent: null, travel: null, verdict: 'NO READING — the handler never ran' });
    continue;
  }

  // The coalescing window is 60ms; wait for the line rather than for a duration.
  let sent = null;
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    const lines = scrollLines();
    if (lines.length > before) {
      sent = lines[lines.length - 1];
      break;
    }
  }
  const nowOn = resumedActivity();

  if (!sent) {
    rows.push({ deltaY, sent: null, travel: null, from: wasOn, to: nowOn, verdict: 'NOT SENT — no input.scroll line appeared' });
    console.log(`     → no input.scroll reached the log within 4s. That is a missing reading, not a negative one.`);
    continue;
  }
  const dy = Number(sent.match(/by (-?\d+),(-?\d+)/)?.[2] ?? NaN);
  const requested = Math.abs(dy) * scale;

  /*
   * The phone's own line for this scroll — the **execution** line, not a registration line.
   *
   * `Scroll Npx + Mpx slop headroom = Tpx of travel (slop Spx); W whole / S short since start` is
   * written inside the branch that computes the headroom, so it can only exist if that code ran. A
   * line saying the feature is installed would say exactly the same thing on a build where it never
   * executes, which is what disqualified `Mirror session started` as a control in Slice 38.
   */
  const phone = phoneScrollLine();
  const dispatched = phone ? Number(phone.match(/= (\d+)px of travel/)?.[1] ?? NaN) : NaN;

  // The discriminator is what ANDROID did, never what the numbers imply. A tap on a Settings row
  // opens SubSettings; a scroll cannot.
  const navigated = nowOn !== wasOn;
  const verdict = navigated
    ? `TAP — Android navigated: ${wasOn.split('/').pop()} → ${nowOn.split('/').pop()}`
    : 'scroll — no navigation';
  rows.push({
    deltaY, dy, requested: +requested.toFixed(1),
    dispatched: Number.isFinite(dispatched) ? dispatched : null,
    subSlopRequest: requested < slop, navigated, verdict, phone,
  });
  console.log(
    `     → dy=${dy} capture px; requested ${requested.toFixed(1)} display px` +
      `${requested < slop ? ' (UNDER the ' + slop + 'px slop)' : ''}` +
      `, dispatched ${Number.isFinite(dispatched) ? dispatched + 'px' : 'NOT READ'}  ${verdict}`,
  );
  if (phone) console.log(`        phone: ${phone.replace(/^\S+ I \[input\] /, '')}`);

  // Put the phone back if a tap navigated, so the next trial starts from the same list.
  if (nowOn !== wasOn) {
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
    await new Promise((r) => setTimeout(r, 900));
  }
}

console.log('\n--- table ---');
console.log('deltaY  dy(cap)  requested  dispatched  slop  under-slop request?  what Android did');
for (const r of rows) {
  console.log(
    `${String(r.deltaY).padStart(6)}  ${String(r.dy ?? '—').padStart(7)}  ` +
      `${String(r.requested ?? '—').padStart(9)}  ${String(r.dispatched ?? 'NOT READ').padStart(10)}  ` +
      `${String(slop).padStart(4)}  ${String(r.subSlopRequest ?? '—').padStart(19)}  ${r.verdict}`,
  );
}

const subSlop = rows.filter((r) => r.subSlopRequest);
const taps = rows.filter((r) => r.navigated);
const scrolled = rows.filter((r) => r.verdict.startsWith('scroll'));
const readPhone = rows.filter((r) => r.dispatched !== null && r.dispatched !== undefined);

console.log(`\nsub-slop REQUESTS in this sweep:            ${subSlop.length} of ${rows.length}`);
console.log(`of those, Android navigated (i.e. a TAP):   ${subSlop.filter((r) => r.navigated).length} of ${subSlop.length}`);
console.log(`of those, Android scrolled:                 ${subSlop.filter((r) => !r.navigated).length} of ${subSlop.length}   ← the denominator`);
console.log(`whole sweep: ${scrolled.length} scrolled / ${taps.length} navigated, out of ${rows.length}`);
console.log(`the phone's own execution line was read on ${readPhone.length} of ${rows.length} — a run that reads 0 has`);
console.log(`  not measured the fix, it has measured a build that does not write that line.`);
if (readPhone.length) {
  const grew = readPhone.filter((r) => r.dispatched > r.requested + 1);
  console.log(`dispatched travel exceeded the request on ${grew.length} of ${readPhone.length} — that IS the headroom.`);
}

probe.close();
