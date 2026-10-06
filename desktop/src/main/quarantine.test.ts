import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyXattrRead, readQuarantine, ReceivedQuarantine, QUARANTINE_ATTRIBUTE } from './quarantine';

/**
 * S8 (defect 186). The reader is tested against **real files with real attributes**, and the attribute is
 * put there by `/usr/bin/xattr` in the test — a stimulus from outside the product, never by the code under
 * test, which only reads. What these tests cannot reach: whether macOS applies `LSFileQuarantineEnabled` to
 * the packaged app's writes. That is a hardware reading, and the config half is checked as text below.
 */

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'sidekick-quarantine-test-'));
}

// A synthetic value in the shape macOS writes; only its presence is read.
const SYNTHETIC = '0081;00000000;SidekickTest;';

test('a synthetic file with the attribute reads present; the same file without it reads absent', async () => {
  const dir = scratch();
  try {
    const marked = join(dir, 'marked.txt');
    const plain = join(dir, 'plain.txt');
    writeFileSync(marked, 'synthetic');
    writeFileSync(plain, 'synthetic');
    execFileSync('/usr/bin/xattr', ['-w', QUARANTINE_ATTRIBUTE, SYNTHETIC, marked]);
    assert.equal(await readQuarantine(marked), 'present');
    assert.equal(await readQuarantine(plain), 'absent', 'control: an unmarked file in the same folder');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Publishing is a hard link; the attribute lives on the inode, so the published name carries the partial's. */
test('a hard-linked publish carries the partial’s attribute', async () => {
  const dir = scratch();
  try {
    const part = join(dir, 'file.sidekick-pull');
    const published = join(dir, 'file.bin');
    writeFileSync(part, 'synthetic bytes');
    execFileSync('/usr/bin/xattr', ['-w', QUARANTINE_ATTRIBUTE, SYNTHETIC, part]);
    linkSync(part, published);
    rmSync(part);
    assert.equal(await readQuarantine(published), 'present');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing file is unknown, never absent — an unreadable answer is not a negative one', async () => {
  assert.equal(await readQuarantine(join(tmpdir(), 'sidekick-no-such-file-' + process.pid)), 'unknown');
});

test('exit codes are classified narrowly', () => {
  assert.equal(classifyXattrRead(0, ''), 'present');
  assert.equal(classifyXattrRead(1, 'xattr: /x: No such xattr: com.apple.quarantine'), 'absent');
  assert.equal(classifyXattrRead(1, 'xattr: No such file: /x'), 'unknown');
  assert.equal(classifyXattrRead(null, ''), 'unknown');
  assert.equal(classifyXattrRead(126, ''), 'unknown');
});

test('a reader that throws is unknown, and the report never throws', async () => {
  const reading = await readQuarantine('/x', (() => {
    throw new Error('spawn failed');
  }) as never);
  assert.equal(reading, 'unknown');
});

test('the report logs every count, and warns only where something is wrong', async () => {
  const lines: Array<{ line: string; level: string }> = [];
  const seq = ['present', 'absent', 'unknown'] as const;
  let i = 0;
  const packaged = new ReceivedQuarantine(true, (line, level) => lines.push({ line, level }), async () => seq[i++]!);
  await packaged.report('/a', 'pulled a');
  await packaged.report('/b', 'pulled b');
  await packaged.report('/c', 'pulled c');
  assert.deepEqual(lines.map((l) => l.level), ['info', 'warn', 'warn']);
  assert.match(lines[1]!.line, /packaged build — LSFileQuarantineEnabled did not apply/);
  assert.match(lines[2]!.line, /1 present \/ 1 absent \/ 1 unknown of 3 received files checked/);

  const devLines: Array<{ line: string; level: string }> = [];
  const dev = new ReceivedQuarantine(false, (line, level) => devLines.push({ line, level }), async () => 'absent');
  await dev.report('/a', 'pulled a');
  assert.equal(devLines[0]!.level, 'info', 'absent is expected in a development build');
  assert.match(devLines[0]!.line, /development build/);
});

test('no sentence claims a quarantined file is safe or scanned', async () => {
  const lines: string[] = [];
  const r = new ReceivedQuarantine(true, (line) => lines.push(line), async () => 'present');
  await r.report('/a', 'pulled a');
  const source = readFileSync(join(__dirname, 'quarantine.ts'), 'utf8');
  for (const text of [...lines, source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')]) {
    assert.doesNotMatch(text, /\bsafe\b|\bscanned\b|\bvirus|\bmalware/i);
  }
});

test('the product never writes the attribute — it only reads', () => {
  const source = readFileSync(join(__dirname, 'quarantine.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.match(source, /'-p', QUARANTINE_ATTRIBUTE/, 'control: the read is there');
  assert.doesNotMatch(source, /'-w'|'-c'|'-d'|setxattr/);
});

/**
 * The packaged half is configuration. Read as text (no YAML dependency in this package); the keys must be
 * inside `mac.extendInfo`, and the exclusions must cover the profile names this app has had.
 */
test('the packaged Info.plist enables quarantine and excludes the app’s own profile', () => {
  const yml = readFileSync(join(__dirname, '..', '..', 'electron-builder.yml'), 'utf8');
  const extend = yml.slice(yml.indexOf('  extendInfo:'), yml.indexOf('\n  # ---- Signing.'));
  assert.ok(extend.length > 0, 'control: extendInfo was found');
  assert.match(extend, /\n    LSFileQuarantineEnabled: true\n/);
  for (const dir of ['Sidekick', 'sidekick-desktop']) {
    assert.ok(extend.includes(`'~/Library/Application Support/${dir}/*'`), `profile ${dir} not excluded`);
  }
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as { name: string };
  assert.ok(extend.includes(`/${pkg.name}/*'`), 'the package name’s profile folder is excluded');
});

/** main.ts is not constructible in a test; these hold both publish paths' wiring in place. */
test('both receive paths report: pulls through the bulk hook, shares through the publish dependency', () => {
  const main = readFileSync(join(__dirname, 'main.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.match(main, /bulk\.onPublished = \(path\) => void receivedQuarantine\.report\(path,/);
  assert.match(main, /publishExclusive\(part, folder, name\);\s*if \(published\.ok\) void receivedQuarantine\.report\(published\.path,/);
  assert.match(main, /new ReceivedQuarantine\(app\.isPackaged,/);
});
