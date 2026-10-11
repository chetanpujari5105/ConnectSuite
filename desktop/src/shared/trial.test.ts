import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import {
  CLOCK_TOLERANCE_MS,
  DAY_MS,
  TRIAL_TOKEN_PREFIX,
  assembleToken,
  encodePayload,
  enteredTokenDecision,
  evaluateTrial,
  nextMark,
  noticeDue,
  signingInput,
  verifyTrialToken,
  type TrialPayload,
} from './trial';

/**
 * The beta trial's pure core: the token format, Ed25519 verification, the verdict, the clock rule and
 * the copy. **Every key here is generated in memory for this run and never written** — a committed
 * fixture key is exactly what `scripts/check-no-private-keys.mjs` refuses.
 */

const issuer = generateKeyPairSync('ed25519');
const stranger = generateKeyPairSync('ed25519');
const PUBLIC = issuer.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const NOW = Date.UTC(2026, 9, 12, 12, 0, 0);

const payload = (over: Partial<TrialPayload> = {}): TrialPayload => ({
  v: 1,
  id: 'Zq3k9Xb2LmT7wP1s',
  label: 'Tester One',
  notBefore: new Date(NOW - DAY_MS).toISOString(),
  notAfter: new Date(NOW - DAY_MS + 45 * DAY_MS).toISOString(),
  ...over,
});

function mint(p: TrialPayload, key: KeyObject = issuer.privateKey): string {
  const body = encodePayload(p);
  return assembleToken(body, sign(null, Buffer.from(signingInput(body), 'ascii'), key));
}

// ---- format and signature -------------------------------------------------------------------

test('a token the issuer signed verifies, and carries exactly what was signed', () => {
  const r = verifyTrialToken(mint(payload()), PUBLIC);
  assert.equal(r.kind, 'ok');
  if (r.kind === 'ok') assert.deepEqual(r.payload, payload());
  assert.ok(mint(payload()).startsWith(`${TRIAL_TOKEN_PREFIX}.`));
});

test('pasting tolerates wrapped lines and surrounding spaces', () => {
  const t = mint(payload());
  const wrapped = `  ${t.slice(0, 30)}\n${t.slice(30, 70)}\r\n ${t.slice(70)}  \n`;
  assert.equal(verifyTrialToken(wrapped, PUBLIC).kind, 'ok');
});

test('wrong key: a token signed by anyone else is refused as a bad signature', () => {
  assert.equal(verifyTrialToken(mint(payload(), stranger.privateKey), PUBLIC).kind, 'bad-signature');
});

test('tampered fields: changing the end date, the label or the id breaks the signature', () => {
  const t = mint(payload());
  const [prefix, body, sig] = t.split('.');
  for (const change of [
    { notAfter: new Date(NOW + 400 * DAY_MS).toISOString() },
    { label: 'Someone Else' },
    { id: 'AAAAAAAAAAAAAAAA' },
    { notBefore: new Date(NOW - 30 * DAY_MS).toISOString() },
  ]) {
    const forged = `${prefix}.${encodePayload(payload(change))}.${sig}`;
    assert.equal(verifyTrialToken(forged, PUBLIC).kind, 'bad-signature', JSON.stringify(change));
  }
  // A flipped signature byte, the payload untouched.
  const bytes = Buffer.from(sig!, 'base64url');
  bytes[0] ^= 1;
  assert.equal(verifyTrialToken(`${prefix}.${body}.${bytes.toString('base64url')}`, PUBLIC).kind, 'bad-signature');
});

test('malformed text is told apart from a bad signature', () => {
  for (const text of ['', 'hello', 'SIDEKICK-TRIAL-1.', 'SIDEKICK-TRIAL-2.abc.def', `${TRIAL_TOKEN_PREFIX}.!!!.???`]) {
    assert.equal(verifyTrialToken(text, PUBLIC).kind, 'malformed', JSON.stringify(text));
  }
  // Well-formed and correctly signed, but the payload breaks the schema: still malformed, never ok.
  for (const bad of [{ v: 2 }, { label: '' }, { id: 'short' }, { notAfter: 'not a date' }, { notAfter: new Date(NOW - 5 * DAY_MS).toISOString() }]) {
    const t = mint(payload(bad as Partial<TrialPayload>));
    assert.equal(verifyTrialToken(t, PUBLIC).kind, 'malformed', JSON.stringify(bad));
  }
});

test('a build without a public key verifies nothing', () => {
  assert.equal(verifyTrialToken(mint(payload()), null).kind, 'no-key');
});

// ---- the verdict ----------------------------------------------------------------------------

const base = { enforced: true, keyPresent: true, now: NOW, mark: null as number | null };

test('valid: in its window, not blocking, with whole days left', () => {
  const v = evaluateTrial({ ...base, token: payload() });
  assert.equal(v.state, 'valid');
  assert.equal(v.blocks, false);
  assert.equal(v.daysLeft, 44);
  assert.match(v.line, /until .*44 days left/);
});

test('expired: at and after notAfter, blocking, saying nothing is lost and how to get a new token', () => {
  const p = payload();
  const end = Date.parse(p.notAfter);
  assert.equal(evaluateTrial({ ...base, now: end - 1, token: p }).state, 'valid');
  const v = evaluateTrial({ ...base, now: end, token: p });
  assert.equal(v.state, 'expired');
  assert.equal(v.blocks, true);
  assert.match(v.body, /new token/);
  assert.match(v.body, /Nothing has been deleted/);
});

