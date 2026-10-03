// Fixtures for the Camera driver's command line: what each argument set asks for, and proof that the
// paths that must touch nothing touch nothing. The real CLI is spawned with a recording fake `adb`; no
// fixture runs --dry-run or --execute past their refusals, because those reach the phone and the
// running Mac app (CDP on 9222).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './camera-driver.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, 'camera-driver.mjs');

test('no arguments, or --help, asks for nothing but help', () => {
  assert.equal(parseArgs([]).mode, 'help');
  assert.equal(parseArgs(['--help']).mode, 'help');
});

test('--execute needs a case, a new report path and the owner present — each one, or it is refused', () => {
  const full = ['--execute', '--case', 'home', '--report', '/tmp/r.json', '--owner-present'];
  assert.equal(parseArgs(full).mode, 'execute', 'control: the complete set executes');
  for (const missing of ['--case', '--report', '--owner-present']) {
    const i = full.indexOf(missing);
    const argv = full.filter((_, k) => k !== i && !(missing !== '--owner-present' && k === i + 1));
    const parsed = parseArgs(argv);
    assert.equal(parsed.mode, 'refused', `without ${missing}`);
    assert.ok(parsed.errors.length > 0);
  }
});

test('two modes at once, an unknown case and an unknown flag are refused', () => {
  assert.equal(parseArgs(['--dry-run', '--execute', '--case', 'home']).mode, 'refused');
  assert.equal(parseArgs(['--plan', '--case', 'sideways']).mode, 'refused');
  assert.equal(parseArgs(['--plan', '--case', 'home', '--force']).mode, 'refused');
  assert.equal(parseArgs(['--plan', '--case', 'plain']).mode, 'plan');
  assert.equal(parseArgs(['--dry-run', '--case', 'home']).mode, 'dry-run');
});

/** A fake adb that records every call, so "touched nothing" is a file that stayed empty. */
function fakeAdb() {
  const dir = mkdtempSync(join(tmpdir(), 'camera-driver-test-'));
  const record = join(dir, 'calls.txt');
  const adb = join(dir, 'adb');
  writeFileSync(record, '');
  writeFileSync(adb, `#!/bin/sh\necho "$@" >> "${record}"\nexit 1\n`);
  chmodSync(adb, 0o755);
  return { dir, record, env: { ...process.env, CONNECTSUITE_ADB: adb, PATH: `${dir}:${process.env.PATH}` }, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function runCli(argv, env) {
  return spawnSync(process.execPath, [CLI, ...argv], { env, encoding: 'utf8', timeout: 20_000 });
}

test('the CLI with no arguments, --plan, and every refusal touches no device and opens no page', () => {
  const fake = fakeAdb();
  try {
    const report = join(fake.dir, 'existing.json');
    writeFileSync(report, '{"earlier":"evidence"}');
    const cases = [
      { argv: [], code: 0, says: /camera-driver — one supervised/ },
      { argv: ['--plan', '--case', 'home'], code: 0, says: /"ACTION_MS": 5000/ },
      { argv: ['--execute', '--case', 'home', '--report', join(fake.dir, 'new.json')], code: 2, says: /owner-present/ },
      { argv: ['--execute', '--case', 'home', '--report', report, '--owner-present'], code: 2, says: /never overwritten/ },
      { argv: ['--dry-run', '--execute', '--case', 'home'], code: 2, says: /choose one of/ },
    ];
    for (const { argv, code, says } of cases) {
      const r = runCli(argv, fake.env);
      assert.equal(r.status, code, `${argv.join(' ')}: exit ${r.status}\n${r.stderr}`);
      assert.match(r.stdout + r.stderr, says, argv.join(' '));
      assert.doesNotMatch(r.stdout + r.stderr, /gates \(read-only\)|REQUEST pressed/, argv.join(' '));
    }
    assert.equal(readFileSync(fake.record, 'utf8'), '', 'an adb call was made');
    assert.equal(readFileSync(report, 'utf8'), '{"earlier":"evidence"}', 'existing evidence was touched');
    assert.equal(existsSync(join(fake.dir, 'new.json')), false);
    // Control: the fake really is the adb the pinned wrapper would run.
    const control = spawnSync(join(HERE, 'adb-pinned.sh'), ['samsung', 'shell', 'true'], { env: fake.env, encoding: 'utf8', timeout: 20_000 });
    assert.notEqual(control.status, 0);
    assert.notEqual(readFileSync(fake.record, 'utf8'), '', 'control: the fake recorded the wrapper’s call');
  } finally {
    fake.cleanup();
  }
});

test('the CLI reaches the page and the phone only after the refusals and the plan have returned', () => {
  const src = readFileSync(CLI, 'utf8');
  const main = src.slice(src.indexOf('async function main('));
  const probe = main.indexOf("await import('./probe.mjs')");
  for (const before of ["args.mode === 'help'", "args.mode === 'refused'", "args.mode === 'plan'", 'existsSync(args.report)']) {
    const at = main.indexOf(before);
    assert.ok(at >= 0 && at < probe, `${before} is not checked before the probe is opened`);
  }
  // The request button is pressed only inside runSession, after the gates; a dry run returns before it.
  assert.ok(main.indexOf("args.mode === 'dry-run'") < main.indexOf('runSession('));
  // Writes go through the pin, and the report is created, never overwritten.
  assert.ok(!/execFile\(\s*'adb'/.test(src), 'adb is called directly');
  assert.ok(src.includes("{ flag: 'wx' }"));
  // The instrument is disposed in a finally.
  assert.ok(/finally \{[\s\S]*DISPOSE_INSTRUMENT/.test(main));
});

test('the module can be imported without running anything', () => {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', `import('${CLI}').then((m) => console.log(typeof m.parseArgs))`], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(out.trim(), 'function');
});
