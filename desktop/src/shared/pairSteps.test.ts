import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { pairSteps } = createRequire(import.meta.url)('./pairSteps.ts') as typeof import('./pairSteps');

const states = (over: Parameters<typeof pairSteps>[0]) => pairSteps(over).map((s) => s.state);

test('a fresh code waits on the scan and claims nothing after it', () => {
  assert.deepEqual(states({ sighted: false, paired: false }), ['active', 'waiting', 'waiting', 'waiting']);
});

test('a sighting advances one step, and only one', () => {
  assert.deepEqual(states({ sighted: true, paired: false }), ['done', 'active', 'waiting', 'waiting']);
});

/**
 * The rule this module exists for. mDNS is dropped by client isolation and by some routers, so an
 * absent sighting must never hold the column back when the link itself says the phone is here.
 */
test('a handshake advances the steps a missing sighting would have stalled', () => {
  assert.deepEqual(
    states({ sighted: false, phase: 'connecting', paired: false }),
    ['done', 'done', 'active', 'waiting'],
    'no sighting held the column at step one while the phone was two steps on',
  );
  // The control: the same input without the handshake really does sit at step one.
  assert.deepEqual(states({ sighted: false, phase: null, paired: false })[0], 'active');
});

test('paired is the end state, and every step behind it is done', () => {
  assert.deepEqual(states({ sighted: true, phase: 'connected', paired: true }), ['done', 'done', 'done', 'done']);
});

test('no step is ever drawn as failed — a phone that has not paired has not failed', () => {
  for (const input of [
    { sighted: false, paired: false },
    { sighted: true, paired: false },
    { sighted: false, phase: 'connecting', paired: false },
    { sighted: true, phase: 'connected', paired: true },
  ]) {
    for (const step of pairSteps(input)) {
      assert.ok(
        ['done', 'active', 'waiting'].includes(step.state),
        `${step.id} drew "${step.state}", which is not one of the three`,
      );
    }
  }
});

test('a step prints a fact only once it has one: the fingerprint appears with the handshake', () => {
  const waiting = pairSteps({ sighted: true, paired: false, fingerprint: 'ABCD1234' });
  assert.equal(waiting[2]!.note, null, 'the fingerprint was printed before anything presented one');

  const verifying = pairSteps({ sighted: true, phase: 'connecting', paired: false, fingerprint: 'ABCD1234' });
  assert.equal(verifying[2]!.note, 'ABCD1234');
});

test('the found step names what it knows, and says something when it knows nothing', () => {
  assert.equal(
    pairSteps({ sighted: true, sightedName: 'Galaxy S25', address: '10.0.0.4', paired: false })[1]!.note,
    'Galaxy S25 · 10.0.0.4',
  );
  assert.match(
    pairSteps({ sighted: true, paired: false })[1]!.note ?? '',
    /scanned this code/,
    'a sighting with no name printed nothing at all',
  );
});

/**
 * `34:12152`. With no network the card replaces the code with an explanation, and this column sits
 * two inches from it — *Waiting for a scan* there would be the two-writers failure across two
 * surfaces: each sentence current, the pair contradicting.
 */
test('with nothing to scan, the first step says what it is actually waiting for', () => {
  const blocked = pairSteps({ sighted: false, paired: false, scannable: false });
  assert.equal(blocked[0]!.label, 'Waiting for a network');
  assert.doesNotMatch(blocked[0]!.label, /scan/i);
  assert.match(blocked[0]!.note ?? '', /address/);
  // Still the step that is happening. Nothing has failed, and there is no failed state to reach.
  assert.equal(blocked[0]!.state, 'active');
  assert.deepEqual(
    blocked.map((s) => s.state),
    ['active', 'waiting', 'waiting', 'waiting'],
  );
});

test('control: the same input with a network reads the way it always did', () => {
  const normal = pairSteps({ sighted: false, paired: false, scannable: true });
  assert.equal(normal[0]!.label, 'Waiting for a scan');
  assert.deepEqual(normal, pairSteps({ sighted: false, paired: false }), 'the default changed');
});

/**
 * The module's standing rule, which this fact must not break: a later fact advances the earlier
 * steps and an earlier absence never retracts a later one. A Mac that regained its network between
 * the reachability read and the draw is `found`, and a stale `scannable: false` may not undo that.
 */
test('a later fact still wins over a stale reachability reading', () => {
  const sighted = pairSteps({ sighted: true, paired: false, scannable: false });
  assert.equal(sighted[0]!.state, 'done');
  assert.equal(sighted[0]!.label, 'Waiting for a scan', 'a done step was relabelled by a stale fact');
  assert.equal(pairSteps({ sighted: false, paired: true, scannable: false })[3]!.state, 'done');
});
