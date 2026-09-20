import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { capabilityRow, capabilityTone, capabilityStateLabel } = createRequire(import.meta.url)(
  './capabilityStatus.ts',
) as typeof import('./capabilityStatus');

const input = (over: Record<string, unknown> = {}) => ({
  id: 'sms',
  label: 'Messages',
  advertised: true,
  reason: null,
  connected: true,
  ...over,
}) as Parameters<typeof capabilityRow>[0];

test('an advertised feature is Available and claims nothing more', () => {
  const row = capabilityRow(input());
  assert.equal(row.state, 'available');
  assert.equal(row.note, null, 'an available feature invented a note');
});

test('a refusal that names a grant is a permission; one that does not is unavailable', () => {
  const permission = capabilityRow(
    input({ advertised: false, reason: 'SMS permission is not granted on the phone.' }),
  );
  assert.equal(permission.state, 'permission');
  assert.equal(permission.note, 'SMS permission is not granted on the phone.', 'the phone’s words were changed');

  // The control: the same shape of refusal without a grant word claims less, not more.
  const unknown = capabilityRow(input({ advertised: false, reason: 'The phone is busy.' }));
  assert.equal(unknown.state, 'unavailable');
  assert.equal(unknown.note, 'The phone is busy.');
});

test('a refusal with no sentence still says something, and does not invent a cause', () => {
  const row = capabilityRow(input({ advertised: false, reason: null }));
  assert.equal(row.state, 'unavailable');
  assert.match(row.note ?? '', /not offering/);
  assert.doesNotMatch(row.note ?? '', /permission|grant/i, 'a cause was invented');
});

/**
 * The row this file exists for. A disconnected phone is not a phone that lacks a feature — the
 * capability list is the last thing the Mac heard, and after a drop it is a memory.
 */
test('nothing is claimed about a phone that is not connected', () => {
  const row = capabilityRow(input({ connected: false, advertised: false, reason: 'whatever' }));
  assert.equal(row.state, 'unavailable');
  assert.match(row.note ?? '', /not connected/);
  // Control: the same capability with the link up and the same reason does read as a real refusal.
  assert.equal(capabilityRow(input({ connected: true, advertised: false, reason: 'whatever' })).state, 'unavailable');
});

test('unbuilt is a fact about Sidekick: it survives the phone advertising it, and never blames a grant', () => {
  const row = capabilityRow(input({ id: 'camera', label: 'Camera', unbuilt: true, advertised: true }));
  assert.equal(row.state, 'unbuilt');
  assert.equal(capabilityStateLabel(row.state), 'Not built');
});

test('a feature that works with a piece missing is Limited, with the piece named', () => {
  const row = capabilityRow(input({ id: 'photos', label: 'Photos', limitedNote: 'Thumbnails only.' }));
  assert.equal(row.state, 'limited');
  assert.equal(row.note, 'Thumbnails only.');
});

test('tone is the state’s, and neither unavailable nor unbuilt reads as a failure', () => {
  assert.equal(capabilityTone('available').tone, 'ok');
  assert.equal(capabilityTone('limited').tone, 'warning');
  assert.equal(capabilityTone('permission').tone, 'warning');
  assert.equal(capabilityTone('unavailable').tone, 'neutral');
  assert.equal(capabilityTone('unbuilt').tone, 'neutral');
});
