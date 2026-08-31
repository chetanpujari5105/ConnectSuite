import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  FAILED_SUFFIX,
  PART_SUFFIX,
  failedPathFor,
  isResumable,
  partPathFor,
  sidecarText,
} from './transferFiles';

/**
 * The on-disk convention, and the one part of it that can actually be enforced.
 *
 * The spec's own table splits this convention into three claims with three different answers. Two
 * are enforceable and are checked here. The third — *nothing else on the phone leaves a `.part` in a
 * folder we can see* — has **no enforcement and cannot have one**, and the last test in this file is
 * the closest thing to it: not a check on other software, which is impossible, but a check that our
 * code refuses to act on a filename it has no record of.
 */

test('the suffixes are declared in exactly one module', () => {
  // The same shape as stylesheets.test.ts failing on a selector declared in two sheets. A literal
  // '.part' built inline wherever a path is needed is how two spellings of one rule start to
  // disagree — and the disagreement would be silent, because both would still produce a filename.
  const root = join(import.meta.dirname, '..');
  const offenders: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      // This module owns the literals, and this test names them to check for them.
      if (entry.name === 'transferFiles.ts' || entry.name === 'transferFiles.test.ts') continue;
      const text = readFileSync(path, 'utf8');
      for (const literal of [`'${PART_SUFFIX}'`, `'${FAILED_SUFFIX}'`]) {
        if (text.includes(literal)) offenders.push(`${entry.name} spells ${literal} inline`);
      }
    }
  };
  walk(root);

  assert.deepEqual(
    offenders,
    [],
    `these files build a transfer suffix themselves instead of importing it: ${offenders.join(', ')}`,
  );
});

test('control — the scan can see a suffix where one exists', () => {
  // Without this the test above passes trivially the day the walk breaks, which is the empty
  // accessibility query in a different costume: a check that cannot find its target reports clean.
  const text = readFileSync(join(import.meta.dirname, 'transferFiles.ts'), 'utf8');
  assert.ok(text.includes(`'${PART_SUFFIX}'`), 'the owning module must contain the literal');
  assert.ok(text.includes(`'${FAILED_SUFFIX}'`), 'the owning module must contain the literal');
});

test('the three states have three distinct names', () => {
  assert.equal(partPathFor('/tmp/holiday.mov'), '/tmp/holiday.mov.part');
  assert.equal(failedPathFor('/tmp/holiday.mov'), '/tmp/holiday.mov.failed');
  assert.notEqual(partPathFor('/tmp/a'), failedPathFor('/tmp/a'));
});

test('a partial we have no record of is another app\'s file and is not resumed', () => {
  // The unenforceable row, met the only way it can be: we cannot stop a browser writing a `.part`
  // into DCIM, so our code refuses to treat a filename as permission to append. This is the
  // assertion that keeps the convention a display convenience rather than something load-bearing.
  const verdict = isResumable({ partBytes: 5_000, recordedBytes: null, totalBytes: 10_000 });
  assert.equal(verdict.resume, false);
  assert.match(verdict.resume === false ? verdict.reason : '', /another app/);
});

test('a partial longer than our record is refused rather than appended to', () => {
  const verdict = isResumable({ partBytes: 9_000, recordedBytes: 5_000, totalBytes: 10_000 });
  assert.equal(verdict.resume, false);
  assert.match(verdict.resume === false ? verdict.reason : '', /9000 bytes where our record says 5000/);
});

test('a matching partial resumes from its own length', () => {
  const verdict = isResumable({ partBytes: 5_000, recordedBytes: 5_000, totalBytes: 10_000 });
  assert.deepEqual(verdict, { resume: true, offset: 5_000 });
});

test('a partial already the full length is not resumed', () => {
  // Zero bytes left to fetch is not a resume, it is a finished transfer nobody renamed. Handing an
  // offset equal to the total to the phone would ask for an empty stream and hang.
  const verdict = isResumable({ partBytes: 10_000, recordedBytes: 10_000, totalBytes: 10_000 });
  assert.equal(verdict.resume, false);
});

test('the sidecar carries the fact and not the bytes', () => {
  const text = sidecarText({
    name: 'holiday.mov',
    whenIso: '2026-09-01T18:22:04.117+05:30',
    bytes: 214748364,
    expected: '6f3b9c1a',
    actual: 'b81e04d7',
  });
  assert.match(text, /checksum mismatch/);
  assert.match(text, /holiday\.mov/);
  assert.match(text, /expected {2}6f3b9c1a/);
  assert.match(text, /actual {4}b81e04d7/);
  // The two sentences that tell a person what to do, which is the reason it is a text file at all.
  assert.match(text, /deleted because the bytes that arrived were wrong/);
  assert.match(text, /retry starts from zero/);
});
