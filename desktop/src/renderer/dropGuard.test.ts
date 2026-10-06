import assert from 'node:assert/strict';
import test from 'node:test';

import '../renderer/dropGuard';

/**
 * Audit S3, the renderer half: a drop no zone accepted is refused, so Chromium never asks to navigate
 * to the dropped file. Runs the page's own `installDropGuard` against a stand-in document.
 */

type Listener = (event: FakeDrag) => void;
interface FakeDrag {
  defaultPrevented: boolean;
  preventDefault(): void;
  dataTransfer: { dropEffect: string } | null;
}

const install = (globalThis as unknown as { installDropGuard: (t: unknown) => void }).installDropGuard;

function fakeDocument(): { listeners: Record<string, Listener>; target: unknown } {
  const listeners: Record<string, Listener> = {};
  return { listeners, target: { addEventListener: (type: string, l: Listener) => { listeners[type] = l; } } };
}

function drag(defaultPrevented = false): FakeDrag {
  const e: FakeDrag = {
    defaultPrevented,
    preventDefault: () => { e.defaultPrevented = true; },
    dataTransfer: { dropEffect: 'copy' },
  };
  return e;
}

test('a drag outside any zone is refused: prevented, with the not-allowed cursor', () => {
  const doc = fakeDocument();
  install(doc.target);
  const e = drag();
  doc.listeners.dragover!(e);
  assert.equal(e.defaultPrevented, true);
  assert.equal(e.dataTransfer!.dropEffect, 'none');
});

test('a drag a zone already accepted keeps its cursor (the Files drop zone still works)', () => {
  const doc = fakeDocument();
  install(doc.target);
  const e = drag(true);
  doc.listeners.dragover!(e);
  assert.equal(e.dataTransfer!.dropEffect, 'copy');
});

test('every drop is prevented at the document, so none becomes a navigation', () => {
  const doc = fakeDocument();
  install(doc.target);
  for (const accepted of [false, true]) {
    const e = drag(accepted);
    doc.listeners.drop!(e);
    assert.equal(e.defaultPrevented, true);
  }
});
