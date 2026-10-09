/**
 * Defect 205's message crossing: every <interval> seconds for <minutes>, the Mac asks the phone for its
 * folder list through the app's own client (`connect.fsRoots`) and records whether an answer crossed and
 * how long it took, beside the link phase the app reports. One JSON line per sample to stdout. Bounds
 * (interval, duration, the 15 s client timeout) are printed in the first line.
 *
 *   node scripts/link-crossing-probe.mjs <minutes> <intervalSeconds>
 */
import { openProbe } from './probe.mjs';

const minutes = Number(process.argv[2] ?? 65);
const interval = Number(process.argv[3] ?? 300);
const probe = await openProbe({ port: 9222 });
console.log(JSON.stringify({ started: new Date().toISOString(), minutes, intervalSeconds: interval, note: 'one fs.list(roots) request per sample, via the app client; a sample is a request, not a socket record' }));
const end = Date.now() + minutes * 60_000;
let n = 0;
while (Date.now() < end) {
  n += 1;
  const r = await probe.read({
    question: `crossing ${n}`,
    read: `(async () => { const s = await connect.status(); const t = performance.now(); let ok = false, err = null, roots = null;
      try { const res = await connect.fsRoots(); ok = Boolean(res && res.ok); roots = res?.data?.roots?.length ?? null; err = res && !res.ok ? (res.reason ?? 'not ok') : null; }
      catch (e) { err = String(e); }
      return { phaseBefore: s?.phase ?? null, ok, ms: Math.round(performance.now() - t), roots, err }; })()`,
    control: `typeof connect.fsRoots`,
  }).catch((e) => ({ value: { ok: false, err: 'probe: ' + String(e) } }));
  console.log(JSON.stringify({ n, at: new Date().toISOString(), ...(r.value ?? {}), control: r.control ?? null }));
  await new Promise((res) => setTimeout(res, interval * 1000));
}
console.log(JSON.stringify({ stopped: 'duration', samples: n, ended: new Date().toISOString() }));
await probe.close?.();
