import Foundation
import WebcamBridge
import WebcamCore
import WebcamProbe

// Sidekick Camera decode probe — the encoder spike's Mac half (docs/camera-v2-encoder-spike.md).
//
// The bridge's own pipeline and record contract, with two differences and no others:
//  - the sink is `ProbeSink`, which counts each composed frame and drops it. Nothing is published as a
//    camera, drawn, or written anywhere;
//  - it counts itself as the one consumer, because it is the one thing reading the frames.
//
// Like the bridge it opens no listening socket of any kind: records on stdin, status records on
// stdout, diagnostics on stderr. It is never packaged and never resolved by the production
// controller (`resolveBridgeExecutable` names only `sidekick-camera-bridge`). Its `ready` record is
// the same honest reading the bridge takes — on this Mac, not installed and unconfigured — and the
// spike runner ignores it for gating, because nothing here is published.
//
// An independent lifetime bound: whatever main does, the probe ends any session and exits after
// `--max-seconds` (default 120), so a stuck parent cannot leave it decoding.

setvbuf(stderr, nil, _IONBF, 0)
let out = FileHandle.standardOutput
let outLock = NSLock()

func send(_ status: BridgeStatus) {
    outLock.lock(); defer { outLock.unlock() }
    out.write(BridgeRecord.encode(status.record))
}

func note(_ s: String) { FileHandle.standardError.write(Data("[decode-probe] \(s)\n".utf8)) }

var maxSeconds = 120
if let i = CommandLine.arguments.firstIndex(of: "--max-seconds"), i + 1 < CommandLine.arguments.count,
   let n = Int(CommandLine.arguments[i + 1]), n > 0, n <= 600 {
    maxSeconds = n
}

let tally = ProbeTally()
let core = BridgeCore(sink: ProbeSink(tally: tally), decoder: ProbeDecoder(tally: tally), emit: send)
func counts() -> [String: Int] { core.countsSnapshot().merging(tally.snapshot()) { a, _ in a } }

send(.ready(deviceInstalled: CMIOSinkPort.locateSidekickCamera() != nil,
            producerIdentityConfigured: SidekickCameraIdentity.teamID != nil))
core.consumersChanged(1)
note("started: decode only — VideoToolbox decode and compose, then discarded; nothing published, drawn or stored; " +
     "exits by itself after \(maxSeconds) s")

let ticker = DispatchSource.makeTimerSource(queue: .global())
ticker.schedule(deadline: .now() + 5, repeating: 5)
ticker.setEventHandler { send(.counts(counts())) }
ticker.resume()

let lifetime = DispatchSource.makeTimerSource(queue: .global())
lifetime.schedule(deadline: .now() + .seconds(maxSeconds))
lifetime.setEventHandler {
    note("lifetime bound of \(maxSeconds) s reached; ending any session and exiting")
    _ = core.control(.shutdown)
    core.drain()
    var c = counts()
    c["probe.lifetimeExpired"] = 1
    send(.counts(c))
    exit(3)
}
lifetime.resume()

var decoder = RecordDecoder()
let input = FileHandle.standardInput
var exitCode: Int32 = 0
loop: while true {
    let chunk = input.availableData
    if chunk.isEmpty { note("stdin closed; ending any session"); _ = core.control(.shutdown); break }
    let records: [BridgeRecord]
    do { records = try decoder.feed(chunk) } catch {
        send(.error("malformed-record: \(error)"))
        _ = core.control(.shutdown)
        exitCode = 2
        break
    }
    for r in records {
        if r.type == .accessUnit, let (_, frame) = ControlCodec.splitAccessUnitBody(r.body) {
            tally.observe(frame: frame)
        }
        switch core.handle(r) {
        case .continue: continue
        case .shutdown: note("shutdown"); break loop
        case let .malformed(why):
            send(.error("malformed-record: \(why)"))
            _ = core.control(.shutdown)
            exitCode = 2
            break loop
        }
    }
}
lifetime.cancel()
core.drain()
send(.counts(counts()))
// One line, integers only (defect 177): where the stage overflowed and how long the picture was gone.
let d = core.diagnostics
let first = d.firstOverflow.map { "first at AU \($0.atReceived), \($0.sinceLiveUs / 1000) ms after live, GOP index \($0.gopIndex), decode in flight \($0.inFlightUs / 1000) ms, \($0.decodesBefore) decodes before" } ?? "none"
note("pipeline: overflow \(d.overflowEvents) (\(first)); recovery \(d.recoveries) max \(d.recoveryMaxUs / 1000) ms, \(d.recoveryMaxRefused) refused; " +
     "decode first \(d.decode.firstUs / 1000) ms max \(d.decode.maxUs / 1000) ms over-budget \(d.decode.overBudget)/\(d.decode.count); " +
     "compose first \(d.compose.firstUs / 1000) ms max \(d.compose.maxUs / 1000) ms over-budget \(d.compose.overBudget)/\(d.compose.count); " +
     "arrival max gap \(d.maxArrivalGapUs / 1000) ms, max \(d.maxArrivalsPerFrame) per frame; after end \(d.completionsAfterEnd) late by \(d.maxLateUs / 1000) ms")
note("exiting \(exitCode); invariant \(core.invariantHolds ? "holds" : "BROKEN")")
exit(exitCode)
