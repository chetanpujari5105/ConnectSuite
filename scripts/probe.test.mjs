/**
 * The enforcement point for `probe.mjs`, and the reason it is a mechanism rather than a fourth
 * restatement of a rule this repo has already written down three times and broken three times.
 *
 * Two halves:
 *
 * 1. **Fixtures** — the helper must refuse a missing control, must mark a deadline unreportable,
 *    and must error on a selector that matches nothing, matches twice, or matches something hidden.
 *    A matcher without fixtures is a rule you are guessing about (`no-force-stop.sh`, defect 41).
 * 2. **The scan** — nothing under `scripts/` may call `Runtime.evaluate` except `probe.mjs`. One
 *    home for the thing and a check that fails when a second appears, same shape as
 *    `FsDeleteGuardTest` and `stylesheets.test.ts`.
 *
 * Run: `node --test scripts/probe.test.mjs`
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProbe, ProbeControlFailure, STOPPED, format, formatAct, PRELUDE } from './probe.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * A fake page: a map of expression → value, or a thrower.
 *
 * Deliberately not a DOM. The three faults this guards are about *what the instrument does with an
 * answer*, and every one of them is reproducible without a browser.
 */
function fakePage(answers) {
  const asked = [];
  const evaluate = async (expression) => {
    asked.push(expression);
    if (expression === PRELUDE) return 'ok';
    const answer = answers[expression];
    if (typeof answer === 'function') return answer();
    if (answer === undefined) throw new Error(`fake page has no answer for: ${expression}`);
    return answer;
  };
  return { evaluate, asked };
}

/** A clock that advances only when the probe sleeps, so deadline tests do not take real seconds. */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    advance: (ms) => {
      t += ms;
    },
  };
}

// --- fixture 1: a control that fails must throw, not return -----------------------------------

test('fixture — a control returning 0 throws CONTROL FAILED and yields no value', async () => {
  const page = fakePage({ 'rows()': 0, 'tableExists()': 0 });
  const probe = createProbe(page.evaluate);
  await assert.rejects(
    () => probe.read({ question: 'how many rows?', read: 'rows()', control: 'tableExists()' }),
    (error) => {
      assert.ok(error instanceof ProbeControlFailure);
      assert.match(error.message, /CONTROL FAILED/);
      assert.match(error.message, /The reading was not taken/);
      return true;
    },
  );
  // The read must never have run: a control that failed means the query cannot see what it is for.
  assert.equal(page.asked.includes('rows()'), false, 'the read ran despite a failed control');
});

test('fixture — control is required and has no default', async () => {
  const probe = createProbe(fakePage({}).evaluate);
  await assert.rejects(
    () => probe.read({ question: 'how many rows?', read: 'rows()' }),
    /`control` is required and has no default/,
  );
});

test('control for the fixture above — a passing control returns the reading normally', async () => {
  // Without this, "it throws" could be true of every input and the fixture would prove nothing.
  const page = fakePage({ 'rows()': 600, 'tableExists()': 1 });
  const probe = createProbe(page.evaluate);
  const result = await probe.read({ question: 'how many rows?', read: 'rows()', control: 'tableExists()' });
  assert.equal(result.value, 600);
  assert.equal(result.control, 1);
  assert.equal(result.stopped, STOPPED.IMMEDIATE);
  assert.equal(result.reportable, true);
});

// --- fixture 2: a deadline is not a reading ---------------------------------------------------

test('fixture — a settle that never comes true returns stopped: deadline and is not reportable', async () => {
  const clock = fakeClock();
  const page = fakePage({ 'rows()': 200, 'tableExists()': 1 });
  const probe = createProbe(page.evaluate, { now: clock.now, sleep: clock.sleep });

  const result = await probe.read({
    question: 'did the folder page past 200?',
    read: 'rows()',
    control: 'tableExists()',
    settle: { until: (n) => n > 200, within: 5000, poll: 500 },
  });

  assert.equal(result.stopped, STOPPED.DEADLINE);
  assert.equal(result.reportable, false, 'a deadline must never be quotable as a finding');
  assert.equal(result.value, 200);
  assert.ok(result.waitedMs >= 5000, `waited ${result.waitedMs}ms`);
  assert.match(format(result), /NOT REPORTABLE/);
});

