import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  diagnoseReach,
  LOCAL_NETWORK_SUSPECTED,
  localNetworkSuspected,
  outcomeOf,
  reachSentence,
  reachSummary,
  type ReachAttempt,
} from './reachDiagnosis';

const attempt = (over: Partial<ReachAttempt>): ReachAttempt => ({
  host: '192.168.1.42',
  via: 'gateway',
  tcpConnected: false,
  timedOut: false,
  code: null,
  ...over,
});

test('each way an address fails is its own outcome', () => {
  assert.equal(outcomeOf(attempt({ code: 'ECONNREFUSED' })), 'refused');
  assert.equal(outcomeOf(attempt({ code: 'EHOSTUNREACH' })), 'host-unreachable');
  assert.equal(outcomeOf(attempt({ code: 'EHOSTDOWN' })), 'host-unreachable');
  assert.equal(outcomeOf(attempt({ code: 'ENETUNREACH' })), 'no-route');
  assert.equal(outcomeOf(attempt({ code: 'ENOTFOUND' })), 'bad-address');
  assert.equal(outcomeOf(attempt({ timedOut: true })), 'silent');
  assert.equal(outcomeOf(attempt({ code: 'ETIMEDOUT' })), 'silent');
});

test('a timeout after TCP connected is a stalled handshake, not silence', () => {
  assert.equal(outcomeOf(attempt({ tcpConnected: true, timedOut: true })), 'handshake-stalled');
  // Control: the same timeout before TCP connected is silence.
  assert.equal(outcomeOf(attempt({ tcpConnected: false, timedOut: true })), 'silent');
});

test('the attempt that got furthest decides the diagnosis', () => {
  const diagnosis = diagnoseReach([
    attempt({ host: '192.168.1.7', via: 'last-known', timedOut: true }),
    attempt({ host: '192.168.1.1', via: 'gateway', code: 'ECONNREFUSED' }),
  ]);
  assert.deepEqual(diagnosis, { localNetworkSuspected: false, kind: 'refused', hosts: ['192.168.1.1'], tried: 2 });
});

test('a phone that answered and then refused is not diagnosed as unreachable', () => {
  // TCP connected, then an error that is not a timeout: a TLS alert, a certificate mismatch.
  const diagnosis = diagnoseReach([
    attempt({ host: '192.168.1.7', via: 'last-known', timedOut: true }),
    attempt({ host: '192.168.1.1', via: 'gateway', tcpConnected: true, code: null }),
  ]);
  assert.equal(diagnosis.kind, 'answered');
  assert.equal(reachSentence(diagnosis), null);
  // Control: without the answering attempt the same round is silence, with a sentence.
  assert.equal(diagnoseReach([attempt({ timedOut: true })]).kind, 'silent');
});

test('no addresses at all is its own diagnosis, not silence', () => {
  assert.deepEqual(diagnoseReach([]), { localNetworkSuspected: false, kind: 'nothing-to-try', hosts: [], tried: 0 });
  assert.match(reachSentence(diagnoseReach([]))!, /no address to try/);
});

test('every diagnosis names a different next step', () => {
  const sentences = {
    refused: reachSentence(diagnoseReach([attempt({ code: 'ECONNREFUSED' })]))!,
    unreachable: reachSentence(diagnoseReach([attempt({ via: 'manual', code: 'EHOSTUNREACH' })]))!,
    silent: reachSentence(diagnoseReach([attempt({ timedOut: true })]))!,
    stalled: reachSentence(diagnoseReach([attempt({ tcpConnected: true, timedOut: true })]))!,
    bad: reachSentence(diagnoseReach([attempt({ host: '10.35.99.249:42501', code: 'ENOTFOUND' })]))!,
  };
  assert.match(sentences.refused, /Sidekick is not listening there/);
  assert.match(sentences.unreachable, /Privacy & Security → Local Network/);
  assert.match(sentences.unreachable, /may be blocking/, 'one result, two causes: a possibility, not a verdict');
  assert.match(sentences.silent, /hotspot/);
  assert.doesNotMatch(sentences.silent, /Local Network/);
  assert.match(sentences.stalled, /reached the phone at 192\.168\.1\.42/);
  assert.match(sentences.bad, /“10\.35\.99\.249:42501” is not an address/);
});

test('no sentence carries an errno', () => {
  for (const code of ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND']) {
    assert.doesNotMatch(reachSentence(diagnoseReach([attempt({ code })]))!, /\bE[A-Z]{4,}\b/);
  }
  // An errno this rule does not know, on an address that is not the gateway, gets no sentence of its
  // own rather than a guess. (On the gateway it is a suspected Local Network block — tested below.)
  assert.equal(reachSentence(diagnoseReach([attempt({ via: 'manual', code: 'EWHATEVER' })])), null);
});

test('the log summary keeps every address beside its outcome', () => {
  const summary = reachSummary([
    attempt({ host: '192.168.1.7', via: 'last-known', timedOut: true }),
    attempt({ host: '192.168.1.1', via: 'gateway', code: 'ECONNREFUSED' }),
  ]);
  assert.equal(summary, '192.168.1.7 (last-known): silent; 192.168.1.1 (gateway): refused ECONNREFUSED');
});

/*
 * Local Network (2026-11-10). The setting cannot be read, so each case is the structural inference:
 * a send to this Mac's own gateway failing outright, and everything that withdraws it.
 */
test('a send to the Mac\'s own gateway failing outright is a suspected Local Network block', () => {
  for (const code of ['EHOSTUNREACH', 'EHOSTDOWN', 'ENETUNREACH', 'EPERM', 'EACCES']) {
    const round = [attempt({ host: '192.168.1.1', via: 'gateway', code })];
    assert.equal(localNetworkSuspected(round), true, code);
    assert.equal(reachSentence(diagnoseReach(round)), LOCAL_NETWORK_SUSPECTED, code);
  }
  assert.match(LOCAL_NETWORK_SUSPECTED, /Privacy & Security → Local Network/);
  assert.match(LOCAL_NETWORK_SUSPECTED, /looks like/, 'an inference, worded as one');
});

test('the same failure on any other address is not that suspicion', () => {
  // A stale or mistyped address being unreachable is ordinary; only the gateway is known to be there.
  for (const via of ['last-known', 'manual', 'mdns', 'tailscale']) {
    assert.equal(localNetworkSuspected([attempt({ via, code: 'EHOSTUNREACH' })]), false, via);
  }
});

test('a gateway that is merely silent or refusing is not a suspected block', () => {
  assert.equal(localNetworkSuspected([attempt({ via: 'gateway', timedOut: true })]), false);
  assert.equal(localNetworkSuspected([attempt({ via: 'gateway', code: 'ECONNREFUSED' })]), false);
});

test('any proof that local sends work withdraws the suspicion', () => {
  const blocked = attempt({ host: '192.168.1.1', via: 'gateway', code: 'EHOSTUNREACH' });
  // Control: alone, it is suspected.
  assert.equal(localNetworkSuspected([blocked]), true);
  assert.equal(localNetworkSuspected([blocked, attempt({ host: '192.168.1.7', via: 'manual', code: 'ECONNREFUSED' })]), false);
  assert.equal(localNetworkSuspected([blocked, attempt({ host: '192.168.1.7', via: 'manual', tcpConnected: true, timedOut: true })]), false);
});
