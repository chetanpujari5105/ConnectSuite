import Foundation

/// Metadata-only readings of the bridge pipeline's timing (defect 177): when the decode stage
/// overflows, how long each stage takes, how long the picture is gone after a drop, and what still
/// completes after a Stop. Integers only — never a byte of a frame — and a FIXED set of keys whatever
/// the stream's length, so the counters cannot grow and nothing is logged per frame.
///
/// Electron main's parser accepts at most 128 counters per status (`webcamBridgeRecords.ts`); this
/// set is 41, the rest of `BridgeCore` 19, and the probe's tally at most ~51.
///
/// Pure: every reading takes its `nowNs` from the caller's clock, so tests drive time explicitly
/// rather than sleeping. Not thread-safe; `BridgeCore` holds its lock around every call.
public struct PipelineDiagnostics: Equatable, Sendable {
    /// One frame at 30 fps — the budget a stage must stay under to keep up, in microseconds.
    public static let frameBudgetUs = 33_333

    public struct Stage: Equatable, Sendable {
        public var count = 0, totalUs = 0, maxUs = 0, firstUs = 0, overBudget = 0
        mutating func add(_ us: Int) {
            if count == 0 { firstUs = us }
            count += 1
            totalUs += us
            maxUs = max(maxUs, us)
            if us > PipelineDiagnostics.frameBudgetUs { overBudget += 1 }
        }
    }

    /// Why the decode chain broke: the gate now refuses everything until an IDR with SPS and PPS.
    public enum Break: Equatable, Sendable { case queueFull, decodeFailed, composeFailed }

    // Arrival into the bridge, before the gate.
    public private(set) var maxArrivalGapUs = 0
    /// The most AUs that arrived inside any one frame interval: a burst, whatever caused it.
    public private(set) var maxArrivalsPerFrame = 0
    private var lastArrivalNs: UInt64?
    private var recentArrivalsNs: [UInt64] = []      // bounded: at most `recentCap`
    private static let recentCap = 64

    // Stages.
    public private(set) var queueWait = Stage()
    public private(set) var decode = Stage()
    public private(set) var compose = Stage()
    public private(set) var service = Stage()          // decode + compose, for frames that composed
    private var inFlightSinceNs: UInt64?

    // The live session and its GOP position.
    private var liveAtNs: UInt64?
    private var endedAtNs: UInt64?
    private var gopIndex = -1                         // index of the last accepted AU since its IDR

    // Overflow of the decode stage.
    public private(set) var overflowEvents = 0
    public private(set) var idrFlushes = 0
    public private(set) var idrFlushedAUs = 0
    public struct Overflow: Equatable, Sendable {
        public var atReceived = 0, sinceLiveUs = 0, gopIndex = 0, inFlightUs = 0, decodesBefore = 0
        public init(atReceived: Int = 0, sinceLiveUs: Int = 0, gopIndex: Int = 0, inFlightUs: Int = 0, decodesBefore: Int = 0) {
            self.atReceived = atReceived; self.sinceLiveUs = sinceLiveUs; self.gopIndex = gopIndex
            self.inFlightUs = inFlightUs; self.decodesBefore = decodesBefore
        }
    }
    public private(set) var firstOverflow: Overflow?

    // Recovery: from a break to the first frame admitted AFTER it that reaches the sink.
    private struct OpenBreak: Equatable, Sendable { var kind: Break; var atNs: UInt64; var receivedMark: Int; var refusedMark: Int }
    private var openBreak: OpenBreak?
    public private(set) var recoveries = 0, recoveryMaxUs = 0, recoveryLastUs = 0, recoveryMaxRefused = 0
    public private(set) var unrecovered = 0
    /// AUs decoded after a decode FAILURE that were admitted before it and are not IDRs: they reference
    /// a picture the decoder never produced, so the chain they were decoded against is not intact.
    public private(set) var decodedAfterFailure = 0

    // What completes after the session ended.
    public private(set) var completionsAfterEnd = 0, maxLateUs = 0
    public private(set) var discardedBeforeDecode = 0, discardedAfterDecode = 0

