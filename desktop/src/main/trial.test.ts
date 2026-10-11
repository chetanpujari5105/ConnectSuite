/*
 * The beta trial's store and controller, against real files in a temporary folder.
 *
 * The one thing replaced is the sealing box — Electron's `safeStorage`, which cannot load under
 * `node --test` — exactly as `identityStore.test.ts` does. Keys are generated **in memory** for this
 * run and never written: the store only ever holds the public token, never a key.
 * **Not reached here:** the real Keychain, the IPC handlers and the link gate's call site in main.ts;
 * the last is pinned by the source test at the bottom and by the release-candidate static check.
 */
import { strict as assert } from 'node:assert';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { SealingBox } from './identityStore';
import { Trial, trialEnforced } from './trial';
import { DAY_MS, assembleToken, encodePayload, signingInput, type TrialPayload } from '../shared/trial';

const issuer = generateKeyPairSync('ed25519');
const PUBLIC = issuer.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const NOW = Date.UTC(2026, 9, 12, 12, 0, 0);

function token(over: Partial<TrialPayload> = {}): string {
  const p: TrialPayload = {
    v: 1,
    id: 'Zq3k9Xb2LmT7wP1s',
    label: 'Tester One',
    notBefore: new Date(NOW - DAY_MS).toISOString(),
    notAfter: new Date(NOW + 44 * DAY_MS).toISOString(),
    ...over,
  };
  const body = encodePayload(p);
  return assembleToken(body, sign(null, Buffer.from(signingInput(body), 'ascii'), issuer.privateKey));
}

/** A box that seals reversibly (base64 with a marker), like a Keychain this build can open. */
const box: SealingBox = {
  available: () => true,
  seal: (text) => Buffer.from(`sealed:${text}`),
  open: (data) => {
    const s = data.toString();
    if (!s.startsWith('sealed:')) throw new Error('not ours');
    return s.slice(7);
  },
};
/** A box that cannot open what another build sealed — defect 207's case. */
const foreignBox: SealingBox = { ...box, open: () => { throw new Error('this build cannot open it'); } };

function mac(dir = mkdtempSync(join(tmpdir(), 'trial-')), clock = { now: NOW }, sealing = box) {
  const lines: string[] = [];
  const trial = new Trial({ dir, box: sealing, publicKey: PUBLIC, enforced: true, now: () => clock.now, log: (_l, line) => lines.push(line) });
  return { dir, clock, trial, lines };
}

test('empty store: no token, and the Mac must not connect', () => {
  const { trial } = mac();
  const v = trial.check();
  assert.equal(v.state, 'none');
  assert.equal(v.blocks, true);
});

test('entering a valid token: accepted, kept across a relaunch, and only the public token is on disk', () => {
  const a = mac();
  const r = a.trial.enter(token());
  assert.equal(r.ok, true);
  assert.match(r.message, /beta access until/);
  assert.equal(a.trial.check().state, 'valid');
  const relaunched = mac(a.dir, a.clock);
  assert.equal(relaunched.trial.check().state, 'valid');
  const file = readFileSync(join(a.dir, 'trial.json'), 'utf8');
  assert.ok(file.includes('SIDEKICK-TRIAL-1.'));
  assert.doesNotMatch(file, /PRIVATE|BEGIN/);
});

test('a wrong or tampered token is refused with its own message, and changes nothing', () => {
  const a = mac();
  a.trial.enter(token());
  const stranger = generateKeyPairSync('ed25519');
  const body = encodePayload({ v: 1, id: 'Zq3k9Xb2LmT7wP1s', label: 'X', notBefore: new Date(NOW).toISOString(), notAfter: new Date(NOW + 400 * DAY_MS - 1).toISOString() });
  const foreign = assembleToken(body, sign(null, Buffer.from(signingInput(body), 'ascii'), stranger.privateKey));
  const r = a.trial.enter(foreign);
  assert.equal(r.ok, false);
  assert.match(r.message, /signature doesn’t match/);
  assert.match(a.trial.enter('hello').message, /doesn’t look like a Sidekick beta token/);
  assert.equal(a.trial.check().label, 'Tester One', 'the good token is still the one in use');
});

test('a stored token edited on disk no longer counts', () => {
  const a = mac();
  a.trial.enter(token());
  const path = join(a.dir, 'trial.json');
  const stored = JSON.parse(readFileSync(path, 'utf8'));
  const [prefix, , sig] = stored.token.split('.');
  stored.token = `${prefix}.${encodePayload({ v: 1, id: 'Zq3k9Xb2LmT7wP1s', label: 'Tester One', notBefore: new Date(NOW - DAY_MS).toISOString(), notAfter: new Date(NOW + 300 * DAY_MS).toISOString() })}.${sig}`;
  writeFileSync(path, JSON.stringify(stored));
  assert.equal(mac(a.dir, a.clock).trial.check().state, 'none');
});

test('expired and not-yet-valid tokens are refused at entry with kind messages', () => {
  const a = mac();
  const ended = a.trial.enter(token({ notBefore: new Date(NOW - 60 * DAY_MS).toISOString(), notAfter: new Date(NOW - 15 * DAY_MS).toISOString() }));
  assert.equal(ended.ok, false);
  assert.match(ended.message, /ended on/);
  const later = a.trial.enter(token({ notBefore: new Date(NOW + 2 * DAY_MS).toISOString(), notAfter: new Date(NOW + 47 * DAY_MS).toISOString() }));
  assert.equal(later.ok, false);
  assert.match(later.message, /starts on/);
  assert.equal(a.trial.check().state, 'none');
});

