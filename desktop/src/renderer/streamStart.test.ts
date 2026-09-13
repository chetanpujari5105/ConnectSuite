import { test } from 'node:test';
import assert from 'node:assert/strict';
const { StartRequestGate, actionFor, MIN_GAP_MS, IN_FLIGHT_TIMEOUT_MS } = require('./streamStart') as {
  StartRequestGate: new (now: () => number, minGap?: number, timeout?: number) => {
    may(): { ask: true; attempt: number } | { ask: false; reason: 'in-flight'; outstandingForMs: number }
      | { ask: false; reason: 'too-soon'; waitMs: number };
    sent(): void; settled(): void; snapshot(): { attempts: number; inFlight: boolean };
  };
  actionFor: (a: { config: { ptsUs: number; bytes: number } | null; sessionRunning: boolean }) => string;
  MIN_GAP_MS: number; IN_FLIGHT_TIMEOUT_MS: number;
};

/**
 * The start contract: one request in flight, a floor between attempts, and three outcomes for an
 * answer rather than two.
 *
 * These reach the **decision**. What they cannot reach is the wiring — whether `float.ts` actually
 * asks once its listeners are up, and whether `main.ts` answers — and that is stated here rather
 * than discovered later: it is the `LinkWaitStatus` split, where eleven green tests sat over a
 * feature that had never worked because no test could see the write. The wiring's proof is on
 * hardware, with `delayFloatListeners` forcing the race to lose.
 */

// ---- the gate -----------------------------------------------------------------------------------

test('the first ask goes', () => {
  const gate = new StartRequestGate(() => 0);
  assert.deepEqual(gate.may(), { ask: true, attempt: 1 });
});

test('a second ask while one is in flight is refused, not queued', () => {
  // The storm the obvious fix for defect 105 would have produced: asking on every dropped frame is
  // sixty asks a second. The answer to the outstanding request is the answer to this one too.
  let t = 0;
  const gate = new StartRequestGate(() => t);
  gate.sent();
  t = 40;
  const v = gate.may();
  assert.equal(v.ask, false);
  assert.equal(v.ask === false && v.reason, 'in-flight');
  assert.equal(v.ask === false && v.reason === 'in-flight' && v.outstandingForMs, 40);
});

test('an answer that never comes releases the gate rather than wedging it shut forever', () => {
  // A rate limit whose failure mode is a deadlock is worse than none: the window would never ask
  // again, which is defect 105's silence with a limiter in front of it.
  let t = 0;
  const gate = new StartRequestGate(() => t);
  gate.sent();
  t = IN_FLIGHT_TIMEOUT_MS - 1;
  assert.equal(gate.may().ask, false);
  t = IN_FLIGHT_TIMEOUT_MS;
  assert.equal(gate.may().ask, true);
});

test('after an answer, the next ask waits out the floor', () => {
  let t = 0;
  const gate = new StartRequestGate(() => t);
  gate.sent();
  t = 100;
  gate.settled();
  const v = gate.may();
  assert.equal(v.ask, false);
  assert.equal(v.ask === false && v.reason, 'too-soon');
  assert.equal(v.ask === false && v.reason === 'too-soon' && v.waitMs, MIN_GAP_MS);
});

test('control — once the floor has passed, the ask goes again', () => {
  let t = 0;
  const gate = new StartRequestGate(() => t);
  gate.sent();
  t = 100;
  gate.settled();
  t = 100 + MIN_GAP_MS;
  assert.deepEqual(gate.may(), { ask: true, attempt: 2 });
});

test('a refusal carries a number, because a bare "no" cannot be logged usefully', () => {
  // Every refusal says how long it has been waiting or how long to wait. "Refused" on its own is
  // the same non-evidence as a count with no denominator.
  let t = 0;
  const gate = new StartRequestGate(() => t);
  gate.sent();
  t = 7;
  const inFlight = gate.may();
  assert.ok(inFlight.ask === false && typeof inFlight.outstandingForMs === 'number');
  gate.settled();
  const tooSoon = gate.may();
  assert.ok(tooSoon.ask === false && typeof tooSoon.waitMs === 'number');
});

test('asks are counted, so a storm is visible as a number', () => {
  let t = 0;
  const gate = new StartRequestGate(() => t);
  for (let i = 0; i < 3; i += 1) {
    gate.sent();
    t += 10;
    gate.settled();
    t += MIN_GAP_MS;
  }
  assert.equal(gate.snapshot().attempts, 3);
  assert.equal(gate.snapshot().inFlight, false);
});

// ---- the answer ---------------------------------------------------------------------------------

test('a retained config is configured with', () => {
  assert.equal(actionFor({ config: { ptsUs: 1, bytes: 40 }, sessionRunning: true }), 'configure');
});

test('THE SPLIT — no config with no session is not the same as no config with a session', () => {
  // Collapsing these is the empty-versus-failed mistake: one is "nothing is mirroring, nothing is
  // wrong" and the other is "something IS mirroring and we have no parameter sets", which is the
  // real gap. Asking again in the first case is a storm against an idle phone.
  assert.equal(actionFor({ config: null, sessionRunning: false }), 'wait-for-session');
  assert.equal(actionFor({ config: null, sessionRunning: true }), 'ask-again');
});

test('null config is an answer, and every answer maps to exactly one action', () => {
  const answers = [
    { config: { ptsUs: 0, bytes: 1 }, sessionRunning: true },
    { config: { ptsUs: 0, bytes: 1 }, sessionRunning: false },
    { config: null, sessionRunning: true },
    { config: null, sessionRunning: false },
  ];
  const actions = answers.map(actionFor);
  assert.equal(actions.length, 4);
  actions.forEach((a) => assert.ok(['configure', 'wait-for-session', 'ask-again'].includes(a)));
  // A retained config is usable whether or not a session is running — it describes the stream, and
  // the decoder can be built from it before the next frame arrives.
  assert.equal(actions[0], 'configure');
  assert.equal(actions[1], 'configure');
});
