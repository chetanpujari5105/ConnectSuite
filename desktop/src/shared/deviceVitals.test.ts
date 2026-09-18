import { test } from 'node:test';
import assert from 'node:assert/strict';
const {
  deviceStatusRings,
  batteryRing,
  storageRing,
  humanBytes,
  BATTERY_LOW_PERCENT,
  batterySlot,
  batteryDiagnostic,
} = require('./deviceVitals.ts');

test('never reported and cannot report are different sentences', () => {
  // Both draw no arc, and a person must still be able to tell them apart: one resolves on its own
  // and the other never will. This is defect 85's separation, one card over.
  const never = batteryRing(null);
  const cannot = batteryRing({ level: null, charging: false, capacityUnknown: true });
  assert.equal(never.fraction, null);
  assert.equal(cannot.fraction, null);
  assert.notEqual(never.caption, cannot.caption);
});

test('an unknown battery does not draw a zero arc', () => {
  // A ring at 0 for an unknown value is a confident claim that the battery is flat.
  const view = batteryRing({ level: null, charging: false, capacityUnknown: true });
  assert.equal(view.fraction, null);
  assert.notEqual(view.value, '0%');
  assert.equal(view.tone, 'unknown');
});

test('a real zero is a real zero', () => {
  const view = batteryRing({ level: 0, charging: false, capacityUnknown: false });
  assert.equal(view.fraction, 0);
  assert.equal(view.value, '0%');
  assert.equal(view.tone, 'low');
});

test('charging at a low level is not a warning — the situation is resolving itself', () => {
  const onBattery = batteryRing({ level: 5, charging: false, capacityUnknown: false });
  const charging = batteryRing({ level: 5, charging: true, capacityUnknown: false });
  assert.equal(onBattery.tone, 'low');
  assert.equal(charging.tone, 'ok');
  assert.equal(charging.caption, 'Charging');
});

test('the low threshold is applied at its boundary in both directions', () => {
  const at = batteryRing({ level: BATTERY_LOW_PERCENT, charging: false, capacityUnknown: false });
  const below = batteryRing({ level: BATTERY_LOW_PERCENT - 1, charging: false, capacityUnknown: false });
  assert.equal(at.tone, 'ok');
  assert.equal(below.tone, 'low');
});

test('storage is stated as free space: the value, the caption and the bar all read free', () => {
  // Sidekick handoff, component 14: value `11.0 GB`, caption `free of 490 GB · 2%`, and the bar
  // fills with FREE space. Red-first: restoring the old binding (fraction = used) makes this 0.8.
  const view = storageRing({ freeBytes: 20_000_000_000, totalBytes: 100_000_000_000 });
  assert.equal(view.fraction, 0.2);
  assert.equal(view.value, '20.0 GB');
  assert.equal(view.caption, 'free of 100 GB · 20%');
  assert.equal(view.tone, 'ok');
});

test('a nearly full phone is a nearly EMPTY bar, and that one is amber', () => {
  const view = storageRing({ freeBytes: 11_000_000_000, totalBytes: 490_000_000_000 });
  assert.ok(view.fraction! < 0.03);
  assert.equal(view.value, '11.0 GB');
  assert.equal(view.caption, 'free of 490 GB · 2%');
  assert.equal(view.tone, 'low');
});

test('low battery says so in words, and charging overrides it like the tone does', () => {
  assert.equal(batteryRing({ level: 12, charging: false, capacityUnknown: false }).caption, 'Low battery');
  assert.equal(batteryRing({ level: 12, charging: true, capacityUnknown: false }).caption, 'Charging');
  assert.equal(batteryRing({ level: 60, charging: false, capacityUnknown: false }).caption, 'On battery');
});

test('a null half of storage makes the whole ring unknown, not zero', () => {
  for (const state of [
    { freeBytes: null, totalBytes: 100 },
    { freeBytes: 100, totalBytes: null },
  ]) {
    const view = storageRing(state as never);
    assert.equal(view.fraction, null);
    assert.equal(view.tone, 'unknown');
  }
});

test('a zero total never becomes a denominator', () => {
  // Dividing by it is how a card ends up showing NaN%.
  const view = storageRing({ freeBytes: 0, totalBytes: 0 });
  assert.equal(view.fraction, null);
  assert.ok(!view.value.includes('NaN'));
});

