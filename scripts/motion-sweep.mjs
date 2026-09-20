#!/usr/bin/env node
/*
 * Every motion claim in `docs/sidekick-motion-system.md` that needs the app running, taken over
 * every route, through `probe.mjs`.
 *
 * ## Why this exists rather than a bigger commit hook
 *
 * `check-motion-tokens.mjs` reads the stylesheets and can prove the *vocabulary* has one home. It
 * cannot prove anything about what the browser does with it, and the defect that started this pass
 * is invisible in CSS by construction:
 *
 *   styles.css   button, .button { transition: …, transform var(--dur-release) var(--ease); }
 *   styles.css   button:active:not(:disabled) { transform: scale(var(--press-scale)); }
 *   styles.css   .sms-thread { transition: background …, border-color …; }   <- drops the transform
 *
 * Three rules, two thousand lines apart, one mechanism. The shorthand in the third replaces the
 * whole list from the first, so the press in the second still *happens* and no longer *eases* —
 * and there is no file you can read that says so. **The cascade is the thing under test, and the
 * only instrument that resolves the cascade is the browser.**
 *
 * The press now rides the independent `scale` property rather than `transform`, which is why this
 * sweep reads `scale`. That split was forced by a second finding this instrument produced and the
 * CSS scan could not: `.photos-tile` animates `transform` for a 2px hover lift and `.recent-row`
 * animates it for the FLIP that keeps rows from teleporting, so on those two the press was
 * inheriting a hover's 200ms and an arrival's 220ms. One property, two purposes, and only one of
 * them can have the right duration. `scale` and `transform` compose, so each purpose now has its
 * own channel and its own timing.
 *
 * That is also why the first version of this audit produced a confident wrong answer: it scanned
 * CSS for "declares a transform transition but never sets a transform" and named nine controls
 * that were perfectly fine, because the transform arrives from a bare `button:active` selector a
 * scan keyed on class names never joins up. `docs/sidekick-motion-system.md` §6.2 has the full
 * account; the rule it leaves behind is that a finding of the form *"X declares half a mechanism"*
 * is not a finding until you have asked what else supplies the other half.
 *
 * ## What it reports, and the controls
 *
 *   press            every enabled button eases its press, at --dur-release
 *   press-down       forcing :active shortens the transition to --dur-press
 *   disabled         a disabled button is not given the press transform
 *   reduced-motion   under `prefers-reduced-motion: reduce`, no transform and no animation survives
 *   reduced-transp   under `prefers-reduced-transparency: reduce`, no backdrop-filter survives
 *   tokens           every motion duration on screen is one of the approved values
 *
 * Each carries a control that must come back **non-trivially true**, because every one of these
 * reads can return a clean zero for the boring reason: a route that did not take, a pane still
 * redrawing, an emulation that did not apply. A zero with no control is not a reading. The two
 * accessibility checks carry the sharpest control of the set — **the same read with the emulation
 * off must disagree** — because a `setEmulatedMedia` that silently failed and a stylesheet that
 * correctly removed all motion are the same picture.
 *
 * ## Its own bounds, stated because an instrument that hides them reports them as findings
 *
 *  - It measures the DOM **as it stands**. Rows that only exist with a phone linked — notification
 *    rows, activity chips, photo albums — are absent from a disconnected run, and the summary says
 *    how many buttons it saw so a thin run is visible as a thin run rather than as a pass.
 *  - A route that never settles is **refused**, not measured.
 *  - `prefers-reduced-motion` is emulated per-read and cleared afterwards. A run that dies between
 *    the two leaves the app drawn in a condition nobody chose; re-run, or restart the app.
 *
 * Run with the app up:
 *   node scripts/motion-sweep.mjs
 *   node scripts/motion-sweep.mjs --only=press
 */
import { openProbe, format } from './probe.mjs';
import { argv } from 'node:process';

const only = (argv.find((a) => a.startsWith('--only=')) ?? '').split('=')[1] ?? null;
const wanted = (name) => !only || only === name;

const probe = await openProbe({ port: 9222 });
let failures = 0;
const lines = [];

/**
 * A class is a finding; each of its four hundred nodes is not. Without this the report reads
 * `photos-album, photos-album, photos-album, ...` eight times and names one of the two offenders.
 */
