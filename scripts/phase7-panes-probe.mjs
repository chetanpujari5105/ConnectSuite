#!/usr/bin/env node
/**
 * The Phase 7 design-pass readings, taken through `probe.mjs`.
 *
 * ### Why this file exists rather than the ad-hoc script that produced these numbers first
 *
 * They were read with a hand-rolled CDP eval in a scratchpad, and the numbers went into
 * `docs/design-departures.md` and into an evidence README. `probe.test.mjs` scans `scripts/` and
 * refuses a `Runtime.evaluate` outside `probe.mjs` — and it passed, because a scratchpad file is
 * not under `scripts/`.
 *
 * That is `CLAUDE.md`'s own paragraph about where the hole lives: *"it lives permanently in the
 * one-off read… the next sighting will be the seventh ad-hoc grep, written by someone who knows
 * this rule and is not thinking about it."* Written by the person who had just read the rule, in the
 * same sitting. So the readings that were **written down** are re-taken here, each with a control
 * that must come back non-trivially true.
 *
 * ### What is deliberately not in here
 *
 * The screenshots. Pixels are not a number and `shot.mjs` quotes none — its two checks (the page is
 * not zoomed, and the routed screen is the one that ended up visible) are preconditions on an image,
 * not findings. Ad-hoc poking stays ad-hoc; the moment a number is going to be written down, it
 * comes through here.
 *
 * Run with the app up on :9222 and a phone connected:
 *   node scripts/phase7-panes-probe.mjs
 */
import { openProbe, STOPPED } from './probe.mjs';

const probe = await openProbe();

/** Routes and waits for the screen to actually be the one asked for, before any reading. */
async function routeTo(id, settingsPane) {
  const call = settingsPane
    ? `shell.route(${JSON.stringify(id)}, ${JSON.stringify(settingsPane)});`
    : `shell.route(${JSON.stringify(id)});`;
  const acted = await probe.act({
    what: `route to ${id}`,
    run: call,
    // The stimulus reports its **effect**, not its request: the screen has to be the one on show.
    // `shell.route` on a blocked route is a no-op, which would leave the previous pane up and every
    // reading below attributed to the wrong screen.
    expect: `document.querySelector('section.screen[data-screen="${id}"]').hidden === false && shell.screen === ${JSON.stringify(id)}`,
  });
  if (!acted.landed) throw new Error(`did not land on ${id} after ${acted.waitedMs}ms`);
}

const findings = [];
const record = (r) => {
  findings.push(r);
  // `r.control`, not `r.controlValue` — `finish()` renames it. The first version printed the wrong
  // field and every line read `control: undefined` over readings whose controls had all passed,
  // which is an instrument lying about its own rigour in the direction of looking worse. It would
  // have been worse the other way round.
  console.log(
    `${r.reportable ? 'ok' : 'NOT REPORTABLE'}  ${r.question}\n    value: ${JSON.stringify(r.value)}` +
      `\n    control: ${JSON.stringify(r.control)}  (stopped: ${r.stopped}, polls: ${r.polls})`,
  );
};

/*
 * **The instrument's own bound, printed before any width.**
 *
 * A grid column width is a fraction of the content column, and the content column is narrower by
 * the width of a scrollbar when the page has one. Two honest readings of the same grid therefore
 * differ by ~11px depending only on how much content happens to be in the pane — which is exactly
 * the *two readings, one fact* family, with neither of them wrong. So the viewport and the
 * scrollbar are reported here, and every `1fr` figure below is to be read against them.
 */
record(
  await probe.read({
    question: 'the viewport, and whether the page is showing a scrollbar (every 1fr below depends on it)',
    read: `(function () {
      var page = __probe.one('.page');
      return { inner: innerWidth, outer: outerWidth,
               scrollbarPx: page.offsetWidth - page.clientWidth,
               pageScrolls: page.scrollHeight > page.clientHeight };
    })()`,
    // A zoomed page would make every measurement below wrong with nothing on screen saying so.
    control: `innerWidth === outerWidth ? innerWidth : 0`,
  }),
);