test('control for the fixture above — a settle that does come true is reportable', async () => {
  const clock = fakeClock();
  let rows = 200;
  const page = fakePage({
    'rows()': () => {
      rows += 200;
      return rows;
    },
    'tableExists()': 1,
  });
  const probe = createProbe(page.evaluate, { now: clock.now, sleep: clock.sleep });
  const result = await probe.read({
    question: 'did the folder page past 200?',
    read: 'rows()',
    control: 'tableExists()',
    settle: { until: (n) => n > 200, within: 5000, poll: 500 },
  });
  assert.equal(result.stopped, STOPPED.SETTLED);
  assert.equal(result.reportable, true);
  assert.doesNotMatch(format(result), /NOT REPORTABLE/);
});

test('fixture — a wait with no deadline cannot be expressed', async () => {
  const probe = createProbe(fakePage({}).evaluate);
  await assert.rejects(
    () =>
      probe.read({
        question: 'q',
        read: 'r()',
        control: 'c()',
        settle: { until: () => true },
      }),
    /settle.within \(ms\) is required/,
  );
});

// --- fixture 3: the selector must resolve to exactly one visible node --------------------------
//
// These assert the PRELUDE's behaviour by running its `one()` against a stub DOM, because that is
// the code the page actually executes. Re-writing the rule here would be testing a copy — the
// mistake `MediaPayloadsTest` made and was fixed for.

function runPreludeOne(nodes) {
  const globalThisStub = {};
  const document = { querySelectorAll: () => nodes };
  // eslint-disable-next-line no-new-func
  new Function('globalThis', 'document', PRELUDE)(globalThisStub, document);
  return (sel) => globalThisStub.__probe.one(sel);
}

const visibleNode = {
  hidden: false,
  checkVisibility: () => true,
  getBoundingClientRect: () => ({ height: 40, width: 100 }),
};
const hiddenNode = {
  hidden: true,
  checkVisibility: () => false,
  getBoundingClientRect: () => ({ height: 0, width: 0 }),
};

test('fixture — a selector matching nothing throws instead of yielding zero', () => {
  const one = runPreludeOne([]);
  assert.throws(() => one('section[data-screen="files"]'), /PROBE_NO_MATCH/);
});

test('fixture — a selector matching two nodes throws instead of taking document order', () => {
  // The app window and the pane both carry [data-screen], and the window comes first. That read
  // once reported a hidden pane as visible, with the sidebar's buttons attached to it.
  const one = runPreludeOne([visibleNode, visibleNode]);
  assert.throws(() => one('[data-screen="files"]'), /PROBE_AMBIGUOUS: 2 nodes/);
});

test('fixture — a hidden node throws instead of reporting clientHeight 0', () => {
  const one = runPreludeOne([hiddenNode]);
  assert.throws(() => one('section[data-screen="photos"]'), /PROBE_NOT_VISIBLE/);
});

test('control for the three fixtures above — exactly one visible node resolves', () => {
  const one = runPreludeOne([visibleNode]);
  assert.equal(one('section[data-screen="files"]'), visibleNode);
});

// --- text matching is refused for presence questions -------------------------------------------

test('a text matcher is refused, and says why', async () => {
  const probe = createProbe(fakePage({}).evaluate);
  await assert.rejects(
    () => probe.read({ question: 'is there an upload affordance?', read: 'r()', control: 'c()', text: /drop|upload/ }),
    /text matching is refused/,
  );
});

test('presence counts controls instead', async () => {
  const page = fakePage({
    [`__probe.count(${JSON.stringify('#files-drop button, #files-drop input[type=file]')})`]: 0,
    'paneVisible()': 1,
  });
  const probe = createProbe(page.evaluate);
  const result = await probe.presence({
    question: 'is there an upload affordance?',
    controls: '#files-drop button, #files-drop input[type=file]',
    control: 'paneVisible()',
  });
  assert.equal(result.value, 0);
  assert.equal(result.reportable, true, 'zero controls with a passing control is a real negative');
});

// --- a stimulus must report its effect ---------------------------------------------------------

test('act requires an expect, because a stimulus without one is a request not a measurement', async () => {
  const probe = createProbe(fakePage({}).evaluate);
  await assert.rejects(
    () => probe.act({ what: 'press BACK', run: 'back()' }),
    /`expect` is required/,
  );
});

