// Fixtures for the encoder spike's pre-registered criteria (webcam-spike-core.mjs). Every report here
// is GENERATED — no hardware reading exists yet. The PASS fixture is the shape the Mac's SpikeReport
// actually has (desktop/src/main/webcamSpike.test.ts runs this verdict on a real report from the real
// decode probe, so the two cannot drift apart silently).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOUNDS, DRIVER_LIMITS, PHONE_LINE_CONTRACT, parseArgs, parseWebcamLine, verdict } from './webcam-spike-core.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEBCAM_SRC = join(REPO, 'camera-module/src/main/java/com/chetan/connectsuite/camera/webcam');

test('arguments: help by default, every execute flag required, nothing unknown', () => {
  assert.equal(parseArgs([]).mode, 'help');
  assert.equal(parseArgs(['--plan']).mode, 'plan');
  assert.equal(parseArgs(['--dry-run']).mode, 'dry-run');
  assert.equal(parseArgs(['--execute']).mode, 'refused');
  assert.equal(parseArgs(['--execute', '--report', 'r.json']).mode, 'refused');
  assert.equal(parseArgs(['--execute', '--owner-present']).mode, 'refused');
  assert.equal(parseArgs(['--execute', '--report', 'r.json', '--owner-present']).mode, 'execute');
  assert.equal(parseArgs(['--plan', '--execute']).mode, 'refused');
  assert.equal(parseArgs(['--dry-run', '--case', 'x']).mode, 'refused');
  assert.equal(parseArgs(['--execute', '--report', '--owner-present']).mode, 'refused');
});

test('the driver’s bounds are the spike’s: planned Stop inside the cap, the emergency after both', () => {
  const ts = readFileSync(join(REPO, 'desktop/src/main/webcamSpike.ts'), 'utf8');
  const num = (key) => Number(ts.match(new RegExp(`${key}: ([\\d_]+),`))[1].replace(/_/g, ''));
  assert.equal(num('plannedStopMs'), DRIVER_LIMITS.PLANNED_STOP_MS);
  assert.equal(num('hardCapMs'), DRIVER_LIMITS.HARD_CAP_MS);
  assert.equal(num('observeMs'), DRIVER_LIMITS.OBSERVE_MS);
  assert.ok(DRIVER_LIMITS.PLANNED_STOP_MS < DRIVER_LIMITS.HARD_CAP_MS && DRIVER_LIMITS.HARD_CAP_MS < DRIVER_LIMITS.EMERGENCY_MS);
  assert.ok(BOUNDS.STOP_AT_MIN_MS <= DRIVER_LIMITS.PLANNED_STOP_MS && DRIVER_LIMITS.PLANNED_STOP_MS <= BOUNDS.STOP_AT_MAX_MS);
  assert.ok(BOUNDS.STOP_AT_MAX_MS < DRIVER_LIMITS.HARD_CAP_MS, 'a stop accepted as planned can never be the cap');
});

test('every phone line the parser depends on is still written by the Kotlin', () => {
  for (const { kind, file, fragment } of PHONE_LINE_CONTRACT) {
    const src = readFileSync(join(WEBCAM_SRC, file), 'utf8');
    assert.ok(src.includes(fragment), `${kind}: ${file} no longer writes ${fragment}`);
  }
});

// Lines as the phone's LinkLog writes them (timestamp, level, tag), with the Kotlin templates filled in.
const P = 'abcd1234';
const L = (body) => `2026-10-05T10:00:00.000+05:30 I [webcam] ${body}`;
const LINES = {
  request: L('webcam.request from Chetans-MacBook-Pro: [Ack, ShowRequest]'),
  tapped: L(`Start camera tapped for webcam ${P}…: [OpenCapture]`),
  capture: L(`Webcam capture ${P}… generation 1: back camera 0, 1920x1080 @30 target, 8.0 Mbit/s — the target 1920x1080@30 is a target, not a measurement; encoder c2.exynos.h264.encoder (hardware true), AE range 30-30, 24 encoder-capable sizes`),
  attached: L(`Webcam stream ${P}… attached for Chetans-MacBook-Pro`),
  running: L(`Webcam session ${P}… running: generation 1, 1920 × 1080 selected against a 1920 × 1080 target, back camera`),
  stopped: L(`Webcam session ${P}… stopped: STOPPED_BY_MAC — 448 sent / 0 dropped`),
  stoppedDetail: L(`Webcam session ${P}… stopped: MAC_FAILED (STREAM_MALFORMED) — 12 sent / 0 dropped`),
  rung: L('Encoder would not configure at 1920x1080 @30 (CodecException); next rung'),
};

