import Foundation
import WebcamBridge
import WebcamCore

// Sidekick Camera Bridge. A child of Electron main, talking only over its own stdin (records in) and
// stdout (status records out); diagnostics go to stderr, which main writes to its rotating log. It
// opens no listening socket of any kind — network or filesystem — so nothing else can reach it.
//
// docs/protocol.md → The Mac's local contract.

setvbuf(stderr, nil, _IONBF, 0)
let out = FileHandle.standardOutput
let outLock = NSLock()

func send(_ status: BridgeStatus) {
    outLock.lock(); defer { outLock.unlock() }
    out.write(BridgeRecord.encode(status.record))
}

func note(_ s: String) { FileHandle.standardError.write(Data("[camera-bridge] \(s)\n".utf8)) }

let sink = CMIOSinkPort()
let core = BridgeCore(sink: sink, emit: send)
let watcher = ConsumerWatcher { core.consumersChanged($0) }
watcher.start()
note("started; Sidekick Camera device \(watcher.deviceFound ? "found" : "not installed")")

// Counters every 5 s, each beside its denominator (the counts record carries all of them).
let ticker = DispatchSource.makeTimerSource(queue: .global())
ticker.schedule(deadline: .now() + 5, repeating: 5)
ticker.setEventHandler { send(.counts(core.countsSnapshot())) }
ticker.resume()

var decoder = RecordDecoder()
let input = FileHandle.standardInput
var exitCode: Int32 = 0
loop: while true {
    let chunk = input.availableData
    if chunk.isEmpty { note("stdin closed; ending any session"); _ = core.control(.shutdown); break }
    let records: [BridgeRecord]
    do { records = try decoder.feed(chunk) } catch {
        send(.error("malformed-record: \(error)"))
        note("malformed record (\(error)); exiting")
        _ = core.control(.shutdown)
        exitCode = 2
        break
    }
    for r in records {
        switch core.handle(r) {
        case .continue: continue
        case .shutdown: note("shutdown"); break loop
        case let .malformed(why):
            send(.error("malformed-record: \(why)"))
            note("malformed record (\(why)); exiting")
            _ = core.control(.shutdown)
            exitCode = 2
            break loop
        }
    }
}
core.drain()
watcher.stop()
send(.counts(core.countsSnapshot()))
exit(exitCode)
