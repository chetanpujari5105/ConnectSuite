import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every field the page declares has a name a screen reader can say — not only a placeholder, which
 * disappears the moment someone types and is not reliably announced. Found by the overnight UI
 * harness (2026-10-06): the New-conversation recipient and message, Contacts search, and the mirror
 * canvas — which takes keyboard focus and forwards keys to the phone — had no name at all.
 *
 * Reads `index.html` as text, so it covers the static markup only; fields built in script (Settings'
 * address inputs) are covered where they are built. A field inside a `<label>` is named by it.
 */
const html = readFileSync(join(__dirname, 'index.html'), 'utf8');

function tags(name: string): string[] {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map((m) => m[0]);
}

function named(tag: string): boolean {
  if (/\baria-label="[^"]+"/.test(tag) || /\baria-labelledby="[^"]+"/.test(tag)) return true;
  const id = /\bid="([^"]+)"/.exec(tag)?.[1];
  if (id && new RegExp(`<label[^>]*\\bfor="${id}"`).test(html)) return true;
  // Wrapped by a <label>: the nearest unclosed <label before the tag.
  const at = html.indexOf(tag);
  const before = html.slice(0, at);
  return before.lastIndexOf('<label') > before.lastIndexOf('</label>');
}

test('control: the scan finds the fields it is checking, and can see an unnamed one', () => {
  assert.ok(tags('input').length >= 8, `inputs read: ${tags('input').length}`);
  assert.equal(named('<input id="nowhere-x" type="text" placeholder="Only a hint" />'), false);
});

test('every input, textarea and select in index.html has a name, not only a placeholder', () => {
  const unnamed = [...tags('input'), ...tags('textarea'), ...tags('select')]
    .filter((t) => !/type="hidden"/.test(t))
    .filter((t) => !named(t));
  assert.deepEqual(unnamed, []);
});

test('the mirror canvas, which takes focus and forwards keys to the phone, is named', () => {
  const canvas = tags('canvas').find((t) => t.includes('id="mirror-canvas"'));
  assert.ok(canvas, 'control: the canvas is in the page');
  assert.ok(named(canvas), canvas);
});
