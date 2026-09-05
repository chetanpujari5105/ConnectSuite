#!/usr/bin/env node
/**
 * Every pane, swept for text that is in the DOM and drawn at **zero height**.
 *
 * ### The defect this is named for
 *
 * The Messages thread list drew a preview line for all fifty conversations. Every one of them
 * carried real text off the wire — `sms.threads` has sent `snippet` since Phase 4 — and every one
 * measured `height: 0`. Nobody had ever seen a preview in this app.
 *
 * The mechanism is the **parent**, and the first version of this note said it was the button.
 *
 * That first version was written from the live page, where varying the row's own properties looked
 * decisive — `min-height: 0` gave 18px, `display: block` restored the text — and it concluded *a
 * button does not grow to its flex content*. Then the fix was reintroduced to prove this probe
 * could see it, **and the row grew to 119px with the text intact**. The claim was wrong.
 *
 * Rebuilt off-screen from the shipped rule, one thing varied at a time, the answer is unambiguous:
 *
 * | parent of the rows | row | preview |
 * |---|---|---|
 * | **as shipped** — `display: flex; flex-direction: column; max-height: 300px` | 32px | **0** |
 * | the same, but `display: block` | 52px | 18px |
 * | flex column, **no** `max-height` | 52px | 18px |
 *
 * **A column flex container with a constrained height shrinks its children**, because a flex item
 * defaults to `flex-shrink: 1` — and inside each shrunken row the deficit came out of the text.
 * Both conditions are needed; neither alone does anything. The row's own `display: flex` was
 * incidental, which is why changing it appeared to help.
 *
 * The lesson is the one this repo keeps paying for: **the properties you can vary are not
 * necessarily the ones responsible.** Varying the row changed the symptom, so the row looked like
 * the cause; only rebuilding the whole structure separated them.
 *
 * ### Why a probe and not a test
 *
 * Nothing else in the repo can see this.
 *
 *  - A **DOM double has no layout**, so `smsView.test.ts` rendered the element, asserted its text,
 *    and passed — for months, over a line no user had ever read.
 *  - A **stylesheet parser cannot see the tag**. `display: flex` with no height is correct on a
 *    `div` and a trap on a `button`, and `stylesheets.test.ts` reads CSS with no idea which
 *    elements a selector will match.
 *  - A **screenshot comparison** shows a missing line as a design difference, which is exactly how
 *    this survived a design pass.
 *
 * So the check is over the running app, and it is deliberately about the **symptom** rather than
 * the mechanism: any element that has text and no height is wrong, whatever caused it. Given how
 * wrong the first reading of the mechanism was, a net cast at the symptom is worth more than one
 * shaped around a cause — and it costs nothing extra.
 *
 * **Its control is a planted element**, not a reintroduction of defect 93: the pane's parent is no
 * longer a constrained flex column, so the original cannot be re-created there without rebuilding
 * the pane. `--self-test` plants a `height: 0` element carrying text into a live pane, runs the
 * sweep, asserts it was reported, and removes it. That is a claim about *this instrument* rather
 * than about that defect — and it is the claim that matters when the next one has a different
 * cause.
 *
 * The control is **built in rather than a sibling file** on purpose: it needs the running app, so a
 * `*.test.mjs` beside it would be a test the suite cannot run, and this repo has already shipped
 * one file that named an instrument which did not exist.
 *
 * Run with the app up on :9222:
 *   node scripts/zero-height-text-probe.mjs
 *   node scripts/zero-height-text-probe.mjs --self-test
 */
import { openProbe } from './probe.mjs';
import { argv, exit } from 'node:process';

const port = Number((argv.find((a) => a.startsWith('--port=')) ?? '--port=9222').split('=')[1]);
const selfTest = argv.includes('--self-test');
const probe = await openProbe({ port });

const CONTROL_CLASS = 'probe-zero-height-control';

/** Removes any control this probe has ever planted, including one a crashed run left behind. */
const clearControl = () =>
  probe.rawEvaluate(
    `(() => { let n = 0; for (const el of document.querySelectorAll('.${CONTROL_CLASS}')) { el.remove(); n++; }
      return String(n); })()`,
  );

await clearControl();

