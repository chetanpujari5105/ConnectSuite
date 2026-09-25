import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { MAC_EXT, SHARE_FILE, negotiate, negotiateAll, parseExt } from './extensions';

/** The same cases the phone's ExtensionsTest reads — one fixture, two parsers held to it. */
const fixture = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'docs', 'fixtures', 'ext-negotiation.json'), 'utf8'),
) as {
  parse: { why: string; raw: unknown; out: Record<string, number> }[];
  negotiate: { why: string; mine: Record<string, number>; theirs: Record<string, number>; out: number | null }[];
};

test('the fixture was read (control)', () => {
  assert.ok(fixture.parse.length >= 10);
  assert.ok(fixture.negotiate.length >= 4);
});

test('every parse case from the shared fixture', () => {
  for (const c of fixture.parse) {
    // `{"absent": true}` models the key being missing entirely.
    const raw =
      c.raw !== null && typeof c.raw === 'object' && !Array.isArray(c.raw) && Object.keys(c.raw).length === 1 && 'absent' in c.raw
        ? undefined
        : c.raw;
    assert.deepEqual(parseExt(raw), c.out, c.why);
  }
});

test('every negotiate case from the shared fixture', () => {
  for (const c of fixture.negotiate) {
    assert.equal(negotiate(c.mine, c.theirs, SHARE_FILE), c.out, c.why);
  }
});

test('this Mac advertises share.file 1, and negotiateAll keeps only what both advertise', () => {
  assert.deepEqual({ ...MAC_EXT }, { 'share.file': 1 });
  assert.deepEqual(negotiateAll(MAC_EXT, { 'share.file': 3, other: 1 }), { 'share.file': 1 });
  assert.deepEqual(negotiateAll(MAC_EXT, {}), {});
  assert.deepEqual(negotiateAll({}, { 'share.file': 1 }), {});
});

test('share.file 3 negotiates by the same min rule — 3+3 is 3, 3+2 and 2+3 are 2 (fixtures only; nothing advertises 3)', () => {
  assert.equal(negotiate({ 'share.file': 3 }, { 'share.file': 3 }, 'share.file'), 3);
  assert.equal(negotiate({ 'share.file': 3 }, { 'share.file': 2 }, 'share.file'), 2);
  assert.equal(negotiate({ 'share.file': 2 }, { 'share.file': 3 }, 'share.file'), 2);
});
