// The Camera v2 encoder spike's driver core — pure, no I/O. docs/camera-v2-encoder-spike.md is the
// runbook; the criteria below are its §7, PRE-REGISTERED: written, tested and committed before any
// hardware reading exists, so nothing can be rationalised afterwards. Change them only in a commit that
// touches no reading.
//
// `webcam-spike-driver.mjs` supplies the phone and the Mac; `webcam-spike-core.test.mjs` supplies
// generated reports for every outcome, including each fault the Camera v1 sittings paid for.

export const DRIVER_LIMITS = Object.freeze({
  /** From the run call: the phone's 30 s expiry + Electron main's 5 s slack + margin. */
  APPROVAL_MS: 40_000,
  /** The spike's own bounds (desktop/src/main/webcamSpike.ts SPIKE_BOUNDS) — the driver checks them, never sets them. */
  PLANNED_STOP_MS: 15_000,
  HARD_CAP_MS: 20_000,
  OBSERVE_MS: 60_000,
  /**
   * The driver's own, independent emergency: our package still holding a camera this long after the DRIVER
   * first saw the Mac's spike phase `capturing` (its own clock, polled ~every 0.5 s — never the phone's tap time).
   */
  EMERGENCY_MS: 25_000,
  /** The whole run, from the run call, before the driver gives up and reports NO READING. */
  OVERALL_MS: 150_000,
  /** How often the phone's camera client list is read. */
  CAMERA_POLL_MS: 2_000,
});

/** Pre-registered timing bounds (runbook §7). Each is a bound on a reading, never a target. */
export const BOUNDS = Object.freeze({
  /** `running` after `starting` — the contract's "IDR within 10 s of the tap". */
  RUNNING_WITHIN_MS: 10_000,
  /** The first AU on the Mac after `starting`. */
  FIRST_AU_WITHIN_MS: 10_000,
  /** The planned Stop must land between these, measured from `starting`. */
  STOP_AT_MIN_MS: 14_500,
  STOP_AT_MAX_MS: 16_500,
  /** The phone's `stopped` after the stop is written. */
  STOPPED_WITHIN_MS: 2_000,
  /** Our package gone from `dumpsys media.camera` after the stop. */
  RELEASED_WITHIN_MS: 5_000,
  /** At least this much decoded: at the ladder's lowest rung (15 fps) for 5 of the ~15 s. */
  MIN_DECODED: 75,
  MIN_DECODED_IDR: 2,
  MIN_DECODED_NON_IDR: 60,
});

export const USAGE = `webcam-spike-driver — the Camera v2 encoder spike (docs/camera-v2-encoder-spike.md)

  --plan                                   print the steps, bounds and criteria; touches nothing
  --dry-run                                read-only gates (pinned phone, its log, the Mac's spike status);
                                           no request, no key, no launch
  --execute --report <new file> --owner-present
                                           ONE request; every flag required

Without --dry-run or --execute this prints and exits. It never sends a request on its own.`;

/** Pure: what the arguments ask for, or why they ask for nothing. */
export function parseArgs(argv) {
  const known = new Set(['--plan', '--dry-run', '--execute', '--report', '--owner-present', '--help']);
  const errors = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') && !known.has(a)) errors.push(`unknown flag ${a}`);
    if (!a.startsWith('--')) errors.push(`unexpected argument ${a}`);
    if (a === '--report' && i + 1 < argv.length) i++;
  }
  const modes = ['--plan', '--dry-run', '--execute'].filter((f) => argv.includes(f));
  if (modes.length > 1) errors.push(`choose one of --plan, --dry-run, --execute (got ${modes.join(', ')})`);
  const mode = modes.length === 1 ? modes[0].slice(2) : 'help';
  const ri = argv.indexOf('--report');
  const report = ri >= 0 && ri + 1 < argv.length && !argv[ri + 1].startsWith('--') ? argv[ri + 1] : null;
  if (mode === 'execute') {
    if (!report) errors.push('--execute needs --report <new file>');
    if (!argv.includes('--owner-present')) errors.push('--execute needs --owner-present: the phone’s owner must be there to tap Start camera');
  }
  return { mode: errors.length ? 'refused' : mode, report, errors };
}

