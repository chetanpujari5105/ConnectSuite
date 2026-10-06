import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refusedSwitch, REFUSED_SWITCHES } from './releaseGuards';

/** S5 (defect 184). The switch guard, the entry point's use of it, and the fuse wire tool. */

test('a packaged build refuses every debugging switch in every spelling', () => {
  for (const s of REFUSED_SWITCHES) {
    assert.equal(refusedSwitch(['/App', s], true), s);
    assert.equal(refusedSwitch(['/App', `${s}=9333`], true), s);
    assert.equal(refusedSwitch(['/App', s.toUpperCase()], true), s);
  }
  assert.equal(refusedSwitch(['/App', '-remote-debugging-port=1'], true), '--remote-debugging-port', 'Chromium also reads a single dash');
});

test('a development run is untouched — the verification sessions depend on --remote-debugging-port', () => {
  assert.equal(refusedSwitch(['electron', '.', '--force-renderer-accessibility', '--remote-debugging-port=9222'], false), null);
});

test('ordinary arguments pass, including ones that merely contain a refused word', () => {
  assert.equal(refusedSwitch(['/App', '--force-renderer-accessibility', '-psn_0_12345', 'file-named--inspect.txt', '--inspector-theme'], true), null);
});

test('entry.js consults the guard before main.js is required, exits on a hit, and needs it only when packaged', () => {
  const entry = readFileSync(join(__dirname, '..', '..', 'entry.js'), 'utf8');
  const guard = entry.indexOf("app.isPackaged ? require('./dist/main/releaseGuards.js').refusedSwitch(process.argv, true) : null");
  const main = entry.indexOf("require('./dist/main/main.js')");
  assert.ok(guard > 0 && main > guard, 'the guard runs first');
  assert.match(entry, /if \(refused !== null\) \{[\s\S]*app\.exit\(78\);[\s\S]*\} else \{\s*require\('\.\/dist\/main\/main\.js'\);/);
  // A development run of a dist built before this guard existed (the rollback copies) must not require it.
  assert.equal((entry.match(/releaseGuards/g) ?? []).length - (entry.match(/`src\/main\/releaseGuards\.ts`/g) ?? []).length, 1, 'required in exactly one place, behind isPackaged');
});

// ---- the fuse wire tool (build/fuses.mjs) -----------------------------------------------------------

type Fuses = {
  SENTINEL: Buffer;
  FUSE: Record<string, number>;
  RELEASE_FUSES: Record<number, boolean>;
  readWire(b: Buffer): string;
  withFuses(b: Buffer, wanted: Record<number, boolean>): Buffer;
  applyFuses(path: string, wanted?: Record<number, boolean>): { before: string; after: string };
};
const load = async (): Promise<Fuses> => (await import('../../build/fuses.mjs')) as unknown as Fuses;

/** A synthetic binary carrying Electron 43.4.1's wire as read from the cached framework: v1, 9, `101100011`. */
function synthetic(f: Fuses, wire = '101100011', version = 1): Buffer {
  return Buffer.concat([Buffer.alloc(64, 7), f.SENTINEL, Buffer.from([version, wire.length]), Buffer.from(wire, 'ascii'), Buffer.alloc(64, 9)]);
}

test('the release fuses turn off RunAsNode, NODE_OPTIONS and --inspect, and turn on ASAR integrity and ASAR-only', async () => {
  const f = await load();
  const out = f.withFuses(synthetic(f), f.RELEASE_FUSES);
  assert.equal(f.readWire(out), '000011011');
  // Nothing outside the wire moved.
  const src = synthetic(f);
  const diff = [...out].map((b, i) => (b !== src[i] ? i : -1)).filter((i) => i >= 0);
  assert.equal(diff.length, 5);
});

test('the named indices match Electron’s FuseV1Options order', async () => {
  const f = await load();
  assert.deepEqual(Object.entries(f.FUSE).sort((a, b) => a[1] - b[1]).map(([k]) => k), [
    'RunAsNode', 'EnableCookieEncryption', 'EnableNodeOptionsEnvironmentVariable', 'EnableNodeCliInspectArguments',
    'EnableEmbeddedAsarIntegrityValidation', 'OnlyLoadAppFromAsar', 'LoadBrowserProcessSpecificV8Snapshot',
    'GrantFileProtocolExtraPrivileges', 'WasmTrapHandlers',
  ]);
});

test('a layout it does not know stops the build instead of flipping a byte', async () => {
  const f = await load();
  assert.throws(() => f.withFuses(synthetic(f, '101100011', 2), f.RELEASE_FUSES), /version 2/);
  assert.throws(() => f.withFuses(synthetic(f, '1011'), f.RELEASE_FUSES), /shorter/);
  assert.throws(() => f.withFuses(Buffer.concat([synthetic(f), synthetic(f)]), f.RELEASE_FUSES), /more than once/);
  assert.throws(() => f.withFuses(Buffer.alloc(100), f.RELEASE_FUSES), /no fuse sentinel/);
  assert.throws(() => f.withFuses(synthetic(f, 'r01100011'), f.RELEASE_FUSES), /removed or unknown/);
});

test('applyFuses writes in place and reads back what it wrote', async () => {
  const f = await load();
  const dir = mkdtempSync(join(tmpdir(), 'sidekick-fuses-'));
  const path = join(dir, 'Electron Framework');
  writeFileSync(path, synthetic(f));
  const { before, after } = f.applyFuses(path);
  assert.equal(before, '101100011');
  assert.equal(after, '000011011');
  assert.equal(f.readWire(readFileSync(path)), '000011011');
});

test('the afterPack hook applies the release fuses before it signs anything', () => {
  const hook = readFileSync(join(__dirname, '..', '..', 'build', 'adhoc-sign.mjs'), 'utf8');
  const apply = hook.indexOf('applyFuses(');
  const firstSign = hook.indexOf('sign(t)');
  assert.ok(apply > 0, 'control: the hook applies fuses');
  assert.ok(apply < firstSign, 'fuses are written before the first signature, or the seal would not cover them');
});
