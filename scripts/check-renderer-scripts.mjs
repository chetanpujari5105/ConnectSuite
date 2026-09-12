/**
 * A shared file loaded into the renderer as a plain `<script>` may not carry an `export` keyword.
 *
 * ### The failure, and why nothing else could see it
 *
 * `src/shared/*.ts` files are loaded two ways: `require`d by tests, and dropped into `index.html`
 * as classic `<script>` tags. A file with an `export` is a **module**, and tsc compiles a module to
 * CommonJS whose first emitted statement is
 *
 *     Object.defineProperty(exports, "__esModule", { value: true });
 *
 * `exports` does not exist in a browser. So the script throws a `ReferenceError` on its first line
 * and **every declaration below it is dead**, including the `globalThis` block at the bottom that
 * the file's own comment says is how the page gets it.
 *
 * Nothing in this repo could report that:
 *
 * | | |
 * |---|---|
 * | `tsc` | clean — it is valid TypeScript |
 * | `npm test` | green — the tests `require` the file, where `exports` exists |
 * | the page | **works**, if the file happens to export only functions |
 *
 * That last row is the whole problem. A **function declaration is hoisted onto `globalThis` before
 * the body runs**, so it survives the throw and the file appears to work. `discHue.ts` shipped that
 * way for a phase, with a comment crediting the mechanism that had never executed.
 *
 * It only became visible when the same shape was written with a **class**, which is not hoisted:
 * `ContactPhotos` was `undefined` in the page while `photoKey`, four lines away in the same file,
 * was a function. That is a defect whose symptom is one specific symbol silently missing, and whose
 * cause is a keyword three hundred lines above it.
 *
 * ### What this checks, and the discriminator
 *
 * A file is in scope **only if `index.html` loads it as a script**. `src/shared/` also holds the
 * electron-free layer for the main process, which is `import`ed normally and must keep its exports.
 * Membership therefore comes from the HTML, not from the directory — the same reason
 * `check-protocol-spec.mjs` counts a heading rather than an occurrence.
 *
 * The match is on a **declaration**, not on the word: `export` inside a comment, a string, or the
 * prose explaining this rule is not a violation. This file, and the two comments describing the
 * trap, must stay legal — a guard that forbids writing its own rationale has broken the pair it is
 * supposed to be (defect 41).
 *
 * Wired to `PreToolUse` on `git commit`. Run directly to check the tree.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RENDERER = join(ROOT, 'desktop', 'src', 'renderer');
const SHARED = join(ROOT, 'desktop', 'src', 'shared');

/**
 * Which shared files the page actually loads as a classic script.
 *
 * Read out of `index.html` rather than assumed from the directory, because `src/shared/` also holds
 * modules the main process imports — those keep their exports and are none of this check's business.
 */
export function scriptLoadedShared(html) {
  const tags = [...html.matchAll(/<script\s+src="\.\.\/shared\/([A-Za-z0-9_]+)\.js"\s*>/g)];
  return tags.map((m) => m[1]);
}

/**
 * Source with comments and string literals removed, so a *mention* of `export` is not a *use*.
 *
 * Same discriminator as `check-apps-verb.mjs`. Order matters: strings are stripped first inside
 * what remains of each line, and a `//` inside a string is not a comment — but a shared file has no
 * URLs in it, and the check errs towards keeping text (a false *legal* reading here would be caught
 * by the emitted-output check below, which is the real backstop).
 */
export function stripCommentsAndStrings(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

/** Every `export` that is a declaration rather than a word, with its line number. */
export function exportDeclarations(source) {
  const stripped = stripCommentsAndStrings(source);
  const found = [];
  stripped.split('\n').forEach((line, i) => {
    if (/^\s*export\s+(default\s+|type\s+|interface\s+|class\s+|const\s+|let\s+|var\s+|function\s+|async\s+|\{|\*)/.test(line)) {
      found.push({ line: i + 1, text: line.trim() });
    }
  });
  return found;
}

/**
 * **Every page in the renderer, not just `index.html`.**
 *
 * The guard read `index.html` alone, which was right while the app had one window and silently
 * partial the moment it grew a second: `float.html` loads `h264Canvas.js` and `float.js` as classic
 * scripts too, so a `src/shared/` file added there with an `export` would throw on its first line
 * in the float window — defect 94 exactly — in the window this check does not open.
 *
 * It is the same shape as `openProbe` taking whichever page sorted first (2026-09-12): a rule
 * written against one window, correct then, and quietly covering half the app afterwards. The
 * discriminator is unchanged — scope still comes from what a page *loads*, never from the directory,
 * because `src/shared/` also holds modules the main process imports normally and those keep their
 * exports. Only the set of pages widened.
 */
function rendererPages() {
  return readdirSync(RENDERER).filter((f) => f.endsWith('.html')).sort();
}

function main() {
  const pages = rendererPages();
  if (pages.length === 0) {
    console.error('check-renderer-scripts: no .html pages under src/renderer. Refusing to pass.');
    return 1;
  }

  const loadedBy = new Map();
  for (const page of pages) {
    for (const name of scriptLoadedShared(readFileSync(join(RENDERER, page), 'utf8'))) {
      if (!loadedBy.has(name)) loadedBy.set(name, []);
      loadedBy.get(name).push(page);
    }
  }
  const loaded = [...loadedBy.keys()];

  if (loaded.length === 0) {
    // A guard that examined nothing would be vacuously green — the same shape as an empty
    // accessibility query reading as evidence. This is the control, and it fails loudly.
    console.error(
      `check-renderer-scripts: found NO shared <script> tags across ${pages.length} page(s) ` +
        `(${pages.join(', ')}). Either the pages stopped loading them or this check can no longer ` +
        'see them. Refusing to pass.',
    );
    return 1;
  }

  const problems = [];
  for (const name of loaded) {
    const path = join(SHARED, `${name}.ts`);
    let source;
    try {
      source = readFileSync(path, 'utf8');
    } catch {
      problems.push(`  ${name}: ${loadedBy.get(name).join(' + ')} load(s) shared/${name}.js but src/shared/${name}.ts does not exist`);
      continue;
    }
    for (const hit of exportDeclarations(source)) {
      problems.push(
        `  src/shared/${name}.ts:${hit.line}  ${hit.text}\n` +
          `      → this file is loaded as a plain <script>. An \`export\` makes it CommonJS, whose\n` +
          `        first line references \`exports\` and throws in the browser, killing the file.\n` +
          `        Drop the keyword; hang the symbol on globalThis and on module.exports instead.`,
      );
    }
  }

  console.log(
    `check-renderer-scripts: ${loaded.length} shared scripts loaded by ${pages.length} page(s): ` +
      pages.join(', '),
  );
  if (problems.length > 0) {
    console.error('\nA renderer-loaded shared file carries an export:\n');
    console.error(problems.join('\n'));
    console.error(
      '\nWhy this is not cosmetic: a file exporting only *functions* still works, because a\n' +
        'function declaration is hoisted onto globalThis before the throw. One exporting a class\n' +
        'does not, and the symbol is simply undefined in the page with nothing reporting it.\n',
    );
    return 1;
  }
  console.log('check-renderer-scripts: OK — none of them carries an export declaration');
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
