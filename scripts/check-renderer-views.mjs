#!/usr/bin/env node
/**
 * Every renderer view class is driven by a test, or it is on the debt list with a reason.
 *
 * ### Three sightings, one cause
 *
 * | | What broke | What the suite said |
 * |---|---|---|
 * | `showsState` (Files pane) | the `Download` wall drew in the wrong one of its two homes — twice, in opposite directions | green |
 * | defect 58 | an auto-apply's Restore row did not appear until an unrelated click | green |
 * | defect 59 | a watcher send never reached the list | green |
 *
 * None is a careless edit. The cause is structural: the renderer loads as plain `<script>` tags, so
 * the seam rule hangs the *pure* halves on `globalThis` and everything that draws is left outside
 * every test. `clipboard.test.ts` went further and **deleted `class ClipboardView` from the source**
 * before evaluating it — and two of the three defects were in that class.
 *
 * `CLAUDE.md`: *when a bug recurs in one line, the question is not is the new expression right but
 * what would have caught either version, and if the answer is "nothing", the line is in the wrong
 * file.* Three recurrences is past the point where a fourth gets noted rather than caught.
 *
 * ### What counts as covered, and why it is not a name match
 *
 * A view is covered when some `*.test.ts` **constructs it** — `new ClipboardView(`, or through the
 * `globalThis` lookup the renderer's seam forces. Merely mentioning the name does not count: every
 * one of these classes is named in prose somewhere, including in this file, and a checker that
 * counted mentions would report the whole renderer covered today. That is the same discriminator
 * `check-protocol-spec.mjs` needed and for the same reason.
 *
 * ### The debt list is printed on every run
 *
 * Most of the views are uncovered right now and pretending otherwise would be worse than the
 * gap. They are listed with a reason each; an entry that becomes covered without leaving the list
 * fails the check, because an allowlist nobody prunes is how a guard stops guarding.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const RENDERER = 'desktop/src/renderer';

/**
 * Views knowingly without a driving test, each with the reason it is waiting.
 *
 * Not a permanent exemption: this list is the work queue for the next renderer sitting, in the
 * order the panes have actually broken. `domDouble.testkit.ts` is what makes clearing an entry a
 * small job now — the harness exists, and each of these is a `mount()` and a handful of assertions.
 *
 * **FilesView and RemoteView came off it on 2026-09-02**, and neither removal was voluntary: this
 * checker refused both commits, on the branch that fails an entry which is *"now driven by a test
 * but is still on the debt list"*. That is the half of a guard people usually forget to write — an
 * allowlist nobody prunes is how a guard stops guarding, and this one pruned itself twice in one
 * sitting.
 */
export const UNCOVERED = new Map([
  ['PhotosView', 'The grid paged and measured through probe.mjs; no view-level test yet'],
  ['SmsView', 'Phase 4, proven on hardware across 5 pager pages; retro-fitting is Phase 6 work'],
  ['NotificationsView', 'Phase 4'],
  ['MirrorView', 'Needs a canvas and a video element the DOM double deliberately does not model'],
  ['ShellView', 'The window frame; its rules live in shell.css and stylesheets.test.ts guards those'],
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith('.ts')) out.push(path);
  }
  return out;
}

export function scan(root = ROOT) {
  const files = walk(join(root, RENDERER));
  const views = new Map();
  const tests = [];

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const rel = relative(root, file).split('\\').join('/');
    if (file.endsWith('.test.ts')) {
      tests.push(source);
      continue;
    }
    for (const match of source.matchAll(/^(?:export\s+)?class\s+(\w*View)\b/gm)) {
      views.set(match[1], rel);
    }
  }

  // Construction, not mention. `new XView(` covers a direct import; the `as new (...)` form covers
  // the `globalThis` lookup the renderer's script-tag loading forces on us.
  const covered = new Set();
  for (const name of views.keys()) {
    const constructed = new RegExp(`new\\s+${name}\\s*\\(|\\)\\.${name}\\b|['"\`]${name}['"\`]\\s*\\]`);
    if (tests.some((source) => constructed.test(source))) covered.add(name);
  }

  return { views, covered, testFiles: tests.length };
}

if (process.argv[1] && process.argv[1].endsWith('check-renderer-views.mjs')) {
  const { views, covered, testFiles } = scan();

  // The instrument reports its own bound: a scan that found no views or no tests would print a
  // clean pass over a run that read nothing.
  console.log(`renderer-view scan: ${views.size} view classes, ${testFiles} test files read`);
  if (views.size === 0 || testFiles === 0) {
    console.log('  INSTRUMENT FAILURE: found no views or no tests — the scan is looking in the wrong place');
    process.exit(1);
  }

  let failures = 0;
  for (const [name, file] of [...views].sort()) {
    if (covered.has(name)) {
      if (UNCOVERED.has(name)) {
        console.log(`  FAIL: ${name} is now driven by a test but is still on the debt list — remove it`);
        failures += 1;
      } else {
        console.log(`  covered: ${name} (${file})`);
      }
    } else if (UNCOVERED.has(name)) {
      console.log(`  debt: ${name} — ${UNCOVERED.get(name)}`);
    } else {
      console.log(`  FAIL: ${name} (${file}) is drawn by nobody's test and is not on the debt list`);
      failures += 1;
    }
  }

  console.log(
    failures === 0
      ? `  OK: ${covered.size} covered, ${UNCOVERED.size} on the debt list, 0 unaccounted for`
      : `  ${failures} unaccounted for`,
  );
  process.exit(failures === 0 ? 0 : 1);
}