    // Preparation at `session-live` (option A): the composers made before the first frame, timed apart
    // from the first frame's own decode and compose, which no longer include them.
    public private(set) var preparations = 0, preparationMaxUs = 0, preparationsFailed = 0
    /// Preparations whose session ended, or was replaced, before they completed: what they made was
    /// released, never installed.
    public private(set) var preparationsDiscarded = 0
    /// The longest a decoded frame waited for its session's preparation to finish.
    public private(set) var preparationWaitMaxUs = 0
    /// From the last `session-live` to the first frame after it reaching the sink.
    public private(set) var firstFrameSinceLiveUs = 0
    private var awaitingFirstFrame = false

    public init() {}

    private static func us(_ from: UInt64, _ to: UInt64) -> Int { to > from ? Int((to - from) / 1_000) : 0 }

    // MARK: Session

    public mutating func sessionLive(nowNs: UInt64) {
        liveAtNs = nowNs
        endedAtNs = nil
        gopIndex = -1
        awaitingFirstFrame = true
    }

    /// A preparation finished while its session was still the live one, and was installed.
    public mutating func prepared(us: Int, failed: Bool) {
        preparations += 1
        preparationMaxUs = max(preparationMaxUs, us)
        if failed { preparationsFailed += 1 }
    }

    public mutating func preparationDiscarded() { preparationsDiscarded += 1 }

    public mutating func waitedForPreparation(us: Int) { preparationWaitMaxUs = max(preparationWaitMaxUs, us) }

    public mutating func sessionEnded(nowNs: UInt64) {
        endedAtNs = nowNs
        if openBreak != nil { unrecovered += 1; openBreak = nil }
    }

    // MARK: Arrival and admission

    public mutating func arrived(nowNs: UInt64) {
        if let last = lastArrivalNs { maxArrivalGapUs = max(maxArrivalGapUs, Self.us(last, nowNs)) }
        lastArrivalNs = nowNs
        recentArrivalsNs.append(nowNs)
        if recentArrivalsNs.count > Self.recentCap { recentArrivalsNs.removeFirst(recentArrivalsNs.count - Self.recentCap) }
        let windowStart = nowNs >= UInt64(Self.frameBudgetUs) * 1_000 ? nowNs - UInt64(Self.frameBudgetUs) * 1_000 : 0
        maxArrivalsPerFrame = max(maxArrivalsPerFrame, recentArrivalsNs.filter { $0 >= windowStart }.count)
    }

    /// An AU the gate accepted. Returns its index in its GOP (the IDR is 0).
    public mutating func accepted(isKeyframe: Bool) -> Int {
        gopIndex = isKeyframe ? 0 : gopIndex + 1
        return gopIndex
    }

    /// A non-IDR AU dropped because the decode stage was full.
    public mutating func overflowed(nowNs: UInt64, atReceived: Int, gopIndex: Int) {
        overflowEvents += 1
        if firstOverflow == nil {
            firstOverflow = Overflow(atReceived: atReceived, sinceLiveUs: liveAtNs.map { Self.us($0, nowNs) } ?? 0,
                                     gopIndex: max(gopIndex, 0), inFlightUs: inFlightSinceNs.map { Self.us($0, nowNs) } ?? 0,
                                     decodesBefore: decode.count)
        }
    }

    /// An IDR arrived at a full stage and replaced everything waiting.
    public mutating func idrFlushed(_ count: Int) { idrFlushes += 1; idrFlushedAUs += count }

    /// The chain broke. Only the first break of an unrecovered run is timed: a second break before
    /// recovery extends the same gap rather than starting a new one.
    public mutating func broke(_ kind: Break, nowNs: UInt64, receivedSoFar: Int, refusedSoFar: Int) {
        if openBreak == nil { openBreak = OpenBreak(kind: kind, atNs: nowNs, receivedMark: receivedSoFar, refusedMark: refusedSoFar) }
    }

    // MARK: The decode stage

    public mutating func discardedBeforeDecoding() { discardedBeforeDecode += 1 }

    public mutating func decodeStarted(nowNs: UInt64, admittedNs: UInt64) {
        queueWait.add(Self.us(admittedNs, nowNs))
        inFlightSinceNs = nowNs
    }