test('expiry while running: the verdict turns at notAfter (and the link gate reads it at the next attempt)', () => {
  const a = mac();
  a.trial.enter(token());
  a.clock.now = NOW + 44 * DAY_MS - 1;
  assert.equal(a.trial.check().state, 'valid');
  a.clock.now = NOW + 44 * DAY_MS;
  assert.equal(a.trial.check().state, 'expired');
});

test('reinstall: a wiped store and the same token give the same end date', () => {
  const first = mac();
  first.trial.enter(token());
  const end = first.trial.check().notAfter;
  const wiped = mac(undefined, { now: NOW + 20 * DAY_MS });
  assert.equal(wiped.trial.check().state, 'none', 'the wipe really removed it');
  wiped.trial.enter(token());
  const v = wiped.trial.check();
  assert.equal(v.notAfter, end);
  assert.equal(v.daysLeft, 24, 'twenty days on, the reinstall has 24 days left, not 44');
});

test('two Macs, one token: both work — allowed by decision, since an unbound token is not tied to a Mac', () => {
  const one = mac();
  const two = mac();
  assert.equal(one.trial.enter(token()).ok, true);
  assert.equal(two.trial.enter(token()).ok, true);
  assert.equal(one.trial.check().state, 'valid');
  assert.equal(two.trial.check().state, 'valid');
});

test('clock set back by more than a day: refused, remembered across a relaunch, and cleared by fixing the date', () => {
  const a = mac();
  a.trial.enter(token());
  a.trial.check(); // seen at NOW
  a.clock.now = NOW - 2 * DAY_MS;
  const back = a.trial.check();
  assert.equal(back.state, 'clock-back');
  assert.equal(back.blocks, true);
  assert.equal(mac(a.dir, a.clock).trial.check().state, 'clock-back', 'the sealed mark survives a relaunch');
  a.clock.now = NOW - 12 * 3_600_000; // the date put right, within the day's tolerance
  assert.equal(a.trial.check().state, 'valid');
});

test('a clock that ran ahead and was corrected: refused, and a token issued later is the way back — an older one is not', () => {
  const a = mac();
  a.trial.enter(token());
  a.clock.now = NOW + 5 * DAY_MS; // wrongly ahead for a while…
  a.trial.check();
  a.clock.now = NOW; // …then corrected
  assert.equal(a.trial.check().state, 'clock-back');
  assert.equal(a.trial.enter(token()).ok, true, 'the same token again is accepted…');
  assert.equal(a.trial.check().state, 'clock-back', '…and does not reset the check');
  const issuedLater = token({ id: 'Nw8sLq2Xc5Vb7Mz1', notBefore: new Date(NOW).toISOString(), notAfter: new Date(NOW + 45 * DAY_MS).toISOString() });
  assert.equal(a.trial.enter(issuedLater).ok, true);
  assert.equal(a.trial.check().state, 'valid');
});

test('the clock mark is sealed, and a build that cannot open it starts fresh — never a lockout', () => {
  const a = mac();
  a.trial.enter(token());
  a.clock.now = NOW + 5 * DAY_MS;
  a.trial.check();
  const raw = readFileSync(join(a.dir, 'trial.json'), 'utf8');
  assert.doesNotMatch(raw, new RegExp(String(NOW + 5 * DAY_MS)), 'the mark is not stored as plain text');
  assert.equal(mac(a.dir, { now: NOW }).trial.check().state, 'clock-back', 'control: a build that CAN open it refuses');
  const other = mac(a.dir, { now: NOW }, foreignBox);
  assert.equal(other.trial.check().state, 'valid');
  assert.ok(other.lines.some((l) => /could not be opened/.test(l)), 'and it says so in the log');
});

test('notices: due once at 7 days, recorded, not repeated', () => {
  const a = mac();
  a.trial.enter(token());
  a.clock.now = NOW + 38 * DAY_MS;
  const v = a.trial.check();
  assert.equal(v.notice?.days, 7);
  a.trial.noticeShown(7);
  assert.equal(mac(a.dir, a.clock).trial.check().notice, null);
});

test('no public key in the build: every token is refused and the Mac does not connect', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trial-'));
  const t = new Trial({ dir, box, publicKey: null, enforced: true, now: () => NOW });
  assert.equal(t.check().state, 'no-key');
  assert.equal(t.enter(token()).ok, false);
  assert.equal(existsSync(join(dir, 'trial.json')), false);
});

// ---- the packaged configuration -------------------------------------------------------------------

test('a packaged build always enforces — the development switch cannot reach it', () => {
  assert.equal(trialEnforced({ packaged: true, skipSwitch: true }), true);
  assert.equal(trialEnforced({ packaged: true, skipSwitch: false }), true);
  assert.equal(trialEnforced({ packaged: false, skipSwitch: false }), true, 'development checks by default too');
  assert.equal(trialEnforced({ packaged: false, skipSwitch: true }), false, 'only a named development switch skips');
});

test('main.ts builds the trial from app.isPackaged, with the switch read only when unpackaged, and gates the link on it', () => {
  const main = readFileSync(join(__dirname, 'main.ts'), 'utf8');
  assert.match(main, /trialEnforced\(\{\s*packaged: app\.isPackaged,\s*skipSwitch: !app\.isPackaged && debugSwitches\(\)\.skipTrial\s*\}\)/);
  assert.match(main, /gate: \(\) => trialGate\(\)/);
});
