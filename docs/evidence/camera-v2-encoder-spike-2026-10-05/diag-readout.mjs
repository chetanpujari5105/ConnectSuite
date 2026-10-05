#!/usr/bin/env node
// Pre-registered 2026-10-05, before the run. Reads ONE spike report (the driver's JSON) and prints the
// defect-177 diagnostic readings with the classification rules fixed below. It never changes the verdict:
// the verdict is scripts/webcam-spike-core.mjs (scorer v2) and nothing else.
//   node diag-readout.mjs <report.json>
import { readFileSync } from 'node:fs';
const r = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const c = r?.spike?.probe?.counts ?? r?.probe?.counts ?? r?.spike?.counts ?? null;
if (!c) { console.log('NO READING: the report carries no probe counts record'); process.exit(0); }
const get = (k) => (k in c ? c[k] : 'MISSING');
const ms = (k) => (typeof c[k] === 'number' ? (c[k] / 1000).toFixed(1) + ' ms' : 'MISSING');
const mean = (s) => (typeof c[`diag.${s}.count`] === 'number' && c[`diag.${s}.count`] > 0 ? (c[`diag.${s}.totalUs`] / c[`diag.${s}.count`] / 1000).toFixed(2) + ' ms' : 'n/a');
const missing = Object.keys(c).length ? ['diag.overflow.events', 'diag.prepare.count', 'diag.firstFrame.sinceLiveUs', 'diag.chain.decodedAfterFailure'].filter((k) => !(k in c)) : [];
const out = [];
out.push(`instrument: ${Object.keys(c).length} counters${missing.length ? `; MISSING ${missing.join(', ')} — those readings do not exist` : ''}`);
// Accounting (the same identity as the scorer's; reported here, judged there).
const gate = Object.entries(c).filter(([k]) => k.startsWith('gate.')).reduce((s, [, v]) => s + v, 0);
const T = ['droppedDecodeQueue', 'decodeErrors', 'composeErrors', 'discardedEnded', 'sinkEnqueued', 'sinkUnavailable'];
out.push(`accounting: received ${get('received')} = accepted ${get('accepted')} + gate drops ${gate}; terminal ${T.map((k) => `${k} ${get(k)}`).join(', ')}; pending ${get('pending')}`);
// Overflow — the pre-registered classification.
const ev = c['diag.overflow.events'];
if (typeof ev !== 'number') out.push('overflow: MISSING — no reading of whether the stage overflowed');
else if (ev === 0) out.push('overflow: NONE in this run — a useful reading, NOT proof that burst recovery is solved');
else if (typeof ev === 'number') {
  const before = c['diag.overflow.first.decodesBefore'], perFrame = c['diag.arrival.maxPerFrame'], inflight = c['diag.overflow.first.inFlightUs'];
  out.push(`overflow: ${ev} event(s); first at AU ${get('diag.overflow.first.atReceived')}, ${ms('diag.overflow.first.sinceLiveUs')} after live, GOP index ${get('diag.overflow.first.gopIndex')}, decode in flight ${ms('diag.overflow.first.inFlightUs')}, ${before} decodes completed before it`);
  out.push(`  before any completed decode: ${before === 0 ? 'YES (the startup case)' : 'NO (a later GOP)'}`);
  // Rules fixed before the run: a burst is >= 5 AUs inside one frame interval (the stage holds 1 decoding + 4 waiting);
  // a slow service is a frame in flight longer than one frame interval (33.3 ms).
  const burst = perFrame >= 5, slow = inflight > 33_333;
  out.push(`  classification: ${burst && slow ? 'burst during slow service' : burst ? 'burst-led' : slow ? 'slow-service-led' : 'neither rule met — unexplained by these counters'}` +
    ` (max ${perFrame} AUs in one frame interval; first overflow's in-flight ${ms('diag.overflow.first.inFlightUs')})`);
  out.push('  NOT established by these counters: what delayed the AUs into a burst (phone, network, Electron main, the pipe) — nothing here measures it');
}
out.push(`recovery: ${get('diag.recovery.count')} recovered, max ${ms('diag.recovery.maxUs')}, max refused ${get('diag.recovery.maxRefused')}, unrecovered ${get('diag.recovery.unrecovered')}, open ${get('diag.recovery.open')}; gate.awaitingKeyframe ${get('gate.awaitingKeyframe')}`);
out.push(`preparation: count ${get('diag.prepare.count')}, max ${ms('diag.prepare.maxUs')}, frame waited ${ms('diag.prepare.waitMaxUs')}, discarded ${get('diag.prepare.discarded')}, failed ${get('diag.prepare.failed')}`);
out.push(`first frame since session-live: ${ms('diag.firstFrame.sinceLiveUs')}`);
for (const s of ['decode', 'compose']) out.push(`${s}: n ${get(`diag.${s}.count`)}, first ${ms(`diag.${s}.firstUs`)}, mean ${mean(s)}, max ${ms(`diag.${s}.maxUs`)}, over 33.3 ms ${get(`diag.${s}.overBudget`)}`);
out.push(`service (decode+compose): max ${ms('diag.service.maxUs')}, over budget ${get('diag.service.overBudget')}; queue wait max ${ms('diag.queueWait.maxUs')}; decode stage high-water ${get('maxWaiting')} of 4`);
out.push(`arrival: max gap ${ms('diag.arrival.maxGapUs')}, most AUs in one frame interval ${get('diag.arrival.maxPerFrame')}`);
out.push(`decode-failure chain: decodedAfterFailure ${get('diag.chain.decodedAfterFailure')} (pre-registered: must be 0; anything else is a defect finding, reported, not a verdict change), flushed ${get('diag.chain.flushedAfterFailure')}, stale ${get('diag.chain.staleFailures')}, resets ${get('diag.chain.decoderResets')}`);
out.push(`after the Stop: completions ${get('diag.afterEnd.completions')}, latest ${ms('diag.afterEnd.maxLateUs')}; discarded before decode ${get('diag.discardedEnded.beforeDecode')}, after ${get('diag.discardedEnded.afterDecode')}`);
console.log(out.join('\n'));
