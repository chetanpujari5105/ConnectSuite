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

// ---- D67: the approved two-layout system ---------------------------------------------------------

/**
 * **There are exactly two layouts and there may not be a third.**
 *
 * This is the rule the D67 migration exists to make true, and it is asserted on the class list
 * rather than on a screenshot: a block is `state-block` (full) or `state-block compact`, and
 * nothing else. Six pane-private vocabularies were deleted to get here — `files-state` (16 CSS
 * rules), `apps-banner` (6), `photos-banner` (5), `activity-state` (4), `files-banner` (2) — and
 * the way a seventh gets built is by a pane adding a modifier of its own to this element.
 */
const KINDS = ['empty', 'unavailable', 'loading', 'permission', 'error', 'wall', 'blocked', 'partial'];

test('every kind draws one of exactly two layouts, in both variants', () => {
  for (const kind of KINDS) {
    const full = stateBlock({ kind, headline: 'x' } as never);
    const compact = stateBlock({ kind, headline: 'x', compact: true } as never);
    assert.equal(full.className, 'state-block', `${kind} full grew a third presentation`);
    assert.equal(compact.className, 'state-block compact', `${kind} compact grew a third presentation`);
  }
});

/**
 * The approved tone map, asserted as a total function over the kinds rather than kind by kind — so
 * a kind added later cannot quietly default to neutral and land a failure in grey.
 */
test('the tone map covers every kind, and lime is not in it', () => {
  const expected: Record<string, string> = {
    empty: 'neutral',
    loading: 'neutral',
    unavailable: 'neutral',
    permission: 'warning',
    blocked: 'warning',
    partial: 'warning',
    wall: 'warning',
    error: 'danger',
  };
  assert.deepEqual(Object.keys(expected).sort(), [...KINDS].sort(), 'a kind has no tone assigned');
  for (const kind of KINDS) {
    assert.equal(rules.stateTone(kind), expected[kind], kind);
    // Lime is the connected state's alone. It is never a state's tone, in either layout.
    for (const compact of [false, true]) {
      const block = stateBlock({ kind, headline: 'x', compact } as never);
      assert.notEqual(block.dataset.tone, 'live', `${kind} took lime`);
      assert.notEqual(block.dataset.tone, 'accent', `${kind} took the accent`);
    }
  }
});

/**
 * **Compact is a size, not a licence.** The restrictions that make a state honest — a `wall` has
 * nothing to retry, and nothing may carry two actions — have to hold identically in both layouts,
 * because the panes that took the compact layout are exactly the ones that used to draw their own
 * card with their own rules.
 */
test('compact keeps every restriction the full layout has', () => {
  const action = { label: 'Do it', run: () => {} };
  for (const compact of [false, true]) {
    const wall = stateBlock({ kind: 'wall', headline: 'x', action, compact } as never);
    assert.equal(wall.queryAll?.('.state-action').length ?? wall.querySelectorAll('.state-action').length, 0,
      `a wall drew an action (compact=${compact})`);
    assert.equal(wall.dataset.refusedAction, 'Do it', 'the refusal is recorded, not silent');

    for (const kind of ['permission', 'blocked', 'error', 'empty', 'partial']) {
      const block = stateBlock({ kind, headline: 'x', action, compact } as never);
      const drawn = block.querySelectorAll('.state-action').length;
      assert.ok(drawn <= 1, `${kind} drew ${drawn} actions (compact=${compact})`);
    }
    // `unavailable` and `loading` refuse one too — there is nothing for a person to do.
    for (const kind of ['unavailable', 'loading']) {
      const block = stateBlock({ kind, headline: 'x', action, compact } as never);
      assert.equal(block.querySelectorAll('.state-action').length, 0, `${kind} drew an action`);
    }
  }
});

/** Several sentences stay several, in both layouts — the phone's words are not joined into one. */
test('a body of several paragraphs draws several, and blanks are dropped', () => {
  const block = stateBlock({
    kind: 'permission',
    headline: 'x',
    body: ['the phone’s reason', '', '   ', 'and the fix'],
  } as never);
  const lines = [...block.querySelectorAll('.state-body')].map((n) => n.textContent);
  assert.deepEqual(lines, ['the phone’s reason', 'and the fix']);
  assert.equal(stateBlock({ kind: 'empty', headline: 'x' } as never).querySelectorAll('.state-body').length, 0);
});