test('humanBytes says what a person would say', () => {
  assert.equal(humanBytes(0), '0 B');
  assert.equal(humanBytes(999), '999 B');
  assert.equal(humanBytes(1_500), '1.5 KB');
  assert.equal(humanBytes(41_231_908_864), '41.2 GB');
});

test('there are two rings and neither of them is memory', () => {
  // The design draws three. Free RAM on Android is not a fact a person can act on, and a number
  // that looks like information and is not is decoration. docs/design-departures.md → O4.
  const rings = deviceStatusRings(null, null);
  assert.equal(rings.length, 2);
  assert.deepEqual(rings.map((r: { id: string }) => r.id), ['battery', 'storage']);
});

// --- batterySlot: the chrome's three slots ------------------------------------------------------
//
// These exist because the slots were `hidden` for a phase on a comment reading "nothing subscribes
// to `battery.state`" — true when written, false from the day `VitalsFeature` landed, and nothing
// in the build could compare a comment to a handler. The tests below are about the *decision*; that
// the shell calls this rather than restating it is asserted in `shellBattery.test.ts`, because the
// decision being right somewhere no surface reads is defect 67 exactly.

test('a real reading shows as the bare percentage the 40px slots have room for', () => {
  const slot = batterySlot({ level: 79, charging: false, capacityUnknown: false }, true);
  assert.equal(slot.show, true);
  assert.equal(slot.text, '79%');
});

/**
 * **This assertion moved rather than being deleted, 2026-09-16.**
 *
 * It read `slot.detail === '12% · Charging'`. `detail` was the labelled form and it had exactly one
 * consumer — the Overview hero's Battery row — which departure O11 removed, because the ring and
 * the sidebar card already carried that fact and three copies on one viewport is what the pane was
 * reported for.
 *
 * The **rule** is untouched and still worth a guard: the charging state is said in words, not left
 * to a glyph with no legend. Its surviving home is the ring's caption, which is where the fact is
 * actually drawn now — so the test asserts it there rather than on a field nothing reads. Deleting
 * it with the field would have retired a rule because its carrier moved.
 */
test('charging is said, not inferred from a glyph nobody has a legend for', () => {
  assert.equal(batteryRing({ level: 12, charging: true, capacityUnknown: false }).caption, 'Charging');
  assert.equal(
    batteryRing({ level: 79, charging: false, capacityUnknown: false }).caption,
    'On battery',
  );
  // Charging at 12% is the situation resolving itself, so it is not `low`. Same rule as the ring,
  // because it IS the ring's rule — this asserts the delegation, not a copy of it.
  assert.equal(batterySlot({ level: 12, charging: true, capacityUnknown: false }, true).tone, 'ok');
});

test('a phone that has never reported shows nothing, and a dash is not nothing', () => {
  const slot = batterySlot(null, true);
  assert.equal(slot.show, false);
  assert.equal(slot.text, '');
});

test('a phone that cannot report shows nothing either, and the ring still explains why', () => {
  const state = { level: null, charging: false, capacityUnknown: true };
  assert.equal(batterySlot(state, true).show, false);
  // The control: the fact is not lost, it moved to the surface with room for a sentence.
  assert.equal(batteryRing(state).caption, 'This phone does not report its level');
});

test('a link that is not live shows nothing, however good the last reading was', () => {
  // The load-bearing one. A percentage drawn while disconnected is a claim about NOW made from a
  // reading that may be hours old — defect 96's shape, on a new surface. Note the state is a
  // perfectly good 79%: nothing about the reading is wrong, only its currency.
  const good = { level: 79, charging: false, capacityUnknown: false };
  assert.equal(batterySlot(good, true).show, true);
  assert.equal(batterySlot(good, false).show, false);
});

test('the slot never invents a number the ring would not draw', () => {
  // The two surfaces are one fact two inches apart. Anything the ring declines to put an arc on,
  // the slot declines to put a number on — asserted across every shape `battery.state` can take.
  for (const state of [
    null,
    { level: null, charging: false, capacityUnknown: false },
    { level: null, charging: true, capacityUnknown: true },
    { level: 0, charging: false, capacityUnknown: false },
    { level: 100, charging: true, capacityUnknown: false },
  ]) {
    const ring = batteryRing(state as never);
    const slot = batterySlot(state as never, true);
    assert.equal(slot.show, ring.fraction !== null, `disagreed about ${JSON.stringify(state)}`);
    if (slot.show) assert.equal(slot.text, ring.value);
  }
});

