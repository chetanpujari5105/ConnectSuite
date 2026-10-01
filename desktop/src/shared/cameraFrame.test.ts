import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CameraFrameError, CameraFrameReader, cameraClaim, parseFrame } from './cameraFrame';
import { CAMERA_MAX_FRAME } from './protocol';

/**
 * The Mac's camera frame reader against the cross-language golden vector the phone's encoder is held
 * to (`docs/fixtures/camera-frame-v1.hex`, asserted by `CameraFrameCodecTest` on the phone). Generated
 * bytes only — no camera, no personal media.
 */

function golden(): Buffer {
  const text = readFileSync(join(__dirname, '../../../docs/fixtures/camera-frame-v1.hex'), 'utf8')
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('')
    .replace(/\s+/g, '');
  return Buffer.from(text, 'hex');
}

/** The golden frame with one byte changed — the malformed variants are each one mutation of it. */
function mutated(offset: number, value: number): Buffer {
  const bytes = Buffer.from(golden());
  bytes[offset] = value;
  return bytes;
}

/** The golden frame with its sequence replaced, for stream tests that need several frames. */
function withSequence(sequence: number): Buffer {
  const bytes = Buffer.from(golden());
  bytes.writeUInt32BE(sequence, 13 + 10);
  return bytes;
}

test('the golden vector parses to exactly the frame the phone encoded', () => {
  const frame = parseFrame(golden());
  assert.equal(frame.ptsUs, Number(0x0102030405060708n));
  assert.equal(frame.facing, 'front');
  assert.equal(frame.rotation, 3);
  assert.equal(frame.mirrored, true);
  assert.equal(frame.epoch, 7);
  assert.equal(frame.width, 1280);
  assert.equal(frame.height, 720);
  assert.equal(frame.sequence, 0x01020304);
  assert.deepEqual([...frame.jpeg], [0xff, 0xd8, 0xff, 0xd9]);
});

test('frames arriving a byte at a time come out whole, in order', () => {
  const reader = new CameraFrameReader();
  const stream = Buffer.concat([withSequence(1), withSequence(2), withSequence(3)]);
  const out: number[] = [];
  for (const byte of stream) out.push(...reader.push(Buffer.from([byte])).map((f) => f.sequence));
  assert.deepEqual(out, [1, 2, 3]);
});

test('every malformed shape the contract lists is refused', () => {
  const cases: Array<[string, Buffer]> = [
    ['keyframe bit clear', mutated(0, 0)],
    ['unknown version', mutated(13, 2)],
    ['unknown format', mutated(14, 2)],
    ['facing over 2', mutated(15, 3)],
    ['rotation over 3', mutated(16, 4)],
    ['reserved flag bit', mutated(17, 0x03)],
    ['reserved byte', mutated(13 + 14, 1)],
    ['zero width', (() => { const b = Buffer.from(golden()); b.writeUInt16BE(0, 13 + 6); return b; })()],
    ['width over 4096', (() => { const b = Buffer.from(golden()); b.writeUInt16BE(4097, 13 + 6); return b; })()],
    ['not a JPEG', mutated(13 + 16, 0x89)],
  ];
  for (const [name, bytes] of cases) {
    assert.throws(() => new CameraFrameReader().push(bytes), CameraFrameError, name);
  }
  // Control: the unmutated frame passes the same reader — so each refusal is about its mutation.
  assert.equal(new CameraFrameReader().push(golden()).length, 1);
});

test('a length over the cap is refused from the header alone, before any body is buffered', () => {
  const header = Buffer.alloc(13);
  header[0] = 1;
  header.writeUInt32BE(CAMERA_MAX_FRAME + 1, 9);
  assert.throws(() => new CameraFrameReader().push(header), /over the/);
  // Control: a length at the cap only waits for its body.
  const atCap = Buffer.from(header);
  atCap.writeUInt32BE(CAMERA_MAX_FRAME, 9);
  assert.deepEqual(new CameraFrameReader().push(atCap), []);
});

test('a payload too short to hold the camera header is refused', () => {
  const bytes = Buffer.from(golden().subarray(0, 13 + 17));
  bytes.writeUInt32BE(17, 9);
  assert.throws(() => parseFrame(bytes), /too short/);
});

test('a sequence that does not increase is refused — a replayed or reordered frame', () => {
  const reader = new CameraFrameReader();
  reader.push(withSequence(5));
  assert.throws(() => reader.push(withSequence(5)), /does not increase/);
  const again = new CameraFrameReader();
  again.push(withSequence(5));
  assert.throws(() => again.push(withSequence(4)), /does not increase/);
  // A gap is a dropped frame, not an error.
  const gap = new CameraFrameReader();
  gap.push(withSequence(5));
  assert.equal(gap.push(withSequence(9)).length, 1);
});

test('a reader that refused a frame stays closed', () => {
  const reader = new CameraFrameReader();
  assert.throws(() => reader.push(mutated(13, 9)));
  assert.throws(() => reader.push(withSequence(10)), /already closed/);
});

test('the claim is the token, the word, and the stream id', () => {
  assert.equal(cameraClaim('ab'.repeat(32), 'cd'.repeat(16)), `${'ab'.repeat(32)} camera ${'cd'.repeat(16)}`);
  assert.ok(Buffer.byteLength(cameraClaim('ab'.repeat(32), 'cd'.repeat(16))) <= 128);
});
