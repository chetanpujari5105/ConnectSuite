import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { pairRejectionCopy } from './pairRejection';
import type { PairRejected } from './protocol';

const SELF = 'AB:CD:EF:01:23:45:67:89';
const OTHER = '11:22:33:44:55:66:77:88';

const rejection = (over: Partial<PairRejected> = {}): PairRejected => ({
  reason: 'TOKEN_EXPIRED',
  fingerprint: SELF,
  message: 'The pairing code expired. Show a fresh one on the Mac and scan it again.',
  ...over,
});

test('each known reason has its own headline, and none is the phone’s raw sentence', () => {
  const seen = new Set<string>();
  for (const reason of ['TOKEN_EXPIRED', 'TOKEN_MISMATCH', 'TOKEN_MISSING', 'UPGRADE_REQUIRED', 'PROOF_INVALID', 'NOT_ARMED', 'TOO_MANY_ATTEMPTS'] as const) {
    const copy = pairRejectionCopy(rejection({ reason }), SELF);
    assert.ok(copy, `${reason} must produce copy`);
    assert.ok(copy.headline.length > 0 && copy.body.length > 0);
    assert.notEqual(copy.body, rejection().message, 'the contract says prefer our own copy');
    assert.ok(!seen.has(copy.headline), `${reason} reuses another reason’s headline`);
    seen.add(copy.headline);
  }
});

test('every rejection asks for a fresh code — a dead end is the silent no-op', () => {
  for (const reason of ['TOKEN_EXPIRED', 'TOKEN_MISMATCH', 'TOKEN_MISSING', 'UPGRADE_REQUIRED', 'PROOF_INVALID', 'NOT_ARMED', 'TOO_MANY_ATTEMPTS'] as const) {
    assert.equal(pairRejectionCopy(rejection({ reason }), SELF)?.refreshCode, true);
  }
});

// --- the fingerprint gate ------------------------------------------------------------------------

test('a rejection meant for ANOTHER Mac is not rendered', () => {
  assert.equal(
    pairRejectionCopy(rejection({ fingerprint: OTHER }), SELF),
    null,
    'telling this user their pairing failed when another Mac was refused is a false alarm on the first screen a stranger sees',
  );
});

test('the fingerprint match ignores case and separators, as the pinning comparison does', () => {
  assert.ok(pairRejectionCopy(rejection({ fingerprint: 'abcdef0123456789' }), SELF));
  assert.ok(pairRejectionCopy(rejection({ fingerprint: SELF.toLowerCase() }), SELF));
});

test('a rejection with NO fingerprint is accepted — absent means "cannot say", not "not yours"', () => {
  assert.ok(pairRejectionCopy(rejection({ fingerprint: undefined }), SELF));
});

test('and when this Mac does not know its own fingerprint yet, it does not filter', () => {
  assert.ok(pairRejectionCopy(rejection({ fingerprint: OTHER }), null));
});

// --- forwards compatibility ----------------------------------------------------------------------

test('an unknown reason from a newer phone falls back to the phone’s sentence', () => {
  const copy = pairRejectionCopy(
    rejection({ reason: 'TOKEN_REVOKED' as never, message: 'You revoked this Mac.' }),
    SELF,
  );
  assert.ok(copy);
  assert.equal(copy.body, 'You revoked this Mac.');
  assert.equal(copy.refreshCode, true);
});

test('an unknown reason with no sentence still tells the user what to do', () => {
  const copy = pairRejectionCopy(
    rejection({ reason: 'WHATEVER' as never, message: undefined }),
    SELF,
  );
  assert.ok(copy);
  assert.ok(copy.body.length > 0, 'never a dead end');
});

test('an unknown reason with a blank sentence does not render an empty body', () => {
  const copy = pairRejectionCopy(rejection({ reason: 'X' as never, message: '   ' }), SELF);
  assert.ok(copy && copy.body.trim().length > 0);
});

// --- no raw material reaches a person -------------------------------------------------------------

test('no copy contains a fingerprint, a code or a wire constant', () => {
  for (const reason of ['TOKEN_EXPIRED', 'TOKEN_MISMATCH', 'TOKEN_MISSING', 'UPGRADE_REQUIRED', 'PROOF_INVALID', 'NOT_ARMED', 'TOO_MANY_ATTEMPTS'] as const) {
    const copy = pairRejectionCopy(rejection({ reason }), SELF);
    const text = `${copy?.headline} ${copy?.body}`;
    assert.ok(!/\b[A-Z]{3,}_[A-Z_]{3,}\b/.test(text), `${reason} leaks a wire constant into the UI`);
    assert.ok(!/[0-9A-F]{2}:[0-9A-F]{2}/i.test(text), `${reason} leaks a fingerprint`);
  }
});
