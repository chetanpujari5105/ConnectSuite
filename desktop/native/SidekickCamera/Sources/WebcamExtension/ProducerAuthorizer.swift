import Foundation
import Security
import WebcamCore

/// Who may feed Sidekick Camera's sink (docs/protocol.md → The bridge ↔ the extension).
///
/// The sink is an injection surface: any process aware of it could otherwise put pictures into
/// somebody's meeting (SinkCam's README says so). The extension starts its sink only for a client
/// whose **code signature** satisfies a requirement pinned to Sidekick's Team ID and the bridge's
/// identifier. A matching `signingID` alone proves nothing: any ad-hoc binary may choose one.
///
/// **Fail closed.** With no Team ID configured (until the Apple Developer Program exists) the
/// requirement can name nobody, so every producer is refused.
///
/// **Residual risk R-1:** `CMIOExtensionClient` exposes a pid, not an audit token, so a pid-reuse race
/// remains in principle. It is recorded, not claimed closed.
public struct ProducerClaim: Sendable, Equatable {
    public var signingID: String?
    public var pid: pid_t

    public init(signingID: String?, pid: pid_t) {
        self.signingID = signingID
        self.pid = pid
    }
}

public enum ProducerRefusal: Equatable, Sendable {
    case noTeamIDConfigured
    case missingSigningID
    case wrongSigningID(String)
    case processGone(OSStatus)
    case signatureRequirementFailed(OSStatus)
    case requirementInvalid(OSStatus)
}

public enum ProducerVerdict: Equatable, Sendable {
    case authorized
    case refused(ProducerRefusal)
}

/// The outcome of checking a running process against a code requirement.
public enum CodeCheck: Equatable, Sendable {
    case satisfied
    case notSatisfied(OSStatus)
    case noSuchProcess(OSStatus)
    case invalidRequirement(OSStatus)
}

/// The identity boundary. Production uses `SecurityFrameworkVerifier`; a test that injects another
/// one is testing the authorizer's *decisions*, not that a signed client is accepted.
public protocol CodeIdentityVerifier: Sendable {
    func check(pid: pid_t, requirement: String) -> CodeCheck
}

/// The real check: `SecCodeCopyGuestWithAttributes` on the pid, then `SecCodeCheckValidity` against
/// a compiled `SecRequirement`.
public struct SecurityFrameworkVerifier: CodeIdentityVerifier {
    public init() {}

    public func check(pid: pid_t, requirement: String) -> CodeCheck {
        var req: SecRequirement?
        let rst = SecRequirementCreateWithString(requirement as CFString, [], &req)
        guard rst == errSecSuccess, let req else { return .invalidRequirement(rst) }
        var code: SecCode?
        let attrs = [kSecGuestAttributePid: NSNumber(value: pid)] as CFDictionary
        let gst = SecCodeCopyGuestWithAttributes(nil, attrs, [], &code)
        guard gst == errSecSuccess, let code else { return .noSuchProcess(gst) }
        let vst = SecCodeCheckValidity(code, [], req)
        return vst == errSecSuccess ? .satisfied : .notSatisfied(vst)
    }
}

public struct ProducerAuthorizer: Sendable {
    public let teamID: String?
    public let bridgeIdentifier: String
    private let verifier: CodeIdentityVerifier

    public init(teamID: String? = SidekickCameraIdentity.teamID,
                bridgeIdentifier: String = SidekickCameraIdentity.bridgeIdentifier,
                verifier: CodeIdentityVerifier = SecurityFrameworkVerifier()) {
        self.teamID = teamID
        self.bridgeIdentifier = bridgeIdentifier
        self.verifier = verifier
    }

    /// The code requirement a producer's running signature must satisfy.
    public static func requirement(teamID: String, identifier: String) -> String {
        "anchor apple generic and identifier \"\(identifier)\" and certificate leaf[subject.OU] = \"\(teamID)\""
    }

    public func authorize(_ claim: ProducerClaim) -> ProducerVerdict {
        guard let teamID, !teamID.isEmpty else { return .refused(.noTeamIDConfigured) }
        guard let id = claim.signingID, !id.isEmpty else { return .refused(.missingSigningID) }
        guard id == bridgeIdentifier else { return .refused(.wrongSigningID(id)) }
        switch verifier.check(pid: claim.pid, requirement: Self.requirement(teamID: teamID, identifier: id)) {
        case .satisfied: return .authorized
        case let .notSatisfied(st): return .refused(.signatureRequirementFailed(st))
        case let .noSuchProcess(st): return .refused(.processGone(st))
        case let .invalidRequirement(st): return .refused(.requirementInvalid(st))
        }
    }
}
