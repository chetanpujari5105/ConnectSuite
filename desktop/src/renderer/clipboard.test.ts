import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The clipboard pane's pure half, through the `globalThis` seam `calls.ts` established.
 *
 * The row copy is the whole of what is tested here, and it is the right thing to test: the three
 * kinds exist so that three different facts get three different sentences, and the one that matters
 * is **`sensitive` must never read as `empty`.** A password manager's clip is *there*; a pane
 * saying the phone's clipboard is empty would be telling somebody something false about their own
 * phone, which is the failure this whole namespace is shaped around.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(HERE, 'clipboard.ts'), 'utf8');

// The file is a plain script, not a module: it is stripped of its types and evaluated, so the test
// runs the function the pane draws with rather than a second copy of its rules.
interface Exported {
  clipRowText(entry: Record<string, unknown>): { body: string; muted: boolean };
  clipRowSource(entry: Record<string, unknown>): string;
}

function load(): Exported {
  const exported: Record<string, unknown> = {};
  // eslint-disable-next-line no-new-func
  new Function('exported', 'document', stripTypes(source))(exported, undefined);
  return exported as unknown as Exported;
}

/** Strips the TypeScript the renderer's tsc removes, leaving the JavaScript the browser runs. */
function stripTypes(text: string): string {
  return text
    .replace(/^interface [\s\S]*?^}/gm, '')
    .replace(/^type .*$/gm, '')
    .replace(/^class ClipboardView[\s\S]*?^}/gm, '')
    .replace(/\(globalThis as Record<string, unknown>\)/g, 'exported')
    .replace(/function clipRowText\(entry: ClipEntryRow\): \{ body: string; muted: boolean \}/,
      'function clipRowText(entry)')
    .replace(/function clipRowSource\(entry: ClipEntryRow\): string/, 'function clipRowSource(entry)')
    .replace(/exported\.ClipboardView = ClipboardView;/, '');
}

const api = load();

test('a sensitive entry never reads as an empty one', () => {
  const sensitive = api.clipRowText({ kind: 'sensitive', atMs: 1, source: 'phone' });
  const empty = api.clipRowText({ kind: 'empty', atMs: 1, source: 'phone' });

  assert.notEqual(sensitive.body, empty.body);
  assert.match(sensitive.body, /sensitive/i);
  assert.match(empty.body, /empty/i);
  assert.ok(
    !/empty/i.test(sensitive.body),
    'the sensitive sentence must not contain the word empty — that is the confusion being prevented',
  );
});

test('an unknown kind is labelled and kept, never rendered as blank text', () => {
  const rendered = api.clipRowText({ kind: 'image', atMs: 1, source: 'phone' });
  assert.match(rendered.body, /can’t show/);
  assert.ok(rendered.body.includes('image'), 'the row names the kind it cannot show');
  assert.equal(rendered.muted, true);
});

test('a text entry renders its own text and nothing else', () => {
  const rendered = api.clipRowText({ kind: 'text', text: 'hello', atMs: 1, source: 'phone' });
  assert.equal(rendered.body, 'hello');
  assert.equal(rendered.muted, false);
});

test('the source line shows the app label, never the package id', () => {
  const labelled = api.clipRowSource({
    kind: 'text',
    atMs: 1,
    source: 'phone',
    package: 'com.android.chrome',
    appName: 'Chrome',
  });
  assert.equal(labelled, 'Phone · Chrome');
  assert.ok(!labelled.includes('com.android.chrome'), 'the package id is a handle, not a sentence');

  assert.equal(api.clipRowSource({ kind: 'text', atMs: 1, source: 'phone' }), 'Phone');
  assert.equal(api.clipRowSource({ kind: 'text', atMs: 1, source: 'mac' }), 'This Mac');
});
