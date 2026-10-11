// Fixtures for scripts/issue-trial-token.mjs. The issuing key is generated IN MEMORY for this run and
// never written: the script's own CLI reads a key file, and these tests never create one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { issueToken, parseArgs } from './issue-trial-token.mjs';
import { DAY_MS, verifyTrialToken } from '../desktop/src/shared/trial.ts';

const owner = generateKeyPairSync('ed25519');
const PEM = owner.privateKey.export({ type: 'pkcs8', format: 'pem' });
const PUBLIC = owner.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

test('a token the script issues is one the Mac app verifies, with exactly the dates asked for', () => {
  const { token, payload } = issueToken({ privateKeyPem: PEM, label: 'Asha', days: 45, start: '2026-10-20' });
  const check = verifyTrialToken(token, PUBLIC);
  assert.equal(check.kind, 'ok');
  assert.deepEqual(check.payload, payload);
  assert.equal(payload.notBefore, '2026-10-20T00:00:00.000Z');
  assert.equal(Date.parse(payload.notAfter) - Date.parse(payload.notBefore), 45 * DAY_MS);
  assert.match(payload.id, /^[A-Za-z0-9_-]{16}$/);
});

test('without --start, the token starts at the beginning of today (UTC), so it is usable at once', () => {
  const { payload } = issueToken({ privateKeyPem: PEM, label: 'Asha', days: 45 });
  const from = Date.parse(payload.notBefore);
  assert.ok(from <= Date.now() && Date.now() - from < DAY_MS);
});

test('every token gets its own random id', () => {
  const a = issueToken({ privateKeyPem: PEM, label: 'A', days: 1 }).payload.id;
  const b = issueToken({ privateKeyPem: PEM, label: 'A', days: 1 }).payload.id;
  assert.notEqual(a, b);
});

test('control: a token from a different key does not verify against this public key', () => {
  const other = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  assert.equal(verifyTrialToken(issueToken({ privateKeyPem: other, label: 'A', days: 45 }).token, PUBLIC).kind, 'bad-signature');
});

test('refuses: a non-Ed25519 key, an empty label, days outside 1–400, a malformed start', () => {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  assert.throws(() => issueToken({ privateKeyPem: rsa, label: 'A', days: 45 }), /not an Ed25519/);
  assert.throws(() => issueToken({ privateKeyPem: PEM, label: '  ', days: 45 }), /label/);
  for (const days of [0, 401, 4.5, Number.NaN]) assert.throws(() => issueToken({ privateKeyPem: PEM, label: 'A', days }), /days/);
  assert.throws(() => issueToken({ privateKeyPem: PEM, label: 'A', days: 45, start: '20/10/2026' }), /YYYY-MM-DD/);
});

test('arguments: the three required ones, unknown flags refused, --help needs nothing', () => {
  assert.deepEqual(parseArgs(['--key', 'k.pem', '--label', 'Asha', '--days', '45']), { help: false, key: 'k.pem', label: 'Asha', days: 45, start: null, out: null });
  assert.throws(() => parseArgs(['--key', 'k.pem', '--days', '45']), /--label is required/);
  assert.throws(() => parseArgs(['--key', 'k.pem', '--label', 'A', '--days', '45', '--forever', 'yes']), /unknown argument/);
  assert.equal(parseArgs(['--help']).help, true);
  const out = execFileSync(process.execPath, [fileURLToPath(new URL('./issue-trial-token.mjs', import.meta.url)), '--help']).toString();
  assert.match(out, /usage: node scripts\/issue-trial-token\.mjs --key/);
});