// ---- Calls -------------------------------------------------------------------------------------

await routeTo('calls');
record(
  await probe.read({
    question: 'Calls: the grid’s three column widths, against the handoff’s 300px 1fr 300px',
    read: `getComputedStyle(__probe.one('.calls-grid')).gridTemplateColumns`,
    // The log has rows in it, so the grid is populated and not an empty three-column skeleton.
    control: `__probe.count('.call-row')`,
  }),
);
record(
  await probe.presence({
    question: 'Calls: the dialler’s keys — twelve as drawn, plus the delete the design has not got',
    controls: '.dialpad .dialkey',
    control: `__probe.count('.calls-tab')`,
  }),
);
record(
  await probe.presence({
    question: 'Calls: controls the live card offers with no call in progress — must be zero',
    controls: '#call-live button',
    // **The control is the thing that makes this absence a reading.** The pane is drawn and has
    // controls elsewhere; if this were zero too, the query would be reporting a blank screen.
    control: `__probe.count('.calls-dialer button')`,
  }),
);

// ---- Clipboard ---------------------------------------------------------------------------------

await routeTo('clipboard');
record(
  await probe.read({
    question: 'Clipboard: the grid’s two column widths, against the handoff’s 1fr 340px',
    read: `getComputedStyle(__probe.one('.clip-grid')).gridTemplateColumns`,
    control: `__probe.count('.clip-tab')`,
  }),
);
record(
  await probe.presence({
    question: 'Clipboard: the filter strip is three tabs, and neither of them is Favourites or Pinned',
    controls: '.clip-tabs button',
    control: `__probe.count('.clip-actions button')`,
  }),
);

// ---- Settings ----------------------------------------------------------------------------------

await routeTo('settings', 'general');
record(
  await probe.read({
    question: 'Settings: the grid’s three column widths, against the handoff’s 200px 1fr 320px',
    read: `getComputedStyle(__probe.one('.settings-grid')).gridTemplateColumns`,
    control: `__probe.count('.settings-tab')`,
  }),
);
record(
  await probe.presence({
    question: 'Settings: rail panes — six, from three',
    controls: '.settings-rail .settings-tab',
    control: `__probe.count('.settings-body .setting-row')`,
  }),
);

// ---- Overview ----------------------------------------------------------------------------------

await routeTo('overview');
record(
  await probe.presence({
    question: 'Overview: Quick action tiles — the handoff’s eight',
    controls: '.quick-grid .quick-tile',
    control: `__probe.count('.hero-actions button')`,
  }),
);
record(
  await probe.presence({
    question: 'Overview: Recent activity rows — the handoff’s five',
    controls: '.recent-list .recent-row',
    control: `__probe.count('.quick-grid .quick-tile')`,
  }),
);
record(
  await probe.read({
    question: 'Overview: the count beside Quick actions counts what WORKS, with the total beside it',
    read: `__probe.text('#quick-count')`,
    control: `__probe.count('.quick-grid .quick-tile')`,
  }),
);

// ---- Mirror ------------------------------------------------------------------------------------

await routeTo('mirror');
record(
  await probe.presence({
    question: 'Mirror: tool-rail buttons — three since M5 landed (Capture, Refresh, Transfer)',
    controls: '#tool-rail button',
    // The readout is markup rather than a button, so this control is a fact about the same rail
    // that cannot be true only when the buttons are there.
    control: `__probe.count('#tool-rail .readout')`,
  }),
);

const unreportable = findings.filter((f) => f.stopped === STOPPED.DEADLINE);
console.log(
  `\n${findings.length} readings, ${unreportable.length} not reportable ` +
    `(a deadline is where the instrument gave up, not a reading).`,
);
await probe.close();
process.exit(unreportable.length === 0 ? 0 : 1);