/**
 * The fragments of the phone's `[webcam]` lines this parser depends on, each as the Kotlin writes it.
 * `webcam-spike-core.test.mjs` checks every one is still in the source, so a reworded log line fails a
 * test here instead of a hardware sitting.
 */
export const PHONE_LINE_CONTRACT = Object.freeze([
  { kind: 'request', file: 'WebcamEngine.kt', fragment: '"webcam.request from ${session.peerName}: ${describe(effects)}"' },
  { kind: 'tapped', file: 'WebcamEngine.kt', fragment: '"Start camera tapped for webcam ${sessionId.take(8)}…: ${describe(effects)}"' },
  { kind: 'capture', file: 'WebcamCamera2.kt', fragment: '"Webcam capture ${sessionId.take(8)}… generation $generation: ${facing.wire} camera $id, $size @${rung.fps} target, "' },
  { kind: 'capture', file: 'WebcamCamera2.kt', fragment: '"${WebcamQuality.TARGET_FPS} is a target, not a measurement; encoder ${codec.name} "' },
  { kind: 'capture', file: 'WebcamCamera2.kt', fragment: '"(hardware ${codec.codecInfo.isHardwareAccelerated}), AE range ' },
  { kind: 'rung-refused', file: 'WebcamCamera2.kt', fragment: '"Encoder would not configure at ${size} @${rung.fps} (${e.javaClass.simpleName}); next rung"' },
  { kind: 'attached', file: 'WebcamEngine.kt', fragment: '"Webcam stream ${sessionId.take(8)}… attached for ${channel.session.peerName}"' },
  { kind: 'running', file: 'WebcamEngine.kt', fragment: '"Webcam session ${(effect.payload["sessionId"] as? String)?.take(8)}… running: generation ${effect.payload["generation"]}, "' },
  { kind: 'stopped', file: 'WebcamEngine.kt', fragment: '"Webcam session ${effect.sessionId.take(8)}… stopped: ${effect.reason.name}"' },
  { kind: 'closed', file: 'WebcamEngine.kt', fragment: '"Webcam stream closed: ${lastTally.third}; $heldBack held back before running or stale, $unassembled unusable buffers"' },
  { kind: 'encoder-failed', file: 'WebcamCamera2.kt', fragment: '"Webcam encoder failed (' },
  { kind: 'lost', file: 'WebcamCamera2.kt', fragment: '"Webcam capture ${h.sessionId.take(8)}… lost: $why"' },
]);

/**
 * One phone `[webcam]` line, classified. `prefix` is the 8 hex characters the phone prints. The peer's
 * name (this Mac's device name) is never kept: it is replaced before the line is stored.
 */
