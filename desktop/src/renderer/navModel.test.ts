/**
 * The shell's route table and palette.
 *
 * Three things are asserted here that are otherwise only checkable by looking at the running app:
 *
 * 1. **Commands come before navigation in the palette.** The handoff's one explicit instruction
 *    about ⌘K. Shown to fail by swapping the two arrays in the `return` of `paletteResults`.
 * 2. **Every icon the shell asks for exists.** This is the other half of the empty-ring defect:
 *    `icons.test.ts` proves no icon is blank, and this proves the shell never asks for one that
 *    was never authored. Shown to fail by deleting `capture` from ICON_GEOMETRY.
 * 3. **Every unbuilt screen carries a reason, and no built screen carries one.** `CLAUDE.md`
 *    decision 6 as a test. Shown to fail by dropping `unbuiltReason` from Files.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  SCREENS,
  PAIRING_SCREEN,
  COMMANDS,
  DOCK,
  TOOL_RAIL,
  GLOBAL_ACTIONS,
  iconNamesUsedByTheShell,
  paletteResults,
  screenById,
  pillOffsetFor,
} = require('./navModel.ts');
const { ICON_NAMES } = require('./icons.ts');

test('the palette puts every command before every navigation row', () => {
  const kinds = paletteResults('').map((r: { kind: string }) => r.kind);
  const firstNav = kinds.indexOf('navigation');
  const lastCommand = kinds.lastIndexOf('command');
  assert.ok(firstNav > -1 && lastCommand > -1, 'the palette should offer both kinds');
  assert.ok(
    lastCommand < firstNav,
    'a command ranked below a screen — the handoff puts commands first',
  );
});

test('control_the ordering assertion can see a palette in the wrong order', () => {
  // The check above is only worth its green if it can go red. Run the same predicate over a
  // deliberately reversed list.
  const reversed = [...paletteResults('')].reverse().map((r: { kind: string }) => r.kind);
  const firstNav = reversed.indexOf('navigation');
  const lastCommand = reversed.lastIndexOf('command');
  assert.ok(lastCommand > firstNav, 'the predicate failed to notice a reversed palette');
});

test('a query filters both halves and keeps commands on top', () => {
  const results = paletteResults('mirror');
  assert.ok(results.length > 1);
  assert.equal(results[0].kind, 'command');
  assert.ok(
    results.some((r: { id: string }) => r.id === 'mirror' ),
    'the Mirror screen should still be reachable by the same word',
  );
});

test('an unknown query returns nothing rather than everything', () => {
  // The failure mode worth guarding: a filter that falls back to the full list on no match looks
  // identical to a working filter until someone types a typo and gets eleven screens back.
  assert.deepEqual(paletteResults('zzzznotathing'), []);
});

test('every icon the shell asks for was actually authored', () => {
  for (const name of iconNamesUsedByTheShell()) {
    assert.ok(ICON_NAMES.includes(name), `the shell asks for icon "${name}" and it does not exist`);
  }
});

test('the enumeration covers the two glyphs the defect was about', () => {
  // Capture and Refresh are the icons that shipped as empty rings. The test above is only the
  // guard it claims to be if they are inside its list — an earlier version enumerated only the
  // sidebar and the dock, passed with `capture` deleted from icons.ts, and would have let the
  // exact defect through a second time.
  const asked = iconNamesUsedByTheShell();
  assert.ok(asked.includes('capture'), 'Capture is not covered by the icon guard');
  assert.ok(asked.includes('refresh'), 'Refresh is not covered by the icon guard');
  assert.equal(TOOL_RAIL.length, 2);
  assert.equal(GLOBAL_ACTIONS.length, 6, 'six actions performGlobalAction can genuinely perform');
});

test('every unbuilt screen says why, and no built screen pretends to', () => {
  for (const screen of SCREENS) {
    if (screen.state === 'unbuilt') {
      assert.ok(
        typeof screen.unbuiltReason === 'string' && screen.unbuiltReason.length > 30,
        `${screen.id} is unbuilt with no reason — decision 6 says it must say why`,
      );
      // "Coming soon" is the sentence that makes decision 6 useless. A reason names a phase or a
      // concrete missing piece.
      assert.doesNotMatch(
        screen.unbuiltReason,
        /coming soon|stay tuned|work in progress/i,
        `${screen.id}'s reason is a placeholder, not a reason`,
      );
    } else {
      assert.equal(
        screen.unbuiltReason,
        undefined,
        `${screen.id} is built but carries an unbuilt reason`,
      );
    }
  }
});

test('state A is complete on every unbuilt screen', () => {
  // `docs/mac-ui-design-proposals.md` §3 state A asks for four things, and a card missing one of
  // them degrades into the generic "nothing here" pattern the whole four-state model exists to
  // avoid. Asserting all four together, because three of four is the failure that looks fine.
  for (const screen of SCREENS.filter((s: { state: string }) => s.state === 'unbuilt')) {
    assert.ok(screen.unbuiltHeadline, `${screen.id} has no headline`);
    assert.ok(screen.unbuiltReason, `${screen.id} has no reason`);
    assert.ok(screen.unbuiltHandle, `${screen.id} has no wire handle`);
    // The headline must not simply restate the tag above it — that wastes the one line a reader is
    // guaranteed to take in.
    assert.doesNotMatch(screen.unbuiltHeadline, /^not built/i, `${screen.id}'s headline repeats the tag`);
  }
});

test('a screen with no proposed namespace says so rather than inventing one', () => {
  // A plausible-looking `clipboard.*` would send someone to docs/protocol.md looking for something
  // that was never designed. Only the two namespaces the Phase 5 proposals actually name may appear
  // as handles; everything else has to admit there is nothing to grep for.
  const proposed = new Set(['fs.*', 'media.*']);
  for (const screen of SCREENS.filter((s: { state: string }) => s.state === 'unbuilt')) {
    const named = /([a-z]+)\.\*/.exec(screen.unbuiltHandle);
    if (named) {
      assert.ok(
        proposed.has(named[0]),
        `${screen.id} names "${named[0]}", which no proposal defines`,
      );
    } else {
      assert.match(
        screen.unbuiltHandle,
        /no namespace proposed|no session store/,
        `${screen.id}'s handle neither names a real namespace nor admits there is none`,
      );
    }
  }
});

