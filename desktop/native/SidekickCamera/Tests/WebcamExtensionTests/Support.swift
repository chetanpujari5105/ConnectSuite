import CoreMedia
import CoreVideo
import Foundation
import WebcamCore
@testable import WebcamExtension
import WebcamMedia
import WebcamTestSupport

/// Adapts the test-support stand-in to the extension's protocol. **Injected**: see InjectedVerifier.
struct InjectedCodeVerifier: CodeIdentityVerifier {
    let box: InjectedVerifier
    func check(pid: pid_t, requirement: String) -> CodeCheck {
        box.record(pid, requirement)
        switch box.verdict {
        case .satisfied: return .satisfied
        case .notSatisfied: return .notSatisfied(errSecCSReqFailed)
        case .gone: return .noSuchProcess(errSecCSNoSuchCode)
        }
    }
}

func injectedAuthorizer(_ v: InjectedVerifier.CodeCheckStandIn = .satisfied, teamID: String? = injectedTeamID) -> (ProducerAuthorizer, InjectedVerifier) {
    let box = InjectedVerifier(v)
    return (ProducerAuthorizer(teamID: teamID, verifier: InjectedCodeVerifier(box: box)), box)
}

let bridgeClaim = ProducerClaim(signingID: SidekickCameraIdentity.bridgeIdentifier, pid: 4242)
let producerID = UUID()

func liveFrame(_ session: SessionID?, generation: UInt16 = 1, y: UInt8 = 200,
               format: PublishedFormat = .fullHD) throws -> CMSampleBuffer {
    let pb = try TestPatterns.marked(width: format.width, height: format.height, background: y)
    let sb = try SampleBuffers.make(pb, pts: CMTime(value: 1, timescale: 30))
    if let session { SampleBuffers.tag(sb, session: session, generation: generation) }
    return sb
}

/// A clock the tests advance by hand, in host nanoseconds.
struct Clock {
    var now: UInt64 = 10_000_000_000
    mutating func advance(ms: UInt64) -> UInt64 { now += ms * 1_000_000; return now }
}
