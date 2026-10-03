// Mutation runner for W3. Each mutation reinstates one specific defect, runs the named suite with a
// hard timeout, records which tests went red (with the TAP file's age and the runner's exit code),
// restores the file, and verifies the restoration by SHA-256.
import { readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const D = '/Users/chetan/Desktop/ConnectSuite/desktop';
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const M = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = [];
for (const m of M) {
  const file = `${D}/${m.file}`;
  const before = sha(file);
  const src = readFileSync(file, 'utf8');
  const n = src.split(m.old).length - 1;
  if (n !== 1) { out.push({ id: m.id, error: `old string occurs ${n} times` }); continue; }
  writeFileSync(file, src.replace(m.old, m.new));
  const tap = `/private/tmp/claude-501/-Users-chetan-Desktop-ConnectSuite/15ea2313-fc73-43ec-a947-b28f791a4887/scratchpad/w3/${m.id}.tap`;
  rmSync(tap, { force: true });
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap', `--test-reporter-destination=${tap}`, ...m.tests],
    { cwd: D, encoding: 'utf8', timeout: 120_000 });
  writeFileSync(file, src);
  const restored = sha(file) === before;
  let red = [], counts = null, age = null;
  try {
    const t = readFileSync(tap, 'utf8');
    age = ((Date.now() - statSync(tap).mtimeMs) / 1000).toFixed(1);
    red = [...t.matchAll(/^not ok \d+ - (.*)$/gm)].map((x) => x[1]);
    counts = { pass: +(t.match(/^# pass (\d+)/m)?.[1] ?? -1), fail: +(t.match(/^# fail (\d+)/m)?.[1] ?? -1) };
  } catch { }
  const named = red.some((x) => x.includes(m.expect));
  out.push({ id: m.id, what: m.what, exit: r.status, tapAgeS: age, ranS: ((Date.now() - t0) / 1000).toFixed(1), counts, red, expect: m.expect, namedTestRed: named, restored });
}
console.log(JSON.stringify(out, null, 1));
