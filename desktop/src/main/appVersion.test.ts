/*
 * The Mac's version is set once, in `package.json`, and read from there by `app.getVersion()` and the
 * packaged `CFBundleShortVersionString`. Two places type it a second time: the Settings › About line
 * (`APP_VERSION` in `renderer.ts`, a classic script with no access to `package.json`) and the hello's
 * `appVersion` fallback in `link.ts` — the value a **packaged** build always sends, because
 * `npm_package_version` exists only under npm. `docs/versioning.md` §4 said none was typed twice; both were.
 * This holds them to the one source, so the 2.0.1 bump (2026-10-14) cannot leave either behind.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(__dirname, '..', '..');
const version = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version;

test('Settings › About shows the version package.json sets', () => {
  const renderer = readFileSync(join(root, 'src/renderer/renderer.ts'), 'utf8');
  const shown = /const APP_VERSION = '([^']+)';/.exec(renderer);
  assert.ok(shown, 'control: the About constant is where this test looks for it');
  assert.equal(shown![1], version);
});

test('a packaged build says the same version in its hello', () => {
  const link = readFileSync(join(root, 'src/main/link.ts'), 'utf8');
  const fallback = /appVersion: process\.env\.npm_package_version \?\? '([^']+)'/.exec(link);
  assert.ok(fallback, 'control: the hello fallback is where this test looks for it');
  assert.equal(fallback![1], version);
});
