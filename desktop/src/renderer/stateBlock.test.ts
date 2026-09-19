import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { installFakeDocument, FakeElement } from './domDouble.testkit';

/**
 * The state block and the Disconnected banner — handoff component 11 and 12.
 *
 * The rule this file is named for is the wall rule: *"Wall — the platform forbids it. No retry
 * button, ever."* It is asserted on the **one block** a caller built, not as a difference between
 * two kinds (the fourth test variety in CLAUDE.md: a likeness is a claim about two things, and
 * either can move).
 */

const require_ = createRequire(import.meta.url);
installFakeDocument();
const g = globalThis as Record<string, unknown>;
Object.assign(g, require_('./icons.ts'));
require_('./stateBlock.ts');

type Spec = {
  kind: string;
  headline: string;
  body?: string;
  code?: string;
  action?: { label: string; run: () => void };
};
const stateBlock = g.stateBlock as (spec: Spec) => FakeElement;
const disconnectedBanner = g.disconnectedBanner as (what: string, at: number | null) => FakeElement;
const rules = g.__stateBlockRules as {
  STATE_ICONS: Record<string, string>;
  stateTone(kind: string): string;
};

test('a wall never draws an action, and says it refused one', () => {
  const wall = stateBlock({
    kind: 'wall',
    headline: 'Android does not let any app capture call audio',
    action: { label: 'Try again', run: () => {} },
  });
  assert.equal(wall.queryAll('button').length, 0, 'a wall drew a retry button');
  assert.equal(wall.dataset.refusedAction, 'Try again');
});

test('an error keeps its retry and prints its code in mono — the control for the wall test', () => {
  let ran = 0;
  const error = stateBlock({
    kind: 'error',
    headline: 'The message was not sent',
    body: 'Nothing was queued.',
    code: 'SEND_FAILED',
    action: { label: 'Try again', run: () => ran++ },
  });
  const buttons = error.queryAll('button');
  assert.equal(buttons.length, 1, 'control: an action handed to an error must be drawn');
  buttons[0]!.click();
  assert.equal(ran, 1);
  assert.equal(error.querySelector('.state-code')?.textContent, 'SEND_FAILED');
  assert.ok(error.querySelector('.state-code')?.className.includes('mono'));
});

test('tone belongs to the state: amber limitation, red failure, never lime', () => {
  assert.equal(rules.stateTone('permission'), 'warning');
  assert.equal(rules.stateTone('wall'), 'warning');
  assert.equal(rules.stateTone('error'), 'danger');
  for (const kind of ['empty', 'unavailable', 'loading']) {
    assert.equal(rules.stateTone(kind), 'neutral', kind);
  }
  assert.equal(stateBlock({ kind: 'permission', headline: 'x' }).dataset.tone, 'warning');
});

test('every default glyph resolves, and the shell enumeration lists it', () => {
  const nav = require_('./navModel.ts') as { iconNamesUsedByTheShell(): string[] };
  const listed = new Set(nav.iconNamesUsedByTheShell());
  for (const [kind, name] of Object.entries(rules.STATE_ICONS)) {
    assert.ok(listed.has(name), `${kind}'s glyph "${name}" is not in iconNamesUsedByTheShell`);
  }
});

test('the disconnected banner states the age of what is shown, and claims none it lacks', () => {
  const at = new Date(2026, 8, 19, 9, 42).getTime();
  assert.match(disconnectedBanner('Conversations', at).textContent, /Conversations as of 09:42/);
  const never = disconnectedBanner('Conversations', null).textContent;
  assert.doesNotMatch(never, /as of/);
  assert.match(never, /Nothing is sent/);
});
