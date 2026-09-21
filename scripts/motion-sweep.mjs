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
 *   keyboard         the palette has NO motion, focus lands with it, Escape closes in the same turn
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

/**
 * The approved durations are **read from the page's own tokens**, never listed here.
 *
 * The first version of this file hardcoded the map, and it went red the moment a token was added
 * — `--dur-brand-breath: 6s` — for no reason except that the list had not been updated. That is a
 * second expression of the rule this repo has a whole section about: two copies of one fact, and
 * the test is the one that ends up wrong. `tokens.css` has one home for a duration, so the sweep
 * asks the document for it.
 *
 * The two reduced-motion kill values are the exception and are named, because they are not
 * durations anyone chose — they are "off", written as the smallest number that still lets a
 * `transitionend` fire.
 */
const KILL_VALUES = new Map([
  ['0s', 'none'],
  ['0.00001s', 'reduced-motion kill'],
  ['1e-06s', 'reduced-motion kill (float)'],
]);

const tokenDurations = JSON.parse(
  await probe.rawEvaluate(`(function(){
    var cs = getComputedStyle(document.documentElement);
    var out = {};
    for (var i = 0; i < cs.length; i++) {
      var name = cs[i];
      if (name.indexOf('--dur-') !== 0) continue;
      var raw = cs.getPropertyValue(name).trim();
      if (!raw) continue;
      var n = parseFloat(raw);
      if (isNaN(n)) continue;
      var secs = raw.slice(-2) === 'ms' ? n / 1000 : n;
      // Normalise to the form getComputedStyle reports a transition-duration in.
      var key = String(secs) + 's';
      out[key] = (out[key] ? out[key] + ' / ' : '') + name;
    }
    return JSON.stringify(out);
  })()`),
);
const APPROVED = new Map([...KILL_VALUES, ...Object.entries(tokenDurations)]);
if (Object.keys(tokenDurations).length === 0) {
  console.log('motion-sweep: REFUSED — no --dur-* tokens readable from :root, so "every duration is');
  console.log('  approved" would be a claim against an empty list and would pass on anything.');
  process.exit(1);
}
console.log(`tokens: ${Object.keys(tokenDurations).length} duration values read from :root`);

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
      : ' — requestAnimationFrame is STALLED, so overview.ts\'s FLIP never clears its marks. ' +
        'Elements carrying an inline `transition` OR the `is-arriving` class are mid-FLIP and are ' +
        'excluded below rather than scored, counted and named by which mark they carry'),
);

/*
 * The theme, on the first line, for the same reason as the window's visibility: **every bound the
 * instrument imposes must appear in what it reports.**
 *
 * It was not here, and the cost was immediate. A dark run and a light run of this sweep came back
 * **byte-identical** — same passes, same counts, same token histogram, which is the correct result
 * since no rule in this file is about colour — so the two evidence files could not be told apart,
 * and neither one said which theme it had been taken in. Two indistinguishable files are not two
 * readings; they are one reading and a claim.
 */
const theme = JSON.parse(
  await probe.rawEvaluate(`JSON.stringify(document.documentElement.getAttribute('data-theme'))`),
);
console.log(`theme: ${theme}`);

/*
 * And whether a phone is on the other end, for the same reason again.
 *
 * The summary at the bottom has always carried "a run on a disconnected app sees fewer" as a
 * standing caveat, which is a true sentence about runs in general and says nothing about THIS one.
 * A reader takes it as a statement that the app was disconnected — the evidence README written
 * from the first captures said exactly that, and it is a coverage claim, since notification rows,
 * call rows and app tiles only exist with a phone linked. So the run reads `shell.status` and
 * prints what it found rather than what is usually true.
 */
const link = JSON.parse(await probe.rawEvaluate(`JSON.stringify({ phase: shell.status.phase, device: shell.status.deviceName || null })`));
console.log(`link: ${link.phase}${link.device ? ` — ${link.device}` : ''}`);

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

