import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { TrayWriter, trayFace, type TrayMenuItem } from './trayWriter';

/**
 * The menu-bar item is redrawn only when what it shows changed (2026-10-15).
 *
 * `refreshTray()` ran on every link status — every 30 s retry while disconnected — and called
 * `setTitle`, `setToolTip` and `setContextMenu` each time, changed or not. The packaged app that hung
 * on 2026-10-14/15 had its main thread blocked inside AppKit drawing that status item. What the hang
 * report does and does not prove is in docs/overnight-report-2026-10-15.md; this change only stops
 * asking AppKit to redraw something that did not change.
 */

function harness() {
  const calls: string[] = [];
  const writer = new TrayWriter({
    setTitle: (t) => calls.push(`title:${t}`),
    setToolTip: (t) => calls.push(`tooltip:${t}`),
    setMenu: (items: readonly TrayMenuItem[]) => calls.push(`menu:${items.length}`),
  });
  return { calls, writer };
}

test('the first write sets all three', () => {
  const h = harness();
  h.writer.write(trayFace(false, 'Searching for your phone…'));
  assert.deepEqual(h.calls, ['title:○', 'tooltip:Searching for your phone…', 'menu:7']);
});

test('the same face again — a retry tick with nothing changed — touches nothing', () => {
  const h = harness();
  h.writer.write(trayFace(false, 'Searching for your phone…'));
  h.calls.length = 0;
  for (let i = 0; i < 5; i += 1) h.writer.write(trayFace(false, 'Searching for your phone…'));
  assert.deepEqual(h.calls, []);
});

test('a new sentence changes the tooltip and the menu (it carries the sentence), never the title', () => {
  const h = harness();
  h.writer.write(trayFace(false, 'Searching for your phone…'));
  h.calls.length = 0;
  h.writer.write(trayFace(false, 'The phone did not answer.'));
  assert.deepEqual(h.calls, ['tooltip:The phone did not answer.', 'menu:7']);
});

test('connecting changes all three, and the menu says Disconnect with Reconnect disabled', () => {
  const h = harness();
  h.writer.write(trayFace(false, 'Searching for your phone…'));
  h.calls.length = 0;
  const face = trayFace(true, 'Connected to Pixel');
  h.writer.write(face);
  assert.deepEqual(h.calls, ['title:●', 'tooltip:Connected to Pixel', 'menu:7']);
  const reconnect = face.menu.find((m) => m.action === 'reconnect');
  const toggle = face.menu.find((m) => m.action === 'toggle');
  assert.equal(reconnect?.enabled, false);
  assert.equal(toggle?.label, 'Disconnect');
});

test('control: every item the tray used to draw is still in the menu, in order', () => {
  const labels = trayFace(false, 'Searching for your phone…').menu.map((m) => m.type ?? m.label);
  assert.deepEqual(labels, [
    'Searching for your phone…', 'separator', 'Open Sidekick', 'Reconnect now', 'Connect', 'separator', 'Quit',
  ]);
});

test('wiring: main.ts writes the tray only through the writer, never with a bare setter', () => {
  const main = readFileSync(join(__dirname, 'main.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const bare = main.match(/\btray\??\.(setTitle|setToolTip|setContextMenu)\(/g) ?? [];
  assert.deepEqual(bare, [], 'refreshTray calls a tray setter directly, so every status tick redraws the menu-bar item');
  assert.match(main, /new TrayWriter\(/, 'control: main.ts constructs the writer');
  assert.match(main, /trayWriter\??\.write\(trayFace\(/, 'control: refreshTray writes through it');
});
