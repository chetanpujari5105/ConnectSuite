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
import { createProbe, ProbeControlFailure, STOPPED, format, PRELUDE } from './probe.mjs';

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
