import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TXT_PAIR_INTENT, pairIntentKey, pairIntentMatches } from './protocol';

/**
 * F6 / P3 — the rule that decides whether an mDNS sighting is about **this** Mac.
 *
 * `docs/phase-7-pairing-flow.md` J1 and J2 are the same Mac screen: *code up, nothing scanned* and
 * *code up, scanned, phone now searching*. The phone publishes this attribute from the moment it
 * scans; this is the comparison the Mac makes against it.
 *
 * **What this file cannot test, said plainly:** whether a real phone publishes the record, whether
 * this Mac's mDNS browser sees it, and whether the pairing screen then draws the line. All three
 * need an unpaired phone and a scan, which needs somebody's hands. The Mac half is therefore
 * **unproven on hardware** and `docs/design-departures.md` says so beside the row.
 */

const OURS = 'AB:CD:EF:01:23:45:67:89:AA:BB:CC:DD:EE:FF:00:11';

test('the key is the first 16 hex characters, lowercase, colons removed', () => {
  assert.equal(pairIntentKey(OURS), 'abcdef0123456789');
  // The phone computes the same thing from the same fingerprint. A mismatch here is a pairing that
  // silently never reports a scan, which is indistinguishable from no scan.
  assert.equal(pairIntentKey(pairIntentKey(OURS)), 'abcdef0123456789');
});

test('a phone publishing our key matches', () => {
  assert.equal(pairIntentMatches({ [TXT_PAIR_INTENT]: 'abcdef0123456789' }, OURS), true);
  // Bytes on a wire: neither end owns the other's letter case.
  assert.equal(pairIntentMatches({ [TXT_PAIR_INTENT]: 'ABCDEF0123456789' }, OURS), true);
});

test('a phone pairing with a DIFFERENT Mac does not match', () => {
  // The failure this comparison exists to prevent is silent and flattering: a Mac that matched any
  // `pair` attribute on the network would say "a phone has scanned this code" over somebody else's
  // pairing, on the one screen where a stranger has no way to check it.
  assert.equal(pairIntentMatches({ [TXT_PAIR_INTENT]: '0123456789abcdef' }, OURS), false);
});

test('absent, empty and non-string all answer false rather than throwing', () => {
  // This runs inside a browser callback over records published by devices this app has never met.
  assert.equal(pairIntentMatches({}, OURS), false);
  assert.equal(pairIntentMatches({ [TXT_PAIR_INTENT]: '' }, OURS), false);
  assert.equal(pairIntentMatches({ [TXT_PAIR_INTENT]: 42 }, OURS), false);
  assert.equal(pairIntentMatches({ [TXT_PAIR_INTENT]: Buffer.from('abcdef0123456789') }, OURS), false);
  assert.equal(pairIntentMatches(undefined, OURS), false);
  assert.equal(pairIntentMatches(null, OURS), false);
  // Control: the same call with a real record still matches, so the falses above are the function
  // discriminating rather than refusing everything it is shown.
  assert.equal(pairIntentMatches({ [TXT_PAIR_INTENT]: 'abcdef0123456789' }, OURS), true);
});

test('no fingerprint of our own means no match, never a match on empty', () => {
  // `selfFingerprint` is null until the identity loads. An empty-vs-empty comparison would make
  // every phone on the network look like it had scanned this code.
  assert.equal(pairIntentMatches({ [TXT_PAIR_INTENT]: 'abcdef0123456789' }, ''), false);
});

test('a partial prefix is not a match', () => {
  // 16 characters is the agreed length. A truncated publication is a different phone or a different
  // build, and "close enough" on an identity comparison is how the wrong device gets confirmed.
  assert.equal(pairIntentMatches({ [TXT_PAIR_INTENT]: 'abcdef01' }, OURS), false);
  assert.equal(pairIntentMatches({ [TXT_PAIR_INTENT]: 'abcdef0123456789ff' }, OURS), false);
});
