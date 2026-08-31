import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PassThrough } from 'node:stream';
import { BulkFraming, FrameReader, FrameTooLargeError, writeFrame } from './framing';
import { MAX_BULK_FRAME, MAX_BULK_HEADER_FRAME, MAX_FRAME } from '../shared/protocol';

/**
 * Bug 6 — the bulk channel's frame caps, read side and write side.
 *
 * Twin of core/src/test/java/com/chetan/connectsuite/core/BulkFramingTest.kt. Both sides are tested
 * because both sides frame, and a cap enforced on one end only is a cap that catches a hostile peer
 * and never catches us.
 */

/** A sink that behaves like a socket and remembers every byte written to it. */
function wire(): { socket: PassThrough; bytes: () => Buffer } {
  const socket = new PassThrough();
  const chunks: Buffer[] = [];
  socket.on('data', (c: Buffer) => chunks.push(c));
  return { socket, bytes: () => Buffer.concat(chunks) };
}

function lengthPrefix(length: number): Buffer {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32BE(length, 0);
  return b;
}

function collector() {
  const frames: Buffer[] = [];
  const violations: string[] = [];
  const bulk = new BulkFraming(
    (f) => frames.push(Buffer.from(f)),
    (m) => violations.push(m),
  );
  return { bulk, frames, violations };
}

// ---- the decision itself ---------------------------------------------------------------------

test('the bulk cap is smaller than the general frame cap, not larger', () => {
  // The whole argument for 1 MB. If someone later "fixes" a large-file transfer by raising this
  // above MAX_FRAME, that is the mistake this line exists to make visible.
  assert.equal(MAX_BULK_FRAME, 1 * 1024 * 1024);
  assert.equal(MAX_BULK_HEADER_FRAME, 64 * 1024);
  assert.ok(MAX_BULK_FRAME < MAX_FRAME);
  assert.ok(MAX_BULK_HEADER_FRAME < MAX_BULK_FRAME);
});

// ---- read side -------------------------------------------------------------------------------

test('a chunk length prefix past the bulk cap is refused, named and closed', () => {
  const { bulk, violations } = collector();
  bulk.expectChunk();

  bulk.reader.push(lengthPrefix(3 * 1024 * 1024));

  assert.equal(violations.length, 1, 'the socket owner is told exactly once');
  const message = violations[0]!;
  assert.match(message, /3145728/, 'names the offending length');
  assert.match(message, new RegExp(String(MAX_BULK_FRAME)), 'names the cap it broke');
  assert.match(message, /Bulk chunk/, 'names which frame');
});

test('a header frame is judged by the header cap, not the chunk cap', () => {
  // The discrimination case: 100 KB is a legal chunk and an illegal header. One cap for the whole
  // channel cannot tell these apart, and would let a malformed first frame claim the entire chunk
  // budget on a connection that has proved nothing beyond its token.
  const hundredKb = Buffer.alloc(100 * 1024, 'h');
  const encoded = Buffer.concat([lengthPrefix(hundredKb.length), hundredKb]);

  const asHeader = collector();
  asHeader.bulk.expectHeader();
  asHeader.bulk.reader.push(encoded);
  assert.equal(asHeader.frames.length, 0);
  assert.match(asHeader.violations[0]!, /Bulk header/);
  assert.match(asHeader.violations[0]!, new RegExp(String(MAX_BULK_HEADER_FRAME)));

  const asChunk = collector();
  asChunk.bulk.expectChunk();
  asChunk.bulk.reader.push(encoded);
  assert.equal(asChunk.violations.length, 0);
  assert.equal(asChunk.frames[0]!.length, hundredKb.length);
});

test('a length prefix still short of its payload is waited for, not refused', () => {
  const { bulk, frames, violations } = collector();
  bulk.expectChunk();
  bulk.reader.push(lengthPrefix(8));
  bulk.reader.push(Buffer.from('half'));
  assert.deepEqual([frames.length, violations.length], [0, 0]);
  bulk.reader.push(Buffer.from('rest'));
  assert.equal(frames[0]!.toString(), 'halfrest');
});

// ---- write side ------------------------------------------------------------------------------

