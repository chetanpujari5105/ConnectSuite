import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  KeyframeQueue,
  WEBCAM_FAILURE_DETAILS,
  WEBCAM_STOPPED_REASONS,
  WEBCAM_STOP_REASON_FOR_CAUSE,
  WEBCAM_MAX_AU,
  WebcamStreamError,
  WebcamStreamReader,
  webcamClaim,
  webcamExt,
} from './webcamWire';

/** The golden AU, read in place: one copy of the wire bytes for the phone, the bridge and main. */
function golden(): Buffer {
  const text = readFileSync(join(__dirname, '../../../docs/fixtures/webcam-au-v1.hex'), 'utf8')
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('')
    .replace(/\s+/g, '');
  return Buffer.from(text, 'hex');
}

const T = { timeout: 5_000 };

test('the golden AU: one frame, verbatim, an IDR with SPS and PPS, generation 7', T, () => {
  const bytes = golden();
  assert.equal(bytes.length, 13 + 40, 'the fixture is what its comment says');
  const frames = new WebcamStreamReader().push(bytes);
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0]!.bytes, bytes);
  assert.equal(frames[0]!.keyframe, true);
  assert.equal(frames[0]!.generation, 7);
});

test('split into single bytes and coalesced three-in-one read the same', T, () => {
  const one = golden();
  const split = new WebcamStreamReader();
  const fromSplit = [];
  for (const b of one) fromSplit.push(...split.push(Buffer.from([b])));
  assert.equal(fromSplit.length, 1);
  assert.deepEqual(fromSplit[0]!.bytes, one);
  const together = new WebcamStreamReader().push(Buffer.concat([one, one, one]));
  assert.equal(together.length, 3);
  for (const f of together) assert.deepEqual(f.bytes, one);
});

test('a forwarded AU is a copy: the reader moving on cannot change it', T, () => {
  const reader = new WebcamStreamReader();
  const two = Buffer.concat([golden(), golden()]);
  const [first] = reader.push(two.subarray(0, 53));
  two.fill(0);
  assert.deepEqual(first!.bytes, golden());
});

test('a length over 2 MiB is refused from the header alone, before any body is buffered', T, () => {
  const head = Buffer.from(golden().subarray(0, 13));
  head.writeUInt32BE(WEBCAM_MAX_AU + 1, 9);
  const reader = new WebcamStreamReader();
  assert.throws(() => reader.push(head), WebcamStreamError);
  assert.equal(reader.buffered, 0);
  // Control: a legal length with its body still to come is buffered, not refused.
  const ok = Buffer.from(golden().subarray(0, 20));
  const r2 = new WebcamStreamReader();
  assert.deepEqual(r2.push(ok), []);
  assert.equal(r2.buffered, 20);
});

test('what main cannot frame closes the stream, and a spent reader stays spent', T, () => {
  const cases: Array<[string, (b: Buffer) => void]> = [
    ['payload under 21 bytes', (b) => b.writeUInt32BE(20, 9)],
    ['reserved frame flag', (b) => b.writeUInt8(0x07, 0)],
    ['webcam version 2', (b) => b.writeUInt8(2, 13)],
    ['codec 2', (b) => b.writeUInt8(2, 14)],
    ['generation 0', (b) => b.writeUInt16BE(0, 13 + 6)],
  ];
  for (const [name, mutate] of cases) {
    const bytes = golden();
    mutate(bytes);
    const reader = new WebcamStreamReader();
    assert.throws(() => reader.push(bytes), WebcamStreamError, name);
    assert.throws(() => reader.push(golden()), /already closed/, `${name}: spent`);
  }
});

test('the claim is the token, the word webcam and the session id — 104 bytes — and refuses anything malformed', T, () => {
  const claim = webcamClaim('a'.repeat(64), '0123456789abcdef0123456789abcdef');
  assert.equal(claim, `${'a'.repeat(64)} webcam 0123456789abcdef0123456789abcdef`);
  assert.equal(Buffer.byteLength(claim), 104);
  assert.throws(() => webcamClaim('a'.repeat(63), '0123456789abcdef0123456789abcdef'));
  assert.throws(() => webcamClaim('a'.repeat(64), '0123456789ABCDEF0123456789abcdef'));
  assert.throws(() => webcamClaim('a'.repeat(64), '0123 camera 6789abcdef0123456789ab'));
});

