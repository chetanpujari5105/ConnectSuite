/**
 * **Share pull speed, this tree against a baseline tree — synthetic data, temp folders only.**
 *
 *   npx tsx scripts/share-pull-bench.ts --baseline <other desktop/ tree> [--mib 512] [--runs 5]
 *
 * Both trees' own `pullShareWith` receive the same random bytes from the same localhost fake phone
 * (`sharePhone.testkit.ts`, production frame size) and publish with their own `publishExclusive`. One
 * warm-up per tree is discarded, then the trees alternate (B, A, B, A, …) so drift in the machine's
 * state lands on both. Each run is checked — the result must be `ok`, the digest must match and the
 * saved file must hold every byte — or the whole benchmark stops: a fast run of a broken pull is not
 * a reading.
 *
 * **Where it writes, and the guard.** Every byte goes under one `mkdtemp` folder inside the OS temp
 * folder; the script refuses to start unless that folder's real path is inside the temp folder's real
 * path, takes **no argument that names an output folder**, and never reads a receive-folder setting.
 * `--baseline` names a source tree to *import*; it is checked to hold `src/main/bulk.ts` and is never
 * written. Each run's folder is removed after it is measured, and the whole temp folder at the end —
 * only after re-checking it is the one this script made.
 *
 * **What the numbers are, and are not** (every bound the instrument imposes, in its output):
 * plain TCP over localhost, no TLS; both ends in this one process, so CPU time is the sum of the fake
 * phone and the Mac's pull; the page cache is warm after the first run; no fsync. This measures the
 * receiver's own code path against itself — not share speed over Wi-Fi, and not what a phone sends.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

interface Impl {
  label: string;
  pull: (options: Record<string, unknown>, open: () => unknown) => Promise<{ ok: boolean; sha256?: string; reason?: string; detail?: string }>;
  publish: (part: string, folder: string, name: string) => Promise<unknown>;
  partPath: (folder: string, offerId: string, nonce: string) => string;
  nonce: () => string;
  startPhone: (b: { bytes: Buffer; chunkSize?: number }) => Promise<{ open(): { socket: { pause(): unknown } }; close(): Promise<void> }>;
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function load(tree: string, label: string): Promise<Impl> {
  const root = resolve(tree);
  if (!existsSync(join(root, 'src/main/bulk.ts'))) throw new Error(`${label}: ${root} is not a desktop/ tree (no src/main/bulk.ts)`);
  const bulk = await import(join(root, 'src/main/bulk.ts'));
  const dest = await import(join(root, 'src/main/shareDestination.ts'));
  const kit = await import(join(root, 'src/main/sharePhone.testkit.ts'));
  return {
    label,
    pull: bulk.pullShareWith,
    publish: dest.publishExclusive,
    partPath: dest.sharePartPath,
    nonce: dest.newPartNonce,
    startPhone: kit.startFakePhone,
  };
}

const MIB = 1024 * 1024;
const OFFER = 's-Q3v9aP0kT7mR2xW8yB4nZc';

async function once(impl: Impl, base: string, n: number, bytes: Buffer, sha256: string) {
  const folder = mkdtempSync(join(base, `run-${n}-`));
  const phone = await impl.startPhone({ bytes });
  let pauses = 0;
  let progressCalls = 0;
  const cpu0 = process.cpuUsage();
  const t0 = process.hrtime.bigint();
  try {
    const result = await impl.pull({
      token: 'token-bench', transferId: 'ts-AAAAAAAAAAAAAAAAAAAAAA',
      part: impl.partPath(folder, OFFER, impl.nonce()),
      expectedBytes: bytes.length, expectedSha256: sha256, idleTimeoutMs: 30_000,
      publish: (part: string) => impl.publish(part, folder, 'bench.bin'),
      ledger: null,
      onProgress: () => { progressCalls += 1; },
    }, () => {
      const conn = phone.open();
      const pause = conn.socket.pause.bind(conn.socket);
      conn.socket.pause = () => { pauses += 1; return pause(); };
      return conn;
    });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const cpu = process.cpuUsage(cpu0);
    if (!result.ok || result.sha256 !== sha256) throw new Error(`${impl.label} run ${n} did not save: ${JSON.stringify(result)}`);
    const onDisk = lstatSync(join(folder, 'bench.bin')).size;
    if (onDisk !== bytes.length) throw new Error(`${impl.label} run ${n}: ${onDisk} bytes on disk for ${bytes.length}`);
    return { ms, mbps: bytes.length / MIB / (ms / 1000), userMs: cpu.user / 1000, sysMs: cpu.system / 1000, frames: progressCalls, pauses };
  } finally {
    await phone.close();
    rmSync(folder, { recursive: true, force: true });
  }
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

async function main(): Promise<void> {
  const baselineTree = arg('baseline');
  if (!baselineTree) throw new Error('usage: --baseline <desktop tree> [--mib 512] [--runs 5]');
  const mib = Number(arg('mib') ?? 512);
  const runs = Number(arg('runs') ?? 5);
  if (!Number.isInteger(mib) || mib < 1 || mib > 2048 || !Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error('--mib 1..2048, --runs 1..20');

  // The guard: one folder, made here, provably inside the OS temp folder.
  const tmpReal = realpathSync(tmpdir());
  const base = mkdtempSync(join(tmpdir(), 'share-bench-'));
  const baseReal = realpathSync(base);
  if (!baseReal.startsWith(`${tmpReal}/`) || !basename(baseReal).startsWith('share-bench-')) {
    throw new Error(`refusing: ${baseReal} is not a share-bench folder inside ${tmpReal}`);
  }

  const candidate = await load(resolve(__dirname, '..'), 'this tree');
  const baseline = await load(baselineTree, 'baseline');
  const bytes = randomBytes(mib * MIB);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  console.log(`share-pull-bench: ${mib} MiB synthetic, ${runs} measured runs per tree after one discarded warm-up each`);
  console.log(`  temp folder ${baseReal} (inside ${tmpReal}); node ${process.version}`);
  console.log('  bounds: localhost TCP, no TLS; phone and pull in one process (CPU is both); warm page cache; no fsync');

  const results: Record<string, Awaited<ReturnType<typeof once>>[]> = { baseline: [], 'this tree': [] };
  try {
    let n = 0;
    for (const impl of [baseline, candidate]) {
      const w = await once(impl, base, n++, bytes, sha256);
      console.log(`  warm-up  ${impl.label.padEnd(9)} ${w.mbps.toFixed(0).padStart(5)} MiB/s (discarded)`);
    }
    for (let i = 0; i < runs; i += 1) {
      for (const impl of [baseline, candidate]) {
        const r = await once(impl, base, n++, bytes, sha256);
        results[impl.label]!.push(r);
        console.log(`  run ${String(i + 1).padStart(2)}   ${impl.label.padEnd(9)} ${r.ms.toFixed(0).padStart(6)} ms  ` +
          `${r.mbps.toFixed(0).padStart(5)} MiB/s  cpu ${r.userMs.toFixed(0)}u/${r.sysMs.toFixed(0)}s ms  ` +
          `${r.frames} frames, ${r.pauses} pauses`);
      }
    }
  } finally {
    if (realpathSync(base) === baseReal) rmSync(base, { recursive: true, force: true });
  }
  const summary = (label: string) => {
    const rs = results[label]!;
    const m = rs.map((r) => r.mbps);
    return { label, medianMiBps: median(m), min: Math.min(...m), max: Math.max(...m), medianCpuMs: median(rs.map((r) => r.userMs + r.sysMs)), medianPauses: median(rs.map((r) => r.pauses)) };
  };
  const a = summary('baseline');
  const b = summary('this tree');
  for (const s of [a, b]) {
    console.log(`  ${s.label.padEnd(9)} median ${s.medianMiBps.toFixed(0)} MiB/s (range ${s.min.toFixed(0)}–${s.max.toFixed(0)}), median CPU ${s.medianCpuMs.toFixed(0)} ms, median pauses ${s.medianPauses}`);
  }
  const ratio = b.medianMiBps / a.medianMiBps;
  // Stated before the numbers: within 5% of the baseline's median is "no measurable regression here".
  console.log(`  this tree / baseline = ${(ratio * 100).toFixed(1)}%  → ${ratio >= 0.95 ? 'within 5%' : 'SLOWER by more than 5% — investigate before committing'}`);
}

main().catch((error: Error) => {
  console.error(`share-pull-bench: ${error.message}`);
  process.exit(1);
});
