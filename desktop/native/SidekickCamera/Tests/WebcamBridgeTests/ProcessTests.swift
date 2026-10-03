import Foundation
import Testing
import WebcamCore

/// The built `sidekick-camera-bridge` executable, run as a child process over stdin/stdout exactly as
/// Electron main will run it. On this Mac there is no activated extension, so the bridge finds no
/// device, its consumer count is 0, and an announced session is ended at once (`no-consumers`) —
/// which is the honest behaviour, and the reading this test takes.
@Suite(.serialized) struct BridgeProcess {
    static var binary: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent(".build/debug/sidekick-camera-bridge")
    }

    func run(_ input: Data) throws -> (status: Int32, records: [[String: Any]], stderr: String) {
        let p = Process()
        p.executableURL = Self.binary
        let inPipe = Pipe(), outPipe = Pipe(), errPipe = Pipe()
        p.standardInput = inPipe; p.standardOutput = outPipe; p.standardError = errPipe
        try p.run()
        inPipe.fileHandleForWriting.write(input)
        try inPipe.fileHandleForWriting.close()
        p.waitUntilExit()
        var dec = RecordDecoder()
        let recs = try dec.feed(outPipe.fileHandleForReading.readDataToEndOfFile())
        let objs = recs.compactMap { try? JSONSerialization.jsonObject(with: $0.body) as? [String: Any] }
        return (p.terminationStatus, objs, String(decoding: errPipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self))
    }

    func record(_ m: ControlMessage) -> Data { BridgeRecord.encode(BridgeRecord(type: .control, body: ControlCodec.encode(m))) }

    @Test func aSessionWithNoInstalledDeviceIsEndedAtOnceAndNothingIsFed() throws {
        #expect(FileManager.default.isExecutableFile(atPath: Self.binary.path), "build the package first")
        let id = SessionID(hex: "0123456789abcdef0123456789abcdef")!
        let frame = WebcamAUCodec.encode(header: WebcamHeader(facing: .front, rotation: 0, discontinuity: false,
                                                              generation: 1, width: 1280, height: 720, sequence: 1),
                                         pts: 1, annexB: Data([0, 0, 0, 1, 0x67, 1, 0, 0, 0, 1, 0x68, 2, 0, 0, 0, 1, 0x65, 3]))
        let input = record(.sessionLive(id, generation: 1))
            + BridgeRecord.encode(BridgeRecord(type: .accessUnit, body: ControlCodec.accessUnitBody(session: id, frame: frame)))
            + record(.shutdown)
        let r = try run(input)
        #expect(r.status == 0)
        let ops = r.records.map { $0["op"] as? String ?? "?" }
        // `ready` first: no device on this Mac (the control is CoreMediaIO listing the Mac's own
        // camera, in WebcamBridgeTests), and no Team ID in this build, so main may ask for nothing.
        #expect(ops.first == "ready")
        #expect(r.records.first?["device"] as? String == "not-installed")
        #expect(r.records.first?["producerIdentity"] as? String == "unconfigured")
        #expect(ops.dropFirst().first == "consumers" && (r.records.dropFirst().first?["count"] as? Int) == 0)
        #expect(r.records.contains { $0["op"] as? String == "session-ended" && $0["reason"] as? String == "no-consumers" })
        #expect(!r.records.contains { $0["op"] as? String == "sink" && $0["state"] as? String == "feeding" })
        let counts = r.records.last { $0["op"] as? String == "counts" }?["counts"] as? [String: Int]
        #expect(counts?["received"] == 1 && counts?["gate.endedSession"] == 1 && counts?["sinkEnqueued"] == 0)
        #expect(r.stderr.contains("device not installed"))
    }

    @Test func aMalformedRecordIsReportedAndTheBridgeExits() throws {
        let r = try run(Data([0x7F, 0xFF, 0xFF, 0xFF, 0x02]))
        #expect(r.status == 2)
        #expect(r.records.contains { ($0["error"] as? String)?.hasPrefix("malformed-record") == true })
    }
}
