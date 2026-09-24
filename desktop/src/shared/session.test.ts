import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearedSession } from './session';

/**
 * Defect 25: the Mac kept offering a phone it was not connected to.
 *
 * `teardown()` cleared the socket, the reader and the pending map, and left `capabilities` holding
 * whatever the last handshake said — so `Start mirroring` stayed enabled and the notifications
 * card stayed up, captioned "Nothing on the phone's notification shade right now", while nothing
 * was connected to the phone.
 */
test('a cleared session holds no claim the connection made', () => {
  const cleared = clearedSession();

  assert.equal(cleared.sessionToken, null, 'the token authorises sockets that no longer exist');
  assert.deepEqual(cleared.capabilities, [], 'defect 25: capabilities outlived their connection');
  assert.deepEqual(cleared.unavailable, [], 'the reasons are the other half of the same claim');
  assert.deepEqual(cleared.limited, [], 'defect 139: a partial capability is a claim about a connection too');
});

/**
 * The guard that actually stops defect 25 recurring is structural, not this assertion: the fields
 * live in one object, so `teardown()` clears them with one assignment and a newly added
 * session-scoped fact is blanked without anyone remembering to. This pins the other half — that
 * every field in the object is *reachable* here, so adding one to `SessionScoped` without a
 * default breaks a test rather than shipping.
 */
test('every session-scoped field is accounted for', () => {
  const cleared = clearedSession();
  // `negotiated` (Feature A slice 2): teardown replaces the session with clearedSession(), so a
  // reconnect renegotiates `ext` rather than inheriting the last phone's answer.
  const known = ['sessionToken', 'capabilities', 'unavailable', 'limited', 'negotiated'];

  assert.deepEqual(
    Object.keys(cleared).sort(),
    [...known].sort(),
    'a field was added to SessionScoped — confirm teardown blanks it, then list it here',
  );
});

/** Two calls must not share arrays, or clearing one session would mutate a previous status object. */
test('each cleared session gets its own arrays', () => {
  const first = clearedSession();
  const second = clearedSession();

  assert.notEqual(first.capabilities, second.capabilities);
  first.capabilities.push('mirror');
  assert.deepEqual(second.capabilities, []);

  assert.notEqual(first.negotiated, second.negotiated);
  first.negotiated['share.file'] = 1;
  assert.deepEqual(second.negotiated, {});
});