/*
 * Mid-FLIP: an element whose transition is suppressed **by the FLIP that is running on it**, not by
 * the stylesheet's rule for its kind.
 *
 * `overview.ts` marks a row two ways and clears both in the same `afterNextPaint`:
 *
 *   row.classList.add('is-arriving')     // .is-arriving { ...; transition: none }   — always
 *   row.style.transition = 'none'        // inline                                   — only if dy !== 0
 *
 * This file checked the inline half only, and a row that arrived **without moving** gets the class
 * and no inline style. It then reports no transition at all, which is exactly what a missing press
 * rule looks like — `snapping: recent-row (12)`, in an occluded window where `afterNextPaint` never
 * fires and the marks are never cleared.
 *
 * One mechanism, two marks, and an exclusion that knew about one of them. The same shape as the
 * `.brand-mark` pair this sitting started with: a rule expressed in two places where only one was
 * being read.
 */
const MID_FLIP = `(function(el){
  if (el.style && el.style.transition) return 'inline';
  if (el.classList && el.classList.contains('is-arriving')) return 'is-arriving';
  return null;
})`;

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
    var flip = (${MID_FLIP})(b);
    if (flip) {
      out.midFlip.push((String(b.className || '').split(' ')[0] || 'button') + '/' + flip);
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
          ? `\n             excluded, mid-FLIP (inline transition or .is-arriving): ${tally(press.midFlip)}` +
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
        if ((${MID_FLIP})(btns[i])) { midFlip++; continue; }
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
      return JSON.stringify({ short: short, scaled: scaled, visible: visible, hidden: hidden, midFlip: midFlip, matched: btns.length, total: btns.length - midFlip, long: long.slice(0,8) });
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
    /*
     * THREE clocks, not two, and the third is the one that produced a false FAIL.
     *
     * `forced` is how many nodes `CSS.forcePseudoState` was applied to; `total` is how many this
     * sample scored. The first version settled on `scaled` and `visible` agreeing twice and never
     * compared those two, so a sample where the force had reached 573 nodes and the reader walked
     * 697 counted as settled — and the 124 it had not reached reported their AT-REST duration,
     * `--dur-release` 0.16s, which was then written up as "128 apps tiles snap their press".
     *
     * The tell is in the output the run already printed: `569 of 697 at 0.1s [forced=573]`. Two
     * numbers that have to be equal for the reading to exist, side by side, differing, with the
     * verdict computed from the other one. `CLAUDE.md`'s rule is that a predicate over independent
     * clocks must settle on every clock; this is the clock nobody wrote down.
     */
    const reachedEverything = forced.forced === now.matched;
    if (previous && previous.scaled === now.scaled && previous.visible === now.visible && reachedEverything) {
      settled = true;
      break;
    }
    previous = now;
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!settled) {
    const last = JSON.parse(forced.value);
    const why =
      forced.forced === last.matched
        ? `the scaled/visible counts never agreed twice in 20s (last: scaled=${last.scaled}, visible=${last.visible})`
        : `the force reached ${forced.forced} nodes and the reader matched ${last.matched} — ` +
          `the ${last.matched - forced.forced} it did not reach report their AT-REST duration, ` +
          'which is indistinguishable from a button that does not shorten its press';
    check('pressing shortens the transition to --dur-press', null,
      `${why}. The style recalc never settled, so this run holds no reading in either direction`);
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
      `${v.short} of ${v.total} at 0.1s${v.long.length ? `; others: ${v.long.join(', ')}` : ''}  [forced=${forced.forced} of ${v.matched} matched; ${v.midFlip} mid-FLIP skipped]`,
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

/* ---- 5b · Keyboard: nothing animates in the way of an action ---------------------------------- */

if (wanted('keyboard')) {
  console.log('\nkeyboard');
  /*
   * The palette is the sharpest case in the whole app and the rule is *no animation at all*:
   * AUDIT.md §1 puts anything reached 100+ times a day in the "never animate" row, and Raycast —
   * the thing this is modelled on — has none. The build agrees deliberately (departure N-M8). So
   * this does not check that the motion is *fast*; it checks that there is **none**, because a
   * 120ms fade here would be the one regression nobody would file and everybody would feel.
   *
   * Then the part motion can actually break: focus must arrive with the surface, and Escape must
   * close it in the same turn. Both are measured through a real key event rather than by calling
   * the handler, because "the handler runs" and "the keystroke reaches it" are different claims —
   * the registration-is-not-execution rule.
   */
  const open = await probe.rawEvaluate(`(function(){
    shell.openPalette();
    var el = document.getElementById('palette');
    var cs = getComputedStyle(el);
    var input = document.getElementById('palette-input');
    return JSON.stringify({
      hidden: el.hidden,
      transition: cs.transitionProperty + ' / ' + cs.transitionDuration,
      animation: cs.animationName + ' / ' + cs.animationDuration,
      focusIsInput: document.activeElement === input,
      activeId: document.activeElement ? document.activeElement.id : null
    });
  })()`);
  const o = JSON.parse(open);
  const noMotion =
    (o.animation.split('/')[0].trim() === 'none' || parseFloat(o.animation.split('/')[1]) <= 0.001) &&
    parseFloat(o.transition.split('/')[1]) <= 0.001;
  check('the command palette opens with NO animation', noMotion,
    `transition ${o.transition}, animation ${o.animation} — AUDIT.md §1: 100+/day is the never-animate row`);
  check('focus is on the palette input the moment it opens', o.focusIsInput,
    `activeElement = ${o.activeId ?? '(none)'}`);

  // A real Escape keydown, not a call to closePalette(): the keystroke has to reach the handler.
  const closed = await probe.rawEvaluate(`(function(){
    var before = document.getElementById('palette').hidden;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    var after = document.getElementById('palette').hidden;
    return JSON.stringify({ before: before, after: after });
  })()`);
  const c = JSON.parse(closed);
  if (c.before !== false) {
    check('Escape closes the palette in the same turn', null,
      'the palette was not open when Escape was sent, so this measured nothing');
  } else {
    check('Escape closes the palette in the same turn', c.after === true,
      'measured synchronously after dispatching a real keydown — no frame in between');
  }

  /*
   * And the general form of "no animation blocks an action": a surface that is on its way out must
   * not still be swallowing clicks. Anything transitioning `opacity` while `pointer-events` is not
   * `none` is a candidate; the palette backdrop is the one that would bite.
   */
  const blockers = JSON.parse(await probe.rawEvaluate(`(function(){
    var out = [], scanned = 0, big = 0, invisible = 0;
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i], cs = getComputedStyle(el);
      scanned++;
      var r = el.getBoundingClientRect();
      var isBig = r.width * r.height >= 10000;
      if (isBig) big++;
      var isInvisible = parseFloat(cs.opacity) <= 0.01;
      if (isInvisible) invisible++;
      if (cs.pointerEvents === 'none') continue;
      if (!isInvisible) continue;
      if (!isBig) continue;
      out.push((el.id || el.className || el.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
    /*
     * scanned, big and invisible are the control. A zero here is only a finding if the query could
     * have found something: each half of the predicate has to match SOMETHING on its own, or the
     * run has proven nothing and merely returned an empty intersection.
     */
    return JSON.stringify({ count: out.length, sample: out.slice(0, 6), scanned: scanned, big: big, invisible: invisible });
  })()`));
  if (blockers.scanned === 0 || blockers.big === 0 || blockers.invisible === 0) {
    check('no invisible surface is still taking clicks', null,
      `the query proved nothing: scanned=${blockers.scanned}, big-enough-to-block=${blockers.big}, ` +
      `at-opacity-0=${blockers.invisible}. Each half of the predicate must match something on its ` +
      'own or a zero intersection is not a reading');
  } else {
    check('no invisible surface is still taking clicks', blockers.count === 0,
      (blockers.count ? blockers.sample.join(', ') : 'none') +
        `  [control: ${blockers.scanned} elements scanned, ${blockers.big} big enough to swallow a ` +
        `click, ${blockers.invisible} at opacity 0 — the intersection is what is empty, not the query]`);
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
  console.log(`  buttons seen: ${press.total} (${press.disabled} disabled), with the link ${link.phase}.`);
  console.log(
    link.phase === 'connected'
      ? '  Notification rows, call rows and app tiles are in that count because a phone is linked;'
      : '  Notification rows, call rows and app tiles are ABSENT from that count: no phone is linked,',
  );
  console.log(
    link.phase === 'connected'
      ? '  a disconnected run sees fewer buttons, not different rules.'
      : '  so this run sees fewer buttons than a linked one — not different rules.',
  );
}
if (noReadings) {
  console.log('  A NO READING is not a pass and not a failure: it is a check that had nothing to measure.');
}
process.exit(failures > 0 ? 1 : 0);
