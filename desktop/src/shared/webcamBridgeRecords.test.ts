import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BridgeOutputError,
  CHAIN_BREAK_CAUSES,
  RECORD_MAX_LENGTH,
  STATUS_MAX_LENGTH,
  StatusRecordReader,
  STREAM_FAULTS,
  accessUnitRecord,
  controlRecord,
  encodeRecord,
  parseStatus,
} from './webcamBridgeRecords';

/**
 * Main's half of the stdin/stdout record framing. These are unit tests of the codec; that it agrees
 * with the **Swift** half is `src/main/webcamBridge.test.ts`'s job, against the built bridge.
 */
const T = { timeout: 5_000 };
const ID = '0123456789abcdef0123456789abcdef';

function status(obj: unknown): Buffer {
  return encodeRecord(0x81, Buffer.from(JSON.stringify(obj)));
}

test('records are a 4-byte big-endian length, a type byte and the body', T, () => {
  const r = encodeRecord(0x01, Buffer.from('{}'));
  assert.deepEqual([...r], [0, 0, 0, 3, 0x01, 0x7b, 0x7d]);
  const au = accessUnitRecord(ID, Buffer.from([9, 9]));
  assert.equal(au.readUInt32BE(0), 1 + 16 + 2);
  assert.equal(au.readUInt8(4), 0x02);
  assert.equal(au.subarray(5, 21).toString('hex'), ID);
  assert.throws(() => encodeRecord(0x02, Buffer.alloc(RECORD_MAX_LENGTH)), /over the/);
  assert.throws(() => controlRecord({ op: 'session-live', sessionId: ID, generation: 0 }));
  assert.throws(() => controlRecord({ op: 'session-ended', sessionId: 'nope', reason: 'x' }));
});

test('status records split byte by byte and coalesced read the same', T, () => {
  const both = Buffer.concat([
    status({ op: 'ready', device: 'not-installed', producerIdentity: 'unconfigured' }),
    status({ op: 'consumers', count: 0 }),
  ]);
  const split = new StatusRecordReader();
  const fromSplit = [];
  for (const b of both) fromSplit.push(...split.push(Buffer.from([b])));
  const together = new StatusRecordReader().push(both);
  const want = [
    { op: 'ready', deviceInstalled: false, producerIdentityConfigured: false },
    { op: 'consumers', count: 0 },
  ];
  assert.deepEqual(fromSplit, want);
  assert.deepEqual(together, want);
});

test('every status op parses to exactly its fields', T, () => {
  assert.deepEqual(parseStatus(Buffer.from(JSON.stringify({ op: 'session-ended', reason: 'no-consumers', sessionId: ID }))), {
    op: 'session-ended', sessionId: ID, reason: 'no-consumers',
  });
  assert.deepEqual(parseStatus(Buffer.from('{"op":"sink","state":"refused"}')), { op: 'sink', state: 'refused' });
  assert.deepEqual(parseStatus(Buffer.from('{"counts":{"received":3,"gate.malformed":0},"op":"counts"}')), {
    op: 'counts', counts: { received: 3, 'gate.malformed': 0 },
  });
  assert.deepEqual(parseStatus(Buffer.from('{"op":"error","error":"malformed-record: x"}')), { op: 'error', error: 'malformed-record: x' });
  assert.deepEqual(
    parseStatus(Buffer.from(JSON.stringify({ generation: 0, op: 'stream-rejected', sessionId: ID, violation: 'unknown-version' }))),
    { op: 'stream-rejected', sessionId: ID, generation: 0, violation: 'unknown-version' },
  );
});

test("stream-rejected carries only the bridge's closed set of violations, read from the shared fixture", T, () => {
  const fixture = JSON.parse(
    readFileSync(join(__dirname, '../../../docs/fixtures/webcam-vocabulary-v1.json'), 'utf8'),
  ) as { streamFaults: string[] };
  assert.deepEqual([...STREAM_FAULTS], fixture.streamFaults);
  for (const violation of fixture.streamFaults) {
    assert.equal(
      (parseStatus(Buffer.from(JSON.stringify({ op: 'stream-rejected', sessionId: ID, generation: 3, violation }))) as { violation: string }).violation,
      violation,
    );
  }
});

