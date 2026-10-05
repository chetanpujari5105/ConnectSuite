import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import './callAudio';

/**
 * The call-audio copy, and the narrowed form of defect 124's guard.
 *
 * Defect 124's guard forbade the word Bluetooth anywhere in the Calls pane's strings, because the
 * pane once told people to pair the Mac over Bluetooth — a remedy measured and retracted. Decision
 * 1(c) (2026-10-05) keeps the pane Bluetooth-free and allows **exactly one** sentence elsewhere to
 * name the condition. These tests hold both halves:
 *
 *  - exactly one string in `callAudio.ts` names Bluetooth, and it is the capability sentence;
 *  - the Calls pane cannot reach that sentence (`calls.test.ts` scans its source);
 *  - **no** call-audio sentence tells anyone to do anything — each is checked on its own, never as a
 *    likeness between the two (the fourth test variety).
 */

const g = globalThis as Record<string, unknown>;
const support = g.callAudioSupport as () => { kind: string; reason: string };
const sentence = g.callAudioSentence as (s: unknown, surface: 'calls-pane' | 'capability-row') => string;

const PANE = 'Phone call audio on Mac is not available. No Mac and phone have been verified for it.';
const CAPABILITY =
  'Phone call audio on Mac is not available unless Bluetooth hands-free compatibility has been verified for this device.';

/** Setup language: anything that reads as an instruction to pair, connect, enable or route. */
const IMPERATIVE =
  /\b(pair\w*|connect\w*|turn(?:ing)?\s+on|switch\s+on|enabl\w*|rout\w*|set\s*up|select\w*|choos\w*|tap|click|go\s+to|open|settings?|try)\b/i;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('the only answer this build can give is unavailable, unverified', () => {
  assert.deepEqual(support(), { kind: 'unavailable', reason: 'unverified' });
  const kinds = [...stripComments(readFileSync(join(__dirname, 'callAudio.ts'), 'utf8')).matchAll(/kind:\s*'(\w+)'/g)]
    .map((m) => m[1]);
  assert.ok(kinds.length > 0, 'control: the scan found the kind literals');
  assert.deepEqual([...new Set(kinds)], ['unavailable'], 'a second CallAudioSupport kind appeared');
});

test('the Calls pane sentence is exactly the approved copy', () => {
  assert.equal(sentence(support(), 'calls-pane'), PANE);
});

test('the capability sentence is exactly the approved copy', () => {
  assert.equal(sentence(support(), 'capability-row'), CAPABILITY);
});

test('the imperative check can see what it forbids', () => {
  // The control for the two tests below: a pattern that matched nothing would pass them both.
  for (const instruction of ['Pair your Mac', 'connect the phone', 'Turn on Bluetooth', 'Enable hands-free', 'Route audio here', 'Open Settings']) {
    assert.match(instruction, IMPERATIVE, `control: "${instruction}" was not seen`);
  }
});

test('the Calls pane sentence says it is unavailable, names no technology, and instructs nothing', () => {
  const line = sentence(support(), 'calls-pane');
  assert.match(line, /not available/);
  assert.doesNotMatch(line, /bluetooth|hands-free|headset/i, 'the pane sentence names a technology');
  assert.doesNotMatch(line, IMPERATIVE, 'the pane sentence instructs');
});

test('the capability sentence says it is unavailable and instructs nothing', () => {
  const line = sentence(support(), 'capability-row');
  assert.match(line, /not available/);
  assert.doesNotMatch(line, IMPERATIVE, 'the capability sentence instructs');
});

test('exactly one string in this file names Bluetooth, and it is the capability sentence', () => {
  const source = stripComments(readFileSync(join(__dirname, 'callAudio.ts'), 'utf8'));
  const literals = [...source.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
  assert.ok(literals.includes('calls-pane'), 'control: the literal scan sees this file’s strings');
  const naming = literals.filter((l) => /bluetooth/i.test(l));
  assert.equal(naming.length, 1, `strings naming Bluetooth: ${JSON.stringify(naming)}`);
  assert.ok(CAPABILITY.startsWith(naming[0]), `the Bluetooth string is not the capability sentence: ${naming[0]}`);
});