test('phone lines parse, and the Mac’s device name is never kept', () => {
  const cap = parseWebcamLine(LINES.capture);
  assert.equal(cap.kind, 'capture');
  assert.deepEqual([cap.prefix, cap.width, cap.height, cap.fps, cap.encoder, cap.hardware, cap.aeRange, cap.encoderSizes, cap.cameraId], [P, 1920, 1080, 30, 'c2.exynos.h264.encoder', true, '30-30', 24, '0']);
  assert.equal(parseWebcamLine(LINES.tapped).prefix, P);
  const att = parseWebcamLine(LINES.attached);
  assert.equal(att.kind, 'attached');
  assert.equal(att.line.includes('Chetans'), false);
  assert.equal(parseWebcamLine(LINES.request).line.includes('Chetans'), false);
  const run = parseWebcamLine(LINES.running);
  assert.deepEqual([run.kind, run.width, run.height, run.targetWidth, run.facing], ['running', 1920, 1080, 1920, 'back']);
  assert.deepEqual(parseWebcamLine(LINES.stopped), { ...parseWebcamLine(LINES.stopped), kind: 'stopped', reason: 'STOPPED_BY_MAC', detail: null, sent: 448, dropped: 0 });
  assert.equal(parseWebcamLine(LINES.stoppedDetail).detail, 'STREAM_MALFORMED');
  assert.equal(parseWebcamLine(LINES.rung).kind, 'rung-refused');
  assert.equal(parseWebcamLine(L('Camera stream abcd1234… attached for x')).kind, 'other', 'Camera v1 lines are not the webcam’s');
});

/** A generated PASS: 15 s at 30 fps, IDR every 2 s, 1080p, the planned Stop, 60 s of nothing. */
function passing() {
  const counts = {
    received: 450, accepted: 450, droppedDecodeQueue: 0, decodeErrors: 0, composeErrors: 0, discardedEnded: 0, pending: 0,
    'gate.noLiveSession': 0, 'gate.endedSession': 0, 'gate.otherSession': 0, 'gate.staleGeneration': 0, 'gate.awaitingKeyframe': 0, 'gate.outOfOrder': 0, 'gate.malformed': 0,
    'probe.arrived': 450, 'probe.decoded': 450, 'probe.decoded.idr': 8, 'probe.decoded.nonIdr': 442,
    'probe.nal.sps': 8, 'probe.nal.pps': 8, 'probe.firstArrivedIsIdrWithConfig': 1, 'probe.firstAcceptedIsIdr': 1,
    'probe.header.width': 1920, 'probe.header.height': 1080, 'probe.header.generationMin': 1, 'probe.header.generationMax': 1, 'probe.header.rotation': 1,
    'probe.sps.width': 1920, 'probe.sps.height': 1080, 'probe.sps.codedWidth': 1920, 'probe.sps.codedHeight': 1088, 'probe.sps.profile': 66, 'probe.sps.level': 40,
    'probe.decoded.width': 1920, 'probe.decoded.height': 1080, 'probe.pts.spanUs': 14_966_667, 'probe.idr.maxGapUs': 2_000_000, 'probe.idr.minGapUs': 1_966_667,
  };
  const spike = {
    outcome: 'completed', noReading: null, detail: null, facing: 'back', session: P,
    timeline: { ackFromRequestMs: 40, startingFromRequestMs: 6_000, runningFromStartingMs: 900, firstAuFromStartingMs: 850, stopFromStartingMs: 15_002, stoppedFromStopMs: 120 },
    stop: { trigger: 'planned', wire: { cause: 'person' }, ackStopped: true },
    running: [{ generation: 1, facing: 'back', width: 1920, height: 1080, targetWidth: 1920, targetHeight: 1080, frameRate: 30, codec: 'h264' }],
    phoneStopped: { reason: 'stopped-by-mac', framesSent: 450, framesDropped: 0 },
    mac: { framed: 450, keyframes: 8, bytes: 15_000_000, maxAuBytes: 200_000, arrivalSpanMs: 14_900, forwarded: 450, heldBeforeRunning: 1, droppedBeforeRunning: 0, droppedAtBridgeBound: 0, socketClose: null, malformed: null },
    probe: { ready: { deviceInstalled: false, producerIdentityConfigured: false }, counts, streamRejected: null, errors: [], exit: { code: 0, signal: null, requested: true, cause: 'stopped' } },
    observation: { ms: 60_001, statesAfterStopped: 0, foreignStates: 0, ausAfterStop: 0, linkEnded: false },
  };
  const phone = {
    lines: [LINES.request, LINES.tapped, LINES.capture, LINES.attached, LINES.running, LINES.stopped].map(parseWebcamLine),
    releasedWithinMs: 1_800, heldDuringObservation: 0, observationSamples: 30, capturesAfterStop: 0, emergencyHome: false,
  };
  return { spike, phone };
}

