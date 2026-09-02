/**
 * Every Apps-pane number in `docs/testing.md`, taken through `probe.mjs`.
 *
 * The claims this feature makes are unusually easy to fake, which is why the instrument is in the
 * repo rather than in `/tmp`:
 *
 *  - **"122 apps with real names and icons"** — a count of tiles proves nothing about the *names*
 *    (a grid of 122 package ids is the same number) and nothing about the *icons* (122 empty
 *    placeholder divs is also the same number). So the tiles, the resolved names and the drawn
 *    `<img>` elements are three separate readings against three separate denominators.
 *  - **"click one, the phone buzzes"** — the click is a stimulus, and a stimulus reported without
 *    its effect is a request. The effect is read on the *phone*, from `dumpsys notification`, not
 *    from anything the Mac says about itself.
 *  - **the copy** — read by counting elements and then reading their text, never by searching the
 *    page for words. The pane's own explanatory copy contains the words for the things it is
 *    explaining, which is how a `/drop|upload/` scan once matched a banner apologising for the
 *    absence of an upload.
 *
 * Run with the app up and a phone linked:
 *   node scripts/apps-pane-probe.mjs
 */
import { openProbe, STOPPED, format } from './probe.mjs';

const probe = await openProbe({ port: 9222 });
let failures = 0;

const check = (label, condition, detail) => {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
};
const show = (result) => {
  console.log('  ' + format(result));
  if (!result.reportable) failures += 1;
  return result;
};

/** Routing is a stimulus, so it reports whether it landed rather than assuming it did. */
const routeTo = async (screen) => {
  const acted = await probe.act({
    what: `route to ${screen}`,
    run: `(() => { const b=[...document.querySelectorAll('.nav-item, nav button, nav a')]
      .find(x => (x.textContent||'').trim().toLowerCase().startsWith(${JSON.stringify(screen)}));
      if (b) b.click(); return !!b; })()`,
    expect: `(() => { const s=document.querySelector('section[data-screen="${screen}"]');
      return !!s && !s.hidden && s.getBoundingClientRect().height > 0; })()`,
    within: 5000,
  });
  if (!acted.landed) {
    console.log(`  FAIL  could not route to ${screen} — nothing below is a reading`);
    failures += 1;
  }
  return acted.landed;
};

/*
 * The control for every reading below.
 *
 * `section[data-screen="apps"]`, narrowed with the element name, because the app window carries the
 * same attribute as its route marker and comes first in document order — the fault that once
 * reported a hidden pane as `visible: true` and listed the sidebar's buttons as its own.
 * `__probe.one` throws on no match, on two matches, and on a hidden node.
 */
const PANE_VISIBLE = `(() => { const s = __probe.one('section[data-screen="apps"]'); return s ? 1 : 0; })()`;
const TILES = `__probe.count('#apps-grid .apps-tile')`;

console.log('\n== Apps pane ==\n');

if (!(await routeTo('apps'))) {
  await probe.close();
  process.exit(1);
}

// ---- the grid ---------------------------------------------------------------------------------

const tiles = show(
  await probe.read({
    question: 'app tiles drawn in the grid',
    read: TILES,
    control: PANE_VISIBLE,
    settle: { until: (n) => n > 0, within: 20000 },
  }),
);

/*
 * Distinct packages, not tiles.
 *
 * The same units discipline the phone side needed: a count of DOM nodes is a count of *tiles*, and
 * `data-package` is what makes it a count of *apps*. If the two ever disagree the grid is drawing
 * something twice, which a tile count alone cannot see.
 */
const distinct = show(
  await probe.read({
    question: 'distinct package handles among those tiles',
    read: `(() => new Set([...document.querySelectorAll('#apps-grid .apps-tile')]
      .map(t => t.dataset.package)).size)()`,
    control: TILES,
  }),
);
check(
  'every tile is a different app',
  distinct.value === tiles.value,
  `${distinct.value} distinct of ${tiles.value} tiles`,
);

/*
 * **The reading that makes "real names" a claim rather than a count.**
 *
 * A resolved name is a tile whose label is not its own package id. Counting tiles cannot tell a
 * grid of 122 apps from a grid of 122 raw package ids — which is exactly the state defect 28 left
 * two other panes in, and exactly what this feature would look like if the `<queries>` block were
 * missing. Published as a ratio, because "12 fallbacks" and "122 of 122 fallbacks" are different
 * findings and only the denominator separates them.
 */
const named = show(
  await probe.read({
    question: 'tiles whose label is a resolved name rather than the package id',
    read: `(() => [...document.querySelectorAll('#apps-grid .apps-tile')].filter(t => {
      const name = t.querySelector('.apps-tile-name');
      return name && name.textContent.trim() && name.textContent.trim() !== t.dataset.package;
    }).length)()`,
    control: TILES,
  }),
);

/*
 * **And the reading that makes the names *visible* rather than merely present.**
 *
 * The reading above counts labels in the DOM, and it returned 123 of 123 over a grid that showed
 * **no text at all** — nine columns of overlapping icons and not one name on screen. `textContent`
 * is a fact about the tree; it is not a fact about the picture. The row was 32px because a
 * `<button>` reports its `min-height` as its intrinsic grid contribution, so every label was clipped
 * to zero height while reading back perfectly.
 *
 * This is `CLAUDE.md`'s "the DOM is an instrument" rule meeting its own probe: the query was
 * correct, the target was there, and the thing being asked about was a different property than the
 * one that mattered. Height is the one that mattered, so height is now read.
 */