if (selfTest) {
  const planted = await probe.rawEvaluate(`(() => {
    const pane = document.querySelector('section[data-screen="clipboard"]');
    const el = document.createElement('div');
    el.className = '${CONTROL_CLASS}';
    el.textContent = 'A sentence that is present, correct, and invisible.';
    // The shape defect 93 produced: real text, no box. Deliberately not display:none — the probe
    // must be shown to tell "collapsed" from "hidden on purpose", which is the distinction that
    // makes it useful rather than noisy.
    el.style.cssText = 'height:0;overflow:hidden;';
    pane.appendChild(el);
    return String(Math.round(el.getBoundingClientRect().height));
  })()`);
  console.log(`self-test: planted a text node measuring ${planted}px in the clipboard pane\n`);
}

const screens = JSON.parse(
  await probe.rawEvaluate(
    `JSON.stringify(Array.from(document.querySelectorAll('section[data-screen]')).map(s => s.dataset.screen))`,
  ),
);

let offenders = 0;
let measured = 0;
const skipped = [];

for (const screen of screens) {
  const landed = await probe.act({
    what: `route to ${screen}`,
    run: `shell.route(${JSON.stringify(screen)})`,
    expect: `(() => { const s = document.querySelector('section[data-screen=${JSON.stringify(screen)}]');
      return !!s && s.hidden === false; })()`,
    within: 4000,
  });
  if (!landed.landed) {
    // A route that did not land is a **missing reading**, not a clean pane. Said out loud rather
    // than folded into the pass, which is this repo's most-repeated lesson about instruments.
    skipped.push(`${screen} (route did not land)`);
    continue;
  }
  // Panes fetch. Nothing here can know when each one has finished, so the wait is declared.
  await new Promise((r) => setTimeout(r, 900));

  const found = await probe.read({
    question: `${screen}: elements carrying text and drawn at zero height`,
    read: `(() => {
      const pane = document.querySelector('section[data-screen=${JSON.stringify(screen)}]');
      const out = [];
      let seen = 0;
      for (const el of pane.querySelectorAll('*')) {
        // Leaf text only. A container reports its children's text and its own zero height is
        // ordinary — a wrapper collapsing is not a lost sentence.
        if (el.children.length > 0) continue;
        const text = (el.textContent || '').trim();
        if (!text) continue;
        seen += 1;
        const r = el.getBoundingClientRect();
        if (r.height > 0) continue;
        // Deliberately hidden is not a defect: a pane that is display:none, a [hidden] node, or an
        // element inside one, is not drawing anything and is not claiming to.
        if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ checkVisibilityCSS: true })) continue;
        // The visually-hidden convention is text FOR a screen reader; it is meant to have no box.
        if (el.className && String(el.className).includes('visually-hidden')) continue;
        out.push({
          cls: String(el.className || el.tagName),
          text: text.slice(0, 48),
          parent: String(el.parentElement?.className || ''),
        });
      }
      return { withText: seen, zeroHeight: out };
    })()`,
    // The control: this pane has text in it at all. A pane that rendered nothing would otherwise
    // report zero offenders and read as clean.
    control: `document.querySelector('section[data-screen=${JSON.stringify(screen)}]').textContent.trim().length`,
  });

  measured += 1;
  const { withText, zeroHeight } = found.value;
  if (zeroHeight.length === 0) {
    console.log(`  ok    ${screen.padEnd(14)} ${String(withText).padStart(4)} text nodes, none collapsed`);
    continue;
  }
  offenders += zeroHeight.length;
  console.log(`  FAIL  ${screen.padEnd(14)} ${String(withText).padStart(4)} text nodes, ${zeroHeight.length} at zero height`);
  for (const one of zeroHeight.slice(0, 6)) {
    console.log(`          .${one.cls} in .${one.parent} — ${JSON.stringify(one.text)}`);
  }
  if (zeroHeight.length > 6) console.log(`          … and ${zeroHeight.length - 6} more`);
}

console.log(
  `\n${measured} of ${screens.length} panes measured, ${offenders} text nodes drawn at zero height.`,
);
if (skipped.length) console.log(`NOT MEASURED: ${skipped.join(', ')}`);

if (selfTest) {
  await clearControl();
  if (offenders < 1) {
    console.error(
      'SELF-TEST FAILED: a text node deliberately drawn at zero height was NOT reported. This ' +
        'probe cannot see the thing it exists for, and every clean run above it is worthless.',
    );
    exit(2);
  }
  console.log(
    `self-test: the planted node was reported (${offenders} found), and it has been removed. ` +
      'The sweep can see a collapsed sentence.',
  );
  exit(0);
}
console.log(
  'A DOM double has no layout and a stylesheet parser has no tags. This is the only place in the\n' +
    'repo that can see a sentence which is present, correct, and invisible.',
);
exit(offenders > 0 ? 1 : 0);
