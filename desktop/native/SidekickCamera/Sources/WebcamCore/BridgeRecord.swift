import Foundation

// docs/protocol.md → The Mac's local contract → Electron main ↔ the bridge. Records travel on the
// bridge's stdin (main → bridge) and stdout (bridge → main). There is no listening socket of any kind.

public enum RecordType: UInt8, Sendable {
    case control = 0x01
    case accessUnit = 0x02
    case status = 0x81
}

public struct BridgeRecord: Sendable, Equatable {
    public var type: RecordType
    public var body: Data

    public init(type: RecordType, body: Data) {
        self.type = type
        self.body = body
    }

    public static func encode(_ r: BridgeRecord) -> Data {
        var out = Data()
        appendU32(&out, UInt32(1 + r.body.count))
        out.append(r.type.rawValue)
        out.append(r.body)
        return out
    }
}

public enum RecordError: Error, Sendable, Equatable {
    case zeroLength
    /// Refused from the 4-byte prefix alone, before a byte of the body is buffered.
    case lengthOverCap(UInt32)
    case unknownType(UInt8)
}

/// Turns a byte stream into records. A length over the cap is refused **before** anything is
/// allocated or buffered for it: the contract's malformed-record rule.
public struct RecordDecoder: Sendable {
    public static let maxLength: UInt32 = UInt32(2 * 1024 * 1024 + 64)

    private var buffer = Data()
    public private(set) var bytesBuffered = 0

    public init() {}

    public mutating func feed(_ data: Data) throws -> [BridgeRecord] {
        buffer.append(data)
        var out: [BridgeRecord] = []
        while true {
            let b = buffer
            guard b.count >= 4 else { break }
            let start = b.startIndex
            let length = (0..<4).reduce(UInt32(0)) { $0 << 8 | UInt32(b[start + $1]) }
            guard length >= 1 else { throw RecordError.zeroLength }
            guard length <= Self.maxLength else { throw RecordError.lengthOverCap(length) }
            guard b.count >= 4 + Int(length) else { break }
            let typeByte = b[start + 4]
            guard let type = RecordType(rawValue: typeByte) else { throw RecordError.unknownType(typeByte) }
            let body = Data(b[(start + 5)..<(start + 4 + Int(length))])
            out.append(BridgeRecord(type: type, body: body))
            buffer = Data(b[(start + 4 + Int(length))...])
        }
        bytesBuffered = buffer.count
        return out
    }
}

// MARK: - Session ids

/// A `sessionId`: 128 bits, written as 32 lowercase hex digits on the control channel and as 16
/// raw bytes at the front of an AU record.
public struct SessionID: Hashable, Sendable, CustomStringConvertible {
    public let bytes: [UInt8]

    public init?(hex: String) {
        guard hex.count == 32 else { return nil }
        var out: [UInt8] = []
        var it = hex.makeIterator()
        while let hi = it.next(), let lo = it.next() {
            guard let h = hi.hexDigitValue, let l = lo.hexDigitValue, hi.isASCII, lo.isASCII,
                  !hi.isUppercase, !lo.isUppercase else { return nil }
            out.append(UInt8(h << 4 | l))
        }
        bytes = out
    }

    public init?(raw: Data) {
        guard raw.count == 16 else { return nil }
        bytes = [UInt8](raw)
    }

    public var hex: String { bytes.map { String(format: "%02x", $0) }.joined() }
    public var raw: Data { Data(bytes) }
    public var description: String { hex }
}

// MARK: - Control and status messages

public enum ControlMessage: Sendable, Equatable {
    case sessionLive(SessionID, generation: UInt16)
    case sessionEnded(SessionID, reason: String)
    case shutdown
}

public enum ControlError: Error, Sendable, Equatable {
    case notJSON
    case unknownOp(String)
    case missingField(String)
}

public enum ControlCodec {
    public static func decode(_ body: Data) throws -> ControlMessage {
        guard let obj = try? JSONSerialization.jsonObject(with: body) as? [String: Any] else {
            throw ControlError.notJSON
        }
        guard let op = obj["op"] as? String else { throw ControlError.missingField("op") }
        switch op {
        case "session-live":
            guard let id = (obj["sessionId"] as? String).flatMap(SessionID.init(hex:)) else {
                throw ControlError.missingField("sessionId")
            }
            guard let g = obj["generation"] as? Int, g >= 1, g <= Int(UInt16.max) else {
                throw ControlError.missingField("generation")
            }
            return .sessionLive(id, generation: UInt16(g))
        case "session-ended":
            guard let id = (obj["sessionId"] as? String).flatMap(SessionID.init(hex:)) else {
                throw ControlError.missingField("sessionId")
            }
            return .sessionEnded(id, reason: obj["reason"] as? String ?? "unspecified")
        case "shutdown":
            return .shutdown
        default:
            throw ControlError.unknownOp(op)
        }
    }

    public static func encode(_ m: ControlMessage) -> Data {
        let obj: [String: Any]
        switch m {
        case let .sessionLive(id, g): obj = ["op": "session-live", "sessionId": id.hex, "generation": Int(g)]
        case let .sessionEnded(id, r): obj = ["op": "session-ended", "sessionId": id.hex, "reason": r]
        case .shutdown: obj = ["op": "shutdown"]
        }
        return try! JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])
    }

    /// The body of a type-0x02 record: the session's 16 raw bytes, then the frame verbatim.
    public static func accessUnitBody(session: SessionID, frame: Data) -> Data {
        session.raw + frame
    }

    public static func splitAccessUnitBody(_ body: Data) -> (SessionID, Data)? {
        guard body.count > 16, let id = SessionID(raw: Data(body.prefix(16))) else { return nil }
        return (id, Data(body.dropFirst(16)))
    }
}
