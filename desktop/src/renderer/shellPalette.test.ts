import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { installFakeDocument, installFakeWindow, FakeElement } from './domDouble.testkit';

/**
 * The ⌘K palette's two entry points, driven through the **real** `ShellView`.
 *
 * ### What this is named for
 *
 * The Sidekick shell deleted the dock and its raised ⌘K circle; the one visible entry point is now
 * the header's **Search** control, and the owner's rule for Batch 1 is that *clicking Search and
 * pressing ⌘K open the same accessible command palette*. Two triggers for one dialog is exactly
 * the shape that drifts: a second `openPalette` written for the button, or a click handler that
 * shows the panel without focusing its input, would look identical in a screenshot.
 *
 * So each test opens the palette one way and asserts the **whole** open state — visible, the
 * button's `aria-expanded`, the input asked for focus, the listbox filled and its first option
 * named as the combobox's active descendant — and the pair is asserted equal, value by value.
 *
 * **Shown to fail**: making the Search click only unhide `#palette` (the drift above) turns the
 * equality test red on `inputFocus` and `options`; dropping the focus return from `closePalette`
 * turns the Escape test red; deleting the Tab branch turns the Tab test red. All put back.
 *
 * The double has no focus model (`domDouble.testkit.ts`): these assert that the shell *asked* for
 * focus on the right element, never that anything was focused.
 */

const require_ = createRequire(import.meta.url);

type Listener = (event: Record<string, unknown>) => void;

function mount() {
  const doc = installFakeDocument({ byId: true });
  const win = installFakeWindow();
  const document_ = (globalThis as unknown as {
    document: { getElementById(id: string): FakeElement; activeElement: FakeElement | null; body: unknown };
  }).document;
  const byId = (id: string) => document_.getElementById(id);
  byId('probe-app-window').className = 'app-window';
  byId('palette').hidden = true;

  const g = globalThis as Record<string, unknown>;
  g.connect = { routeChanged: () => {} };
  Object.assign(g, require_('../shared/linkTone.ts'));
  Object.assign(g, require_('../shared/islandState.ts'));
  Object.assign(g, require_('./icons.ts'));
  Object.assign(g, require_('./navModel.ts'));
  // `shell.ts` constructs its own instance on its last line, so it is evaluated fresh for every
  // mount and not constructed a second time here. Requiring it cached and then calling `new`
  // gave the first mount two shells bound to one document, and every later mount one — so a click
  // "focused the input twice" in exactly one test, which is a harness fault read as a product one.
  delete require_.cache[require_.resolve('./shell.ts')];
  require_('./shell.ts');

  const keydown = (key: string, mods: { metaKey?: boolean } = {}) => {
    let prevented = false;
    const event = { key, metaKey: false, ctrlKey: false, shiftKey: false, ...mods, preventDefault: () => { prevented = true; } };
    for (const fn of (win.listeners.get('keydown') ?? []) as Listener[]) fn(event);
    return prevented;
  };

  /** Everything that makes the palette "open", read off the elements the shell wrote. */
  const openState = () => {
    const input = byId('palette-input');
    const results = byId('palette-results');
    return {
      visible: !byId('palette').hidden,
      expanded: byId('open-palette').getAttribute('aria-expanded'),
      inputFocus: input.focusCount,
      options: results.children.filter((c) => c.getAttribute('role') === 'option').length,
      active: input.getAttribute('aria-activedescendant'),
      firstSelected: results.children[0]?.getAttribute('aria-selected'),
    };
  };

  return {
    document: document_,
    byId,
    keydown,
    openState,
    restore: () => {
      win.restore();
      doc.restore();
    },
  };
}

test('clicking Search and pressing ⌘K open the same palette, in the same state', () => {
  const clicked = mount();
  clicked.byId('open-palette').click();
  const viaClick = clicked.openState();
  clicked.restore();

  const keyed = mount();
  assert.equal(keyed.keydown('k', { metaKey: true }), true, '⌘K must be taken by the page');
  const viaKey = keyed.openState();
  keyed.restore();

  // Control: the state is a real open palette, not two identical closed ones.
  assert.equal(viaClick.visible, true);
  assert.equal(viaClick.expanded, 'true');
  assert.equal(viaClick.inputFocus, 1, 'the input is asked for focus once');
  assert.ok(viaClick.options > 0, 'the listbox is filled on open');
  assert.equal(viaClick.active, 'palette-option-0');
  assert.equal(viaClick.firstSelected, 'true');

  assert.deepEqual(viaKey, viaClick);
});

test('Escape closes it and hands focus back to the Search control that opened it', () => {
  const m = mount();
  const search = m.byId('open-palette');
  m.document.activeElement = search;
  search.click();
  const before = search.focusCount;
  m.keydown('Escape');
  assert.equal(m.byId('palette').hidden, true);
  assert.equal(search.getAttribute('aria-expanded'), 'false');
  assert.equal(m.byId('palette-input').getAttribute('aria-activedescendant'), null);
  assert.equal(search.focusCount, before + 1, 'focus goes back to the opener, not to <body>');
  m.restore();
});

test('Tab cannot leave the modal: it stays on the palette input', () => {
  const m = mount();
  m.byId('open-palette').click();
  const input = m.byId('palette-input');
  const before = input.focusCount;
  assert.equal(m.keydown('Tab'), true, 'Tab is taken while the dialog is open');
  assert.equal(input.focusCount, before + 1);
  m.restore();
});

test('control_with the palette closed, Tab belongs to the window', () => {
  const m = mount();
  assert.equal(m.keydown('Tab'), false);
  m.restore();
});

test('the arrow keys move the active option the screen reader is told about', () => {
  const m = mount();
  m.byId('open-palette').click();
  m.keydown('ArrowDown');
  assert.equal(m.byId('palette-input').getAttribute('aria-activedescendant'), 'palette-option-1');
  m.restore();
});
