import Foundation
import Testing
@testable import WebcamCore

@Suite struct RecordFraming {
    @Test func recordsSplitAcrossAndWithinChunks() throws {
        let a = BridgeRecord(type: .control, body: Data("{\"op\":\"shutdown\"}".utf8))
        let b = BridgeRecord(type: .accessUnit, body: Data(repeating: 7, count: 300))
        let stream = BridgeRecord.encode(a) + BridgeRecord.encode(b)
        var d = RecordDecoder()
        var got: [BridgeRecord] = []
        for chunk in stride(from: 0, to: stream.count, by: 7) {
            got += try d.feed(stream.subdata(in: chunk..<min(stream.count, chunk + 7)))
        }
        #expect(got == [a, b])
        #expect(d.bytesBuffered == 0)
    }

    @Test func anOversizedLengthIsRefusedBeforeItsBodyIsBuffered() throws {
        var d = RecordDecoder()
        let prefix = Data([0x00, 0x20, 0x00, 0x41]) // 2 MiB + 65: one over the cap
        #expect(throws: RecordError.lengthOverCap(2 * 1024 * 1024 + 65)) { _ = try d.feed(prefix) }
        // The control: exactly the cap is a length the decoder waits for, not an error.
        var e = RecordDecoder()
        #expect(try e.feed(Data([0x00, 0x20, 0x00, 0x40])).isEmpty)
    }

    @Test func zeroLengthAndUnknownTypesAreMalformed() throws {
        var d = RecordDecoder()
        #expect(throws: RecordError.zeroLength) { _ = try d.feed(Data([0, 0, 0, 0])) }
        var e = RecordDecoder()
        #expect(throws: RecordError.unknownType(0x7F)) { _ = try e.feed(Data([0, 0, 0, 1, 0x7F])) }
    }

    @Test func sessionIdsAre32LowercaseHexOr16RawBytes() {
        let hex = "00112233445566778899aabbccddeeff"
        #expect(SessionID(hex: hex)?.hex == hex)
        #expect(SessionID(hex: hex.uppercased()) == nil)
        #expect(SessionID(hex: String(hex.dropLast())) == nil)
        #expect(SessionID(hex: "zz" + hex.dropFirst(2)) == nil)
        #expect(SessionID(raw: Data(count: 15)) == nil)
        #expect(SessionID(raw: SessionID(hex: hex)!.raw) == SessionID(hex: hex))
    }

    @Test func controlMessagesRoundTripAndRefuseWhatTheyCannotRead() throws {
        let id = SessionID(hex: "0123456789abcdef0123456789abcdef")!
        for m in [ControlMessage.sessionLive(id, generation: 3), .sessionEnded(id, reason: "person"), .shutdown] {
            #expect(try ControlCodec.decode(ControlCodec.encode(m)) == m)
        }
        #expect(throws: ControlError.notJSON) { try ControlCodec.decode(Data("nope".utf8)) }
        #expect(throws: ControlError.unknownOp("resume")) { try ControlCodec.decode(Data("{\"op\":\"resume\"}".utf8)) }
        #expect(throws: ControlError.missingField("generation")) {
            try ControlCodec.decode(Data("{\"op\":\"session-live\",\"sessionId\":\"\(id.hex)\",\"generation\":0}".utf8))
        }
        let body = ControlCodec.accessUnitBody(session: id, frame: Data([1, 2, 3]))
        let split = ControlCodec.splitAccessUnitBody(body)
        #expect(split?.0 == id && split?.1 == Data([1, 2, 3]))
        #expect(ControlCodec.splitAccessUnitBody(Data(count: 16)) == nil)
    }
}

@Suite struct Ledger {
    @Test func episodesBeginAtOneAndEndAtZero() {
        var l = ConsumerLedger()
        #expect(l.started() == .episodeBegan)
        #expect(l.started() == nil)
        #expect(l.stopped() == nil)
        #expect(l.isConsumed)
        #expect(l.stopped() == .episodeEnded)
        #expect(!l.isConsumed)
        #expect(l.started() == .episodeBegan)
        #expect(l.episodes == 2)
    }

    @Test func aStopAtZeroIsAnAnomalyAndCannotHideALaterStart() {
        var l = ConsumerLedger()
        #expect(l.stopped() == nil)
        #expect(l.anomalies == 1 && l.count == 0)
        #expect(l.started() == .episodeBegan)
        #expect(l.count == 1)
    }
}

@Suite struct TombstoneBound {
    @Test func boundedAndTheEvictionIsCounted() {
        var t = Tombstones(capacity: 2)
        let ids = (0..<3).map { SessionID(raw: Data(repeating: UInt8($0), count: 16))! }
        ids.forEach { t.bury($0) }
        #expect(t.count == 2 && t.evicted == 1)
        #expect(!t.contains(ids[0]) && t.contains(ids[1]) && t.contains(ids[2]))
    }
}
