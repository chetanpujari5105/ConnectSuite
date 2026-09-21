/**
 * Fixtures for `check-renderer-scripts.mjs`, each carrying its opposite.
 *
 * The first fixture is the **verbatim declaration that actually shipped** — a guard written after a
 * failure and never run against that failure has not been tested against the one case it is known
 * to have missed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportDeclarations, scriptLoadedShared, stripCommentsAndStrings } from './check-renderer-scripts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

test('fixture — the declaration that actually shipped is denied', () => {
  // `discHue.ts` carried this for a phase. It threw on its first emitted line in the browser and
  // worked anyway, by function hoisting, with its own comment crediting the wrong mechanism.
  const source = `
/** A stable hue in [0, 360) for a label. */
export function discHue(label) {
  return 0;
}
`;
  const hits = exportDeclarations(source);
  assert.equal(hits.length, 1);
  assert.match(hits[0].text, /export function discHue/);
});

test('fixture — an exported class is denied, which is the case that has no survivor', () => {
  assert.equal(exportDeclarations('export class ContactPhotos {}').length, 1);
  assert.equal(exportDeclarations('export const MAX_PHOTOS = 300;').length, 1);
  assert.equal(exportDeclarations('export type Fetch = () => void;').length, 1);
  assert.equal(exportDeclarations('export { a, b };').length, 1);
  assert.equal(exportDeclarations('export default thing;').length, 1);
});

test('control — the house pattern passes', () => {
  const source = `
const ISLAND_CATEGORIES = ['clipboard'];
function islandLineFor(event) { return null; }
{
  const g = globalThis;
  g.islandLineFor = islandLineFor;
}
if (typeof module !== 'undefined') {
  module.exports = { islandLineFor, ISLAND_CATEGORIES };
}
`;
  assert.deepEqual(exportDeclarations(source), []);
});

/**
 * The discriminator this repo has now needed five times: a guard that searches for a forbidden
 * thing matches the sentence forbidding it. These two must stay legal or the rule cannot be
 * written down beside the code it governs.
 */
test('control — prose and strings mentioning export are not violations', () => {
  const prose = `
/*
 * Why there is no export keyword here: a file with an export compiles to CommonJS, and
 * export function foo() {} would throw on its first line in the browser.
 */
// export class Nope {}
const note = 'export const is banned in this file';
const other = "export default is too";
`;
  assert.deepEqual(exportDeclarations(prose), []);
});

test('control for the discriminator — it can still see a real declaration beside the prose', () => {
  const mixed = `
// export class Nope {}
export class Yes {}
`;
  const hits = exportDeclarations(mixed);
  assert.equal(hits.length, 1, 'the commented one is skipped and the real one is not');
  assert.match(hits[0].text, /export class Yes/);
});

/**
 * What the stripper actually claims, which is less than its name suggests and is enough.
 *
 * It removes block comments and **line-leading** `//` comments, not trailing ones. That is not a
 * gap, because `exportDeclarations` anchors on `^\s*export` — a trailing comment can never begin a
 * line, so it cannot produce a match whether it is stripped or not. Written down rather than
 * quietly relied on: the two rules are load-bearing together, and someone unanchoring the matcher
 * later needs to know the stripper was never carrying that half.
 */
test('the stripper removes block and line-leading comments', () => {
  assert.doesNotMatch(stripCommentsAndStrings('/* export class A {} */'), /class A/);
  assert.doesNotMatch(stripCommentsAndStrings('  // export class B {}'), /class B/);
  assert.match(stripCommentsAndStrings('const a = 1; // export function b(){}'), /const a = 1;/);
});

test('control — a trailing comment cannot produce a match even though it survives stripping', () => {
  const line = 'const a = 1; // export function b(){}';
  assert.match(stripCommentsAndStrings(line), /export function b/, 'it is indeed still there');
  assert.deepEqual(exportDeclarations(line), [], 'and it still cannot match: the rule is anchored');
});

// ---- against the real tree ---------------------------------------------------------------------

test('index.html loads shared scripts, and the check can see them', () => {
  const html = readFileSync(join(ROOT, 'desktop/src/renderer/index.html'), 'utf8');
  const loaded = scriptLoadedShared(html);
  // The control for the scan itself. Zero would make the whole check vacuously green.
  assert.ok(loaded.length >= 8, `only ${loaded.length} shared scripts seen in index.html`);
  assert.ok(loaded.includes('contactPhotos'), 'contactPhotos.js is loaded by the page and was not seen');
  /*
   * The second anchor was `discHue`, and naming it is what went wrong. The file was deleted with
   * its last caller — `calls.ts` records why, the Sidekick system has no per-person hue — and this
   * suite went red on the branch and stayed red, because nothing runs `scripts/*.test.mjs`:
   * `check-suites-run.mjs` reads Gradle's XML and `desktop/.test-run.json`, and the script fixtures
   * are in neither. A file name written into a control is an allowlist of one and rots the same
   * way an allowlist rots.
   *
   * So the second reading is structural. Every name the scan returns must resolve to a real source
   * file: that proves the scan is returning module names rather than parse debris, it cannot go
   * stale when something is deleted, and it goes red on the case that actually matters — index.html
   * and the tree disagreeing, which in the browser is a 404 on a <script> nobody sees fail.
   */
  const missing = loaded.filter((n) => !existsSync(join(ROOT, 'desktop/src/shared', `${n}.ts`)));
  assert.deepEqual(missing, [], 'index.html loads a shared script that has no source file');
});

test('every shared file the page loads is free of export declarations', () => {
  const html = readFileSync(join(ROOT, 'desktop/src/renderer/index.html'), 'utf8');
  for (const name of scriptLoadedShared(html)) {
    const source = readFileSync(join(ROOT, 'desktop/src/shared', `${name}.ts`), 'utf8');
    assert.deepEqual(
      exportDeclarations(source),
      [],
      `src/shared/${name}.ts is loaded as a plain <script> and carries an export`,
    );
  }
});

/**
 * The backstop, and the only reading here that is about the *emitted* artifact rather than the
 * source. If the stripper were ever wrong in the permissive direction, this is what catches it:
 * the compiled file either references `exports` at the top level or it does not.
 */
test('the built output of a renderer-loaded shared file references no `exports`', () => {
  const html = readFileSync(join(ROOT, 'desktop/src/renderer/index.html'), 'utf8');
  let checked = 0;
  for (const name of scriptLoadedShared(html)) {
    let js;
    try {
      js = readFileSync(join(ROOT, 'desktop/dist/shared', `${name}.js`), 'utf8');
    } catch {
      continue; // not built in this working tree; the source check above still ran
    }
    checked += 1;
    const offenders = js
      .split('\n')
      .filter((line) => /^Object\.defineProperty\(exports|^exports\./.test(line));
    assert.deepEqual(offenders, [], `dist/shared/${name}.js would throw in the browser`);
  }
  assert.ok(checked > 0, 'no built shared files were read — run `npm run build` in desktop/ first');
});