const visible = show(
  await probe.read({
    question: 'tiles whose label is actually drawn — non-zero height, not just present in the DOM',
    read: `(() => [...document.querySelectorAll('#apps-grid .apps-tile .apps-tile-name')]
      .filter(n => n.getBoundingClientRect().height > 0).length)()`,
    control: TILES,
  }),
);
check(
  'every name is on screen, not merely in the tree',
  visible.value === tiles.value,
  `${visible.value} drawn of ${tiles.value}`,
);

/*
 * And the reading that makes "real icons" a claim.
 *
 * A drawn `<img>` with a base64 PNG in it, counted separately from the placeholder divs. A tile
 * that never received an icon still draws — as `.apps-tile-pending` — so the two counts must sum to
 * the tile count, and that sum is the check that says the reading covers the whole grid rather than
 * whatever happened to be scrolled into view.
 */
const icons = show(
  await probe.read({
    question: 'tiles showing a real icon (an img with PNG data)',
    read: `(() => [...document.querySelectorAll('#apps-grid .apps-tile img.apps-tile-icon')]
      .filter(i => (i.src||'').startsWith('data:image/png;base64,') && i.src.length > 200).length)()`,
    control: TILES,
    settle: { until: (n) => n > 0, within: 30000 },
  }),
);
const pending = show(
  await probe.read({
    question: 'tiles still waiting for an icon',
    read: `__probe.count('#apps-grid .apps-tile-pending')`,
    control: TILES,
  }),
);
check(
  'icons and placeholders account for every tile',
  icons.value + pending.value === tiles.value,
  `${icons.value} drawn + ${pending.value} pending = ${icons.value + pending.value} of ${tiles.value}`,
);

// ---- the copy, counted rather than searched ------------------------------------------------------

/*
 * The pane must not offer any control that implies this Mac opens anything.
 *
 * Counted as elements, never matched as text: the pane's own banner explains that the phone is what
 * opens an app, so a `/open|launch/` text scan would match the sentence describing the absence.
 * This enumerates *actionable* things and asserts the only ones are the tiles and the search box.
 */
const controls = show(
  await probe.presence({
    question: 'actionable controls in the pane that are not a tile or the search box',
    controls:
      'section[data-screen="apps"] button:not(.apps-tile), ' +
      'section[data-screen="apps"] input:not(#apps-search), ' +
      'section[data-screen="apps"] a[href]',
    control: TILES,
  }),
);
check(
  'no retry, no queue, no "open" button — the tap is on the phone',
  controls.value === 0,
  `${controls.value} extra controls`,
);

// ---- the click, and its effect read on the phone -------------------------------------------------

/*
 * The stimulus. `userGesture` is on for this one probe, because a real click is what is being
 * measured; the expectation is the Mac's own toast, and the *phone's* notification is read
 * separately by the shell, below, because a Mac reporting its own request as an effect is the
 * 12 MB-that-never-left fault.
 */
const firstLabel = await probe.rawEvaluate(
  `(() => { const t = document.querySelector('#apps-grid .apps-tile');
    return t ? (t.querySelector('.apps-tile-name')||{}).textContent : null; })()`,
);
console.log(`\n  clicking the first tile: ${JSON.stringify(firstLabel)}`);

/*
 * **The expectation names the app, and the first version did not — which cost a wrong reading on
 * this probe's first run.**
 *
 * It was `!toast.hidden`, and the toast was *already visible* from a click somebody had made before
 * the probe started. So the poll returned on its first sample, the read took the previous click's
 * sentence, and the probe reported clicking "AdBlock for Samsung Browser" and being told "Sent to
 * your phone — YouTube Music". Both halves were true and they were about different events.
 *
 * That is `CLAUDE.md`'s absence rule with the sign flipped: the usual fault is reading an absence
 * that was never populated, and this is reading a **presence that was already there**. The question
 * is the same one — *what else would satisfy this expectation?* — and here the answer was "any
 * earlier click, including one a person made while you were not looking".
 *
 * What settles it is that the state under test is not "a toast exists" but "the toast is about the
 * app I just clicked", so the expectation says the label. It is still not proof the ask reached the
 * phone; the phone's own log is that, and the bound is printed at the end.
 */
const clicked = await probe.act({
  what: `click the first app tile (${firstLabel})`,
  run: `(() => { const t = document.querySelector('#apps-grid .apps-tile'); if (t) t.click(); return !!t; })()`,
  expect: `(() => { const t = document.querySelector('#apps-toast');
    return !!t && !t.hidden && (t.textContent||'').includes(${JSON.stringify(String(firstLabel ?? ' '))}); })()`,
  within: 8000,
});
check('the click produced a line in the pane', clicked.landed, `landed=${clicked.landed}`);

if (clicked.landed) {
  const toast = show(
    await probe.read({
      question: 'what the pane says a click did',
      read: `__probe.text('#apps-toast')`,
      control: `(() => (document.querySelector('#apps-toast').textContent||'').length)()`,
    }),
  );
  const said = String(toast.value ?? '');
  // Read *after* the element was found and confirmed non-empty — this is checking the wording of a
  // sentence known to exist, which is a different question from "is there a sentence", and only the
  // second one is the trap the text-matcher refusal is about.
  check('it says the app was sent to the phone', /sent to your phone/i.test(said), said);
  check('it does not claim the app opened', !/open(ed|ing)\b/i.test(said), said);
  check('it does not say "launch"', !/launch/i.test(said), said);
}

console.log(
  `\n  bound: this instrument reads the Mac's DOM only. Whether the phone actually posted a ` +
    `notification is read from the phone, by the shell, and is not visible here.\n`,
);

await probe.close();
console.log(failures === 0 ? 'apps-pane-probe: all reportable\n' : `apps-pane-probe: ${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
