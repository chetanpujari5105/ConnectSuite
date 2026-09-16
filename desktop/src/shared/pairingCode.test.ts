import { test } from 'node:test';
import assert from 'node:assert/strict';
const { pairingCodeState, PAIR_CODE_WARN_MS } = require('./pairingCode.ts');

/**
 * P5. The design draws a countdown; this asserts the thing that is actually true.
 *
 * The countdown was not built, and the reason is measurable rather than a preference: the renderer
 * re-arms the token every 60 s and `armPairing` pushes the expiry out by the full five minutes, so
 * a clock wired to it cannot reach zero while anybody is watching. What CAN happen — and could not
 * be drawn at all before `pairingExpiresAt` reached the renderer — is a Mac that slept with the
 * pairing screen open, showing a picture of a token it will now refuse.
 */

const T0 = 1_760_000_000_000;
const MIN = 60_000;

test('no armed code claims nothing, and still says something', () => {
  // The screen has not made a claim yet. It must not go blank — a QR with no line under it is a
  // code with no stated validity, which is worse than the standing copy.
  for (const none of [null, undefined]) {
    const s = pairingCodeState(none, T0, 'Chetans-MacBook-Pro', '10.0.0.4');
    assert.equal(s.kind, 'none');
    assert.ok(s.text.length > 0);
    assert.equal(s.urgent, false);
  }
});

test('a fresh code keeps the standing copy, and the copy is the useful sentence', () => {
  const s = pairingCodeState(T0 + 5 * MIN, T0, 'Chetans-MacBook-Pro', '10.0.0.4');
  assert.equal(s.kind, 'fresh');
  assert.equal(s.text, 'Chetans-MacBook-Pro at 10.0.0.4 — valid while this code is on screen.');
  assert.equal(s.urgent, false);
  // No number: with the re-arm running there is nothing a number would tell anyone.
  assert.ok(!/\d+s/.test(s.text), s.text);
});

test('an expired code says so, and points at the button', () => {
  const s = pairingCodeState(T0 - 1, T0, 'Chetans-MacBook-Pro', '10.0.0.4');
  assert.equal(s.kind, 'stale');
  assert.equal(s.text, 'This code has expired. Show a fresh code to pair.');
  assert.equal(s.urgent, true);
});

test('the stale sentence does not guess why', () => {
  /*
   * A slept Mac, a busy Mac and a stepped clock all land here and the screen cannot tell them
   * apart. Same discipline as the folder picker: when one result has several causes, nothing is
   * explained afterwards. This asserts the absence of a cause word, which is the claim being made.
   */
  const s = pairingCodeState(T0 - MIN, T0);
  for (const guess of ['sleep', 'slept', 'asleep', 'network', 'Wi-Fi', 'because', 'lid']) {
    assert.ok(!s.text.toLowerCase().includes(guess.toLowerCase()), `${s.text} guesses "${guess}"`);
  }
});

test('the transition into stale is at the instant, not a second either side', () => {
  // The edge is a write, and a state machine fails at its edges — CLAUDE.md's rule about reaching
  // the transition. `now` is a parameter precisely so this test can stand on both sides of it.
  assert.equal(pairingCodeState(T0 + 1, T0).kind, 'expiring');
  assert.equal(pairingCodeState(T0, T0).kind, 'stale');
  assert.equal(pairingCodeState(T0 - 1, T0).kind, 'stale');
});

test('the warn edge is the constant, read from the module rather than retyped', () => {
  // A second expression of the threshold in the test is the failure CLAUDE.md names: the two
  // disagree eventually and the test is the one that is wrong.
  assert.equal(pairingCodeState(T0 + PAIR_CODE_WARN_MS + 1, T0).kind, 'fresh');
  assert.equal(pairingCodeState(T0 + PAIR_CODE_WARN_MS, T0).kind, 'expiring');
});

test('an expiring code shows a real number, and rounds up so it never shows 0s while alive', () => {
  assert.equal(pairingCodeState(T0 + 42_000, T0).secondsLeft, 42);
  assert.ok(pairingCodeState(T0 + 42_000, T0).text.includes('42s'));
  // 1ms left is "1s", not "0s" — a live code reading zero is the screen contradicting itself.
  assert.equal(pairingCodeState(T0 + 1, T0).secondsLeft, 1);
  assert.equal(pairingCodeState(T0, T0).secondsLeft, 0);
});

test('expiring is unreachable while the 60s re-arm runs, which is the point of it', () => {
  /*
   * The re-arm interval is 60 s and the TTL is 5 minutes, so a running renderer never lets the
   * remaining time fall below four minutes. Simulated here rather than asserted as a comment: this
   * walks ten minutes of ticks with the re-arm firing, and nothing ever leaves `fresh`.
   *
   * So a user who sees a number has a stopped timer — which is exactly when the number is worth
   * having, and why this is not the design's countdown.
   */
  let expiresAt = T0 + 5 * MIN;
  const kinds = new Set<string>();
  for (let t = T0; t < T0 + 10 * MIN; t += 1_000) {
    if ((t - T0) % 60_000 === 0) expiresAt = t + 5 * MIN; // the re-arm
    kinds.add(pairingCodeState(expiresAt, t).kind);
  }
  assert.deepEqual([...kinds], ['fresh']);

  // The control: the same walk with the re-arm stopped reaches every other state, so the assertion
  // above is about the re-arm and not about a rule that can only ever return one answer.
  const stopped = new Set<string>();
  for (let t = T0; t < T0 + 10 * MIN; t += 1_000) stopped.add(pairingCodeState(T0 + 5 * MIN, t).kind);
  assert.deepEqual([...stopped].sort(), ['expiring', 'fresh', 'stale']);
});

test('a slept Mac: five minutes of ticks, then a two-hour jump', () => {
  // The case the feature exists for, end to end. Before `pairingExpiresAt` reached the renderer the
  // last line here read "valid while this code is on screen" over a token the Mac would refuse.
  const expiresAt = T0 + 5 * MIN;
  assert.equal(pairingCodeState(expiresAt, T0 + 60_000).kind, 'fresh');
  assert.equal(pairingCodeState(expiresAt, T0 + 2 * 3_600_000).kind, 'stale');
});
