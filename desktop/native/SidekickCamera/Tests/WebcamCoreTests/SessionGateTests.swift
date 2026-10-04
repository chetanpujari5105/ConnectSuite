import Foundation
import Testing
@testable import WebcamCore

let S1 = SessionID(hex: "11111111111111111111111111111111")!
let S2 = SessionID(hex: "22222222222222222222222222222222")!

func frame(gen: UInt16 = 1, seq: UInt32, pts: UInt64, idr: Bool) -> Data {
    let annexB = idr ? Data([0, 0, 0, 1, 0x67, 1, 0, 0, 0, 1, 0x68, 2, 0, 0, 0, 1, 0x65, 3])
                     : Data([0, 0, 0, 1, 0x41, 9])
    return WebcamAUCodec.encode(header: WebcamHeader(facing: .front, rotation: 0, discontinuity: false,
                                                     generation: gen, width: 1280, height: 720, sequence: seq),
                                pts: pts, annexB: annexB)
}

func isAccept(_ a: SessionGate.Admission) -> Bool { if case .accept = a { return true }; return false }

@Suite struct Gate {
    @Test func nothingIsAdmittedWithoutALiveSessionFromMain() {
        var g = SessionGate(consumers: 1)
        #expect(g.admit(session: S1, frame: frame(seq: 1, pts: 1, idr: true)) == .drop(.noLiveSession))
        #expect(g.sessionLive(S1, generation: 1) == [.startSink(S1)])
        #expect(isAccept(g.admit(session: S1, frame: frame(seq: 2, pts: 2, idr: true))))
    }

    @Test func anotherSessionsFramesAreRefused() {
        var g = SessionGate(consumers: 1)
        _ = g.sessionLive(S1, generation: 1)
        #expect(g.admit(session: S2, frame: frame(seq: 1, pts: 1, idr: true)) == .drop(.otherSession))
    }

    @Test func aStaleGenerationIsRefusedAndANewerOneIsAdoptedOnlyFromAKeyframe() {
        var g = SessionGate(consumers: 1)
        _ = g.sessionLive(S1, generation: 2)
        #expect(isAccept(g.admit(session: S1, frame: frame(gen: 2, seq: 1, pts: 1, idr: true))))
        #expect(g.admit(session: S1, frame: frame(gen: 1, seq: 2, pts: 2, idr: true)) == .drop(.staleGeneration))
        // Generation 3 outran its `running`: adopted from its IDR with SPS and PPS.
        #expect(isAccept(g.admit(session: S1, frame: frame(gen: 3, seq: 4, pts: 4, idr: true))))
        #expect(g.admit(session: S1, frame: frame(gen: 2, seq: 5, pts: 5, idr: true)) == .drop(.staleGeneration))
        #expect(g.live == S1)
    }

    @Test func aDownstreamDropWaitsForTheNextIDR() {
        var g = SessionGate(consumers: 1)
        _ = g.sessionLive(S1, generation: 1)
        _ = g.admit(session: S1, frame: frame(seq: 1, pts: 1, idr: true))
        g.noteDownstreamDrop()
        #expect(g.admit(session: S1, frame: frame(seq: 2, pts: 2, idr: false)) == .drop(.awaitingKeyframe))
        #expect(isAccept(g.admit(session: S1, frame: frame(seq: 3, pts: 3, idr: true))))
        #expect(isAccept(g.admit(session: S1, frame: frame(seq: 4, pts: 4, idr: false))))
    }

    @Test func anEndedSessionNeverComesBack() {
        var g = SessionGate(consumers: 1)
        _ = g.sessionLive(S1, generation: 1)
        #expect(g.sessionEnded(S1, reason: "person") == [.stopSink(S1, reason: "person")])
        #expect(g.admit(session: S1, frame: frame(seq: 1, pts: 1, idr: true)) == .drop(.endedSession))
        #expect(g.sessionLive(S1, generation: 1) == [.refusedEnded(S1)])
        #expect(g.live == nil)
    }

    @Test func theLastConsumerLeavingEndsTheSessionAtOnce() {
        var g = SessionGate(consumers: 2)
        _ = g.sessionLive(S1, generation: 1)
        #expect(g.consumersChanged(1) == [])
        #expect(g.consumersChanged(0) == [.stopSink(S1, reason: "no-consumers"), .reportEnded(S1, reason: "no-consumers")])
        #expect(g.admit(session: S1, frame: frame(seq: 1, pts: 1, idr: true)) == .drop(.endedSession))
    }