test('a complete, healthy run is PASS, with the targets reported beside the readings', () => {
  const { spike, phone } = passing();
  const v = verdict(spike, phone);
  assert.equal(v.verdict, 'PASS', v.reasons.join('\n'));
  assert.equal(v.info.measuredFps, 30);
  assert.equal(v.info.idrIntervalMaxMs, 2_000);
  assert.equal(v.info.coded, '1920×1088');
  assert.equal(v.info.encoder.name, 'c2.exynos.h264.encoder');
  assert.equal(v.info.selected, '1920×1080');
});

test('a lower rung than the target is still a PASS — the selected size is reported, not judged', () => {
  const { spike, phone } = passing();
  const c = spike.probe.counts;
  for (const k of ['probe.header', 'probe.sps', 'probe.decoded']) { c[`${k}.width`] = 1280; c[`${k}.height`] = 720; }
  c['probe.sps.codedWidth'] = 1280; c['probe.sps.codedHeight'] = 720;
  spike.running[0] = { ...spike.running[0], width: 1280, height: 720 };
  phone.lines = phone.lines.map((l) => (l.kind === 'capture' ? { ...l, width: 1280, height: 720 } : l));
  const v = verdict(spike, phone);
  assert.equal(v.verdict, 'PASS', v.reasons.join('\n'));
  assert.equal(v.info.selected, '1280×720');
  assert.equal(v.info.target, '1920×1080@30');
});

