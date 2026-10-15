import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

/**
 * What `electron-builder.yml` writes into the packaged app's Info.plist, read from the file itself.
 *
 * Reading the config is not reading the built bundle: whether macOS shows this sentence in its
 * prompt is a property of the packaged app on a fresh account, and no test here reaches that.
 */

const yml = readFileSync(join(__dirname, '..', '..', 'electron-builder.yml'), 'utf8');
const extendInfo = yml.slice(yml.indexOf('  extendInfo:'), yml.indexOf('\n  # ---- Signing.'));

test('control: the extendInfo block is found and carries the key already known to be there', () => {
  assert.ok(extendInfo.length > 0);
  assert.match(extendInfo, /\n    NSLocalNetworkUsageDescription: >-\n/);
});

test('Save to Mac writes into ~/Downloads, so the Downloads prompt carries a plain sentence', () => {
  const m = extendInfo.match(/\n    NSDownloadsFolderUsageDescription: >-\n((?: {6}[^\n]*\n)+)/);
  assert.ok(m, 'NSDownloadsFolderUsageDescription is missing from mac.extendInfo');
  const sentence = m[1]!.replace(/\s+/g, ' ').trim();
  assert.match(sentence, /^Sidekick .*Downloads.*\.$/);
  assert.ok(sentence.length <= 200, `the prompt sentence is ${sentence.length} characters`);
});
