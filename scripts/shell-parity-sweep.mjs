/**
 * The shell's cross-cutting surfaces, measured in both themes: focus rings, tooltips, the modal
 * surfaces, the toast, the reduced-motion and reduced-transparency modes.
 *
 * ### Why a sweep rather than a look
 *
 * Every one of these is invisible until somebody is in the state that draws it. A focus ring only
 * exists while a control is focused **by keyboard**; a tooltip only while a pointer rests; a
 * reduced-transparency rule only on a machine with the setting on. So the pane screenshots this
 * project takes — twelve routes, at rest, mouse elsewhere — structurally cannot show any of them,
 * and no amount of looking at those images would find a missing ring.
 *
 * ### What each reading is, and what it is not
 *
 * - **Focus rings** are read by focusing each control and taking its *computed* `outline`. A rule
 *   existing in `tokens.css` is not a ring on a control: `:focus-visible` is the UA's own
 *   heuristic, and a control reached by script is not always given it. So this **sets the
 *   `:focus-visible` state through CDP's forced pseudo-state**, which is the browser's own answer
 *   rather than a guess about when the heuristic fires.
 * - **Tooltips** are counted as `title` attributes. A native tooltip is drawn by the OS: it does
 *   not follow the app's theme, cannot be styled, waits about a second, and is invisible to a
 *   touch or keyboard user. Counting them is a parity reading, not a bug report — the verdict is
 *   whether any carries information that exists nowhere else.
 * - **Reduced modes** are read by emulating the media feature and re-reading the same surfaces.
 *   A `@media` block that exists is not a block that covers the surfaces added since it was
 *   written, which is the only way this one goes wrong.
 *
 * Run with the app up:
 *   node scripts/shell-parity-sweep.mjs
 */
import { openProbe, format } from './probe.mjs';

