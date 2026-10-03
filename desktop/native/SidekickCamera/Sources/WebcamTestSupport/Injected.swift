import Foundation
import WebcamCore

/// **An injected identity boundary.** Answers every code-requirement check with a fixed verdict and
/// records what it was asked. A test using it proves the authorizer's *decisions* given a verdict; it
/// proves nothing about whether a real signed bridge satisfies the real requirement — that needs a
/// Developer ID certificate, which does not exist yet (proposal §11.2 item 3).
public final class InjectedVerifier: @unchecked Sendable {
    public var verdict: CodeCheckStandIn
    public private(set) var asked: [(pid: pid_t, requirement: String)] = []

    public enum CodeCheckStandIn { case satisfied, notSatisfied, gone }

    public init(_ verdict: CodeCheckStandIn) { self.verdict = verdict }

    public func record(_ pid: pid_t, _ requirement: String) { asked.append((pid, requirement)) }
}

public let injectedTeamID = "INJECTED01"
