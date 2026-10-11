#!/usr/bin/env node
/**
 * The raw TCP speed of the phone ↔ Mac link, with no Sidekick code in the path.
 *
 *   node scripts/raw-link-speed.mjs --phone=10.51.59.236            # both directions, 1 and 4 streams
 *   node scripts/raw-link-speed.mjs --phone=… --streams=1,2,4,8 --mib=512 --runs=3 --dir=up,down
 *
 * `up` is phone → Mac, `down` is Mac → phone. The phone end is toybox `nc` over `adb-pinned.sh samsung`;
 * the Mac end is this process. Plain TCP, no TLS — the ceiling Sidekick's numbers are compared to.
 *
 * Written 2026-10-11 for the sharing-speed question, replacing the one-off `nc` + Python commands behind
 * `docs/transfer-speed-2026-10-11.md` §2 so the ceiling can be re-read beside any Sidekick number.
 *
 * ### What each number is — every bound stated, so a result shaped by one is not read as the link's
 *  - **up**: the clock starts at the first byte the Mac reads and stops when the Mac has read every byte
 *    of every stream. Bytes counted are bytes **delivered to this process**, never bytes the phone queued.
 *  - **down**: the clock starts at the Mac's first write and stops when the phone has closed every stream,
 *    which `nc` does only after reading to the end; the phone's own `wc -c` per stream is printed and must
 *    equal what was sent, or the run is refused. So it is delivered bytes plus one close, ≈ one RTT.
 *  - `--mib` is the total per run, split evenly across streams. 512 MiB by default: at 1 Gbit/s that is
 *    ~4 s, long enough that a 100 ms start-up cost is under 3 %.
 *  - Mbit/s here is 10^6 bits; MB/s is 10^6 bytes. MiB only names the payload size.
 *  - A run that does not finish inside `--timeout` seconds (default 60) is reported `stopped=timeout`,
 *    with no rate.
 *
 * ### Parallel streams
 * `--streams` takes a list. If N streams do not beat 1 on a link, splitting a transfer across N sockets
 * cannot help on that link either — that is the reading a multi-stream "fast path" would need first.
 */
import { createServer, connect } from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback = null) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const phone = arg('phone') ?? (() => {
  try { return execFileSync('ipconfig', ['getoption', 'en0', 'router'], { encoding: 'utf8' }).trim(); } catch { return null; }
})();
if (!phone) { console.error('raw-link-speed: --phone=<ip> is required (no default gateway on en0 to assume)'); exit(2); }
const iface = execFileSync('route', ['-n', 'get', phone], { encoding: 'utf8' }).match(/interface: (\S+)/)?.[1];
const mac = iface ? execFileSync('ipconfig', ['getifaddr', iface], { encoding: 'utf8' }).trim() : null;
if (!mac) { console.error(`raw-link-speed: no local address on the route to ${phone}`); exit(2); }

