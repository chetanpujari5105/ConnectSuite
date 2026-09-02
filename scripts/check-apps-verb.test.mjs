import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findingsIn, scan, stripComments, PATTERNS, SELF } from './check-apps-verb.mjs';

/**
 * Fixtures for the `apps.launch` scan, each carrying its opposite.
 *
 * A matcher without fixtures is a rule you are guessing about — and this matcher's whole value is a
 * distinction (use versus mention) that a careless version gets backwards. The pairs below are what
 * says it is drawn in the right place.
 */

const forbidden = [
  {
    name: 'the wire literal in a Kotlin constant',
    source: 'object MessageType {\n    const val APPS_LAUNCH = "apps.launch"\n}\n',
  },
  {
    name: 'the wire literal in the desktop twin',
    source: "export const MessageType = {\n  APPS_LAUNCH: 'apps.launch',\n} as const;\n",
  },
  {
    name: 'a handler registered for it, even by a literal alone',
    source: 'link.register("apps.launch", handler)\n',
  },
  {
    name: 'a camelCase method that would carry it',
    source: 'async appsLaunch(pkg: string) { return this.ask(pkg); }\n',
  },
  {
    name: 'a template literal, which is a string like any other',
    source: 'const type = `apps.launch`;\n',
  },
];

for (const fixture of forbidden) {
  test(`DENIED — ${fixture.name}`, () => {
    const found = findingsIn('fixture.kt', fixture.source);
    assert.ok(found.length > 0, `should have been caught:\n${fixture.source}`);
  });
}

const allowed = [
  {
    name: 'prose about the prohibition — the case that makes this a pair rather than a trap',
    // Defect 41: the force-stop hook denied every command talking about force-stop, including the
    // commit writing the doc that explained it. If this fixture ever goes red, the guard has
    // forbidden writing its own other half and must be fixed rather than worked around.
    source:
      '/**\n' +
      ' * There is no apps.launch and there will not be one. A verb called apps.launch whose ack\n' +
      ' * means asked invites a remote control built on top of it.\n' +
      ' */\n' +
      'const val APPS_OPEN_ASK = "apps.open.ask"\n',
  },
  {
    name: 'a line comment naming the literal in quotes',
    source: '// The forbidden shape is "apps.launch" and it must never appear unquoted in code.\n',
  },
  {
    name: 'the verb that actually ships',
    source: 'const val APPS_OPEN_ASK = "apps.open.ask"\nlink.register(MessageType.APPS_OPEN_ASK, handler)\n',
  },
  {
    name: 'a name about launchers rather than about the verb',
    // The feature IS a launcher grid. A guard that forbade the word "launcher" would forbid naming
    // the thing correctly, which is how a rule starts getting routed around.
    source: 'fun launcherPackages(pm: PackageManager): List<String> = APPS_LAUNCHER_INTENT.query(pm)\n',
  },
  {
    name: 'getLaunchIntentForPackage, which is the platform API this feature is built on',
    source: 'val intent = pm.getLaunchIntentForPackage(packageName)\n',
  },
];

for (const fixture of allowed) {
  test(`ALLOWED — ${fixture.name}`, () => {
    const found = findingsIn('fixture.kt', fixture.source);
    assert.deepEqual(found, [], `should not have been caught:\n${fixture.source}`);
  });
}

test('CONTROL — the comment stripper leaves string literals alone', () => {
  // The two halves of the discriminator, in one assertion. If stripping ever eats strings, every
  // "DENIED" fixture above would still pass for the wrong reason — the source would be empty.
  const code = stripComments('// "apps.launch"\nval x = "apps.launch" // trailing\n');
  assert.equal(code.includes('val x = "apps.launch"'), true, 'the live literal survived stripping');
  assert.equal(code.split('\n')[0].includes('apps.launch'), false, 'the comment did not');
});

test('CONTROL — the matcher can see something, so an empty result means something', () => {
  // A pattern list that matched nothing would make every ALLOWED fixture pass vacuously. This is
  // the known-positive that turns "no findings" into a reading rather than an absence.
  assert.ok(PATTERNS.length >= 2);
  assert.equal(findingsIn('x.kt', 'const val APPS_LAUNCH = "apps.launch"').length, 2);
});

test('the real tree is clean, and the scan actually read it', () => {
  const { findings, filesRead } = scan();
  // The instrument's own bound, asserted rather than printed: a scan that read nothing would
  // report zero findings, which is the confident-wrong-answer shape this repo has recorded eleven
  // times. 50 is well under the real count and well over anything a broken path would produce.
  assert.ok(filesRead > 50, `the scan read only ${filesRead} files — it is looking in the wrong place`);
  assert.deepEqual(
    findings.map((f) => `${f.file}:${f.line} ${f.text}`),
    [],
  );
});

test('the guard exempts itself and its fixtures, and nothing else', () => {
  // A two-entry allowlist is small enough to assert whole. It exists so that moving this guard into
  // the scanned tree does not make it deny itself; anything else appearing here is an escape hatch.
  assert.deepEqual(SELF, ['scripts/check-apps-verb.mjs', 'scripts/check-apps-verb.test.mjs']);
});
