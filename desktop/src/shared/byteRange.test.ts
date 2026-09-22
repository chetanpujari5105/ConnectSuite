import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseByteRange } from './byteRange';

test('no Range header is the whole file', () => {
  assert.deepEqual(parseByteRange(undefined, 1000), { kind: 'full' });
});

test('an open-ended range — what a <video> sends to start and to seek', () => {
  assert.deepEqual(parseByteRange('bytes=0-', 1000), { kind: 'partial', start: 0, end: 999 });
  assert.deepEqual(parseByteRange('bytes=600-', 1000), { kind: 'partial', start: 600, end: 999 });
});

test('a closed range is clamped to the file, never past its last byte', () => {
  assert.deepEqual(parseByteRange('bytes=10-19', 1000), { kind: 'partial', start: 10, end: 19 });
  assert.deepEqual(parseByteRange('bytes=900-5000', 1000), { kind: 'partial', start: 900, end: 999 });
});

test('a suffix range is the last n bytes', () => {
  assert.deepEqual(parseByteRange('bytes=-100', 1000), { kind: 'partial', start: 900, end: 999 });
  assert.deepEqual(parseByteRange('bytes=-5000', 1000), { kind: 'partial', start: 0, end: 999 });
});

test('a range starting at or past the end is unsatisfiable (416), not the whole file', () => {
  assert.deepEqual(parseByteRange('bytes=1000-', 1000), { kind: 'unsatisfiable' });
  assert.deepEqual(parseByteRange('bytes=20-10', 1000), { kind: 'unsatisfiable' });
});

test('a header it does not understand — multi-range, another unit — is answered with the whole file', () => {
  assert.deepEqual(parseByteRange('bytes=0-1,5-9', 1000), { kind: 'full' });
  assert.deepEqual(parseByteRange('items=0-1', 1000), { kind: 'full' });
});