test('ext.webcam is advertised only with the development gate (or release flag) open AND the bridge present', T, () => {
  assert.deepEqual(webcamExt({ packaged: false, devSwitch: true, bridgePresent: true }), { webcam: 1 });
  assert.deepEqual(webcamExt({ packaged: false, devSwitch: true, bridgePresent: false }), {});
  assert.deepEqual(webcamExt({ packaged: false, devSwitch: false, bridgePresent: true }), {});
  assert.deepEqual(webcamExt({ packaged: true, devSwitch: true, bridgePresent: true }), {}, 'a packaged build ignores the dev switch');
  assert.deepEqual(webcamExt({ packaged: true, devSwitch: false, bridgePresent: true, release: true }), { webcam: 1 });
  assert.deepEqual(webcamExt({ packaged: true, devSwitch: false, bridgePresent: false, release: true }), {});
});

test('KeyframeQueue: bounded, a keyframe replaces what waits, and after a drop only a keyframe passes', T, () => {
  const q = new KeyframeQueue<number>(4);
  assert.equal(q.offer(1, true), true);
  for (const n of [2, 3, 4]) assert.equal(q.offer(n, false), true);
  assert.equal(q.offer(5, false), false, 'full');
  assert.equal(q.offer(6, false), false, 'waiting for a keyframe even if room appears');
  assert.equal(q.shift(), 1);
  assert.equal(q.offer(7, false), false, 'room, but the chain is broken');
  assert.equal(q.offer(8, true), true, 'a keyframe with room joins the queue');
  assert.equal(q.length, 4);
  assert.equal(q.offer(9, false), false, 'full again');
  assert.equal(q.offer(10, true), true, 'full: the keyframe replaces everything waiting');
  assert.equal(q.length, 1);
  assert.equal(q.shift(), 10);
  assert.equal(q.dropped, 4 + 4, 'four refused one by one, four discarded by the keyframe');
});

test('KeyframeQueue counts a slot held in flight against the bound', T, () => {
  const q = new KeyframeQueue<number>(4);
  for (const n of [1, 2, 3]) q.offer(n, n === 1, 1);
  assert.equal(q.offer(4, false, 1), false, 'three held plus one in flight is four');
  const all = new KeyframeQueue<number>(1);
  assert.equal(all.offer(1, true, 1), false, 'every slot in flight: even a keyframe cannot be held');
  assert.equal(all.waitingForKeyframe, true);
});

/** docs/fixtures/webcam-vocabulary-v1.json, read in place: the phone and the bridge read the same file. */
function vocabulary(): { stopCauses: Record<string, string>; failureDetails: string[]; stoppedReasons: string[]; streamFaults: string[] } {
  return JSON.parse(readFileSync(join(__dirname, '../../../docs/fixtures/webcam-vocabulary-v1.json'), 'utf8'));
}

test("the stop vocabulary is the contract's, and failure is a cause of its own", T, () => {
  const v = vocabulary();
  assert.deepEqual({ ...WEBCAM_STOP_REASON_FOR_CAUSE }, v.stopCauses);
  assert.deepEqual([...WEBCAM_FAILURE_DETAILS], v.failureDetails);
  assert.deepEqual([...WEBCAM_STOPPED_REASONS], v.stoppedReasons);
  // The correction itself: a Mac that could not continue is not worded as somebody pressing Stop.
  assert.equal(WEBCAM_STOP_REASON_FOR_CAUSE.failure, 'mac-failed');
  assert.notEqual(WEBCAM_STOP_REASON_FOR_CAUSE.failure, WEBCAM_STOP_REASON_FOR_CAUSE.person);
});

test("the phone's writer output (docs/fixtures/webcam-phone-stream-v1.hex) frames on main's reader, split anywhere", T, () => {
  // Written by camera-module's production path from real H.264; the Swift bridge decodes the same bytes.
  const lines = readFileSync(join(__dirname, '../../../docs/fixtures/webcam-phone-stream-v1.hex'), 'utf8')
    .split('\n')
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  const stream = Buffer.from(lines.join(''), 'hex');
  const whole = new WebcamStreamReader().push(stream);
  assert.equal(whole.length, 9);
  assert.deepEqual(whole.map((f) => f.generation), [1, 1, 1, 1, 1, 1, 2, 2, 2]);
  assert.deepEqual(whole.map((f) => f.keyframe), [true, false, false, false, true, false, true, false, false]);
  assert.deepEqual(whole.map((f) => f.bytes.toString('hex')), lines, 'each AU forwarded verbatim');
  // Byte-at-a-time and odd chunkings read the same nine AUs.
  for (const size of [1, 7, 1000]) {
    const reader = new WebcamStreamReader();
    const got = [];
    for (let i = 0; i < stream.length; i += size) got.push(...reader.push(stream.subarray(i, i + size)));
    assert.equal(got.length, 9, `chunks of ${size}`);
    assert.ok(reader.buffered === 0);
  }
});
