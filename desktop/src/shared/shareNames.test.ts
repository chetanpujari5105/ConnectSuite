import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { candidateName, sanitizeShareName } from './shareNames';

/** The same cases the phone's ShareNamesTest reads — one fixture, two sanitisers held to it (plan G7). */
const fixture = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'docs', 'fixtures', 'share-names.json'), 'utf8'),
) as { cases: { why: string; in: string; out: string }[] };

test('every fixture case sanitises to its expected name', () => {
  assert.ok(fixture.cases.length >= 10, 'the fixture was read (control)');
  for (const c of fixture.cases) assert.equal(sanitizeShareName(c.in), c.out, c.why);
});

test('a long name is capped at 255 UTF-8 bytes, keeps its extension, and never splits a character', () => {
  const out = sanitizeShareName('é'.repeat(200) + '.txt');
  assert.ok(Buffer.byteLength(out) <= 255);
  assert.ok(out.endsWith('.txt'));
  assert.equal(Buffer.from(out).toString('utf8'), out);
});

test('candidate names count from the plain name', () => {
  assert.equal(candidateName('x.bin', 1), 'x.bin');
  assert.equal(candidateName('x.bin', 2), 'x (2).bin');
  assert.equal(candidateName('noext', 3), 'noext (3)');
  assert.equal(candidateName('.hidden', 2), '.hidden (2)');
});
