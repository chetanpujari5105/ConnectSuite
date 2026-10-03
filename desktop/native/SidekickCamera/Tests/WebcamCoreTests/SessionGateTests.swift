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
        // Generation 3 outran its `running`: adopted, but only from an IDR with SPS and PPS.
        #expect(g.admit(session: S1, frame: frame(gen: 3, seq: 3, pts: 3, idr: false)) == .drop(.awaitingKeyframe))
        #expect(isAccept(g.admit(session: S1, frame: frame(gen: 3, seq: 4, pts: 4, idr: true))))
        #expect(g.admit(session: S1, frame: frame(gen: 2, seq: 5, pts: 5, idr: true)) == .drop(.staleGeneration))
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
        _ = g.admit(session: S1, frame: frame(seq: 2, pts: 2, idr: false))          // awaitingKeyframe
        _ = g.admit(session: S1, frame: frame(seq: 3, pts: 3, idr: true))           // accept
        _ = g.admit(session: S1, frame: frame(seq: 4, pts: 3, idr: false))          // outOfOrder
        _ = g.admit(session: S1, frame: Data([1, 2, 3]))                            // malformed
        _ = g.admit(session: S2, frame: frame(seq: 5, pts: 5, idr: true))           // otherSession
        #expect(g.received == 6)
        #expect(g.accepted == 1)
        #expect(g.received == g.accepted + g.droppedTotal)
        #expect(g.dropped == [.noLiveSession: 1, .awaitingKeyframe: 1, .outOfOrder: 1, .malformed: 1, .otherSession: 1])
    }
}