const probe = await openProbe({ port: 9222 });
let failures = 0;
const show = (r) => {
  console.log('  ' + format(r));
  if (!r.reportable) failures += 1;
  return r;
};
const verdict = (what, ok, note = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${what}${note ? ` — ${note}` : ''}`);
  if (!ok) failures += 1;
};
const note = (what) => console.log(`  --   ${what}`);

/** Every control the shell chrome itself owns, named so a zero is legible. */
const CHROME_CONTROLS = `(() => {
  const pick = (sel) => [...document.querySelectorAll(sel)].filter((n) => n.offsetParent !== null);
  return {
    navRows: pick('.nav-row').length,
    toolbar: pick('.toolbar-button').length,
    account: pick('.account-row').length,
    island: document.querySelectorAll('#status-island').length,
  };
})()`;

console.log('\n=== Shell-wide parity sweep ===\n');

const chrome = show(
  await probe.read({
    question: 'the chrome is drawn and its controls are countable',
    read: CHROME_CONTROLS,
    control: `document.querySelectorAll('.app-window').length`,
  }),
);

/* ---- 1 · Focus rings -------------------------------------------------------------------------
 * Forced through CDP so the reading is the browser's, not a guess about when :focus-visible fires.
 */
console.log('\n-- focus rings, by forced :focus-visible on every visible control --\n');
let ringSweepResult;

const FOCUSABLE =
  'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * The reading, and the control that makes it one.
 *
 * `outlined` counts controls whose computed outline is a real width with a style — **with
 * `:focus-visible` forced by the browser**, because `el.focus()` from a script does not trigger the
 * user agent's heuristic and reads zero rings on a perfectly ringed app.
 *
 * The control is the same query with the pseudo-class **not** forced: it must come back near zero.
 * Without it, a stylesheet that outlined every control all the time would score a perfect 100%.
 */
async function ringSweep(label) {
  /** One sample: every visible, enabled control, and whether its computed outline is a real ring. */
  const SAMPLE = `(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(FOCUSABLE)})]
      .filter((n) => n.offsetParent !== null && !n.disabled);
    let outlined = 0; const bare = [];
    for (const el of els) {
      const cs = getComputedStyle(el);
      const w = parseFloat(cs.outlineWidth) || 0;
      if (w > 0 && cs.outlineStyle !== 'none') outlined += 1;
      else bare.push(el.id || el.className || el.tagName);
    }
    return { total: els.length, outlined, bare: [...new Set(bare)].slice(0, 10) };
  })()`;

  /*
   * **Force and read are one atomic pair, repeated — and that is the whole instrument.**
   *
   * `CSS.forcePseudoState` is applied to *node ids*. Photos and Apps stream their content in, and
   * a pane that re-renders **replaces** its elements: the node count is unchanged, so a settle
   * predicate on the count is satisfied, while every forced state now sits on a node that is no
   * longer in the document. That produced a stable, repeatable and completely wrong `557 of 829`
   * with 272 photo tiles reported as having no focus ring — and a run before it, against a pane
   * that happened to have finished loading, read `825 of 825`.
   *
   * Two readings of one fact, and neither tool was less trustworthy than the other: one measured
   * a settled pane and one measured dead nodes. What separates them is **re-applying the stimulus
   * immediately before each sample**, so the nodes carrying the state are the nodes being read.
   * Agreement across two consecutive pairs is the settle, and `settled: false` is reported rather
   * than averaged away.
   */
  let previous = null;
  let last = null;
  const deadline = Date.now() + 20000;
  for (;;) {
    last = await probe.rawForcePseudo({ selector: FOCUSABLE, pseudo: 'focus-visible', read: SAMPLE });
    if (
      previous &&
      previous.value.outlined === last.value.outlined &&
      previous.value.total === last.value.total
    ) {
      break;
    }
    previous = last;
    if (Date.now() >= deadline) {
      console.log(`  ${label}: NO READING — the ring count never agreed twice in 20s`);
      return {
        forced: { total: 0, outlined: 0, bare: [] },
        atRest: { total: 0, outlined: 0 },
        settled: false,
      };
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  const atRest = await probe.rawEvaluate(SAMPLE);
  console.log(
    `  ${label}: ${last.value.outlined} of ${last.value.total} ringed under forced :focus-visible` +
      `   [control: ${atRest.outlined} of ${atRest.total} outlined at rest — must be ~0]`,
  );
  if (last.value.bare.length) console.log(`     bare: ${last.value.bare.join(', ')}`);
  if (last.stopped !== 'all') {
    console.log(
      `     stopped=${last.stopped} — ${last.forced} of ${last.matched} nodes actually took the state`,
    );
  }
  return { forced: last.value, atRest, settled: true };
}

/*
 * Every route, because a ring rule is per-selector and a pane that styles its own controls is the
 * one that will have missed it. `navModel.SCREENS` is the list, read from the app rather than
 * typed here — a hand-copied route list is the second copy that stops matching.
 */
const routes = await probe.rawEvaluate(`SCREENS.map((s) => s.id)`);
const perRoute = [];
const refused = [];
/**
 * Waits until a route stops changing shape, and says so when it does not.
 *
 * Photos and Apps fill in asynchronously — thumbnails and icons arrive over the wire — and a DOM
 * that is still mutating **drops the forced pseudo-state** off the nodes it re-renders. That is
 * how the same sweep read `photos: 286 of 286` on one run and `14 of 286` on the next, with no
 * `stopped=` line either time because every node genuinely took the state at the moment it was
 * applied. A fixed 250 ms sleep is the 263 ms sampling window in `CLAUDE.md`'s table with a
 * smaller number in it: it makes the miss rarer without making it impossible, and it cannot say
 * whether the run that passed did so because the pane settled or because the sleep was generous.
 *
 * So the predicate is the thing that has to be true — **the control count is the same twice in a
 * row** — and a route that never settles is reported rather than measured.
 */
async function settleRoute(id) {
  const count = () =>
    probe.rawEvaluate(
      `document.querySelectorAll(${JSON.stringify(FOCUSABLE)}).length`,
    );
  const deadline = Date.now() + 8000;
  let previous = -1;
  for (;;) {
    await new Promise((r) => setTimeout(r, 250));
    const now = await count();
    if (now === previous) return { settled: true, controls: now };
    previous = now;
    if (Date.now() >= deadline) return { settled: false, controls: now };
  }
}

for (const id of routes) {
  await probe.rawEvaluate(`shell.route(${JSON.stringify(id)})`);
  const settle = await settleRoute(id);
  if (!settle.settled) {
    console.log(`  ${id}: NO READING — still redrawing after 8s (${settle.controls} controls and moving)`);
    refused.push(`${id} (never settled)`);
    continue;
  }
  const drawn = await probe.rawEvaluate(
    `(() => { const s=[...document.querySelectorAll('section.screen')].find(x => !x.hidden); return s ? s.dataset.screen : null; })()`,
  );
  if (drawn !== id) {
    console.log(`  ${id}: NO READING — the route did not take (drawn: ${drawn}). A blocked route is a no-op`);
    refused.push(id);
    continue;
  }
  perRoute.push([id, await ringSweep(id)]);
}
await probe.rawEvaluate(`shell.route('overview')`);
ringSweepResult = {
  forced: {
    total: perRoute.reduce((n, [, r]) => n + r.forced.total, 0),
    outlined: perRoute.reduce((n, [, r]) => n + r.forced.outlined, 0),
    bare: [...new Set(perRoute.flatMap(([, r]) => r.forced.bare))],
  },
  atRest: { outlined: perRoute.reduce((n, [, r]) => n + r.atRest.outlined, 0) },
};

/* ---- 2 · Tooltips ---------------------------------------------------------------------------- */
console.log('\n-- tooltips --\n');
const tips = show(
  await probe.read({
    question: 'native title tooltips in the app, and what they say',
    read: `(() => {
      const all = [...document.querySelectorAll('[title]')];
      const byKind = {};
      for (const n of all) {
        const kind = (n.className || n.tagName).split(' ')[0];
        byKind[kind] ??= { n: 0, sample: n.title, duplicatesVisibleText: 0 };
        byKind[kind].n += 1;
        if (n.textContent.trim() === n.title.trim()) byKind[kind].duplicatesVisibleText += 1;
      }
      return { count: all.length, byKind };
    })()`,
    control: `document.querySelectorAll('*').length`,
  }),
);

/* ---- 3 · The modal surfaces ------------------------------------------------------------------
 * The palette and the New-conversation panel are the only two things that take over the window.
 */
console.log('\n-- modal surfaces --\n');
const modals = show(
  await probe.read({
    question: 'the palette and the New-conversation panel: role, modality, labelling, Escape',
    read: `(() => {
      const one = (sel) => { const n = document.querySelector(sel); if (!n) return null;
        return { role: n.getAttribute('role'), modal: n.getAttribute('aria-modal'),
                 label: n.getAttribute('aria-label') || n.getAttribute('aria-labelledby'),
                 hidden: n.hidden }; };
      return { palette: one('.palette'), newConversation: one('#contacts-card') };
    })()`,
    control: `document.querySelectorAll('.palette').length`,
  }),
);

/* ---- 4 · Toast ------------------------------------------------------------------------------- */
console.log('\n-- toast --\n');
const toast = show(
  await probe.read({
    question: 'the toast host: does it exist, is it announced, is it themed',
    read: `(() => {
      const n = document.querySelector('.toast, #toast, .toast-host');
      if (!n) return { present: false, hosts: [...document.querySelectorAll('[aria-live]')].map((x) => x.id || x.className) };
      const cs = getComputedStyle(n);
      return { present: true, live: n.getAttribute('aria-live'), role: n.getAttribute('role'),
               background: cs.backgroundColor, color: cs.color };
    })()`,
    control: `document.querySelectorAll('.app-window').length`,
  }),
);

/* ---- 5 · Reduced modes ------------------------------------------------------------------------
 * Emulated, because neither setting can be produced from page script and neither is on here.
 */
console.log('\n-- reduced transparency and reduced motion, emulated --\n');

/**
 * Every surface this pass added or touched, plus the chrome, so a `@media` block that predates a
 * surface is visible as a surface it does not cover.
 */
const SURFACES = `(() => {
  const read = (sel) => { const n = document.querySelector(sel); if (!n) return null;
    const cs = getComputedStyle(n);
    return { backdrop: cs.backdropFilter, bg: cs.backgroundColor,
             transition: cs.transitionDuration, animation: cs.animationDuration }; };
  return {
    island: read('.status-island'),
    sidebar: read('.sidebar'),
    card: read('.card'),
    palette: read('.palette'),
    toast: read('.toast'),
    stateBlock: read('.state-block'),
    pairNotice: read('.pair-notice'),
  };
})()`;

const atRest = await probe.rawEvaluate(SURFACES);
const noTransparency = await probe.rawEmulateMedia({
  features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
  read: SURFACES,
});
const noMotion = await probe.rawEmulateMedia({
  features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  read: SURFACES,
});

/** A surface is covered when nothing about it is still translucent or still blurred. */
const translucent = (v) =>
  !!v && (v.backdrop !== 'none' || /rgba\([^)]*,\s*0?\.\d+\)/.test(v.bg));
const stillBlurred = Object.entries(noTransparency)
  .filter(([, v]) => v && v.backdrop !== 'none')
  .map(([k]) => k);
const blurredAtRest = Object.entries(atRest)
  .filter(([, v]) => translucent(v))
  .map(([k]) => k);
const stillMoving = Object.entries(noMotion)
  .filter(([, v]) => v && parseFloat(v.transition) > 0.001)
  .map(([k]) => k);

console.log(`  translucent or blurred at rest : ${blurredAtRest.join(', ') || 'none'}`);
console.log(`  still blurred under reduce     : ${stillBlurred.join(', ') || 'none'}`);
console.log(`  still transitioning under reduce: ${stillMoving.join(', ') || 'none'}`);

console.log('');
verdict('the chrome draws its controls', chrome.value.navRows >= 10 && chrome.value.toolbar >= 2 && chrome.value.island === 1);
verdict(
  'control: something IS translucent at rest, so the reduce reading means something',
  blurredAtRest.length > 0,
  `${blurredAtRest.length} surfaces`,
);
verdict('reduced transparency removes every blur', stillBlurred.length === 0, stillBlurred.join(', '));
verdict('reduced motion stops every transition', stillMoving.length === 0, stillMoving.join(', '));
/*
 * The denominator is the verdict's own control, and it has to be checked before the ratio.
 *
 * This printed **`OK — 0 of 0`** on a run where every route was refused: the app was forced to the
 * pairing screen by a repudiated link, `shell.route` was a no-op twelve times in a row, and
 * `0 === 0` is true. A sweep that measured nothing certified everything. That is this repo's own
 * page-cap row — the instrument reporting a state it never reached — arriving inside a sweep
 * written in the same sitting as the probe that has the same guard.
 *
 * So a ratio over an empty denominator is **NO READING**, never a pass, and the routes that
 * refused are named rather than summed away.
 */
if (refused.length) {
  note(
    `${refused.length} of ${routes.length} routes refused to draw (${refused.join(', ')}) — ` +
      'the app forces one screen while the link is unpaired or repudiated',
  );
}
if (ringSweepResult.forced.total === 0) {
  note(
    'focus rings: NO READING — no route drew a control, so there was no denominator. ' +
      'This is not a pass; re-run with the app on a reachable route',
  );
  failures += 1;
} else {
  verdict(
    'every visible control takes a focus ring',
    ringSweepResult.forced.outlined === ringSweepResult.forced.total,
    `${ringSweepResult.forced.outlined} of ${ringSweepResult.forced.total}` +
      ` across ${perRoute.length} routes` +
      (ringSweepResult.forced.bare.length ? ` — bare: ${ringSweepResult.forced.bare.join(', ')}` : ''),
  );
  verdict(
    'control: the ring is the focus state, not a permanent outline',
    ringSweepResult.atRest.outlined === 0,
    `${ringSweepResult.atRest.outlined} outlined at rest`,
  );
}
verdict('the palette is a labelled modal dialog',
  modals.value.palette?.role === 'dialog' && modals.value.palette?.modal === 'true' && !!modals.value.palette?.label);
if (modals.value.newConversation) {
  verdict('the New-conversation panel is a labelled modal dialog too',
    modals.value.newConversation.role === 'dialog' && modals.value.newConversation.modal === 'true');
} else {
  note('the New-conversation panel: NO READING — not in the DOM on this route (it lives in Messages)');
}
if (toast.value.present) {
  verdict('the toast is announced', toast.value.live === 'polite' || toast.value.role === 'status');
} else {
  note(`the toast: NO READING — no .toast in the DOM at rest. aria-live hosts present: ${JSON.stringify(toast.value.hosts)}`);
}
/*
 * Counted by kind, never totalled. 194 is not a finding; the useful column is
 * `duplicatesVisibleText`, which is how defect 127 was found — nine rows whose tooltip repeated
 * the line under the pointer. A total would have hidden nine inside two hundred.
 */
console.log(`  --   tooltips: ${tips.value.count} title attributes, by kind:`);
for (const [kind, info] of Object.entries(tips.value.byKind ?? {})) {
  const dupes = info.duplicatesVisibleText
    ? `  ** ${info.duplicatesVisibleText} repeat the element's own text **`
    : '';
  console.log(`         ${String(info.n).padStart(4)} x ${kind.padEnd(18)} e.g. ${JSON.stringify(String(info.sample).slice(0, 60))}${dupes}`);
}

console.log(`\n${failures === 0 ? 'ALL READINGS OK' : `${failures} FAILED`}\n`);
await probe.close();
process.exit(failures === 0 ? 0 : 1);