    @Test func aSessionAnnouncedWithNobodyWatchingIsNeverFed() {
        var g = SessionGate(consumers: 0)
        #expect(g.sessionLive(S1, generation: 1) == [.reportEnded(S1, reason: "no-consumers")])
        #expect(g.live == nil)
        #expect(g.admit(session: S1, frame: frame(seq: 1, pts: 1, idr: true)) == .drop(.endedSession))
    }

    @Test func aNewSessionSupersedesTheOldOneAndStopsItsSinkFirst() {
        var g = SessionGate(consumers: 1)
        _ = g.sessionLive(S1, generation: 1)
        #expect(g.sessionLive(S2, generation: 1) == [.stopSink(S1, reason: "superseded"), .startSink(S2)])
        #expect(g.admit(session: S1, frame: frame(seq: 1, pts: 1, idr: true)) == .drop(.endedSession))
    }

    @Test func everyAUIsCountedExactlyOnce() {
        var g = SessionGate(consumers: 1)
        _ = g.admit(session: S1, frame: frame(seq: 1, pts: 1, idr: true))           // noLiveSession
        _ = g.sessionLive(S1, generation: 1)
        _ = g.admit(session: S1, frame: frame(seq: 3, pts: 3, idr: true))           // accept
        _ = g.admit(session: S1, frame: frame(seq: 4, pts: 3, idr: false))          // outOfOrder
        g.noteDownstreamDrop()
        _ = g.admit(session: S1, frame: frame(seq: 5, pts: 4, idr: false))          // awaitingKeyframe
        _ = g.admit(session: S2, frame: frame(seq: 6, pts: 6, idr: true))           // otherSession
        _ = g.admit(session: S1, frame: Data([1, 2, 3]))                            // malformed: ends S1
        _ = g.admit(session: S1, frame: frame(seq: 7, pts: 7, idr: true))           // endedSession
        #expect(g.received == 7)
        #expect(g.accepted == 1)
        #expect(g.received == g.accepted + g.droppedTotal)
        #expect(g.dropped == [.noLiveSession: 1, .awaitingKeyframe: 1, .outOfOrder: 1, .malformed: 1,
                              .otherSession: 1, .endedSession: 1])
    }
}

func isReject(_ a: SessionGate.Admission) -> StreamFault? {
    if case let .reject(fault, _) = a { return fault }
    return nil
}