test('zero percent is a reading, not an absence', () => {
  // The third of defect 85's three states: a real zero must not look like "cannot tell you".
  const slot = batterySlot({ level: 0, charging: false, capacityUnknown: false }, true);
  assert.equal(slot.show, true);
  assert.equal(slot.text, '0%');
  assert.equal(slot.tone, 'low');
});

// --- batteryDiagnostic: Settings → Advanced -----------------------------------------------------
//
// The line said `not subscribed on this build (battery.state is unhandled)` for a phase, beside a
// phone that was pushing `battery.state` every tick. A true sentence about a build that no longer
// exists is the hardest kind to catch by reading: the mechanism it describes was real.

const T0 = 1_760_000_000_000;

test('nothing received is its own answer, and never blank', () => {
  // Advanced is where a person looks BECAUSE the chrome is showing nothing. A blank line here is
  // the one thing this surface may not do.
  assert.equal(batteryDiagnostic(null, null, T0), 'no battery.state received this session');
  // A state with no arrival time is the same absence — neither half is evidence on its own.
  assert.equal(
    batteryDiagnostic({ level: 46, charging: true, capacityUnknown: false }, null, T0),
    'no battery.state received this session',
  );
});

test('cannot-report is not silence, and says so', () => {
  const line = batteryDiagnostic({ level: null, charging: false, capacityUnknown: true }, T0 - 4_000, T0);
  assert.equal(line, 'the phone reports it cannot read its level · received 4s ago');
  assert.ok(!line.includes('no battery.state'), 'a phone that answered is not a phone that is silent');
});

test('a real reading carries its age, because a bare percentage has no denominator', () => {
  assert.equal(
    batteryDiagnostic({ level: 46, charging: true, capacityUnknown: false }, T0 - 34_000, T0),
    '46% · charging · received 34s ago',
  );
  assert.equal(
    batteryDiagnostic({ level: 46, charging: false, capacityUnknown: false }, T0 - 34_000, T0),
    '46% · on battery · received 34s ago',
  );
});

test('the word is `received`, never `measured`', () => {
  // `docs/protocol.md` gives battery.state no timestamp. This is the arrival on this Mac, and the
  // phone's own clock is not on the wire — implying it would be an invented fact.
  const line = batteryDiagnostic({ level: 90, charging: false, capacityUnknown: false }, T0 - 1_000, T0);
  assert.ok(line.includes('received'));
  assert.ok(!line.includes('measured') && !line.includes('at '), line);
});

test('the age is coarse, and an hour-old reading does not read as current', () => {
  const state = { level: 46, charging: false, capacityUnknown: false };
  const at = (ms: number) => batteryDiagnostic(state, T0 - ms, T0).split('received ')[1];
  assert.equal(at(0), '0s ago');
  assert.equal(at(89_000), '89s ago');
  assert.equal(at(91_000), '2m ago');
  assert.equal(at(89 * 60_000), '89m ago');
  assert.equal(at(91 * 60_000), '2h ago');
});

test('a clock that went backwards reports an unknown time, not a negative age', () => {
  // A sleep or an NTP step. "-4s ago" is the instrument reporting its own fault as a measurement,
  // which is the failure this repo has a table of.
  const line = batteryDiagnostic({ level: 46, charging: false, capacityUnknown: false }, T0 + 4_000, T0);
  assert.equal(line, '46% · on battery · received at an unknown time');
  assert.ok(!line.includes('-'), line);
});

test('the diagnostic speaks where the slot is silent — the two are not the same rule', () => {
  // The pair that matters: every state in which the chrome shows nothing, Advanced still explains.
  for (const state of [
    null,
    { level: null, charging: false, capacityUnknown: true },
    { level: null, charging: false, capacityUnknown: false },
  ]) {
    assert.equal(batterySlot(state as never, true).show, false);
    const line = batteryDiagnostic(state as never, state === null ? null : T0 - 1_000, T0);
    assert.ok(line.length > 20, `Advanced went quiet too for ${JSON.stringify(state)}: ${line}`);
  }
});
