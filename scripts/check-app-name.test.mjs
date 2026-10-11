// Fixtures for scripts/check-app-name.mjs, and the real tree held to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { literals, offenders } from './check-app-name.mjs';

test('the owner’s sentence is caught, verbatim', () => {
  const kt = 'val GRANT_HINT =\n        "Add a folder in ConnectSuite on the phone, under Sync › Folders, to browse more of it"';
  assert.equal(offenders(kt).length, 1);
});

test('an instruction to find the app in Android Settings by the old name is caught', () => {
  assert.equal(offenders('fixHint = "On the phone: Settings > Apps > ConnectSuite > Permissions"').length, 1);
});

test('control: the real folder, technical tags and comments pass', () => {
  assert.deepEqual(offenders('"Saved to Download › ConnectSuite."'), []);
  assert.deepEqual(offenders('newWakeLock(PARTIAL_WAKE_LOCK, "ConnectSuite:link")'), []);
  assert.deepEqual(offenders('// ConnectSuite was the old name\nval x = "Sidekick"'), []);
  assert.deepEqual(offenders('/** Was "ConnectSuite" in v1. */ val y = 1'), []);
  assert.deepEqual(offenders("const s = 'Sidekick replaced ConnectSuite on this Mac and now uses a new key.';"), []);
});

test('control: literals are read in all three quote styles', () => {
  assert.deepEqual(literals(`a("x"); b('y'); c(\`z\`)`), ['"x"', "'y'", '`z`']);
});

test('the real tree: no sentence calls the app ConnectSuite, and every allowed use still exists', () => {
  const script = fileURLToPath(new URL('./check-app-name.mjs', import.meta.url));
  let out = '';
  let code = 0;
  try {
    out = execFileSync(process.execPath, [script]).toString();
  } catch (error) {
    out = error.stdout.toString();
    code = error.status;
  }
  assert.equal(code, 0, out);
});
