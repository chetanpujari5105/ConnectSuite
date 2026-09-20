import test from 'node:test';
import assert from 'node:assert/strict';
import { networkInterfaces } from 'node:os';

import { localPairAddress, NO_LOCAL_ADDRESS, type InterfaceAddress } from './pairReach';

const lo: InterfaceAddress = { address: '127.0.0.1', family: 'IPv4', internal: true };
const lo6: InterfaceAddress = { address: '::1', family: 'IPv6', internal: true };
const wifi: InterfaceAddress = { address: '192.168.1.24', family: 'IPv4', internal: false };
const wifi6: InterfaceAddress = { address: 'fe80::1', family: 'IPv6', internal: false };

test('a Mac on Wi-Fi pairs on its Wi-Fi address', () => {
  const found = localPairAddress({ lo0: [lo, lo6], en0: [wifi6, wifi] });
  assert.equal(found.address, '192.168.1.24');
  assert.equal(found.reachable, true);
});

/**
 * The defect. With Wi-Fi off, the only interface left is loopback, and the old code returned the
 * literal `'0.0.0.0'` with nothing anywhere marking it as *not an address* — it was encoded into a
 * QR and drawn under "scan this".
 */
test('a Mac with only loopback has no address to put in a code', () => {
  const found = localPairAddress({ lo0: [lo, lo6] });
  assert.equal(found.address, NO_LOCAL_ADDRESS);
  assert.equal(found.reachable, false);
});

test('no interfaces at all is the same answer, not a crash', () => {
  assert.deepEqual(localPairAddress({}), { address: NO_LOCAL_ADDRESS, reachable: false });
  assert.deepEqual(localPairAddress({ en0: undefined }), {
    address: NO_LOCAL_ADDRESS,
    reachable: false,
  });
});

/**
 * An IPv6-only interface is not an answer: the payload's `host` is dialled as IPv4 by the phone,
 * and a v6 address in that field would be a code that fails at connect time rather than one the
 * screen could refuse to draw.
 */
test('a non-internal IPv6 address alone does not make a code', () => {
  const found = localPairAddress({ en0: [wifi6] });
  assert.equal(found.reachable, false);
});

/** Node has reported `family` as both `'IPv4'` and `4`. Both are the same fact. */
test('family reads the same whether the runtime numbers it or names it', () => {
  const named = localPairAddress({ en0: [{ address: '10.0.0.5', family: 'IPv4', internal: false }] });
  const numbered = localPairAddress({ en0: [{ address: '10.0.0.5', family: 4, internal: false }] });
  assert.deepEqual(named, numbered);
  assert.equal(numbered.reachable, true);
});

/**
 * Deliberately reachable — see the module's note. A link-local address is an interface that is up
 * with no lease, and a phone on the same link self-assigns from the same range.
 */
test('a link-local address is offered rather than refused', () => {
  const found = localPairAddress({ en0: [{ address: '169.254.7.3', family: 'IPv4', internal: false }] });
  assert.equal(found.reachable, true);
  assert.equal(found.address, '169.254.7.3');
});

/**
 * The control this rule would otherwise lack: every case above is a hand-built interface list, so
 * nothing above asks whether a **real** `os.networkInterfaces()` is the shape this reads. It is run
 * against the live machine, and only the invariant that holds on any machine is asserted — that the
 * answer is self-consistent, never `reachable` with the unspecified address or the reverse.
 */
test('control: the live machine answers, and its answer is self-consistent', () => {
  const found = localPairAddress(networkInterfaces() as Record<string, InterfaceAddress[]>);
  assert.equal(found.reachable, found.address !== NO_LOCAL_ADDRESS);
  assert.match(found.address, /^\d+\.\d+\.\d+\.\d+$/);
});
