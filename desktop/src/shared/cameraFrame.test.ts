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

// ---- fragmentation, coalescing and hostile bytes (2026-10-03) ----------------------------------------
// Explicit bounds, set before the runs: a seeded generator, 400 split runs of a 25-frame stream, 2,000
// random-byte inputs of at most 2 KiB each. Nothing here allocates more than the stream itself.

/** A small seeded generator (mulberry32), so a failure names the seed that produced it. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('any split of a stream into chunks yields the same frames, in order (400 seeded runs)', () => {
  const stream = Buffer.concat(Array.from({ length: 25 }, (_, i) => withSequence(i + 1)));
  for (let seed = 1; seed <= 400; seed++) {
    const next = rng(seed);
    const reader = new CameraFrameReader();
    const seen: number[] = [];
    let at = 0;
    while (at < stream.length) {
      const size = 1 + Math.floor(next() * 90);
      for (const f of reader.push(stream.subarray(at, at + size))) seen.push(f.sequence);
      at += size;
    }
    assert.deepEqual(seen, Array.from({ length: 25 }, (_, i) => i + 1), `seed ${seed}`);
  }
});

test('many frames coalesced into one chunk all come out of one push', () => {
  const stream = Buffer.concat(Array.from({ length: 200 }, (_, i) => withSequence(i + 1)));
  const frames = new CameraFrameReader().push(stream);
  assert.equal(frames.length, 200);
  assert.equal(frames.at(-1)!.sequence, 200);
});

test('a frame split inside its header or its JPEG is held until whole, then parsed once', () => {
  const frame = golden();
  for (const cut of [1, 12, 13, 14, 28, 29, frame.length - 1]) {
    const reader = new CameraFrameReader();
    assert.deepEqual(reader.push(frame.subarray(0, cut)), [], `cut ${cut}`);
    assert.equal(reader.push(frame.subarray(cut)).length, 1, `cut ${cut}`);
  }
});

test('the size rules hold for height too, and for the second reserved byte; an equal sequence is refused', () => {
  const height = (h: number) => { const b = Buffer.from(golden()); b.writeUInt16BE(h, 13 + 8); return b; };
  assert.throws(() => new CameraFrameReader().push(height(0)), CameraFrameError);
  assert.throws(() => new CameraFrameReader().push(height(4097)), CameraFrameError);
  assert.equal(new CameraFrameReader().push(height(4096)).length, 1, 'control: 4096 is allowed');
  assert.throws(() => new CameraFrameReader().push(mutated(13 + 15, 1)), CameraFrameError);
  const reader = new CameraFrameReader();
  reader.push(withSequence(5));
  assert.throws(() => reader.push(withSequence(5)), CameraFrameError, 'a repeated sequence is not an increase');
});

test('hostile bytes only ever produce frames or a CameraFrameError — never another exception (2,000 seeded inputs)', () => {
  let refused = 0;
  let accepted = 0;
  for (let seed = 1; seed <= 2000; seed++) {
    const next = rng(seed);
    // Half start from a real frame with bytes flipped, half are noise; both bounded at 2 KiB.
    const base = seed % 2 === 0 ? Buffer.from(golden()) : Buffer.alloc(1 + Math.floor(next() * 2048));
    for (let i = 0; i < base.length; i++) if (seed % 2 === 1 || next() < 0.05) base[i] = Math.floor(next() * 256);
    try {
      accepted += new CameraFrameReader().push(base).length;
    } catch (error) {
      assert.ok(error instanceof CameraFrameError, `seed ${seed}: ${String(error)}`);
      refused += 1;
    }
  }
  assert.ok(refused > 0, 'control: hostile input was refused at least once');
  assert.ok(accepted >= 0);
});
