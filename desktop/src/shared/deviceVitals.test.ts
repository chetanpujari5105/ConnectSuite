import { test } from 'node:test';
import assert from 'node:assert/strict';
const {
  deviceStatusRings,
  batteryRing,
  storageRing,
  humanBytes,
  BATTERY_LOW_PERCENT,
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

test('storage fills with what is used and says what is free', () => {
  // One fact twice — "88% used" over a ring 88% full — is not two facts. The number says the thing
  // the ring cannot.
  const view = storageRing({ freeBytes: 20_000_000_000, totalBytes: 100_000_000_000 });
  assert.equal(view.fraction, 0.8);
  // The word "free" lives in the caption because the value sits inside a 72px ring and
  // "13.7 GB free" overflows it. The pair still says used-arc plus free-number.
  assert.equal(view.value, '20.0 GB');
  assert.match(view.caption, /^free of /);
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