// Each mutation reinstates one way the spike can answer "no", and must fail on exactly that criterion.
const FAILS = [
  ['the first AU is not an IDR with SPS/PPS', (s) => (s.probe.counts['probe.firstArrivedIsIdrWithConfig'] = 0), /first AU was not an IDR/],
  ['no P-frames decoded', (s) => { s.probe.counts['probe.decoded.nonIdr'] = 0; s.probe.counts['probe.decoded'] = 8; s.probe.counts.accepted = 8; s.probe.counts['gate.awaitingKeyframe'] = 442; }, /P-frames decoded/],
  ['a decode failure', (s) => { s.probe.counts['probe.decodeFailed'] = 1; }, /decode failures/],
  ['the header claims a size the SPS does not', (s) => (s.probe.counts['probe.header.height'] = 1088), /dimensions disagree/],
  ['decoded size differs from the SPS', (s) => (s.probe.counts['probe.decoded.width'] = 1280), /dimensions disagree/],
  ['running reports another size', (s) => (s.running[0].height = 720), /dimensions disagree/],
  ['the bridge rejected the stream', (s) => (s.probe.streamRejected = 'generation-without-keyframe'), /malformed stream/],
  ['a second generation appeared', (s) => (s.probe.counts['probe.header.generationMax'] = 2), /generation not exactly 1/],
  ['running came late', (s) => (s.timeline.runningFromStartingMs = 10_001), /running not within/],
  ['the hard cap ended it', (s) => { s.stop.trigger = 'hard-cap'; s.timeline.stopFromStartingMs = 20_001; }, /not the planned Stop/],
  ['the Stop landed early', (s) => (s.timeline.stopFromStartingMs = 14_000), /outside/],
  ['the phone answered late', (s) => (s.timeline.stoppedFromStopMs = 2_500), /phone's stopped/],
  ['a state after the stop', (s) => (s.observation.statesAfterStopped = 1), /after the stop/],
  ['the observation was cut short', (s) => (s.observation.ms = 30_000), /observation ran/],
  ['the probe was killed', (s) => (s.probe.exit = { code: null, signal: 'SIGKILL', requested: true, cause: 'stopped' }), /decode probe exit/],
  ['accounting broken', (s) => (s.probe.counts.received = 451), /accounting does not hold/],
];
for (const [what, mutate, reason] of FAILS) {
  test(`FAIL: ${what}`, () => {
    const { spike, phone } = passing();
    mutate(spike);
    const v = verdict(spike, phone);
    assert.equal(v.verdict, 'FAIL');
    assert.ok(v.reasons.some((r) => reason.test(r)), `${what}: ${v.reasons.join(' | ')}`);
  });
}

const PHONE_FAILS = [
  ['the camera was still held 5 s after the stop', (p) => (p.releasedWithinMs = 6_000), /still held a camera/],
  ['the camera was never seen released', (p) => (p.releasedWithinMs = null), /never seen released/],
  ['a camera held during the observation', (p) => (p.heldDuringObservation = 1), /observation samples/],
  ['too few observation samples to say', (p) => (p.observationSamples = 3), /observation samples/],
  ['a capture after the stop', (p) => (p.capturesAfterStop = 1), /capture lines after the stop/],
  ['the driver had to press Home', (p) => (p.emergencyHome = true), /press Home/],
  ['no claim attached on the phone', (p) => (p.lines = p.lines.filter((l) => l.kind !== 'attached')), /claim attached/],
  ['the phone selected another size than it streamed', (p) => (p.lines = p.lines.map((l) => (l.kind === 'capture' ? { ...l, width: 1280 } : l))), /capture line/],
  ['another reason in the phone log', (p) => (p.lines = p.lines.map((l) => (l.kind === 'stopped' ? { ...l, reason: 'STREAM_CLOSED' } : l))), /STREAM_CLOSED/],
];
for (const [what, mutate, reason] of PHONE_FAILS) {
  test(`FAIL: ${what}`, () => {
    const { spike, phone } = passing();
    mutate(phone);
    const v = verdict(spike, phone);
    assert.equal(v.verdict, 'FAIL');
    assert.ok(v.reasons.some((r) => reason.test(r)), `${what}: ${v.reasons.join(' | ')}`);
  });
}

test('NO READING is its own outcome: no report, a no-reading, a lost link, the owner’s own Stop or Home', () => {
  assert.equal(verdict(null, null).verdict, 'NO READING');
  for (const [noReading, detail] of [['not-approved', 'expired'], ['ended-before-capture', 'declined'], ['refused-by-phone', 'CAMERA_BUSY'], ['not-connected', null]]) {
    const { spike, phone } = passing();
    Object.assign(spike, { outcome: 'no-reading', noReading, detail });
    const v = verdict(spike, phone);
    assert.equal(v.verdict, 'NO READING');
    assert.match(v.reasons[0], new RegExp(noReading));
  }
  for (const trigger of ['link', 'lifecycle']) {
    const { spike, phone } = passing();
    spike.stop.trigger = trigger;
    assert.equal(verdict(spike, phone).verdict, 'NO READING', trigger);
  }
  for (const reason of ['left-screen', 'stopped-on-phone']) {
    const { spike, phone } = passing();
    spike.stop = { trigger: 'phone', wire: null, ackStopped: null };
    spike.phoneStopped.reason = reason;
    assert.equal(verdict(spike, phone).verdict, 'NO READING', reason);
  }
  // …but the phone failing the capture is an answer, and the answer is no.
  const { spike, phone } = passing();
  spike.stop = { trigger: 'phone', wire: null, ackStopped: null };
  spike.phoneStopped.reason = 'capture-failed';
  assert.equal(verdict(spike, phone).verdict, 'FAIL');
});
