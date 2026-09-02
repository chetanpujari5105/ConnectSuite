/**
 * Every Activity-pane number in `docs/testing.md`, taken through `probe.mjs`.
 *
 * `activityView.test.ts` drives the real view class against a DOM double, and that covers which
 * element got which text. What it cannot see is the half `domDouble.testkit.ts` names in its own
 * header: cascade, layout, and whether the section is on screen at all. Those are exactly the two
 * faults this project has recorded against panes — a grid measured while hidden, and a `:root`
 * block in the wrong stylesheet — so the pane is read here as well, in the real window.
 *
 * Run with the app up:
 *   node scripts/activity-pane-probe.mjs
 */
import { openProbe, format } from './probe.mjs';

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
    run: `(() => { const b=[...document.querySelectorAll('.nav-row, nav button, nav a')]
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

console.log('\n=== Activity pane ===\n');

// The section selector is `section[data-screen=...]`, never `[data-screen=...]`: the app window
// carries the same attribute as its route marker and comes first in document order, so the bare
// attribute selector returns the whole window and reports a hidden pane as visible. That is one of
// the three instrument faults recorded in CLAUDE.md and it is why this line is spelled out.
const PANE = 'section[data-screen="activity"]';

if (!(await routeTo('activity'))) process.exit(1);

// A1 — the pane is genuinely on screen before it is asked anything about itself.
show(
  await probe.read({
    question: 'the Activity section is visible and has height',
    read: `(() => { const s=document.querySelector('${PANE}');
      return s && !s.hidden ? Math.round(s.getBoundingClientRect().height) : 0; })()`,
    control: `document.querySelectorAll('section.screen').length`,
  }),
);

// A2 — the pane drew exactly one of its five states. Counting both the table and the state card is
// the point: "no rows" and "no card" are the same number if only one of them is counted.
const shape = show(
  await probe.read({
    question: 'rows drawn, state cards drawn, and which state id',
    read: `(() => { const s=document.querySelector('${PANE}');
      if (!s) return null;
      const card = s.querySelector('.activity-state');
      return { rows: s.querySelectorAll('.activity-row').length,
               cards: s.querySelectorAll('.activity-state').length,
               state: card ? card.dataset.state : 'A5',
               chips: s.querySelectorAll('.activity-chip').length,
               donuts: s.querySelectorAll('.activity-donut').length }; })()`,
    control: `document.querySelectorAll('${PANE}').length`,
    settle: { until: (v) => v && (v.rows > 0 || v.cards > 0), within: 6000 },
  }),
);

const seen = shape.value ?? {};
check(
  'exactly one state is drawn — a table or a card, never both and never neither',
  (seen.rows > 0) !== (seen.cards > 0),
  `rows=${seen.rows} cards=${seen.cards} state=${seen.state}`,
);

// A3 — the styles actually applied. The DOM double has no cascade, so this is the half it cannot
// see, and this project has already shipped a screen whose every icon was an empty ring.
show(
  await probe.read({
    question: 'the layout is the two-column grid the design draws, with a real column width',
    read: `(() => { const l=document.querySelector('${PANE} .activity-layout');
      if (!l) return null;
      const cs=getComputedStyle(l);
      return { display: cs.display, columns: cs.gridTemplateColumns }; })()`,
    control: `document.querySelectorAll('${PANE} .activity-layout, ${PANE} .activity-state').length`,
  }),
);

// A4 — every custom property this pane asks for resolves to something. An undefined token is not
// an error: it silently paints nothing, which is how the design's violet accent was never once
// drawn.
//
// The list is **read out of the loaded stylesheet**, not typed here. The first version of this
// check carried its own array of ten names; the pane's CSS was then corrected to use the tokens
// that actually exist, and the probe went on reporting the three old names as broken — a stale
// second copy of the very thing under test, reporting a fault that had been fixed. Same family as
// the test that models instead of calls. One home: the stylesheet says which tokens the pane uses.
show(
  await probe.read({
    question: 'tokens the Activity rules reference that resolve to an empty string',
    read: `(() => {
      const root = getComputedStyle(document.documentElement);
      const wanted = new Set();
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch { continue; }
        for (const rule of rules || []) {
          if (!rule.selectorText || !rule.selectorText.includes('.activity-')) continue;
          for (const m of rule.cssText.matchAll(/var\\((--[a-z0-9-]+)/g)) wanted.add(m[1]);
        }
      }
      return { referenced: wanted.size,
               empty: [...wanted].filter(n => root.getPropertyValue(n).trim() === '') }; })()`,
    // The control is the count of tokens found at all: an empty `empty` list over a `referenced`
    // of zero is a stylesheet the scan could not read, which is the clean-looking wrong answer.
    control: `(() => { let n=0; for (const s of document.styleSheets) { let r; try { r=s.cssRules; } catch { continue; }
      for (const rule of r||[]) if (rule.selectorText && rule.selectorText.includes('.activity-')) n++; } return n; })()`,
  }),
);

// A5 — the page body must not scroll sideways; wide content scrolls inside its own container.
show(
  await probe.read({
    question: 'the table scrolls inside itself rather than widening the page',
    read: `(() => { const t=document.querySelector('${PANE} .activity-table');
      const page=document.querySelector('#page') || document.body;
      return { tableOverflowX: t ? getComputedStyle(t).overflowX : 'no table',
               pageScrollsSideways: page.scrollWidth > page.clientWidth + 1 }; })()`,
    control: `document.querySelectorAll('${PANE}').length`,
  }),
);

// A6 — the nav row is no longer marked unbuilt. The `unbuilt` class drives both the sidebar's dimmed
// row and its "— not built yet" accessible name, so this is one read for two claims.
show(
  await probe.read({
    question: 'the Activity nav row is not marked unbuilt, and how many rows still are',
    read: `(() => {
      const rows=[...document.querySelectorAll('.nav-row')];
      const mine=rows.find(r => (r.textContent||'').trim().startsWith('Activity'));
      return { activityUnbuilt: mine ? mine.className.includes('unbuilt') : null,
               stillUnbuilt: rows.filter(r => r.className.includes('unbuilt'))
                 .map(r => (r.textContent||'').trim()) }; })()`,
    control: `document.querySelectorAll('.nav-row').length`,
  }),
);

// A7 — the export control is an element, counted, not a word found in the copy. The pane's own
// empty-state sentences contain the word "log"; a text scan would match them.
show(
  await probe.presence({
    question: 'the export affordance is a real control',
    controls: `${PANE} .activity-export`,
    control: `document.querySelectorAll('${PANE}').length`,
  }),
);

console.log(
  `\n${failures === 0 ? 'OK' : `${failures} FAILURE(S)`} — every reading above carries its control\n`,
);
process.exit(failures === 0 ? 0 : 1);
