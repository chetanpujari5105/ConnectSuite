import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import {
  CLOCK_TOLERANCE_MS,
  DAY_MS,
  TRIAL_TOKEN_PREFIX,
  assembleToken,
  describeRefusedText,
  encodePayload,
  enteredTokenDecision,
  enteredTokenMessage,
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

// ---- a forgiving paste (2026-10-14, the owner's first install) --------------------------------------
//
// What a person's copy actually delivers: wrapped, quoted, autocorrected, with invisible characters or
// inside a whole message. Each corruption must clean back to **the exact token that was issued** — the
// same Ed25519 check then runs on it — and every refusal below must keep the reason it had before.

const TOKEN = mint(payload());
const ok = (text: string) => {
  const r = verifyTrialToken(text, PUBLIC);
  assert.equal(r.kind, 'ok', JSON.stringify(text));
  if (r.kind === 'ok') assert.equal(r.token, TOKEN, `cleaned to something other than the issued token: ${JSON.stringify(text)}`);
};
const why = (text: string) => {
  const r = verifyTrialToken(text, PUBLIC);
  return r.kind === 'malformed' ? r.why : r.kind;
};

test('control: the issued token verifies and comes back unchanged', () => ok(TOKEN));

test('paste: spaces and line breaks inside the token are removed', () => {
  ok(TOKEN.replace(/(.{20})/g, '$1 '));
  ok(TOKEN.replace(/(.{37})/g, '$1\r\n'));
  ok(`\t${TOKEN.slice(0, 50)} ${TOKEN.slice(50)} `);
});

test('paste: wrapping quotes and backticks are stripped, straight or curly', () => {
  for (const [a, b] of [['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’'], ['«', '»'], ['`', '`'], ['```\n', '\n```'], ['"`', '`"']]) {
    ok(`${a}${TOKEN}${b}`);
  }
});

test('paste: look-alike dashes in the prefix (autocorrect) are put back', () => {
  for (const dash of ['‐', '‑', '‒', '–', '—', '−', '－']) {
    ok(TOKEN.replace(/^SIDEKICK-TRIAL-1/, `SIDEKICK${dash}TRIAL${dash}1`));
  }
});

test('paste: zero-width and invisible characters are removed', () => {
  for (const ch of ['​', '‌', '‍', '⁠', '﻿', '­']) {
    ok(`${ch}${TOKEN.slice(0, 40)}${ch}${TOKEN.slice(40)}${ch}`);
  }
});

test('paste: trailing punctuation is accepted', () => {
  for (const end of ['.', ',', ';', ':', '!', '?', ')', '…', '."', ').']) ok(`${TOKEN}${end}`);
  ok(`(${TOKEN})`);
  ok(`<${TOKEN}>`);
});

test('paste: the token is found inside a longer message, even wrapped and quoted', () => {
  ok(`Hi! Here is your Sidekick beta token:\n\n${TOKEN}\n\nThanks — see you soon.`);
  ok(`Your token: “${TOKEN.slice(0, 60)}\n${TOKEN.slice(60)}”. Any trouble, reply to tester@example.com or see https://example.com/help`);
  ok(`Token${TOKEN}Thanks`);
});

test('paste: every corruption at once still cleans to the issued token', () => {
  ok(`> “​${TOKEN.replace(/^SIDEKICK-TRIAL-1/, 'SIDEKICK–TRIAL–1').replace(/(.{45})/g, '$1\n> ')}”.`);
});

// The refusals keep their reasons.

test('refused as before: a cut-off token is malformed, and says it is cut off', () => {
  for (const cut of [1, 2, 20, 86, 87, TOKEN.length - 20]) {
    const text = TOKEN.slice(0, TOKEN.length - cut);
    assert.equal(verifyTrialToken(text, PUBLIC).kind, 'malformed', `less its last ${cut}`);
    assert.equal(why(text), 'cut-off', `less its last ${cut}`);
  }
  assert.equal(why(`“${TOKEN.slice(0, -10)}…”`), 'cut-off', 'quoted and visibly truncated');
  assert.equal(why(TOKEN.slice(10)), 'cut-off', 'the start is missing');
});

test('refused as before: one character changed anywhere in the payload or signature is a bad signature', () => {
  const start = TRIAL_TOKEN_PREFIX.length + 1;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let checked = 0;
  for (let i = start; i < TOKEN.length; i++) {
    if (TOKEN[i] === '.') continue;
    for (const offset of [1, 17]) {
      const swapped = alphabet[(alphabet.indexOf(TOKEN[i]!) + offset) % alphabet.length]!;
      const changed = TOKEN.slice(0, i) + swapped + TOKEN.slice(i + 1);
      assert.equal(verifyTrialToken(changed, PUBLIC).kind, 'bad-signature', `position ${i}: ${TOKEN[i]} → ${swapped}`);
      checked += 1;
    }
  }
  assert.ok(checked > 2 * 200, `control: ${checked} changes checked`);
});

test('refused as before: a token from another key is a bad signature, however it was pasted', () => {
  const foreign = mint(payload(), stranger.privateKey);
  for (const text of [foreign, `“${foreign}”`, `Here:\n${foreign.replace(/(.{30})/g, '$1\n')}\nThanks`]) {
    assert.equal(verifyTrialToken(text, PUBLIC).kind, 'bad-signature');
  }
});

test('cleaning never hides a change: a quoted, wrapped token with one character changed is still refused', () => {
  const i = TOKEN.length - 30;
  const changed = TOKEN.slice(0, i) + (TOKEN[i] === 'A' ? 'B' : 'A') + TOKEN.slice(i + 1);
  assert.equal(verifyTrialToken(`“${changed.replace(/(.{40})/g, '$1\n')}”.`, PUBLIC).kind, 'bad-signature');
});

// The common wrong pastes, said so.

test('wrong paste: a 64-character hex checksum is recognised as one', () => {
  const hex = 'a3f1c09e5b7d2468ace013579bdf2468ace013579bdf2468ace013579bdf2468';
  for (const text of [hex, hex.toUpperCase(), `SHA-256: ${hex}`, `${hex}  Sidekick-2.0.0-arm64.dmg`, `“${hex}”`, `${hex}\n`]) {
    assert.equal(why(text), 'checksum', JSON.stringify(text));
  }
  // Controls: one hex digit too few or too many is not a SHA-256.
  assert.equal(why(hex.slice(1)), 'wrong-format');
  assert.equal(why(`${hex}0`), 'wrong-format');
});

test('wrong paste: a web address and an email address are recognised', () => {
  for (const text of ['https://example.com/sidekick', 'http://example.com', 'www.example.com/beta']) assert.equal(why(text), 'url', text);
  for (const text of ['tester@example.com', 'Chetan <tester@example.com>']) assert.equal(why(text), 'email', text);
  assert.equal(why('hello'), 'wrong-format', 'control: ordinary text is just the wrong format');
  assert.equal(why('SIDEKICK-TRIAL-2.' + 'A'.repeat(40) + '.' + 'B'.repeat(86)), 'wrong-format', 'control: another version is not "cut off"');
});

test('a real token beside a checksum, an address and a URL is still found', () => {
  ok(`SHA-256: ${'ab'.repeat(32)}\nFrom tester@example.com, see https://example.com\n${TOKEN}`);
});

test('each refusal has its own plain sentence with a next step', () => {
  const said = (r: ReturnType<typeof verifyTrialToken>) => (r.kind === 'ok' ? '' : enteredTokenMessage(r));
  const hex = 'ab'.repeat(32);
  assert.match(said(verifyTrialToken(hex, PUBLIC)), /^That looks like a download checksum, not a beta token\./);
  assert.match(said(verifyTrialToken('https://example.com', PUBLIC)), /web address, not a beta token/);
  assert.match(said(verifyTrialToken('a@example.com', PUBLIC)), /email address, not a beta token/);
  assert.match(said(verifyTrialToken(TOKEN.slice(0, -5), PUBLIC)), /cut off/);
  assert.match(said(verifyTrialToken('hello', PUBLIC)), /isn’t a Sidekick beta token/);
  assert.match(said(verifyTrialToken(mint(payload(), stranger.privateKey), PUBLIC)), /changed on the way/);
  for (const text of [hex, 'https://example.com', 'a@example.com', TOKEN.slice(0, -5), 'hello']) {
    assert.match(said(verifyTrialToken(text, PUBLIC)), /SIDEKICK-TRIAL-1|token file/, `no next step for ${text}`);
  }
});

test('the refusal log carries character classes only — never the text', () => {
  const line = describeRefusedText(`“${TOKEN}”\n`);
  for (let i = 0; i + 8 <= TOKEN.length; i += 8) assert.ok(!line.includes(TOKEN.slice(i, i + 8)), 'a piece of the token reached the log line');
  assert.match(line, new RegExp(`^${TOKEN.length + 3} characters`));
  assert.match(line, /non-ASCII 2/);
  assert.match(line, /line breaks 1/);
  const hex = describeRefusedText('ab'.repeat(32));
  assert.match(hex, /^64 characters/);
  assert.match(hex, /hex-only yes/);
});
