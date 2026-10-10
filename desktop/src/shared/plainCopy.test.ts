/**
 * The main window's connection and pairing copy names what happens, not how (UX batch 2026-10-10,
 * section 3).
 *
 * The rule: mechanism words — TLS versions, fingerprints, certificates, trust stores, protocols,
 * mDNS, ports, "the wire" — belong in the logs, the docs and Settings → Advanced, not in sentences a
 * person reads on the Overview, the pairing screen or the status island. Before this batch the hero
 * tile read *"TLS 1.3, pinned"*, the pairing step printed the Mac's key in hex, and a version clash
 * said the two devices *"disagree about the protocol"*.
 *
 * **What this is not.** It is not a text search over the page: that finds the sentence explaining a
 * rule as readily as a breach of it (`CLAUDE.md`, *searching for a forbidden thing*). It runs the
 * three copy sources that produce these sentences — `securityCard`, `pairSteps`, `classifyLinkError`
 * — over **every state each one has**, and checks what they return. A source not listed here is not
 * covered, and the list says so by being short.
 *
 * The phone app is called Sidekick (`app_name`, `input_service_label`), so the Mac's copy names it
 * that way. The one deliberate "ConnectSuite" is the Mac's own former name in the rename refusal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLinkError, RENAME_REFUSAL } from './linkHealth';

const { securityCard } = require('./securityCard') as {
  securityCard: (i: { phase?: string; paired: boolean; endedAt?: string }) => { title: string; body: string };
};
const { pairSteps } = require('./pairSteps') as {
  pairSteps: (i: Record<string, unknown>) => Array<{ label: string; note: string | null }>;
};

const MECHANISM = /\bTLS\b|fingerprint|certificate|trust store|protocol|\bmDNS\b|\bport\b|\bthe wire\b|handshake|pinned/i;

function sentences(): string[] {
  const out: string[] = [];
  for (const input of [
    { phase: 'connected', paired: true },
    { paired: false },
    { phase: 'connecting', paired: true },
    { phase: 'handshaking', paired: true },
    { phase: 'failed', paired: true, endedAt: '21:04' },
    { phase: 'failed', paired: true },
  ]) {
    const card = securityCard(input);
    out.push(card.title, card.body);
  }
  for (const input of [
    { sighted: false, paired: false, fingerprint: 'AB12' },
    { sighted: true, paired: false, fingerprint: 'AB12', address: '10.0.0.4' },
    { sighted: true, phase: 'connecting', paired: false, fingerprint: 'AB12' },
    { sighted: true, phase: 'connected', paired: true, fingerprint: 'AB12' },
    { sighted: false, paired: false, scannable: false },
  ]) {
    for (const step of pairSteps(input)) out.push(step.label, step.note ?? '');
  }
  for (const raw of ['CERTIFICATE_UNKNOWN', 'ECONNREFUSED', 'ECONNRESET', 'PROTOCOL_MISMATCH', 'something else']) {
    out.push(classifyLinkError(raw)!.message, classifyLinkError(raw, { rePairPending: true })!.message);
  }
  return out.filter(Boolean);
}

test('connection, pairing and link-failure copy names no mechanism, in every state', () => {
  const all = sentences();
  assert.ok(all.length >= 30, `control: the enumeration produced ${all.length} sentences`);
  for (const line of all) assert.doesNotMatch(line, MECHANISM, `mechanism in main-window copy: "${line}"`);
});

test('the phone app is named Sidekick; the Mac’s own former name appears only where it is history', () => {
  for (const line of sentences()) {
    if (line === RENAME_REFUSAL) {
      assert.match(line, /^Sidekick replaced ConnectSuite on this Mac/, 'the Mac’s history was renamed away');
      assert.doesNotMatch(line.replace(/^Sidekick replaced ConnectSuite on this Mac/, ''), /ConnectSuite/);
      continue;
    }
    assert.doesNotMatch(line, /ConnectSuite/, `the phone app named by its old name: "${line}"`);
  }
});

test('control_the checks see the sentences they exist for', () => {
  assert.match('TLS 1.3, pinned to this Mac. Only your devices can read this traffic.', MECHANISM);
  assert.match('This Mac and your phone disagree about the protocol.', MECHANISM);
  assert.match('A95935BB6C053265 fingerprint', MECHANISM);
  assert.doesNotMatch('Encrypted between your phone and this Mac. Only your two devices can read it.', MECHANISM);
});