const streamsList = (arg('streams') ?? '1,4').split(',').map(Number);
const dirs = (arg('dir') ?? 'up,down').split(',');
const runs = Number(arg('runs', '2'));
const totalBytes = Number(arg('mib', '512')) * 1024 * 1024;
const timeoutMs = Number(arg('timeout', '60')) * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function phoneShell(cmd) {
  const child = spawn(join(here, 'adb-pinned.sh'), ['samsung', 'shell', cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const done = new Promise((resolve) => child.on('close', (code) => resolve({ code, out, err })));
  return { child, done };
}

async function up(n) {
  const per = Math.floor(totalBytes / n);
  let got = 0, first = 0, last = 0, closed = 0;
  const server = createServer((s) => {
    s.on('data', (d) => { if (!first) first = performance.now(); got += d.length; if (got >= per * n) last = performance.now(); });
    s.on('close', () => { closed++; });
  });
  await new Promise((r) => server.listen(0, mac, r));
  const port = server.address().port;
  const cmd = `for i in $(seq 1 ${n}); do (head -c ${per} /dev/zero | toybox nc ${mac} ${port}) & done; wait`;
  const ph = phoneShell(cmd);
  const deadline = performance.now() + timeoutMs;
  while (!last && performance.now() < deadline) await sleep(20);
  ph.child.kill();
  await Promise.race([ph.done, sleep(2000)]);
  server.close();
  if (!last) return { stopped: 'timeout', bytes: got, expected: per * n };
  return { stopped: 'complete', bytes: got, ms: last - first };
}

async function down(n) {
  const per = Math.floor(totalBytes / n);
  const base = 42600 + Math.floor(Math.random() * 300);
  // stdin is /dev/null: without -q, toybox nc keeps reading the network after its stdin ends, and exits
  // only when the Mac closes — so each `wc -c` prints, and the shell ends, as soon as its stream is read.
  // (The first version fed it `sleep 120`, which held every pipeline open after nc had exited, so the
  // counts were often unprinted when the shell was stopped: three runs refused, recorded in testing.md.)
  const cmd = `for i in $(seq 0 ${n - 1}); do (toybox nc -l -p $((${base}+i)) </dev/null | toybox wc -c) & done; wait`;
  const ph = phoneShell(cmd);
  await sleep(1500); // the listeners' start-up; the clock does not include it
  const chunk = Buffer.alloc(256 * 1024);
  let first = 0;
  const ends = [];
  for (let i = 0; i < n; i++) {
    ends.push(new Promise((resolve) => {
      // allowHalfOpen: the phone's nc half-closes when its stdin ends; that must not end our sending.
      const s = connect({ port: base + i, host: phone, allowHalfOpen: true }, () => {
        if (!first) first = performance.now();
        let left = per;
        const pump = () => {
          while (left > 0) {
            const b = left >= chunk.length ? chunk : chunk.subarray(0, left);
            left -= b.length;
            if (!s.write(b)) { s.once('drain', pump); return; }
          }
          s.end();
        };
        pump();
      });
      s.on('close', () => resolve(performance.now()));
      s.on('error', () => resolve(NaN));
    }));
  }
  const timer = sleep(timeoutMs).then(() => 'timeout');
  const all = await Promise.race([Promise.all(ends), timer]);
  // Every count is printed before the shell ends; wait for it rather than cutting it off.
  const res = await Promise.race([ph.done, sleep(10000).then(() => ({ out: '' }))]);
  ph.child.kill();
  const counts = (res.out.match(/^\s*\d+\s*$/gm) ?? []).map(Number);
  if (all === 'timeout') return { stopped: 'timeout' };
  if (all.some(Number.isNaN)) return { stopped: 'socket error' };
  const delivered = counts.reduce((a, b) => a + b, 0);
  if (counts.length !== n || delivered !== per * n) {
    return { stopped: 'phone count mismatch', phoneCounts: counts, expected: per * n };
  }
  return { stopped: 'complete', bytes: delivered, ms: Math.max(...all) - first };
}

console.log(`raw TCP, no TLS · Mac ${mac} (${iface}) ↔ phone ${phone} · ${totalBytes / 1048576} MiB per run · ${runs} run(s) per cell`);
const results = [];
for (const dir of dirs) {
  for (const n of streamsList) {
    for (let r = 0; r < runs; r++) {
      const res = dir === 'up' ? await up(n) : await down(n);
      const mbit = res.ms ? (res.bytes * 8 / 1e6) / (res.ms / 1000) : null;
      results.push({ dir, streams: n, run: r + 1, ...res, mbit });
      const label = dir === 'up' ? 'phone → Mac' : 'Mac → phone';
      console.log(res.stopped === 'complete'
        ? `${label}  ${n} stream(s)  run ${r + 1}: ${res.bytes} B in ${res.ms.toFixed(0)} ms = ${mbit.toFixed(0)} Mbit/s (${(mbit / 8).toFixed(1)} MB/s)`
        : `${label}  ${n} stream(s)  run ${r + 1}: stopped=${res.stopped} ${JSON.stringify(res)} — no rate`);
      await sleep(1000);
    }
  }
}
if (arg('json')) console.log(JSON.stringify(results));
exit(0);