export function parseWebcamLine(line) {
  const at = line.slice(0, 29);
  const clean = line.replace(/(attached for |webcam\.request from )([^:]+?)(:|$)/, '$1<peer>$3');
  let m;
  if ((m = clean.match(/webcam\.request from <peer>/))) return { kind: 'request', prefix: null, at, line: clean };
  if ((m = clean.match(/Start camera tapped for webcam ([0-9a-f]{8})…/))) return { kind: 'tapped', prefix: m[1], at, line: clean };
  if ((m = clean.match(/Webcam capture ([0-9a-f]{8})… generation (\d+): (back|front) camera (\S+), (\d+)x(\d+) @(\d+) target, ([\d.]+) Mbit\/s .*?encoder (\S+) \(hardware (true|false)\), AE range (\S+|none offered), (\d+) encoder-capable sizes/))) {
    return {
      kind: 'capture', prefix: m[1], generation: +m[2], facing: m[3], cameraId: m[4], width: +m[5], height: +m[6], fps: +m[7],
      mbps: +m[8], encoder: m[9], hardware: m[10] === 'true', aeRange: m[11], encoderSizes: +m[12], at, line: clean,
    };
  }
  if ((m = clean.match(/Encoder would not configure at (\d+)x(\d+) @(\d+) \((\w+)\); next rung/))) return { kind: 'rung-refused', prefix: null, width: +m[1], height: +m[2], fps: +m[3], why: m[4], at, line: clean };
  if ((m = clean.match(/Webcam stream ([0-9a-f]{8})… attached for <peer>/))) return { kind: 'attached', prefix: m[1], at, line: clean };
  if ((m = clean.match(/Webcam session ([0-9a-f]{8})… running: generation (\d+), (\d+) × (\d+) selected against a (\d+) × (\d+) target, (back|front) camera/))) {
    return { kind: 'running', prefix: m[1], generation: +m[2], width: +m[3], height: +m[4], targetWidth: +m[5], targetHeight: +m[6], facing: m[7], at, line: clean };
  }
  if ((m = clean.match(/Webcam session ([0-9a-f]{8})… stopped: ([A-Z_]+)(?: \((\w+)\))? — (\d+) sent \/ (\d+) dropped/))) {
    return { kind: 'stopped', prefix: m[1], reason: m[2], detail: m[3] ?? null, sent: +m[4], dropped: +m[5], at, line: clean };
  }
  if (clean.includes('Webcam stream closed: ')) return { kind: 'closed', prefix: null, at, line: clean };
  if ((m = clean.match(/Webcam encoder failed \((\w+)\)/))) return { kind: 'encoder-failed', prefix: null, how: m[1], at, line: clean };
  if ((m = clean.match(/Webcam capture ([0-9a-f]{8})… lost: (.+)$/))) return { kind: 'lost', prefix: m[1], why: m[2], at, line: clean };
  return { kind: 'other', prefix: null, at, line: clean };
}

const has = (o, k) => o != null && typeof o[k] === 'number';

/**
 * The pre-registered verdict (runbook §7). Three outcomes, never folded:
 *   - NO READING — the question was not asked: no tap, a refusal, a lost link, a gate, a lifecycle stop.
 *   - FAIL — the question was asked and the answer is no, or the instrument's bounds were broken.
 *   - PASS — every criterion below, each with the reading that satisfied it.
 *
 * `spike` is the Mac's SpikeReport. `phone` is what the driver read off the phone:
 *   { lines: parsed lines for THIS session's prefix (and unprefixed ones inside the window),
 *     releasedWithinMs: ms from the stop to our package leaving the camera client list (null: never seen),
 *     heldDuringObservation: samples in the 60 s with our package holding a camera,
 *     observationSamples: how many samples were taken in it,
 *     capturesAfterStop: `capture` lines after the stop, emergencyHome: whether the driver pressed Home }
 */
