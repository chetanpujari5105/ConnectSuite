// Fixtures for the encoder spike's pre-registered criteria (webcam-spike-core.mjs). Every report here
// is GENERATED — no hardware reading exists yet. The PASS fixture is the shape the Mac's SpikeReport
// actually has (desktop/src/main/webcamSpike.test.ts runs this verdict on a real report from the real
// decode probe, so the two cannot drift apart silently).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BOUNDS, DRIVER_LIMITS, PEER, PEER_SHAPES, PHONE_LINE_CONTRACT, SCORER_VERSION, TERMINAL_DISPOSITIONS,
  accounting, criteriaChanges, knownMacNames, parseArgs, parseWebcamLine, redactPeerNames, redactPeerShapes, sanitizeReport, verdict,
} from './webcam-spike-core.mjs';

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
    received: 450, accepted: 450, droppedDecodeQueue: 0, decodeErrors: 0, composeErrors: 0, discardedEnded: 0, sinkEnqueued: 450, sinkUnavailable: 0, pending: 0,
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

// ---- Evidence handling: the peer's name (scorer version 2's sitting) --------------------------------

const PEER_LITERAL = /"[^"\n]*(\$peerName|\$\{[^}]*peerName[^}]*\})[^"\n]*"/g;
/** On-screen copy, never logged — each named here so a new literal anywhere must be classified. */
const PEER_UI_COPY = [
  ['WebcamActivity.kt', '"Webcam for ${ui.peerName'],
  ['WebcamNotifications.kt', '"An app on $peerName'],
  ['WebcamNotifications.kt', '"$peerName is asking'],
];

test('every Kotlin literal naming the peer is a log shape the sanitizer covers, or named on-screen copy', () => {
  let logs = 0;
  for (const file of readdirSync(WEBCAM_SRC).filter((f) => f.endsWith('.kt'))) {
    const src = readFileSync(join(WEBCAM_SRC, file), 'utf8');
    const lines = src.split('\n');
    for (const m of src.matchAll(PEER_LITERAL)) {
      const lineNo = src.slice(0, m.index).split('\n').length - 1;
      const isLog = lines.slice(Math.max(0, lineNo - 3), lineNo + 1).some((l) => l.includes('LinkLog.'));
      if (isLog) {
        logs += 1;
        assert.ok(PEER_SHAPES.some((s) => m[0].startsWith(s.fragment.split('${')[0])), `${file}:${lineNo + 1} logs the peer's name in a shape the sanitizer does not cover: ${m[0]}`);
      } else {
        assert.ok(PEER_UI_COPY.some(([f, p]) => f === file && m[0].startsWith(p)), `${file}:${lineNo + 1} names the peer and is neither a covered log shape nor listed copy: ${m[0]}`);
      }
    }
  }
  assert.equal(logs, PEER_SHAPES.length, 'control: the scan found exactly the log lines the shapes describe');
});

test('every peer shape is still written by the Kotlin', () => {
  const src = readFileSync(join(WEBCAM_SRC, 'WebcamEngine.kt'), 'utf8');
  for (const { kind, fragment } of PEER_SHAPES) assert.ok(src.includes(fragment), `${kind}: WebcamEngine.kt no longer writes ${fragment}`);
});

// Synthetic device names only. Each carries a hazard: an apostrophe, a curly apostrophe and a diacritic,
// the separator ": " itself, regex metacharacters, and a dash-joined hostname.
const NAMES = ["Ada's MacBook Air", 'Zoë’s iMac', 'lab: build-host', 'Mac (2) [test]+?', 'Grace-MBP-14'];
const SHAPED = (name) => [
  L(`webcam.request from ${name}: Ack, ShowRequest(screen, person), ArmTimer`),
  L(`webcam.stop from ${name}: CancelTimers, CloseCapture, CloseStream, ClearRequest, stopped STOPPED_BY_MAC, Ack`),
  L(`webcam.switch from ${name}: SwitchCapture(front, generation 2), RequestKeyframe(generation 2)`),
  `2026-10-05T10:00:00.000+05:30 W [webcam] Webcam claim for ${P}… from ${name} refused — not this connection's session, not live, or already claimed`,
  L(`Webcam stream ${P}… attached for ${name}`),
];

test('every shape loses the name and keeps everything else, for names that are hostile to a pattern', () => {
  for (const name of NAMES) {
    for (const line of SHAPED(name)) {
      const out = redactPeerShapes(line);
      assert.ok(out.includes(PEER), `no <peer> in ${out}`);
      assert.equal(out.includes(name), false, `the name survived: ${out}`);
      for (const piece of name.split(/[\s:()[\]+?'’-]+/).filter((p) => p.length >= 3)) assert.equal(out.includes(piece), false, `part of the name survived (${piece}): ${out}`);
      assert.equal(out.replace(PEER, name), line, 'only the name changed');
    }
  }
  assert.equal(parseWebcamLine(SHAPED('lab: build-host')[1]).line.includes('build'), false, 'the parser stores the redacted line');
});

test('unrelated lines are untouched by the shapes and by the known names', () => {
  const names = knownMacNames({ hostname: 'Grace-MBP-14.local', username: 'grace', computerName: 'Grace’s MacBook Pro', localHostName: 'Grace-MBP-14' });
  const unrelated = [
    L(`Webcam session ${P}… stopped: STOPPED_BY_MAC — 421 sent / 0 dropped`),
    L('Webcam stream closed: 421 sent / 0 dropped (0 backpressure, 0 oversize), 0 IDR requested'),
    L(`Webcam capture ${P}… generation 1: back camera 0, 1920x1080 @30 target, 8.0 Mbit/s`),
    L('camera.stop from Grace-MBP-14x: a Camera v1 line, a different tag and a different name'),
    '2026-10-05T10:00:00.000+05:30 I [link] package com.grace.connectsuite.debug from the Mac: nothing to do',
    L('Stopped from the phone: the owner pressed Stop'),
  ];
  for (const line of unrelated) {
    assert.equal(redactPeerShapes(line), line, `a shape touched ${line}`);
    assert.equal(redactPeerNames(line, names).text, line, `a known name touched ${line}`);
  }
  assert.equal(redactPeerNames(L('Session with grace-mbp-14 ended'), names).text, L(`Session with ${PEER} ended`), 'case-insensitive, whole token');
});

test('known names: macName()’s two forms and macOS’s two, never a generic word', () => {
  const names = knownMacNames({ hostname: 'Grace-MBP-14.local', username: 'grace', computerName: 'Grace’s MacBook Pro', localHostName: 'Grace-MBP-14' });
  for (const n of ['Grace-MBP-14.local', 'Grace-MBP-14', 'Grace’s MacBook Pro', "grace's Mac", 'grace’s Mac']) assert.ok(names.includes(n), n);
  assert.equal(names.length, 5, 'deduplicated');
  assert.deepEqual(knownMacNames({ hostname: 'Mac', computerName: 'MacBook' }), [], 'a generic name would eat STOPPED_BY_MAC');
  assert.equal(redactPeerNames(L('stopped STOPPED_BY_MAC'), ['Mac']).text, L('stopped STOPPED_BY_MAC'), 'whole tokens only');
});

test('a report is sanitized everywhere, and a name glued into another token refuses rather than ships', () => {
  const names = knownMacNames({ hostname: 'Grace-MBP-14.local', username: 'grace' });
  const report = { phone: { lines: [parseWebcamLine(SHAPED('Grace-MBP-14')[1])] }, spike: { detail: 'Grace-MBP-14 went to sleep', n: 3 } };
  const { report: out, replaced } = sanitizeReport(report, names);
  assert.equal(JSON.stringify(out).toLowerCase().includes('grace'), false);
  assert.equal(replaced, 1, 'the stored line was already redacted by the parser; the detail is the one left');
  assert.equal(out.spike.n, 3);
  assert.throws(() => sanitizeReport({ x: 'xGrace-MBP-14' }, names), /survived redaction/);
});

// ---- Accounting: scorer version 2 ---------------------------------------------------------------

test('the terminal dispositions are BridgeCore’s own, read from the Swift', () => {
  const swift = readFileSync(join(REPO, 'desktop/native/SidekickCamera/Sources/WebcamBridge/BridgeCore.swift'), 'utf8');
  const block = swift.match(/let pastGate = ([\s\S]*?)\n\s*return gateOK/)[1];
  const keys = [...block.matchAll(/c\["(\w+)"\]!/g)].map((m) => m[1]);
  assert.deepEqual([...keys].sort(), [...TERMINAL_DISPOSITIONS].sort());
  assert.equal(SCORER_VERSION, 2);
});

/** The 2026-10-04 19:57 IST run's counts, verbatim (integers only — nothing identifying). */
const RUN_2026_10_04 = Object.freeze({
  received: 421, accepted: 367, pending: 0, 'gate.awaitingKeyframe': 54, 'gate.endedSession': 0, 'gate.malformed': 0, 'gate.noLiveSession': 0,
  'gate.otherSession': 0, 'gate.outOfOrder': 0, 'gate.staleGeneration': 0, droppedDecodeQueue: 1, decodeErrors: 0, composeErrors: 0,
  discardedEnded: 1, sinkEnqueued: 365, sinkUnavailable: 0, 'probe.decoded': 366, 'probe.decodeAttempts': 366, 'probe.composedDiscarded': 365,
});

test('the run’s counts: one AU decoded, then discarded at the session’s door, is counted once', () => {
  const a = accounting(RUN_2026_10_04);
  assert.equal(a.holds, true, a.line);
  assert.equal(a.terminal, 367);
  assert.match(a.line, /discardedEnded 1, sinkEnqueued 365/);
});

const LOSSES = [
  ['a lost AU: one handed to the sink is missing', { sinkEnqueued: 364 }, /does not hold/],
  ['a double count: discarded at the door AND enqueued', { discardedEnded: 2 }, /does not hold/],
  ['a gate drop not counted', { 'gate.awaitingKeyframe': 53 }, /does not hold/],
  ['an AU still pending', { pending: 1 }, /does not hold/],
  ['a terminal counter not reported', { sinkEnqueued: undefined }, /cannot be checked: .*sinkEnqueued/],
];
for (const [what, patch, reason] of LOSSES) {
  test(`accounting FAILS on ${what}`, () => {
    const c = { ...RUN_2026_10_04, ...patch };
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete c[k];
    const a = accounting(c);
    assert.equal(a.holds, false);
    assert.match(a.line, reason);
  });
}

// ---- Accounting against counts the PRODUCTION path produced ------------------------------------------
// docs/fixtures/webcam-spike-accounting-v1.json is written by the real BridgeCore with the decode probe's
// decoder and sink (Tests/WebcamProbeTests/AccountingScenarioTests.swift), and a Swift test fails if it
// drifts from what BridgeCore produces. Nothing below types a count by hand except the corruptions.

const FIXTURE = JSON.parse(readFileSync(join(REPO, 'docs/fixtures/webcam-spike-accounting-v1.json'), 'utf8')).scenarios;
const REQUIRED = ['ordinary-completion', 'decoded-then-discarded-at-final-check', 'stop-while-decoding-with-frames-waiting', 'decode-queue-drop', 'decode-failure', 'compose-failure'];

test('control: the fixture holds every required scenario and each reached its condition', () => {
  assert.deepEqual(Object.keys(FIXTURE).sort(), [...REQUIRED].sort());
  assert.equal(FIXTURE['decoded-then-discarded-at-final-check'].discardedEnded, 1);
  assert.equal(FIXTURE['stop-while-decoding-with-frames-waiting'].discardedEnded, 3);
  assert.equal(FIXTURE['decode-queue-drop'].droppedDecodeQueue, 1);
  assert.equal(FIXTURE['decode-failure'].decodeErrors, 1);
  assert.equal(FIXTURE['compose-failure'].composeErrors, 1);
});

for (const name of REQUIRED) {
  test(`accounting holds on BridgeCore's own counts: ${name}`, () => {
    const a = accounting(FIXTURE[name]);
    assert.equal(a.holds, true, a.line);
  });
  test(`accounting FAILS when one AU of ${name} is lost or counted twice`, () => {
    const c = FIXTURE[name];
    const nonzero = TERMINAL_DISPOSITIONS.find((k) => c[k] > 0);
    assert.equal(accounting({ ...c, [nonzero]: c[nonzero] - 1 }).holds, false, `lost from ${nonzero}`);
    for (const k of TERMINAL_DISPOSITIONS) assert.equal(accounting({ ...c, [k]: c[k] + 1 }).holds, false, `double-counted in ${k}`);
  });
}

test('why version 1 was wrong, in BridgeCore’s own numbers: a decoded frame can still end elsewhere', () => {
  // Not the old rule restated — the fact it missed. In these scenarios frames were decoded AND then
  // ended by the session check or the composer, so `probe.decoded` overlaps a terminal disposition.
  const overlapping = REQUIRED.filter((n) => FIXTURE[n]['probe.decoded'] > FIXTURE[n].sinkEnqueued + FIXTURE[n].sinkUnavailable);
  assert.deepEqual(overlapping.sort(), ['compose-failure', 'decoded-then-discarded-at-final-check', 'stop-while-decoding-with-frames-waiting']);
});

test('criteriaChanges names exactly the lines a re-score moved', () => {
  const before = { reasons: ['accounting does not hold (x)'], passed: ['one session id acked'] };
  const after = { reasons: [], passed: ['one session id acked', 'accounting holds: y'] };
  assert.deepEqual(criteriaChanges(before, after), { removed: ['FAIL: accounting does not hold (x)'], added: ['PASS: accounting holds: y'] });
  assert.deepEqual(criteriaChanges(after, after), { removed: [], added: [] });
});