    public mutating func decodeFinished(startNs: UInt64, nowNs: UInt64, ordinal: Int, isKeyframe: Bool, ok: Bool) {
        decode.add(Self.us(startNs, nowNs))
        if ok, !isKeyframe, let b = openBreak, b.kind == .decodeFailed, ordinal <= b.receivedMark { decodedAfterFailure += 1 }
    }

    public mutating func composeFinished(decodeStartNs: UInt64, startNs: UInt64, nowNs: UInt64, ok: Bool) {
        compose.add(Self.us(startNs, nowNs))
        if ok { service.add(Self.us(decodeStartNs, nowNs)) }
    }

    public mutating func frameDone() { inFlightSinceNs = nil }

    /// A frame decoded, then met the session check at the sink's door and was discarded.
    public mutating func discardedAfterDecoding(nowNs: UInt64) {
        discardedAfterDecode += 1
        if let end = endedAtNs {
            completionsAfterEnd += 1
            maxLateUs = max(maxLateUs, Self.us(end, nowNs))
        }
    }

    /// A frame handed to the sink. If it was admitted after an open break, the picture is back.
    public mutating func enqueued(ordinal: Int, nowNs: UInt64, refusedSoFar: Int) {
        if awaitingFirstFrame {
            awaitingFirstFrame = false
            firstFrameSinceLiveUs = liveAtNs.map { Self.us($0, nowNs) } ?? 0
        }
        guard let b = openBreak, ordinal > b.receivedMark else { return }
        let gap = Self.us(b.atNs, nowNs)
        recoveries += 1
        recoveryLastUs = gap
        recoveryMaxUs = max(recoveryMaxUs, gap)
        recoveryMaxRefused = max(recoveryMaxRefused, refusedSoFar - b.refusedMark)
        openBreak = nil
    }

    // MARK: Out

    public var counts: [String: Int] {
        let f = firstOverflow ?? Overflow()
        return [
            "diag.arrival.maxGapUs": maxArrivalGapUs, "diag.arrival.maxPerFrame": maxArrivalsPerFrame,
            "diag.queueWait.maxUs": queueWait.maxUs, "diag.queueWait.totalUs": queueWait.totalUs,
            "diag.decode.count": decode.count, "diag.decode.totalUs": decode.totalUs, "diag.decode.maxUs": decode.maxUs,
            "diag.decode.firstUs": decode.firstUs, "diag.decode.overBudget": decode.overBudget,
            "diag.compose.count": compose.count, "diag.compose.totalUs": compose.totalUs, "diag.compose.maxUs": compose.maxUs,
            "diag.compose.firstUs": compose.firstUs, "diag.compose.overBudget": compose.overBudget,
            "diag.service.maxUs": service.maxUs, "diag.service.overBudget": service.overBudget,
            "diag.overflow.events": overflowEvents, "diag.overflow.idrFlushes": idrFlushes,
            "diag.overflow.idrFlushedAUs": idrFlushedAUs,
            "diag.overflow.first.atReceived": f.atReceived, "diag.overflow.first.sinceLiveUs": f.sinceLiveUs,
            "diag.overflow.first.gopIndex": f.gopIndex, "diag.overflow.first.inFlightUs": f.inFlightUs,
            "diag.overflow.first.decodesBefore": f.decodesBefore,
            "diag.recovery.count": recoveries, "diag.recovery.maxUs": recoveryMaxUs, "diag.recovery.lastUs": recoveryLastUs,
            "diag.recovery.maxRefused": recoveryMaxRefused, "diag.recovery.open": openBreak == nil ? 0 : 1,
            "diag.recovery.unrecovered": unrecovered,
            "diag.chain.decodedAfterFailure": decodedAfterFailure,
            "diag.afterEnd.completions": completionsAfterEnd, "diag.afterEnd.maxLateUs": maxLateUs,
            "diag.discardedEnded.beforeDecode": discardedBeforeDecode, "diag.discardedEnded.afterDecode": discardedAfterDecode,
            "diag.prepare.count": preparations, "diag.prepare.maxUs": preparationMaxUs, "diag.prepare.failed": preparationsFailed,
            "diag.prepare.discarded": preparationsDiscarded, "diag.prepare.waitMaxUs": preparationWaitMaxUs,
            "diag.firstFrame.sinceLiveUs": firstFrameSinceLiveUs,
        ]
    }
}