export function verdict(spike, phone) {
  const reasons = [];
  const passed = [];
  const info = {};
  const fail = (why) => reasons.push(why);
  const ok = (what) => passed.push(what);

  if (!spike) return { verdict: 'NO READING', reasons: ['no spike report was read from the Mac'], passed, info };
  if (spike.outcome === 'no-reading') {
    return { verdict: 'NO READING', reasons: [`${spike.noReading}${spike.detail ? `: ${spike.detail}` : ''}`], passed, info };
  }
  if (spike.stop?.trigger === 'link' || spike.stop?.trigger === 'lifecycle') {
    return { verdict: 'NO READING', reasons: [`the session ended by ${spike.stop.trigger} before the planned Stop`], passed, info };
  }
  if (spike.stop?.trigger === 'phone' && spike.phoneStopped && ['stopped-on-phone', 'left-screen'].includes(spike.phoneStopped.reason)) {
    // The owner (or the screen) ended it: not a product failure, and not the planned Stop either.
    return { verdict: 'NO READING', reasons: [`ended on the phone (${spike.phoneStopped.reason}) before the planned Stop`], passed, info };
  }

  const tl = spike.timeline ?? {};
  const c = spike.probe?.counts ?? null;
  const running = spike.running?.[0] ?? null;
  const capture = (phone?.lines ?? []).find((l) => l.kind === 'capture') ?? null;

  // 1. Identity: one request, one session, one claim, one generation.
  if (spike.session && /^[0-9a-f]{8}$/.test(spike.session)) ok('one session id acked'); else fail('no session id in the report');
  if ((phone?.lines ?? []).some((l) => l.kind === 'attached' && l.prefix === spike.session)) ok('the phone attached the claim for this session');
  else fail('the phone never logged the claim attached for this session');
  if (c && c['probe.header.generationMin'] === 1 && c['probe.header.generationMax'] === 1 && spike.running.length === 1) ok('one generation (1) throughout');
  else fail(`generation not exactly 1 throughout (running ×${spike.running?.length ?? 0}, header ${c?.['probe.header.generationMin']}..${c?.['probe.header.generationMax']})`);

  // 2. Timing to first picture.
  if (has(tl, 'runningFromStartingMs') && tl.runningFromStartingMs <= BOUNDS.RUNNING_WITHIN_MS) ok(`running ${tl.runningFromStartingMs} ms after starting reached the Mac`);
  else fail(`running not within ${BOUNDS.RUNNING_WITHIN_MS} ms of starting (${tl.runningFromStartingMs ?? 'never'})`);
  if (has(tl, 'firstAuFromStartingMs') && tl.firstAuFromStartingMs <= BOUNDS.FIRST_AU_WITHIN_MS) ok(`first AU ${tl.firstAuFromStartingMs} ms after starting reached the Mac`);
  else fail(`no AU within ${BOUNDS.FIRST_AU_WITHIN_MS} ms of starting (${tl.firstAuFromStartingMs ?? 'never'})`);

  // 3. The bitstream: SPS/PPS/IDR first, then P-frames, all decoded by VideoToolbox.
  if (!c) {
    fail('no counts from the decode probe');
  } else {
    if (c['probe.firstArrivedIsIdrWithConfig'] === 1) ok('the first AU was an IDR carrying SPS and PPS'); else fail('the first AU was not an IDR with SPS and PPS');
    if ((c['probe.nal.sps'] ?? 0) >= 1 && (c['probe.nal.pps'] ?? 0) >= 1) ok(`SPS ×${c['probe.nal.sps']}, PPS ×${c['probe.nal.pps']}`); else fail('no SPS/PPS reached the decoder');
    if ((c['probe.sps.unreadable'] ?? 0) === 0 && has(c, 'probe.sps.width')) ok(`SPS read: profile ${c['probe.sps.profile']}, level ${c['probe.sps.level']}`); else fail('an SPS could not be read');
    if ((c['probe.decoded.idr'] ?? 0) >= BOUNDS.MIN_DECODED_IDR) ok(`${c['probe.decoded.idr']} IDR decoded`); else fail(`fewer than ${BOUNDS.MIN_DECODED_IDR} IDR decoded (${c['probe.decoded.idr'] ?? 0})`);
    if ((c['probe.decoded.nonIdr'] ?? 0) >= BOUNDS.MIN_DECODED_NON_IDR) ok(`${c['probe.decoded.nonIdr']} P-frames decoded`); else fail(`fewer than ${BOUNDS.MIN_DECODED_NON_IDR} P-frames decoded (${c['probe.decoded.nonIdr'] ?? 0})`);
    if ((c['probe.decoded'] ?? 0) >= BOUNDS.MIN_DECODED) ok(`${c['probe.decoded']} frames decoded`); else fail(`fewer than ${BOUNDS.MIN_DECODED} frames decoded (${c['probe.decoded'] ?? 0})`);
    if ((c['probe.decodeFailed'] ?? 0) === 0 && (c.decodeErrors ?? 0) === 0) ok('no decode failure'); else fail(`${(c['probe.decodeFailed'] ?? 0)} decode failures`);
    if ((c['gate.malformed'] ?? 0) === 0 && !spike.probe.streamRejected && !spike.mac?.malformed) ok('no malformed AU');
    else fail(`malformed stream (${spike.probe.streamRejected ?? spike.mac?.malformed ?? `gate.malformed ${c['gate.malformed']}`})`);

    // 4. Dimensions: the header, `running`, the SPS (cropped) and the decoded buffer must agree.
    const header = [c['probe.header.width'], c['probe.header.height']];
    const sps = [c['probe.sps.width'], c['probe.sps.height']];
    const decoded = [c['probe.decoded.width'], c['probe.decoded.height']];
    const run = [running?.width, running?.height];
    const same = (a, b) => a[0] === b[0] && a[1] === b[1] && typeof a[0] === 'number';
    if (same(header, run) && same(header, sps) && same(sps, decoded)) ok(`header = running = SPS = decoded = ${header.join('×')}`);
    else fail(`dimensions disagree: header ${header.join('×')}, running ${run.join('×')}, SPS ${sps.join('×')}, decoded ${decoded.join('×')}`);
    if ((c['probe.mismatch.headerVsSps'] ?? 0) + (c['probe.mismatch.spsVsDecoded'] ?? 0) + (c['probe.mismatch.headerVsDecoded'] ?? 0) === 0) ok('no per-AU dimension mismatch');
    else fail('a per-AU dimension mismatch was counted');
    if ((c['probe.sps.sizeChanges'] ?? 0) === 0 && (c['probe.header.sizeChanges'] ?? 0) === 0) ok('one size throughout'); else fail('the size changed mid-session');
    if (capture && capture.width === header[0] && capture.height === header[1]) ok(`the phone selected ${capture.width}×${capture.height} and the stream carried it`);
    else fail(`the phone's capture line (${capture ? `${capture.width}×${capture.height}` : 'absent'}) does not match the stream (${header.join('×')})`);

    // Accounting: every AU the probe saw is accounted for once.
    const gateDrops = Object.entries(c).filter(([k]) => k.startsWith('gate.')).reduce((s, [, v]) => s + v, 0);
    const past = (c['probe.decoded'] ?? 0) + (c.droppedDecodeQueue ?? 0) + (c.decodeErrors ?? 0) + (c.composeErrors ?? 0) + (c.discardedEnded ?? 0);
    if (c.received === (c.accepted ?? 0) + gateDrops && c.accepted === past && c.pending === 0) ok(`accounting holds: ${c.received} received`);
    else fail(`accounting does not hold (received ${c.received}, accepted ${c.accepted}, gate drops ${gateDrops}, past the gate ${past}, pending ${c.pending})`);
  }

  // 5. The Stop, the release, and nothing after.
  if (spike.stop?.trigger === 'planned') ok('the planned Stop ended it'); else fail(`ended by ${spike.stop?.trigger ?? 'nothing'}, not the planned Stop`);
  if (has(tl, 'stopFromStartingMs') && tl.stopFromStartingMs >= BOUNDS.STOP_AT_MIN_MS && tl.stopFromStartingMs <= BOUNDS.STOP_AT_MAX_MS) ok(`Stop at ${tl.stopFromStartingMs} ms`);
  else fail(`Stop at ${tl.stopFromStartingMs ?? '?'} ms, outside ${BOUNDS.STOP_AT_MIN_MS}–${BOUNDS.STOP_AT_MAX_MS}`);
  if (spike.phoneStopped?.reason === 'stopped-by-mac' && has(tl, 'stoppedFromStopMs') && tl.stoppedFromStopMs <= BOUNDS.STOPPED_WITHIN_MS) ok(`phone stopped-by-mac in ${tl.stoppedFromStopMs} ms`);
  else fail(`the phone's stopped was ${spike.phoneStopped?.reason ?? 'absent'} after ${tl.stoppedFromStopMs ?? '?'} ms`);
  const phoneStoppedLine = (phone?.lines ?? []).find((l) => l.kind === 'stopped' && l.prefix === spike.session);
  if (phoneStoppedLine?.reason === 'STOPPED_BY_MAC') ok('the phone logged STOPPED_BY_MAC'); else fail(`the phone logged ${phoneStoppedLine?.reason ?? 'no stopped line'} for this session`);
  if (typeof phone?.releasedWithinMs === 'number' && phone.releasedWithinMs <= BOUNDS.RELEASED_WITHIN_MS) ok(`camera released ${phone.releasedWithinMs} ms after the stop`);
  else fail(`our package still held a camera ${BOUNDS.RELEASED_WITHIN_MS} ms after the stop (${phone?.releasedWithinMs ?? 'never seen released'})`);
  if (spike.probe?.exit && spike.probe.exit.code === 0) ok('the decode probe exited 0 and was reaped'); else fail(`decode probe exit ${JSON.stringify(spike.probe?.exit ?? null)}`);
  if ((spike.observation?.ms ?? 0) >= DRIVER_LIMITS.OBSERVE_MS - 1_000) ok(`observed ${spike.observation.ms} ms`); else fail(`the observation ran ${spike.observation?.ms ?? 0} ms, not ${DRIVER_LIMITS.OBSERVE_MS}`);
  const after = (spike.observation?.statesAfterStopped ?? 0) + (spike.observation?.foreignStates ?? 0) + (spike.observation?.ausAfterStop ?? 0);
  if (after === 0) ok('no state and no AU after the stop'); else fail(`${after} states/AUs after the stop`);
  if ((phone?.heldDuringObservation ?? 1) === 0 && (phone?.observationSamples ?? 0) >= 10) ok(`no camera held in ${phone.observationSamples} samples over the observation`);
  else fail(`camera held in ${phone?.heldDuringObservation ?? '?'} of ${phone?.observationSamples ?? 0} observation samples`);
  if ((phone?.capturesAfterStop ?? 1) === 0) ok('no capture line after the stop'); else fail(`${phone?.capturesAfterStop ?? '?'} capture lines after the stop`);
  if (phone?.emergencyHome) fail('the driver had to press Home: the Mac-side stop did not release the camera in time');

  // Informational — reported beside the targets, never pass/fail (runbook §7.4).
  if (c) {
    const span = c['probe.pts.spanUs'] ?? 0;
    info.measuredFps = span > 0 ? +(((c['probe.arrived'] ?? 1) - 1) / (span / 1e6)).toFixed(2) : null;
    info.targetFps = running?.frameRate ?? null;
    info.idrIntervalMaxMs = has(c, 'probe.idr.maxGapUs') ? Math.round(c['probe.idr.maxGapUs'] / 1000) : null;
    info.idrIntervalMinMs = has(c, 'probe.idr.minGapUs') ? Math.round(c['probe.idr.minGapUs'] / 1000) : null;
    info.idrTargetMs = 2_000;
    info.selected = has(c, 'probe.header.width') ? `${c['probe.header.width']}×${c['probe.header.height']}` : null;
    info.target = running ? `${running.targetWidth}×${running.targetHeight}@${running.frameRate}` : null;
    info.coded = has(c, 'probe.sps.codedWidth') ? `${c['probe.sps.codedWidth']}×${c['probe.sps.codedHeight']}` : null;
    info.profileLevel = has(c, 'probe.sps.profile') ? `${c['probe.sps.profile']}/${c['probe.sps.level']}` : null;
    info.rotation = c['probe.header.rotation'] ?? null;
    info.sequenceGaps = c['probe.header.sequenceGaps'] ?? 0;
    info.discontinuities = c['probe.header.discontinuities'] ?? 0;
    info.macBitrateMbps = spike.mac?.arrivalSpanMs ? +((spike.mac.bytes * 8) / (spike.mac.arrivalSpanMs / 1000) / 1e6).toFixed(2) : null;
    info.dropped = { beforeRunning: spike.mac?.droppedBeforeRunning ?? 0, bridgeBound: spike.mac?.droppedAtBridgeBound ?? 0, decodeQueue: c.droppedDecodeQueue ?? 0, phone: spike.phoneStopped?.framesDropped ?? null };
  }
  if (capture) info.encoder = { name: capture.encoder, hardware: capture.hardware, aeRange: capture.aeRange, cameraId: capture.cameraId, rungFps: capture.fps, mbps: capture.mbps, encoderSizes: capture.encoderSizes };
  info.rungsRefused = (phone?.lines ?? []).filter((l) => l.kind === 'rung-refused').map((l) => `${l.width}x${l.height}@${l.fps} (${l.why})`);

  return { verdict: reasons.length === 0 ? 'PASS' : 'FAIL', reasons, passed, info };
}
