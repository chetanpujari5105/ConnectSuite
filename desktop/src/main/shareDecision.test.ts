import assert from 'node:assert/strict';
import test from 'node:test';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { acceptAllowed, displayFolder, handleShareDecision, parseShareDecision, type Decider, type WindowFacts } from './shareDecision';
import type { ReceiveState } from './share';

const id = 's-Q3v9aP0kT7mR2xW8yB4nZc';
const front: WindowFacts = { exists: true, visible: true, minimized: false, focused: true };

class FakeDecider implements Decider {
  calls: string[] = [];
  // No default: `new FakeDecider(undefined)` must mean "never held", not fall through to a default.
  constructor(public current: ReceiveState | undefined) {}
  state(): ReceiveState | undefined {
    return this.current;
  }
  async decide(offerId: string, decision: 'accept' | 'decline'): Promise<void> {
    this.calls.push(`${offerId}:${decision}`);
    this.current = decision === 'accept' ? 'saved' : 'declined';
  }
}

test('control: an offer id and a word, from a window in front, reaches decide', async () => {
  const d = new FakeDecider('awaiting-decision');
  assert.deepEqual(await handleShareDecision({ offerId: id, decision: 'accept' }, front, d), { ok: true, state: 'saved' });
  assert.deepEqual(d.calls, [`${id}:accept`]);
});

test('a renderer-supplied path, name or payload beside a valid id is refused whole — nothing is decided', async () => {
  for (const extra of [{ path: '/Users/x/.ssh' }, { folder: '/tmp' }, { savedAs: 'a' }, { offer: {} }]) {
    const d = new FakeDecider('awaiting-decision');
    const r = await handleShareDecision({ offerId: id, decision: 'accept', ...extra }, front, d);
    assert.equal(r.ok, false, JSON.stringify(extra));
    assert.deepEqual(d.calls, []);
  }
});

test('malformed input is refused', () => {
  for (const raw of [null, 'accept', [], { offerId: id }, { offerId: 'nope', decision: 'accept' },
    { offerId: id, decision: 'save' }, { offerId: `${id}/../x`, decision: 'accept' }]) {
    assert.equal(parseShareDecision(raw).ok, false, JSON.stringify(raw));
  }
});

test('hidden window: an Accept is refused and the offer keeps waiting; a Decline still goes through', async () => {
  const hidden: WindowFacts[] = [
    { ...front, visible: false },
    { ...front, minimized: true },
    { ...front, focused: false },
    { exists: false, visible: false, minimized: false, focused: false },
  ];
  for (const w of hidden) {
    const d = new FakeDecider('awaiting-decision');
    const r = await handleShareDecision({ offerId: id, decision: 'accept' }, w, d);
    assert.equal(r.ok, false, JSON.stringify(w));
    assert.match((r as { reason: string }).reason, /still waiting/);
    assert.deepEqual(d.calls, [], 'nothing decided');
    assert.equal(d.current, 'awaiting-decision');
    assert.deepEqual(await handleShareDecision({ offerId: id, decision: 'decline' }, w, d), { ok: true, state: 'declined' });
  }
});

test('a decision for an offer that is no longer waiting (expired, stale, already decided) is refused before decide', async () => {
  for (const state of ['expired', 'ended', 'declined', 'saved', undefined] as const) {
    const d = new FakeDecider(state);
    const r = await handleShareDecision({ offerId: id, decision: 'accept' }, front, d);
    assert.equal(r.ok, false, String(state));
    assert.deepEqual(d.calls, []);
  }
});

test('the Accept gate: only a visible, unminimised, focused window', () => {
  assert.equal(acceptAllowed(front).ok, true);
  assert.equal(acceptAllowed({ ...front, visible: false }).ok, false);
  assert.equal(acceptAllowed({ ...front, focused: false }).ok, false);
});

/**
 * Owner decision (v1): the card is the only decision surface — no macOS notification, no window
 * raising, no Dock bounce. That lives in `main.ts`, which needs Electron and no test can load, so this
 * reads its **code** (comments stripped: the comment explaining the decision names the very calls it
 * forbids) and pins two things: `main.ts` imports no `Notification` and touches no Dock; and the
 * share change handler's body does nothing but forward snapshots.
 */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function bodyAfter(code: string, marker: string): string {
  const start = code.indexOf(marker);
  assert.ok(start >= 0, `control: ${marker} is in main.ts`);
  let depth = 0;
  for (let i = code.indexOf('{', start); i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    if (code[i] === '}' && --depth === 0) return code.slice(start, i + 1);
  }
  throw new Error('unbalanced');
}

test('no macOS notification, window raising or Dock bounce for an incoming share', () => {
  const code = codeOf(readFileSync(join(__dirname, 'main.ts'), 'utf8'));
  const electronImport = code.slice(0, code.indexOf("from 'electron';"));
  assert.ok(electronImport.includes('BrowserWindow'), 'control: the electron import was read');
  assert.doesNotMatch(electronImport, /\bNotification\b/, 'main.ts imports Notification');
  assert.doesNotMatch(code, /\bapp\.dock\b|\.bounce\(/, 'a Dock bounce');
  const handler = bodyAfter(code, 'shareReceiver.onChange(');
  assert.ok(handler.includes("send('share-offers'"), 'control: the handler body was found');
  assert.doesNotMatch(handler, /Notification|\.show\(|\.focus\(|\.restore\(|moveTop|setAlwaysOnTop|flashFrame/);
});

test('the folder is shown with ~ for the home folder, and only for a real prefix', () => {
  assert.equal(displayFolder('/Users/a/Downloads/Sidekick', '/Users/a'), '~/Downloads/Sidekick');
  assert.equal(displayFolder('/Users/ab/Downloads', '/Users/a'), '/Users/ab/Downloads');
  assert.equal(displayFolder('/Volumes/X', '/Users/a'), '/Volumes/X');
});
