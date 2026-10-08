/*
 * Defect 207 (b, c): the development build gets its own profile folder, and a second instance on one
 * profile refuses to start.
 *
 * `planProfile` and `seedDevelopmentProfile` are called as `entry.js` calls them; the Electron half
 * (`app.setPath`, `requestSingleInstanceLock`) is reached only by the isolated launch recorded in
 * `docs/testing.md` → *Defect 207*.
 */
import { strict as assert } from 'node:assert';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { planProfile, secondInstancePrompt, seedDevelopmentProfile } from './profile';

const APPDATA = '/Users/x/Library/Application Support';

test('a packaged build keeps the folder every packaged build has used', () => {
  assert.equal(planProfile({ appData: APPDATA, packaged: true, env: {} }).dir, join(APPDATA, 'sidekick-desktop'));
});

test('defect 207: a development build never shares the packaged build’s folder', () => {
  const dev = planProfile({ appData: APPDATA, packaged: false, env: {} });
  const packaged = planProfile({ appData: APPDATA, packaged: true, env: {} });
  assert.notEqual(dev.dir, packaged.dir, 'the development build and a packaged copy share one profile');
  assert.equal(dev.dir, join(APPDATA, 'sidekick-desktop-dev'));
  assert.equal(dev.seedFrom, packaged.dir);
});

test('a development override is honoured only when absolute, and never by a packaged build', () => {
  assert.equal(planProfile({ appData: APPDATA, packaged: false, env: { CONNECTSUITE_DEV_PROFILE: '/tmp/p1' } }).dir, '/tmp/p1');
  assert.equal(planProfile({ appData: APPDATA, packaged: false, env: { CONNECTSUITE_DEV_PROFILE: '/tmp/p1' } }).seedFrom, null);
  assert.equal(planProfile({ appData: APPDATA, packaged: false, env: { CONNECTSUITE_DEV_PROFILE: 'relative' } }).dir, join(APPDATA, 'sidekick-desktop-dev'));
  assert.equal(planProfile({ appData: APPDATA, packaged: true, env: { CONNECTSUITE_DEV_PROFILE: '/tmp/p1' } }).dir, join(APPDATA, 'sidekick-desktop'));
});

test('the first development launch copies the shared folder once, leaving the original untouched', () => {
  const root = mkdtempSync(join(tmpdir(), 'profile-207-'));
  const shared = join(root, 'sidekick-desktop');
  const dev = join(root, 'sidekick-desktop-dev');
  mkdirSync(join(shared, 'identity'), { recursive: true });
  writeFileSync(join(shared, 'identity', 'key.enc'), 'sealed');
  writeFileSync(join(shared, 'sidekick.json'), '{"paired":{}}');
  symlinkSync('host-123', join(shared, 'SingletonLock'));
  const first = seedDevelopmentProfile(shared, dev);
  assert.equal(first.outcome, 'copied');
  assert.equal(readFileSync(join(dev, 'identity', 'key.enc'), 'utf8'), 'sealed');
  assert.equal(readFileSync(join(dev, 'sidekick.json'), 'utf8'), '{"paired":{}}');
  // lstat, not existsSync: the lock is a symlink to a name that is not a file, so existsSync reads a
  // copied lock as absent — the first version of this line passed with the filter deleted.
  assert.throws(() => lstatSync(join(dev, 'SingletonLock')), /ENOENT/, 'another process’s lock was copied');
  assert.ok(lstatSync(join(shared, 'SingletonLock')).isSymbolicLink(), 'control: the lock is there to be copied');
  assert.equal(readFileSync(join(shared, 'identity', 'key.enc'), 'utf8'), 'sealed');
  // Once only: the development folder is its own from now on.
  writeFileSync(join(shared, 'sidekick.json'), '{"changed":true}');
  assert.equal(seedDevelopmentProfile(shared, dev).outcome, 'exists');
  assert.equal(readFileSync(join(dev, 'sidekick.json'), 'utf8'), '{"paired":{}}');
});

test('nothing to seed from: an empty development folder, said as such', () => {
  const root = mkdtempSync(join(tmpdir(), 'profile-207-'));
  assert.equal(seedDevelopmentProfile(join(root, 'none'), join(root, 'dev')).outcome, 'nothing-to-copy');
});

test('the second-instance prompt names the folder and says nothing was changed', () => {
  const p = secondInstancePrompt('/Users/x/Library/Application Support/sidekick-desktop');
  assert.match(p.message, /already open/);
  assert.match(p.detail, /sidekick-desktop/);
  assert.match(p.detail, /nothing/i);
});