test('act reports a stimulus that did not land as not landed', async () => {
  const clock = fakeClock();
  const page = fakePage({ 'back()': 1, 'cancelled()': false });
  const probe = createProbe(page.evaluate, { now: clock.now, sleep: clock.sleep });
  const result = await probe.act({
    what: 'press BACK to cancel the picker',
    run: 'back()',
    expect: 'cancelled()',
    within: 1000,
  });
  // BACK navigates up in DocumentsUI; it does not cancel. The absent log line was never a reading.
  assert.equal(result.landed, false);
  assert.equal(result.stopped, STOPPED.DEADLINE);
});

// --- the scan ----------------------------------------------------------------------------------

/** Every `.mjs` under `scripts/`, recursively, with its text. */
function scriptSources(dir = HERE, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) scriptSources(full, out);
    else if (entry.name.endsWith('.mjs')) out.push({ name: entry.name, full, text: readFileSync(full, 'utf8') });
  }
  return out;
}

/**
 * The call, matched as a call rather than as a mention.
 *
 * `no-force-stop.sh`'s first matcher denied every command that merely *talked* about the rule,
 * including the doc carrying its argument — a matcher that forbids writing its own other half. So
 * this looks for the method name in the position a CDP call puts it, and the fixture below proves
 * it does not fire on prose about it.
 */