test('anything off-contract is malformed output — and a spent reader stays spent', T, () => {
  const bad: Array<[string, Buffer]> = [
    ['length 0', Buffer.from([0, 0, 0, 0])],
    ['over the status cap, from the 4-byte head alone', (() => { const b = Buffer.alloc(4); b.writeUInt32BE(STATUS_MAX_LENGTH + 1); return b; })()],
    // A body that would parse as a valid status: only the type byte separates it.
    ['a valid status body under the control type', encodeRecord(0x01, Buffer.from('{"op":"consumers","count":1}'))],
    ['not JSON', encodeRecord(0x81, Buffer.from('hello'))],
    ['a JSON array', status([1])],
    ['unknown op', status({ op: 'frame' })],
    ['an extra field', status({ op: 'consumers', count: 1, extra: true })],
    ['a missing field', status({ op: 'sink' })],
    ['an unknown sink state', status({ op: 'sink', state: 'running' })],
    ['a negative count', status({ op: 'consumers', count: -1 })],
    ['a fractional count', status({ op: 'consumers', count: 1.5 })],
    ['an uppercase session id', status({ op: 'session-ended', sessionId: ID.toUpperCase(), reason: 'x' })],
    ['a counter that is not a count', status({ op: 'counts', counts: { received: '3' } })],
    ['ready with a guessed value', status({ op: 'ready', device: 'maybe', producerIdentity: 'configured' })],
    // An exception's text is never a violation: only the fixed tokens are.
    ['a violation outside the closed set', status({ op: 'stream-rejected', sessionId: ID, generation: 1, violation: 'Error: boom at 0x10' })],
    ['a generation over u16', status({ op: 'stream-rejected', sessionId: ID, generation: 65536, violation: 'unknown-version' })],
    ['stream-rejected without its session', status({ op: 'stream-rejected', generation: 1, violation: 'unknown-version' })],
  ];
  for (const [name, bytes] of bad) {
    const reader = new StatusRecordReader();
    assert.throws(() => reader.push(bytes), BridgeOutputError, name);
    assert.throws(() => reader.push(status({ op: 'consumers', count: 0 })), /already closed/, `${name}: spent`);
  }
  // Control: the reader is not simply refusing everything.
  assert.equal(new StatusRecordReader().push(status({ op: 'consumers', count: 2 })).length, 1);
});

test('version 2: chain-broken and chain-recovered parse to exactly their fields, causes from the shared fixture', T, () => {
  const fixture = JSON.parse(readFileSync(join(__dirname, '../../../docs/fixtures/webcam-vocabulary-v1.json'), 'utf8')) as {
    chainBreakCauses: string[];
  };
  assert.deepEqual([...CHAIN_BREAK_CAUSES], fixture.chainBreakCauses);
  for (const cause of fixture.chainBreakCauses) {
    assert.deepEqual(parseStatus(Buffer.from(JSON.stringify({ op: 'chain-broken', sessionId: ID, generation: 2, cause }))), {
      op: 'chain-broken', sessionId: ID, generation: 2, cause,
    });
  }
  assert.deepEqual(parseStatus(Buffer.from(JSON.stringify({ op: 'chain-recovered', sessionId: ID, generation: 9 }))), {
    op: 'chain-recovered', sessionId: ID, generation: 9,
  });
  const bad: unknown[] = [
    { op: 'chain-broken', sessionId: ID, generation: 2, cause: 'sunspots' },
    { op: 'chain-broken', sessionId: ID, generation: 0, cause: 'queue-full' },
    { op: 'chain-broken', sessionId: ID, generation: 2 },
    { op: 'chain-broken', sessionId: ID, generation: 2, cause: 'queue-full', extra: 1 },
    { op: 'chain-broken', sessionId: 'ABC', generation: 2, cause: 'queue-full' },
    { op: 'chain-recovered', sessionId: ID, generation: 70_000 },
    { op: 'chain-recovered', sessionId: ID },
  ];
  for (const obj of bad) assert.throws(() => parseStatus(Buffer.from(JSON.stringify(obj))), BridgeOutputError, JSON.stringify(obj));
});