/// docs/protocol.md → The Mac's local contract, `stream-rejected`: a structural or codec-contract
/// violation **in the live session** ends that session and is reported once, bound to its id. Every
/// documented drop stays a drop, and nothing tagged with another session can end the live one.
@Suite struct FatalInput {
    @Test func aMalformedAUOfTheLiveSessionEndsItAndIsReportedOnce() {
        var g = SessionGate(consumers: 1)
        _ = g.sessionLive(S1, generation: 1)
        #expect(isAccept(g.admit(session: S1, frame: frame(seq: 1, pts: 1, idr: true))))
        var bad = frame(seq: 2, pts: 2, idr: false)
        bad[FrameHeader.size + 4] = 0x80                                            // a reserved header bit
        let admission = g.admit(session: S1, frame: bad)
        #expect(admission == .reject(.headerReservedBits, [
            .stopSink(S1, reason: "malformed"),
            .reportRejected(S1, generation: 0, fault: .headerReservedBits),
        ]))
        #expect(g.live == nil)
        #expect(g.tombstones.contains(S1))
        // Nothing more of it is inspected, so it cannot be reported twice.
        #expect(g.admit(session: S1, frame: bad) == .drop(.endedSession))
        #expect(g.sessionLive(S1, generation: 1) == [.refusedEnded(S1)])
    }

    @Test func aGenerationThatDoesNotStartWithAnIDRIsFatalNotAWait() {
        var g = SessionGate(consumers: 1)
        _ = g.sessionLive(S1, generation: 1)
        _ = g.admit(session: S1, frame: frame(seq: 1, pts: 1, idr: true))
        #expect(isReject(g.admit(session: S1, frame: frame(gen: 2, seq: 2, pts: 2, idr: false))) == .generationWithoutKeyframe)
        #expect(g.live == nil)
    }

    @Test func theFirstAUOfASessionMustBeAnIDR() {
        var g = SessionGate(consumers: 1)
        _ = g.sessionLive(S1, generation: 1)
        #expect(isReject(g.admit(session: S1, frame: frame(seq: 1, pts: 1, idr: false))) == .generationWithoutKeyframe)
    }

    @Test func aSequenceThatDoesNotIncreaseIsFatal() {
        var g = SessionGate(consumers: 1)
        _ = g.sessionLive(S1, generation: 1)
        _ = g.admit(session: S1, frame: frame(seq: 5, pts: 1, idr: true))
        #expect(isReject(g.admit(session: S1, frame: frame(seq: 5, pts: 2, idr: false))) == .sequenceDidNotIncrease)
    }

    @Test func flagsClaimingAnIDRTheAUDoesNotCarryAreFatal() {
        var g = SessionGate(consumers: 1)
        _ = g.sessionLive(S1, generation: 1)
        var lying = frame(seq: 1, pts: 1, idr: false)
        lying[0] = FrameHeader.flagIDR
        #expect(isReject(g.admit(session: S1, frame: lying)) == .idrFlagWithoutIDR)
    }

    @Test func malformedBytesTaggedWithAnotherSessionCannotEndTheLiveOne() {
        var g = SessionGate(consumers: 1)
        _ = g.sessionLive(S1, generation: 1)
        _ = g.sessionLive(S2, generation: 1)                                        // S1 superseded, buried
        _ = g.admit(session: S2, frame: frame(seq: 1, pts: 1, idr: true))
        // A delayed error from the old session, and garbage claiming a stranger's id.
        #expect(g.admit(session: S1, frame: Data([1, 2, 3])) == .drop(.endedSession))
        let stranger = SessionID(hex: "33333333333333333333333333333333")!
        #expect(g.admit(session: stranger, frame: Data([1, 2, 3])) == .drop(.otherSession))
        #expect(g.live == S2)
        #expect(isAccept(g.admit(session: S2, frame: frame(seq: 2, pts: 2, idr: false))))
    }

    @Test func malformedBytesWithNoLiveSessionAreADrop() {
        var g = SessionGate(consumers: 1)
        #expect(g.admit(session: S1, frame: Data([1, 2, 3])) == .drop(.noLiveSession))
    }

    @Test func theDocumentedDropsStayDrops() {
        var g = SessionGate(consumers: 1)
        _ = g.sessionLive(S1, generation: 2)
        _ = g.admit(session: S1, frame: frame(gen: 2, seq: 1, pts: 10, idr: true))
        // Stale generation: `running` travels on the control connection and can overtake the tail of
        // the generation it replaces.
        #expect(g.admit(session: S1, frame: frame(gen: 1, seq: 2, pts: 11, idr: false)) == .drop(.staleGeneration))
        // A PTS that does not increase is a capture-clock hiccup, not a violation.
        #expect(g.admit(session: S1, frame: frame(gen: 2, seq: 3, pts: 10, idr: false)) == .drop(.outOfOrder))
        // Recoverable keyframe waiting after a Mac-side drop.
        g.noteDownstreamDrop()
        #expect(g.admit(session: S1, frame: frame(gen: 2, seq: 4, pts: 12, idr: false)) == .drop(.awaitingKeyframe))
        #expect(isAccept(g.admit(session: S1, frame: frame(gen: 2, seq: 5, pts: 13, idr: true))))
        #expect(g.live == S1)
        #expect(g.dropped[.malformed] == nil)
    }
}

/// docs/fixtures/webcam-vocabulary-v1.json, read in place: Electron main's parser reads the same list,
/// so a token the bridge can send is a token main accepts, and nothing else.
@Suite struct Vocabulary {
    @Test func theBridgesFaultsAreTheSharedClosedSet() throws {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("docs/fixtures/webcam-vocabulary-v1.json")
        let obj = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
        let shared = obj["streamFaults"] as! [String]
        #expect(StreamFault.allCases.map(\.rawValue) == shared)
        // Every MalformedAU and StreamViolation has a token of its own.
        #expect(Set(shared).count == shared.count)
    }
}