test('not yet valid: before notBefore, blocking, naming the start date', () => {
  const p = payload({ notBefore: new Date(NOW + 2 * DAY_MS).toISOString(), notAfter: new Date(NOW + 47 * DAY_MS).toISOString() });
  const v = evaluateTrial({ ...base, token: p });
  assert.equal(v.state, 'not-yet');
  assert.equal(v.blocks, true);
});

test('empty store: no token, blocking, asking for one', () => {
  const v = evaluateTrial({ ...base, token: null });
  assert.equal(v.state, 'none');
  assert.equal(v.blocks, true);
  assert.match(v.body, /token/);
});

test('a build with no public key blocks, and says it is the build, not the person', () => {
  const v = evaluateTrial({ ...base, keyPresent: false, token: null });
  assert.equal(v.state, 'no-key');
  assert.equal(v.blocks, true);
});

test('not enforced (development only): never blocks', () => {
  for (const token of [null, payload({ notBefore: new Date(NOW - 90 * DAY_MS).toISOString(), notAfter: new Date(NOW - 45 * DAY_MS).toISOString() })]) {
    const v = evaluateTrial({ ...base, enforced: false, keyPresent: false, token });
    assert.equal(v.state, 'not-enforced');
    assert.equal(v.blocks, false);
  }
});

// ---- the clock ------------------------------------------------------------------------------

test('clock going backwards by more than a day blocks, in plain words and without blame', () => {
  const v = evaluateTrial({ ...base, token: payload(), mark: NOW + CLOCK_TOLERANCE_MS + 60_000 });
  assert.equal(v.state, 'clock-back');
  assert.equal(v.blocks, true);
  assert.match(v.body, /Date & Time/);
  assert.doesNotMatch(`${v.headline} ${v.body}`, /cheat|tamper|illegal|violat|suspicious|fraud/i);
});

test('clock: up to a day backwards is tolerated (travel, a correction, a timezone change)', () => {
  assert.equal(evaluateTrial({ ...base, token: payload(), mark: NOW + CLOCK_TOLERANCE_MS }).state, 'valid');
  assert.equal(evaluateTrial({ ...base, token: payload(), mark: NOW + 12 * 3_600_000 }).state, 'valid');
});

test('the mark only moves forward, and does not move while the clock is refused', () => {
  assert.equal(nextMark(null, NOW), NOW);
  assert.equal(nextMark(NOW, NOW + 5), NOW + 5);
  assert.equal(nextMark(NOW + 10 * 60_000, NOW), NOW + 10 * 60_000, 'a small step back keeps the mark');
  assert.equal(nextMark(NOW + 3 * DAY_MS, NOW), NOW + 3 * DAY_MS, 'a refused clock keeps the mark');
});

// ---- entering a token -----------------------------------------------------------------------

test('entering: a valid token is accepted; a newer one also resets the clock check', () => {
  const first = payload();
  const d1 = enteredTokenDecision({ current: null, entered: first, now: NOW });
  assert.equal(d1.accept, true);
  assert.equal(d1.resetMark, true, 'the first token starts the clock check fresh');
  const newer = payload({ id: 'Nw8sLq2Xc5Vb7Mz1', notBefore: new Date(NOW).toISOString(), notAfter: new Date(NOW + 45 * DAY_MS).toISOString() });
  const d2 = enteredTokenDecision({ current: first, entered: newer, now: NOW });
  assert.equal(d2.accept, true);
  assert.equal(d2.resetMark, true, 'a token issued later is the way back from a wrong clock');
  const older = enteredTokenDecision({ current: newer, entered: first, now: NOW });
  assert.equal(older.accept, true);
  assert.equal(older.resetMark, false, 'an older token can never reset the clock check');
});

test('entering: an expired or not-yet token is refused kindly and keeps what is there', () => {
  const ended = payload({ notBefore: new Date(NOW - 50 * DAY_MS).toISOString(), notAfter: new Date(NOW - 5 * DAY_MS).toISOString() });
  const d = enteredTokenDecision({ current: null, entered: ended, now: NOW });
  assert.equal(d.accept, false);
  assert.match(d.message, /ended on/);
  const later = payload({ notBefore: new Date(NOW + 3 * DAY_MS).toISOString(), notAfter: new Date(NOW + 48 * DAY_MS).toISOString() });
  const d2 = enteredTokenDecision({ current: null, entered: later, now: NOW });
  assert.equal(d2.accept, false);
  assert.match(d2.message, /starts on/);
});

test('reinstall: the same token gives the same end date — nothing about it depends on first launch', () => {
  const p = payload();
  const first = evaluateTrial({ ...base, token: p, mark: null });
  const reinstalled = evaluateTrial({ ...base, now: NOW + 30 * DAY_MS, token: p, mark: null });
  assert.equal(first.notAfter, reinstalled.notAfter);
  assert.equal(reinstalled.daysLeft, 14, 'thirty days later, the same token has fourteen left — not forty-four');
});

// ---- notices --------------------------------------------------------------------------------

test('notices: once at 7 days, once at 1 day, never repeated, never for a blocked state', () => {
  assert.equal(noticeDue({ state: 'valid', daysLeft: 8 }, []), null);
  assert.equal(noticeDue({ state: 'valid', daysLeft: 7 }, []), 7);
  assert.equal(noticeDue({ state: 'valid', daysLeft: 3 }, [7]), null);
  assert.equal(noticeDue({ state: 'valid', daysLeft: 1 }, [7]), 1);
  assert.equal(noticeDue({ state: 'valid', daysLeft: 1 }, []), 1, 'a person who skipped the 7-day window gets the 1-day one');
  assert.equal(noticeDue({ state: 'valid', daysLeft: 1 }, [7, 1]), null);
  assert.equal(noticeDue({ state: 'expired', daysLeft: 0 }, []), null);
});