test('the sidebar is the handoff eleven, in its groups', () => {
  assert.equal(SCREENS.length, 11);
  assert.equal(SCREENS.filter((s: { group: string }) => s.group === 'MENU').length, 9);
  assert.equal(SCREENS.filter((s: { group: string }) => s.group === 'SYSTEM').length, 2);
});

test('no two screens share an id or a shortcut', () => {
  const ids = SCREENS.map((s: { id: string }) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  const keys = SCREENS.map((s: { shortcut: string }) => s.shortcut).filter((k: string) => k !== '');
  assert.equal(new Set(keys).size, keys.length);
  const commandKeys = COMMANDS.map((c: { shortcut: string }) => c.shortcut);
  assert.equal(new Set(commandKeys).size, commandKeys.length);
});

test('pairing is a route with no sidebar row', () => {
  // The design has no unpaired state at all (departures row X5). Pairing must be reachable and
  // must not add a twelfth row the designer never drew.
  assert.equal(screenById('pairing'), PAIRING_SCREEN);
  assert.equal(SCREENS.some((s: { id: string }) => s.id === 'pairing'), false);
  assert.equal(paletteResults('pair').length, 0, 'pairing is forced by state, never navigated to');
});

test('the pill never leaves the top of the nav, however the list is scrolled', () => {
  // The clamp exists because offsetTop is read from a scrollable nav; a negative offset would
  // park the pill above the first row.
  assert.equal(pillOffsetFor(0), 0);
  assert.equal(pillOffsetFor(228), 228);
  assert.equal(pillOffsetFor(-40), 0);
});