const tally = (names) => {
  const counts = new Map();
  for (const n of names) counts.set(n.split(':').pop(), (counts.get(n.split(':').pop()) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} (${c})`).join(', ');
};

const check = (label, ok, detail) => {
  const tag = ok === null ? 'NO READING' : ok ? 'PASS' : 'FAIL';
  console.log(`  ${tag.padEnd(10)} ${label}${detail ? ` — ${detail}` : ''}`);
  lines.push({ label, ok, detail });
  if (ok === false) failures += 1;
  if (ok === null) failures += 1;
};

/** The approved motion durations, in seconds as getComputedStyle reports them. */
const APPROVED = new Map([
  ['0s', 'none'],
  ['0.1s', '--dur-press'],
  ['0.14s', '--dur-route-fade'],
  ['0.16s', '--dur-release / --dur-toggle'],
  ['0.18s', '--dur-state'],
  ['0.2s', '--dur-hover / --dur-pill'],
  ['0.22s', '--dur-float / --dur-arrive'],
  ['0.26s', '--dur-route'],
  ['0.6s', '--dur-ring'],
  ['0.9s', '--dur-spin-fast'],
  ['1.2s', '--dur-spin'],
  ['1.4s', '--dur-flash'],
  // The two reduced-motion kill values, which are "off" rather than a duration anyone chose.
  ['0.00001s', 'reduced-motion kill'],
  ['1e-06s', 'reduced-motion kill (float)'],
]);

/* ---- Routing, with the settle predicate the shell sweep already proved it needs --------------- */

/*
 * **Whether the window is visible changes what is true, so it is read and reported.**
 *
 * An occluded window stops `requestAnimationFrame`, and `overview.ts` clears the recent-activity
 * FLIP's inline `transition: none` inside `afterNextPaint`. Run against a hidden window this sweep
 * read four `.recent-row` nodes with no transition at all and reported `snapping: recent-row (48)`
 * — a press defect that does not exist. Measured 2026-09-21: `rafFired: 0` after 1.88s,
 * `visibilityState: "hidden"`, four rows carrying `style.transition === "none"`.
 *
 * **The product is fine and this is not a defect report about it.** rAF runs before the first paint
 * anyone sees, so that state is cleared before a user can observe it. The instrument was wrong.
 *
 * Refusing outright was the first fix and it was the wrong one: `Page.bringToFront` does not raise
 * an Electron window that another application is covering, and on this machine System Events
 * reports `windows=0` for the process while CDP screenshots it happily. An instrument that only
 * runs when somebody is looking at the app is the rAF mistake wearing a different hat. So the
 * sweep reads in both conditions and **excludes elements carrying an inline `transition`**, which
 * is the signature of rAF-pending cleanup, counting and naming them rather than scoring them.
 *
 * This is the hidden-section rule one scale up: a hidden element cannot report its geometry, and a
 * hidden window cannot report anything whose value is settled in a frame callback.
 */
const visibility = JSON.parse(await probe.rawBringToFront());
const windowVisible = visibility.visibility === 'visible';
console.log(
  `window: ${visibility.visibility}` +
    (windowVisible
      ? ' — rAF-settled values are readable'
      : ' — requestAnimationFrame is STALLED. Elements with an inline `transition` are mid-FLIP ' +
        'and are excluded below rather than scored'),
);

const routes = await probe.rawEvaluate(`SCREENS.map((s) => s.id)`);
if (!Array.isArray(routes) || routes.length === 0) {
  console.log('motion-sweep: REFUSED — SCREENS is empty, so there is nothing to sweep and a');
  console.log('  "0 of 0" pass would certify an app nobody looked at.');
  process.exit(1);
}

async function settleRoute() {
  const count = () => probe.rawEvaluate(`document.querySelectorAll('button').length`);
  const deadline = Date.now() + 8000;
  let previous = -1;
  for (;;) {
    await new Promise((r) => setTimeout(r, 200));
    const now = await count();
    if (now === previous) return { settled: true, controls: now };
    previous = now;
    if (Date.now() >= deadline) return { settled: false, controls: now };
  }
}

async function goTo(id) {
  await probe.rawEvaluate(`shell.route(${JSON.stringify(id)})`);
  const settle = await settleRoute();
  if (!settle.settled) return { ok: false, why: `still redrawing after 8s (${settle.controls} controls and moving)` };
  const drawn = await probe.rawEvaluate(
    `(() => { const s=[...document.querySelectorAll('section.screen')].find(x => !x.hidden); return s ? s.dataset.screen : null; })()`,
  );
  if (drawn !== id) return { ok: false, why: `route did not take (drawn: ${drawn}) — a blocked route is a no-op` };
  return { ok: true };
}

/* ---- The page-side reads ---------------------------------------------------------------------- */

/** Every button's press wiring, as the cascade actually resolves it. */
const READ_PRESS = `(function(){
  var out = { total: 0, disabled: 0, eased: 0, snapped: [], wrongDur: [], midFlip: [] };
  var btns = document.querySelectorAll('button');
  for (var i = 0; i < btns.length; i++) {
    var b = btns[i];
    /*
     * An inline transition is the FLIP in overview.ts mid-flight: it writes transition:none on
     * the element and clears it in a frame callback. While the window is occluded that callback
     * never runs, so the node reports no transition and reads exactly like a missing press rule.
     * Counted and named, never scored — the stylesheet's rule is not what is being overridden here.
     */
    if (b.style && b.style.transition) {
      out.midFlip.push(String(b.className || '').split(' ')[0] || 'button');
      out.total++;
      continue;
    }
    var cs = getComputedStyle(b);
    var props = String(cs.transitionProperty || '').split(',').map(function(s){ return s.trim(); });
    var durs  = String(cs.transitionDuration || '').split(',').map(function(s){ return s.trim(); });
    var name = String(b.className || '').split(' ')[0] || (b.id ? '#' + b.id : 'button');
    out.total++;
    if (b.disabled) { out.disabled++; continue; }
    var idx = props.indexOf('scale');
    if (idx < 0 && props.indexOf('all') < 0) { out.snapped.push(name); continue; }
    out.eased++;
    var d = durs[idx] || durs[0];
    if (d !== '0.16s') out.wrongDur.push(name + '=' + d);
  }
  return JSON.stringify(out);
})()`;

/** Anything still moving. Used with and without the reduced-motion emulation. */
const READ_MOTION = `(function(){
  var moving = [], spinning = [];
  var all = document.querySelectorAll('*');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var cs = getComputedStyle(el);
    var props = String(cs.transitionProperty || '').split(',').map(function(s){ return s.trim(); });
    var durs  = String(cs.transitionDuration || '').split(',').map(function(s){ return s.trim(); });
    var name = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '');
    for (var k = 0; k < props.length; k++) {
      if (props[k] !== 'transform') continue;
      var d = durs[k] || durs[0] || '0s';
      if (parseFloat(d) > 0.001) { moving.push(name + ' ' + d); }
    }
    var an = String(cs.animationName || 'none');
    if (an !== 'none' && an !== '') {
      var ad = parseFloat(cs.animationDuration || '0');
      if (ad > 0.001) spinning.push(name + ' ' + an + ' ' + cs.animationDuration);
    }
  }
  return JSON.stringify({ moving: moving.slice(0, 12), movingCount: moving.length,
                          spinning: spinning.slice(0, 12), spinningCount: spinning.length });
})()`;

/** Translucency, for the reduced-transparency half. */
const READ_BLUR = `(function(){
  var blurred = [];
  var all = document.querySelectorAll('*');
  for (var i = 0; i < all.length; i++) {
    var cs = getComputedStyle(all[i]);
    var bf = cs.backdropFilter || cs.webkitBackdropFilter || 'none';
    if (bf && bf !== 'none') {
      var el = all[i];
      blurred.push(el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : ''));
    }
  }
  return JSON.stringify({ count: blurred.length, sample: blurred.slice(0, 10) });
})()`;

/** Every transition and animation duration on screen, for the token check. */
const READ_DURATIONS = `(function(){
  var seen = {};
  var all = document.querySelectorAll('*');
  for (var i = 0; i < all.length; i++) {
    var cs = getComputedStyle(all[i]);
    String(cs.transitionDuration || '').split(',').forEach(function(d){ d=d.trim(); if(d) seen[d]=(seen[d]||0)+1; });
    var an = String(cs.animationName || 'none');
    if (an !== 'none' && an !== '') {
      String(cs.animationDuration || '').split(',').forEach(function(d){ d=d.trim(); if(d) seen[d]=(seen[d]||0)+1; });
    }
  }
  return JSON.stringify(seen);
})()`;

/* ---- 1 · Press, over every route -------------------------------------------------------------- */

const press = { total: 0, disabled: 0, eased: 0, snapped: [], wrongDur: [], midFlip: [] };
const refused = [];

if (wanted('press') || wanted('tokens')) {
  console.log('\nroutes');
  for (const id of routes) {
    const landed = await goTo(id);
    if (!landed.ok) {
      console.log(`  NO READING ${id} — ${landed.why}`);
      refused.push(id);
      continue;
    }
    const r = JSON.parse(await probe.rawEvaluate(READ_PRESS));
    press.total += r.total;
    press.disabled += r.disabled;
    press.eased += r.eased;
    press.snapped.push(...r.snapped.map((s) => `${id}:${s}`));
    press.wrongDur.push(...r.wrongDur.map((s) => `${id}:${s}`));
    press.midFlip.push(...(r.midFlip ?? []).map((s) => `${id}:${s}`));
  }
  await probe.rawEvaluate(`shell.route('overview')`);
  console.log(`  ${routes.length - refused.length} of ${routes.length} routes read${refused.length ? `, refused: ${refused.join(', ')}` : ''}`);
}

if (wanted('press')) {
  console.log('\npress');
  // The control: a sweep that saw no buttons must not report "0 snapped" as a pass.
  if (press.total === 0) {
    check('every enabled button eases its press', null, 'no buttons seen at all — the sweep read nothing');
  } else {
    check(
      'every enabled button eases its press',
      press.snapped.length === 0,
      `${press.eased} of ${press.eased + press.snapped.length} enabled buttons` +
        (press.snapped.length ? `; snapping: ${tally(press.snapped)}` : '') +
        `  [control=${press.total} buttons seen across ${routes.length - refused.length} routes]` +
        (press.midFlip.length
          ? `\n             excluded, inline transition mid-FLIP: ${tally(press.midFlip)}` +
            (windowVisible ? '' : ' (expected: the window is occluded, so rAF cleanup has not run)')
          : ''),
    );
    check(
      'the press releases at --dur-release (0.16s), not at --dur-press',
      press.wrongDur.length === 0,
      press.wrongDur.length ? tally(press.wrongDur) : 'all 0.16s',
    );
  }
}

/* ---- 2 · The press going down ----------------------------------------------------------------- */

if (wanted('press-down')) {
  console.log('\npress-down');
  /*
   * `:active` cannot be produced from page script — the same reason `rawForcePseudo` exists for
   * `:focus-visible`. Forcing it and reading the computed duration is the browser answering
   * directly: does pressing actually shorten the transition to --dur-press?
   */
  /*
   * **Force and read are one atomic pair, repeated — and that is the whole instrument.**
   *
   * Copied from `shell-parity-sweep.mjs`, which paid for it first. `CSS.forcePseudoState` applies
   * to *node ids*, and the style recalc it triggers happens on the renderer's own schedule, so a
   * `getComputedStyle` in the same round trip can resolve against the pre-recalc style. This check
   * read **5, then 18, then 23** of the same 23 buttons across three consecutive samples of an
   * unchanged app — and, run straight after a route change, a stable and completely wrong **0**
   * three times running, which is the worse failure because it repeats.
   *
   * The settle is not a sleep. A sleep is the 263 ms sampling window in `CLAUDE.md`'s table with a
   * bigger number in it: it makes the miss rarer without making it impossible, and it cannot say
   * whether the run that passed did so because the style settled or because the wait was generous.
   * Agreement across two consecutive force-and-read pairs is the predicate, and a run that never
   * agrees is reported as NO READING rather than averaged away.
   *
   * It is explicitly not `requestAnimationFrame`: rAF does not fire in an occluded window, so a
   * fix built on it works only while somebody is looking at the app.
   */
  const SAMPLE_ACTIVE = `(function(){
      var btns = document.querySelectorAll('button:not([disabled])');
      var short = 0, long = [], scaled = 0, visible = 0, hidden = 0, midFlip = 0;
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].style && btns[i].style.transition) { midFlip++; continue; }
        var cs = getComputedStyle(btns[i]);
        var props = String(cs.transitionProperty||'').split(',').map(function(s){return s.trim();});
        var durs  = String(cs.transitionDuration||'').split(',').map(function(s){return s.trim();});
        var idx = props.indexOf('scale');
        var d = idx >= 0 ? (durs[idx] || durs[0]) : durs[0];
        if (d === '0.1s') short++; else long.push((btns[i].className||'button').split(' ')[0] + '=' + d);
        /*
         * Only a VISIBLE button counts here. A button in a non-routed pane is display:none, and a
         * hidden element reports no scale however forced its state is — so counting all of them
         * reported "23 of 697 scale", which reads exactly like a missing press rule and is an
         * artifact of where the other 674 were. Measured: 23 of 23 visible, 0 of 674 hidden.
         */
        var shown = btns[i].offsetParent !== null || cs.position === 'fixed';
        if (!shown) { hidden++; continue; }
        visible++;
        var t = cs.scale;
        if (t && t !== 'none' && parseFloat(t) < 1) scaled++;
      }
      return JSON.stringify({ short: short, scaled: scaled, visible: visible, hidden: hidden, midFlip: midFlip, total: btns.length - midFlip, long: long.slice(0,8) });
    })()`;

  let previous = null;
  let forced = null;
  let settled = false;
  const deadline = Date.now() + 20000;
  for (;;) {
    forced = await probe.rawForcePseudo({
      selector: 'button:not([disabled])',
      pseudo: 'active',
      read: SAMPLE_ACTIVE,
    });
    const now = JSON.parse(forced.value);
    if (previous && previous.scaled === now.scaled && previous.visible === now.visible) {
      settled = true;
      break;
    }
    previous = now;
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!settled) {
    check('pressing shortens the transition to --dur-press', null,
      'the forced :active reading never agreed twice in 20s — the style recalc never settled, ' +
      'so this run holds no reading in either direction');
  }
  const v = JSON.parse(forced.value);
  if (!settled) {
    // already reported above
  } else if (v.total === 0) {
    check('pressing shortens the transition to --dur-press', null, 'no enabled buttons to force');
  } else {
    check(
      'pressing shortens the transition to --dur-press (0.1s)',
      v.short === v.total,
      `${v.short} of ${v.total} at 0.1s${v.long.length ? `; others: ${v.long.join(', ')}` : ''}  [forced=${forced.forced}]`,
    );
    check(
      'pressing actually applies a scale transform',
      v.visible > 0 && v.scaled === v.visible,
      `${v.scaled} of ${v.visible} VISIBLE buttons actually scale below 1 (${v.hidden} in ` +
        'non-routed panes report no scale whatever their state, and are excluded) — this is the ' +
        'control for the row above, since a duration on a property that never changes is unobservable',
    );
  }
}

/* ---- 3 · Disabled controls -------------------------------------------------------------------- */

if (wanted('disabled')) {
  console.log('\ndisabled');
  const r = JSON.parse(
    await probe.rawEvaluate(`(function(){
      var btns = document.querySelectorAll('button[disabled]');
      var moved = [];
      for (var i = 0; i < btns.length; i++) {
        var cs = getComputedStyle(btns[i]);
        // The press rides scale; transform is checked too, since a pane may still use it.
        var pressed = (cs.scale && cs.scale !== 'none' && parseFloat(cs.scale) !== 1)
                   || (cs.transform && cs.transform !== 'none');
        if (pressed) moved.push((btns[i].className||'button').split(' ')[0]);
      }
      return JSON.stringify({ total: btns.length, moved: moved });
    })()`),
  );
  if (r.total === 0) {
    /*
     * Not a pass. A disabled-control rule with no disabled control on screen has not been tested,
     * and saying "0 of 0 moved" would certify it. Named, so a run on a linked phone can take it.
     */
    check('a disabled control does not animate', null,
      'no disabled button on screen — this needs a state that produces one (an unpaired link disables the mirror controls)');
  } else {
    check('a disabled control does not animate', r.moved.length === 0,
      `${r.total} disabled buttons, ${r.moved.length} carrying a press${r.moved.length ? `: ${r.moved.join(', ')}` : ''}`);
  }
}

/* ---- 4 · Reduced motion ----------------------------------------------------------------------- */

if (wanted('reduced-motion')) {
  console.log('\nreduced-motion');
  const before = JSON.parse(await probe.rawEvaluate(READ_MOTION));
  const after = JSON.parse(
    await probe.rawEmulateMedia({
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      read: READ_MOTION,
    }),
  );
  /*
   * THE CONTROL, and it is the whole check. An emulation that silently did nothing and a
   * stylesheet that correctly removed every transform are the same reading — zero moving
   * elements — and only the before/after disagreement separates them.
   */
  const emulationWorked = before.movingCount > after.movingCount || before.spinningCount > after.spinningCount;
  if (!emulationWorked) {
    check('reduced motion removes movement', null,
      `the emulation changed nothing (moving ${before.movingCount} -> ${after.movingCount}, ` +
      `animating ${before.spinningCount} -> ${after.spinningCount}). Either setEmulatedMedia did not ` +
      'apply or the app had no motion to remove — this run cannot tell which, so it holds no reading');
  } else {
    check('reduced motion removes every transform', after.movingCount === 0,
      `${before.movingCount} -> ${after.movingCount}` + (after.moving.length ? `; surviving: ${after.moving.join(', ')}` : '') +
      `  [control: the same read with the emulation off returns ${before.movingCount}]`);
    check('reduced motion stops every running animation', after.spinningCount === 0,
      `${before.spinningCount} -> ${after.spinningCount}` + (after.spinning.length ? `; surviving: ${after.spinning.join(', ')}` : ''));
  }
}

/* ---- 5 · Reduced transparency ----------------------------------------------------------------- */

if (wanted('reduced-transparency')) {
  console.log('\nreduced-transparency');
  const before = JSON.parse(await probe.rawEvaluate(READ_BLUR));
  const after = JSON.parse(
    await probe.rawEmulateMedia({
      features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
      read: READ_BLUR,
    }),
  );
  if (before.count === 0) {
    check('reduced transparency removes every backdrop blur', null,
      'no backdrop-filter on screen with the setting OFF, so there is nothing for this to remove ' +
      'and a zero after would mean nothing');
  } else {
    check('reduced transparency removes every backdrop blur', after.count === 0,
      `${before.count} -> ${after.count}` + (after.sample.length ? `; surviving: ${after.sample.join(', ')}` : '') +
      `  [control: ${before.count} blurred surfaces with the setting off]`);
  }
}

/* ---- 6 · Approved durations only -------------------------------------------------------------- */

if (wanted('tokens')) {
  console.log('\ntokens');
  const seen = JSON.parse(await probe.rawEvaluate(READ_DURATIONS));
  const entries = Object.entries(seen).sort((a, b) => b[1] - a[1]);
  const rogue = entries.filter(([d]) => !APPROVED.has(d));
  if (entries.length === 0) {
    check('every duration on screen is an approved token value', null, 'no durations read at all');
  } else {
    check('every duration on screen is an approved token value', rogue.length === 0,
      rogue.length
        ? `unapproved: ${rogue.map(([d, n]) => `${d} (${n}x)`).join(', ')}`
        : `${entries.length} distinct values, all approved  [control=${entries.length} values seen]`);
    for (const [d, n] of entries) {
      console.log(`             ${d.padEnd(10)} ${String(n).padStart(5)}x  ${APPROVED.get(d) ?? '** NOT A TOKEN **'}`);
    }
  }
}

/* ---- Summary ---------------------------------------------------------------------------------- */

console.log('\n' + '-'.repeat(78));
const readings = lines.filter((l) => l.ok !== null).length;
const noReadings = lines.filter((l) => l.ok === null).length;
console.log(
  `motion-sweep: ${lines.filter((l) => l.ok === true).length} pass, ` +
    `${lines.filter((l) => l.ok === false).length} fail, ${noReadings} NO READING, ` +
    `over ${routes.length - refused.length} of ${routes.length} routes.`,
);
if (press.total) {
  console.log(`  buttons seen: ${press.total} (${press.disabled} disabled). A run on a disconnected app`);
  console.log('  sees fewer — notification rows, activity chips and photo albums need a linked phone.');
}
if (noReadings) {
  console.log('  A NO READING is not a pass and not a failure: it is a check that had nothing to measure.');
}
process.exit(failures > 0 ? 1 : 0);
