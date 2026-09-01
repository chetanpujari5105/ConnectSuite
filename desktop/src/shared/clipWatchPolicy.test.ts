import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  skipReason,
  nextIntervalMs,
  MARKER_TYPES,
  MIN_INTERVAL_MS,
  MAX_INTERVAL_MS,
  DUTY_CYCLE,
} from './clipWatchPolicy';

/**
 * The watcher's two decisions, tested where they live.
 *
 * The marker half is the one that matters: this is the code standing between a password manager and
 * the network, and its first version could not have worked. It read the marker's *value* — which
 * the convention leaves empty — so it returned false for every real concealed clip ever written,
 * and its control passed only because the control wrote a value nothing in the wild writes. The
 * fixture below is built from the measured shape rather than from the convention's documentation.
 */

const none = new Set<string>();

test('every marker type is honoured, and each is named in the reason', () => {
  assert.deepEqual(
    MARKER_TYPES.map((type) => skipReason('some text', new Set([type]), false)),
    ['concealed', 'transient', 'auto-generated'],
  );
});

test('CONTROL — the same text with no marker is sendable', () => {
  // The row that makes the test above mean something. Without it, a `skipReason` that refused
  // everything would look like perfect protection.
  assert.equal(skipReason('some text', none, false), null);
});

test('a concealed clip that is also too large is reported as concealed', () => {
  // Two true statements, and the order is a decision. "That entry is over the 64 KB limit" about
  // somebody's password would be the wrong one of the two to write down, and the counters this
  // feeds would then say the watcher refused a big clip when it refused a secret.
  assert.equal(skipReason('x'.repeat(200_000), new Set([MARKER_TYPES[0]]), true), 'concealed');
  assert.equal(skipReason('x'.repeat(200_000), none, true), 'too large');
});

test('an empty clipboard is a skip and not an error', () => {
  assert.equal(skipReason('', none, false), 'empty');
  // …and empty is checked after the markers, so a cleared concealed clip still reads as concealed
  // rather than as ordinary emptiness.
  assert.equal(skipReason('', new Set([MARKER_TYPES[0]]), false), 'concealed');
});

test('an unknown marker on the pasteboard does not silently make a clip sendable or unsendable', () => {
  // Chromium surfaces plenty of types we have no opinion about. The rule is an allowlist of things
  // that *stop* a send, so an unrecognised type must fall through to the ordinary decision.
  assert.equal(skipReason('some text', new Set(['org.chromium.web-custom-data']), false), null);
});

test('the poll interval holds a 1% duty cycle, with a floor and a ceiling', () => {
  // The measured medians from Slice 13, run through the real function.
  assert.equal(nextIntervalMs(0.0010), MIN_INTERVAL_MS, 'an empty clipboard cannot poll faster than the floor');
  assert.equal(nextIntervalMs(0.1008), MIN_INTERVAL_MS, '64 KB — our own cap — sits at the floor');
  assert.equal(nextIntervalMs(2.0355), MIN_INTERVAL_MS, '1 MB still sits at the floor');
  assert.equal(nextIntervalMs(37.2974), 3730, '20 MB backs off to 3.7 s');
  assert.equal(nextIntervalMs(500), MAX_INTERVAL_MS, 'a pathological read is capped, not unbounded');
});

test('the interval spends the budget it claims, except where a bound binds — and the bounds are named', () => {
  // The control on the numbers above: asserting what the function returns proves only that it is
  // consistent with itself. This asserts the *property* those numbers exist for, which is the thing
  // an edit could break while keeping every number green.
  //
  // It also found the honest limit. Above a **50 ms** read the ceiling binds and the duty cycle is
  // exceeded — `MAX_INTERVAL_MS` is a deliberate cap on how unresponsive the watcher may become,
  // and it is paid for in budget. That is a real trade and it is asserted rather than hidden:
  // without the ceiling a 200 MB clipboard would push the interval to 37 seconds, and the person
  // who copies a URL immediately afterwards would wait most of a minute for it to be noticed.
  for (const readMs of [0.001, 0.1, 2, 37.3]) {
    const interval = nextIntervalMs(readMs);
    const spent = readMs / interval;
    assert.ok(
      spent <= DUTY_CYCLE + 1e-9 || interval === MIN_INTERVAL_MS,
      `a ${readMs}ms read at ${interval}ms spends ${(spent * 100).toFixed(2)}% — over budget below the ceiling`,
    );
  }

  // Where the ceiling binds, the cost is bounded and stated rather than merely exceeded.
  assert.equal(nextIntervalMs(50), MAX_INTERVAL_MS, '50 ms is exactly where the ceiling starts to bind');
  assert.equal(50 / MAX_INTERVAL_MS, DUTY_CYCLE, 'and at that point the budget is met exactly');
  assert.equal(nextIntervalMs(100) , MAX_INTERVAL_MS);
  assert.equal(100 / nextIntervalMs(100), 0.02, 'a 100 ms read costs 2% — twice the budget, capped, and known');
});