const CDP_CALL = /method\s*:\s*['"]Runtime\.evaluate['"]/;

test('the scan — only probe.mjs may call Runtime.evaluate', () => {
  const offenders = scriptSources()
    .filter((f) => f.name !== 'probe.mjs' && f.name !== 'probe.test.mjs')
    .filter((f) => CDP_CALL.test(f.text))
    .map((f) => f.name);

  assert.deepEqual(
    offenders,
    [],
    `these call Runtime.evaluate directly instead of going through probe.mjs: ${offenders.join(', ')}. ` +
      'A second home for the DOM read is a second place the control can be skipped.',
  );
});

test('control for the scan — it can see a violation when there is one', () => {
  // Without this, the scan passes identically against a regex that matches nothing.
  const planted = `ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: {} }));`;
  assert.equal(CDP_CALL.test(planted), true, 'the scan cannot see a real violation');
});

test('control for the scan — prose about Runtime.evaluate is not a violation', () => {
  const prose = '// Everything goes through probe.mjs rather than calling Runtime.evaluate by hand.';
  assert.equal(CDP_CALL.test(prose), false, 'the scan fires on a mention, which forbids documenting itself');
});

test('the scan actually looked at some files', () => {
  // An empty file list would make the scan vacuously green — the same shape as an empty
  // accessibility query reading as evidence.
  const files = scriptSources();
  assert.ok(files.length >= 3, `the scan found only ${files.length} scripts`);
  assert.ok(files.some((f) => f.name === 'probe.mjs'), 'probe.mjs itself was not seen by the scan');
});

// ---- format vs formatAct ---------------------------------------------------------------------

/**
 * The fixture is the sentence that actually got printed, over a stimulus that had landed.
 *
 * A guard written after a failure and never run against that failure has not been tested against
 * the one case it is known to have missed.
 */
test('fixture — formatting an act result as a read is refused', () => {
  const acted = { what: 'route to calls', landed: true, waitedMs: 26, stopped: STOPPED.SETTLED };
  assert.throws(() => format(acted), /that is an `act` result/);
});

test('control for the fixture above — a real read still formats', () => {
  const read = {
    question: 'how many rows',
    value: 50,
    control: 3,
    polls: 1,
    waitedMs: 8,
    stopped: STOPPED.SETTLED,
    reportable: true,
  };
  assert.match(format(read), /how many rows → 50/);
  assert.doesNotMatch(format(read), /NOT REPORTABLE/);
});

test('formatAct says landed, and says plainly when it did not', () => {
  const landed = { what: 'route to calls', landed: true, waitedMs: 26, stopped: STOPPED.SETTLED };
  const missed = { what: 'route to calls', landed: false, waitedMs: 5000, stopped: STOPPED.DEADLINE };
  assert.match(formatAct(landed), /route to calls → landed/);
  assert.doesNotMatch(formatAct(landed), /NOT A PREMISE/);
  assert.match(formatAct(missed), /DID NOT LAND/);
  assert.match(formatAct(missed), /NOT A PREMISE/);
});

// --- onScreen measures against the clipping scroller, not the viewport -------------------------

/**
 * Runs the PRELUDE's `onScreen` against a stub DOM.
 *
 * The stub is the shape that actually broke it: an element low in a pane, a `#page` scroll port
 * whose bottom sits above the viewport bottom because the dock is under it, and a viewport taller
 * than both. The rule under test is the one the page executes, not a copy of it.
 */
function runPreludeOnScreen({ rect, ancestors, viewportH }) {
  // The rect is mutable so `scrollIntoView` can actually move it, the way a real scroll does. A
  // stub whose `scrollIntoView` did nothing would make every clipped element read as `stranded`,
  // which is a different wrong answer rather than no answer.
  let current = rect;
  const el = {
    hidden: false,
    checkVisibility: () => true,
    getBoundingClientRect: () => current,
    scrollIntoView: () => {
      const port = ancestors.find((a) => a.overflowY && a.overflowY !== 'visible');
      if (!port) return;
      const top = port.rect.top + (port.rect.bottom - port.rect.top - rect.height) / 2;
      current = { top, bottom: top + rect.height, height: rect.height };
    },
    parentElement: null,
  };
  let tail = el;
  for (const a of ancestors) {
    const node = {
      getBoundingClientRect: () => a.rect,
      __overflowY: a.overflowY ?? 'visible',
      parentElement: null,
      scrollTop: 0,
      scrollLeft: 0,
      scrollHeight: a.scrollHeight ?? 100,
      clientHeight: a.clientHeight ?? 100,
      id: a.id ?? '',
      tagName: 'DIV',
      className: a.className ?? 'page',
    };
    tail.parentElement = node;
    tail = node;
  }
  const documentElement = {};
  tail.parentElement = documentElement;

  const globalThisStub = {
    window: { innerHeight: viewportH },
    getComputedStyle: (n) => ({ overflowY: n.__overflowY ?? 'visible', overflowX: 'visible' }),
  };
  const document = { querySelectorAll: () => [el], documentElement };
  // eslint-disable-next-line no-new-func
  new Function('globalThis', 'document', 'window', 'getComputedStyle', PRELUDE)(
    globalThisStub,
    document,
    globalThisStub.window,
    globalThisStub.getComputedStyle,
  );
  return globalThisStub.__probe.onScreen('#anything');
}

/**
 * The fixture is the measurement that was actually wrong, with its real numbers.
 *
 * Calls pane, 2026-09-05: viewport 841, the app-call note at 728–826, and `#page` — `overflow-y:
 * auto` — ending at 795 because the dock sits under it. 31px of the sentence was not drawn and
 * `onScreen` returned `visible` with `fraction: 1`.
 */
test('fixture — an element clipped by a scroll port is not reported as fully visible', () => {
  const result = runPreludeOnScreen({
    rect: { top: 728, bottom: 826, height: 98 },
    ancestors: [
      { rect: { top: 152, bottom: 795 }, overflowY: 'auto', clientHeight: 643, scrollHeight: 737 },
    ],
    viewportH: 841,
  });
  assert.equal(result.atRest.fraction, 0.68, '67 of 98 pixels are inside the port, not 98');
  assert.equal(result.atRest.clipBottom, 795, 'and it must say where the clipping happened');
  assert.notEqual(result.verdict, 'visible', 'the whole point: this was `visible` before');
  // `reachable` is the honest verdict here — the note IS one scroll away. What was wrong was
  // calling it `visible`, which says a reader sees it without doing anything.
  assert.equal(result.verdict, 'reachable');
});

test('control for the fixture above — the same element inside a port that contains it is visible', () => {
  const result = runPreludeOnScreen({
    rect: { top: 728, bottom: 826, height: 98 },
    ancestors: [
      { rect: { top: 152, bottom: 841 }, overflowY: 'auto', clientHeight: 689, scrollHeight: 689 },
    ],
    viewportH: 841,
  });
  assert.equal(result.atRest.fraction, 1);
  assert.equal(result.verdict, 'visible');
});

test('control — an ancestor with visible overflow does not clip, however small its box', () => {
  // A short ancestor with `overflow: visible` does not clip its children; treating it as a port
  // would report every card inside a compact wrapper as cut.
  const result = runPreludeOnScreen({
    rect: { top: 100, bottom: 200, height: 100 },
    ancestors: [{ rect: { top: 100, bottom: 120 }, overflowY: 'visible' }],
    viewportH: 841,
  });
  assert.equal(result.atRest.fraction, 1);
  assert.equal(result.verdict, 'visible');
});