test('our own oversized chunk fails on our side and nothing is emitted', () => {
  // The half that catches us rather than a hostile peer: an adaptive chunk size that ran away
  // should fail here with a clear line, not become a frame the phone silently closes the socket
  // over.
  const { socket, bytes } = wire();
  const { bulk, violations } = collector();

  assert.throws(
    () => bulk.writeChunk(socket, Buffer.alloc(3 * 1024 * 1024)),
    (e: unknown) =>
      e instanceof FrameTooLargeError && /3145728/.test(e.message) && /Bulk chunk/.test(e.message),
  );

  assert.equal(bytes().length, 0, 'a refused frame puts no bytes on the wire');
  assert.equal(violations.length, 1);
});

test('our own oversized header fails on our side too', () => {
  const { socket, bytes } = wire();
  const { bulk } = collector();

  assert.throws(
    () => bulk.writeHeader(socket, Buffer.alloc(MAX_BULK_HEADER_FRAME + 1)),
    (e: unknown) =>
      e instanceof FrameTooLargeError &&
      /Bulk header/.test(e.message) &&
      new RegExp(String(MAX_BULK_HEADER_FRAME)).test(e.message),
  );
  assert.equal(bytes().length, 0);
});

// ---- the denominator -------------------------------------------------------------------------

test('the refusal carries what the channel had already accepted', () => {
  // A refusal count with no denominator is not evidence. The first over-size frame in a
  // 10,000-frame transfer must not read the same as a channel broken from its first byte.
  const { socket } = wire();
  const { bulk, violations } = collector();

  bulk.writeHeader(socket, Buffer.alloc(512));
  for (let i = 0; i < 3; i += 1) bulk.writeChunk(socket, Buffer.alloc(1000));

  assert.throws(() => bulk.writeChunk(socket, Buffer.alloc(2 * 1024 * 1024)));

  const message = violations[0]!;
  assert.match(message, /4 frames/, 'frames accepted');
  assert.match(message, /3512 bytes/, 'bytes moved');
  assert.match(message, /1 rejected/, 'refusals');
  assert.deepEqual(
    [bulk.tally.accepted, bulk.tally.bytesAccepted, bulk.tally.rejected],
    [4, 3512, 1],
  );
});

test('a tally counts reads as well as writes, so a receiver has a denominator too', () => {
  const { socket, bytes } = wire();
  const sender = collector();
  sender.bulk.writeHeader(socket, Buffer.from('{"transferId":"t1"}'));
  sender.bulk.writeChunk(socket, Buffer.alloc(2048));

  const receiver = collector();
  receiver.bulk.expectChunk();
  receiver.bulk.reader.push(bytes());

  assert.equal(receiver.bulk.tally.accepted, 2);
  assert.equal(receiver.bulk.tally.bytesAccepted, 2067);
  assert.equal(receiver.bulk.tally.summary(), '2 frames / 2067 bytes accepted, 0 rejected');
});

// ---- the control that proves the checks above can see a legal frame ---------------------------

test('frames at exactly the cap are accepted, both sides', () => {
  // The positive control. Every assertion above is an absence — "this was refused" — and an absence
  // is only evidence beside a known positive. If an off-by-one made the caps refuse everything,
  // all five refusal tests would still pass and this is the one that would not.
  const { socket, bytes } = wire();
  const sender = collector();
  sender.bulk.writeHeader(socket, Buffer.alloc(MAX_BULK_HEADER_FRAME));
  sender.bulk.writeChunk(socket, Buffer.alloc(MAX_BULK_FRAME));

  const receiver = collector();
  receiver.bulk.expectHeader();
  const wireBytes = bytes();
  receiver.bulk.reader.push(wireBytes.subarray(0, 4 + MAX_BULK_HEADER_FRAME));
  receiver.bulk.expectChunk();
  receiver.bulk.reader.push(wireBytes.subarray(4 + MAX_BULK_HEADER_FRAME));

  assert.deepEqual(
    receiver.frames.map((f) => f.length),
    [MAX_BULK_HEADER_FRAME, MAX_BULK_FRAME],
  );
  assert.equal(receiver.bulk.tally.rejected, 0);
});

test('the control channel writes under its own cap, not the video cap', () => {
  // The asymmetry the write side exposed: this channel *reads* at MAX_CONTROL_FRAME, so a write
  // side defaulting to MAX_FRAME would refuse frames the phone would happily have accepted.
  const { socket, bytes } = wire();
  const big = Buffer.alloc(MAX_FRAME + 1);
  assert.throws(() => writeFrame(socket, big), FrameTooLargeError);
  writeFrame(socket, big, MAX_FRAME + 1);
  assert.equal(bytes().length, 4 + big.length);
});
