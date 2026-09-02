import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyLinkError,
  needsPairing,
  pairingHealth,
  pairingLabel,
  type LinkFailure,
} from './linkHealth';

/**
 * The real string, copied verbatim out of the Mac's own log during the 2026-09-02 outage, where it
 * appeared 47 times and reached the status bar unchanged.
 *
 * It is a fixture rather than a constructed example on purpose: `CLAUDE.md`'s rule about an
 * instrument supplying its own input. A hand-written approximation of a BoringSSL error would test
 * that the regex matches the thing the regex was written from.
 */
const REAL_REFUSAL =
  '1288490715584:error:10000416:SSL routines:OPENSSL_internal:SSLV3_ALERT_CERTIFICATE_UNKNOWN:' +
  '../../third_party/boringssl/src/ssl/tls_record.cc:489:SSL alert number 46';

test('the real refusal from the log is classified, not passed through', () => {
  const f = classifyLinkError(REAL_REFUSAL);
  assert.equal(f?.kind, 'certificate-refused');
  assert.match(f!.message, /no longer recognises this Mac/);
  assert.match(f!.message, /scan a new pairing code/i);
});

test('no user-facing message ever contains the raw error', () => {
  // The defect in one assertion. Every kind, checked for the fragments a user must never see.
  const samples = [
    REAL_REFUSAL,
    'connect ECONNREFUSED 10.0.0.5:42501',
    'read ECONNRESET',
    'protocol error: bad envelope',
    'something nobody anticipated',
    '',
  ];
  for (const raw of samples) {
    const f = classifyLinkError(raw);
    if (!f) continue;
    for (const leak of ['boringssl', 'OPENSSL_internal', 'tls_record.cc', 'error:1000', 'SSL alert number']) {
      assert.ok(
        !f.message.includes(leak),
        `message for ${JSON.stringify(raw.slice(0, 30))} leaks ${leak}: ${f.message}`,
      );
    }
    assert.ok(!/\.\.\//.test(f.message), `message contains a file path: ${f.message}`);
    assert.ok(!/:\d+:/.test(f.message), `message contains a line number: ${f.message}`);
  }
});

test('the alert number alone is enough, without the symbolic name', () => {
  // Keyed on the wire's own value rather than BoringSSL's spelling. If Electron changes the text
  // around it — which it does on every bump — the number does not move.
  const f = classifyLinkError('some future stack said no:SSL alert number 46');
  assert.equal(f?.kind, 'certificate-refused');
});

test('the symbolic name alone is enough, without the number', () => {
  const f = classifyLinkError('SSLV3_ALERT_CERTIFICATE_UNKNOWN');
  assert.equal(f?.kind, 'certificate-refused');
});

test('an unrelated alert number is not read as a refusal', () => {
  // The control for the two above. Matching any "SSL alert number" would make the check useless.
  const f = classifyLinkError('handshake failure:SSL alert number 40');
  assert.notEqual(f?.kind, 'certificate-refused');
});

test('the other kinds are separated', () => {
  assert.equal(classifyLinkError('connect ECONNREFUSED 10.0.0.5:42501')?.kind, 'unreachable');
  assert.equal(classifyLinkError('No phone answered on any known address')?.kind, 'unreachable');
  assert.equal(classifyLinkError('read ECONNRESET')?.kind, 'dropped');
  assert.equal(classifyLinkError('protocol error: bad envelope')?.kind, 'protocol');
  assert.equal(classifyLinkError('gremlins')?.kind, 'unknown');
});

test('no error is not a failure', () => {
  assert.equal(classifyLinkError(undefined), null);
  assert.equal(classifyLinkError(''), null);
});

test('every classification keeps the raw text for the log', () => {
  // The raw string must survive somewhere — hiding it from the user is not the same as discarding
  // it, and a support conversation needs it.
  const f = classifyLinkError(REAL_REFUSAL);
  assert.equal(f?.raw, REAL_REFUSAL);
});

// ---- the fourth state ------------------------------------------------------------------------

const refused = classifyLinkError(REAL_REFUSAL) as LinkFailure;
const dropped = classifyLinkError('read ECONNRESET') as LinkFailure;

test('a stored pairing the phone refuses is repudiated, not paired', () => {
  // The state that had no representation. It was drawn as "Reconnecting…", which promises that
  // waiting will work; the phone will refuse every attempt until somebody scans.
  const h = pairingHealth(true, refused, 1000);
  assert.equal(h.kind, 'repudiated');
  assert.equal(pairingLabel(h), 'Pairing was removed on the phone');
  assert.ok(needsPairing(h), 'a repudiated pairing must send the user to the pairing screen');
});

test('an ordinary drop is still paired', () => {
  // The discrimination that matters: a dropped link and a repudiated pairing both stop the phone
  // appearing, and only one of them is fixed by waiting.
  const h = pairingHealth(true, dropped, 1000);
  assert.equal(h.kind, 'paired');
  assert.ok(!needsPairing(h), 'a dropped link must not throw the user at the QR screen');
});

test('no stored pairing is unpaired regardless of the last failure', () => {
  // A certificate refusal while unpaired is the ordinary state of an unpaired Mac and means nothing.
  assert.equal(pairingHealth(false, refused, 1000).kind, 'unpaired');
  assert.equal(pairingHealth(false, null, 1000).kind, 'unpaired');
});

test('a healthy pairing with no failures is paired', () => {
  assert.equal(pairingHealth(true, null, 1000).kind, 'paired');
});

test('the sidebar and the pairing screen cannot disagree', () => {
  // The bug, stated as a property: for every state, the label the sidebar shows and the decision
  // the shell makes about routing come from the same value. A state where the sidebar says a phone
  // is present while the shell demands pairing is unrepresentable.
  const states = [
    pairingHealth(false, null, 0),
    pairingHealth(true, null, 0),
    pairingHealth(true, refused, 0),
    pairingHealth(true, dropped, 0),
  ];
  for (const h of states) {
    const label = pairingLabel(h);
    const routes = needsPairing(h);
    // "Paired" is the only label compatible with not being sent to the pairing screen.
    assert.equal(
      routes,
      label !== 'Paired',
      `label ${JSON.stringify(label)} disagrees with needsPairing=${routes}`,
    );
  }
});
