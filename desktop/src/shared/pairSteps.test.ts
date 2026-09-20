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
