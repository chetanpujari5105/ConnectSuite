import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { TransferDigest } from './transferDigest';

/**
 * The resumed digest — the failure that reports corruption on a perfectly good file.
 *
 * Written **before** the receiver that will use it, deliberately: this is the one fault in the
 * transfer path that destroys data while claiming to protect it, so it is built and shown to fail
 * before anything can be written on top of a version that has it.
 *
 * The assertion throughout is the one the spec names: a **resumed transfer's digest equals a
 * whole-file digest of the same source.** Not that the transfer reported success — that is the thing
 * under test, and a digest computed the same wrong way on both ends would agree with itself and pass.
 */

const source = randomBytes(300_000);
const wholeFile = createHash('sha256').update(source).digest('hex');
const OFFSET = 120_000;

/** A `.part` holding the first [bytes] of the source, as an interrupted transfer would leave. */
function partialOnDisk(bytes: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'connectsuite-digest-'));
  const path = join(dir, 'holiday.mov.part');
  writeFileSync(path, source.subarray(0, bytes));
  return path;
}

test('a resumed digest equals a whole-file digest of the same source', async () => {
  // The whole test, in one assertion. The receiver holds 120,000 bytes and 180,000 arrive; what it
  // computes must be indistinguishable from hashing the file in one pass.
  const part = partialOnDisk(OFFSET);
  const digest = new TransferDigest();
  await digest.primeFrom(part, OFFSET);
  digest.update(source.subarray(OFFSET));

  assert.equal(digest.digest(OFFSET), wholeFile);
  assert.deepEqual(digest.counts(), {
    primed: OFFSET,
    appended: source.length - OFFSET,
    total: source.length,
  });
});

test('a digest started at the offset does NOT match, which is the bug this file exists for', async () => {
  // The red-first case, kept as a permanent test rather than a temporary experiment. This is what
  // the broken implementation computes: the tail only. Asserting it is *different* from the
  // whole-file digest is what gives the test above its meaning — without it, the first test would
  // pass on any implementation that happened to hash the same bytes twice.
  const tailOnly = createHash('sha256').update(source.subarray(OFFSET)).digest('hex');
  assert.notEqual(
    tailOnly,
    wholeFile,
    'if these were equal the whole resumed-digest problem would not exist',
  );

  // And the object refuses to produce that answer at all: a resume that never primed throws rather
  // than returning a confident wrong digest. The difference between a stack trace and a deleted
  // file.
  const unprimed = new TransferDigest();
  unprimed.update(source.subarray(OFFSET));
  assert.throws(() => unprimed.digest(OFFSET), /without priming/);
});

test('a transfer that never resumed needs no priming and still matches', async () => {
  // offset 0 is every transfer today. It must not be made to carry the resume machinery.
  const digest = new TransferDigest();
  digest.update(source);
  assert.equal(digest.digest(0), wholeFile);
});

test('a partial shorter than the offset is refused rather than digested', async () => {
  // The lookalike failure: the receiver believes it holds 120,000 bytes and the file holds 90,000.
  // Digesting what is there would produce a wrong digest that *looks* computed correctly, and the
  // mismatch would then be blamed on the transfer. Refusing names the real fault.
  const short = partialOnDisk(90_000);
  const digest = new TransferDigest();
  await assert.rejects(() => digest.primeFrom(short, OFFSET), /90000 bytes where 120000/);
});

test('priming after bytes have arrived is refused, because the order is the rule', async () => {
  // Priming late would hash the tail and then the head — same bytes, wrong order, different digest.
  // SHA-256 is not commutative and this is the one place someone might assume otherwise.
  const part = partialOnDisk(OFFSET);
  const digest = new TransferDigest();
  digest.update(source.subarray(OFFSET));
  await assert.rejects(() => digest.primeFrom(part, OFFSET), /before any chunk is appended/);
});

test('the order matters, demonstrated rather than asserted', () => {
  // Why the previous test is not pedantry: hashing the same two pieces in the other order gives a
  // different answer, so "the digest covers every byte" is not sufficient — it has to cover them in
  // the file's order.
  const forwards = createHash('sha256')
    .update(source.subarray(0, OFFSET))
    .update(source.subarray(OFFSET))
    .digest('hex');
  const backwards = createHash('sha256')
    .update(source.subarray(OFFSET))
    .update(source.subarray(0, OFFSET))
    .digest('hex');
  assert.equal(forwards, wholeFile);
  assert.notEqual(backwards, wholeFile);
});
