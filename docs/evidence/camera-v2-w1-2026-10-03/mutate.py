import json, os, subprocess, sys, time
PKG='/Users/chetan/Desktop/ConnectSuite/desktop/native/SidekickCamera'
M=[
 ("M1 a stop leaves the last frame in the slot", 'Sources/WebcamExtension/FrameRelay.swift',
  "        if slot != nil { cleared += 1 }\n        slot = nil\n        sessionLive = false",
  "        if slot != nil { cleared += 1 }\n        sessionLive = false",
  ["aStopClearsTheSlotAndTheNextTickIsThePristineCard","explicitStopClearsOldPixelsAndReleasesEverything"]),
 ("M2 an ended session can be announced live again", 'Sources/WebcamCore/SessionGate.swift',
  "        if tombstones.contains(id) { return [.refusedEnded(id)] }\n", "",
  ["anEndedSessionNeverComesBack","aStoppedStreamNeverReappears"]),
 ("M3 the last consumer leaving does not end the session (a linger)", 'Sources/WebcamCore/SessionGate.swift',
  "        guard consumers == 0, let id = live else { return [] }",
  "        guard consumers == -1, let id = live else { return [] }",
  ["theLastConsumerLeavingEndsTheSessionAtOnce","theLastConsumerClosingStopsTheSessionWithoutWaitingForMain"]),
 ("M4 a matching signingID is trusted when the signature fails", 'Sources/WebcamExtension/ProducerAuthorizer.swift',
  "        case let .notSatisfied(st): return .refused(.signatureRequirementFailed(st))",
  "        case .notSatisfied: return .authorized",
  ["theRightSigningIDIsNotEnoughTheSignatureMustSatisfyTheRequirement"]),
 ("M4b the verifier is never asked", 'Sources/WebcamExtension/ProducerAuthorizer.swift',
  "        guard id == bridgeIdentifier else { return .refused(.wrongSigningID(id)) }\n",
  "        guard id == bridgeIdentifier else { return .refused(.wrongSigningID(id)) }\n        return .authorized\n",
  ["theRightSigningIDIsNotEnoughTheSignatureMustSatisfyTheRequirement"]),
 ("M5 no Team ID falls back to trusting the signingID", 'Sources/WebcamExtension/ProducerAuthorizer.swift',
  "        guard let teamID, !teamID.isEmpty else { return .refused(.noTeamIDConfigured) }",
  "        guard let teamID, !teamID.isEmpty else { return claim.signingID == bridgeIdentifier ? .authorized : .refused(.noTeamIDConfigured) }",
  ["withNoTeamIDEveryProducerIsRefusedEvenAPerfectOne"]),
 ("M6 a stale frame is shown frozen instead of the paused card", 'Sources/WebcamExtension/FrameRelay.swift',
  "nowNanos - s.arrivalNanos <= stallThresholdNanos {", "nowNanos - s.arrivalNanos <= UInt64.max {",
  ["freshThenRepeatThenPausedNeverAFrozenFrameLabelledLive"]),
 ("M7 the decode stage is unbounded", 'Sources/WebcamBridge/BridgeCore.swift',
  "        if waiting.count >= decodeCapacity {", "        if waiting.count >= Int.max {",
  ["aSlowDecoderIsBoundedAndEveryAUIsAccountedFor"]),
 ("M8 delivery timestamps follow the clock, not strictly increasing", 'Sources/WebcamExtension/FrameRelay.swift',
  "        let t = max(nowNanos, lastDeliveryNanos + 1)", "        let t = nowNanos",
  ["timestampsStrictlyIncreaseAcrossEveryChangeEvenIfTheClockDoesNot"]),
 ("M9 rotation applied counter-clockwise", 'Sources/WebcamMedia/FrameComposer.swift',
  "        case 1: angle = kVTRotation_CW90", "        case 1: angle = kVTRotation_CCW90",
  ["rotationIsAppliedClockwiseAndThePictureIsNeverCropped","generatedFramesArriveUprightFittedAndLive"]),
 ("M10 a new generation may start without a keyframe (gate)", 'Sources/WebcamCore/SessionGate.swift',
  "        if needsKeyframe && !au.isKeyframeWithConfig { return drop(.awaitingKeyframe) }", "",
  ["aStaleGenerationIsRefusedAndANewerOneIsAdoptedOnlyFromAKeyframe","aDownstreamDropWaitsForTheNextIDR","aProducerFailureRecoversOnlyAtTheNextIDR"]),
 ("M11 the relay accepts frames of an ended session", 'Sources/WebcamExtension/FrameRelay.swift',
  "            if tombstones.contains(id) { return refuse(.endedSession) }\n", "",
  ["aStoppedSessionNeverReappearsFromAnyProducer","aStoppedStreamNeverReappears"]),
 ("M12 the AU cap is checked after the length match", 'Sources/WebcamCore/WebcamAU.swift',
  "        guard length <= UInt32(maxPayload) else { throw MalformedAU.lengthOverCap(length) }\n", "",
  ["lengthOverTheCapIsRefusedFromTheDeclaredLengthAlone"]),
 ("M13 a session announced with no consumers is fed", 'Sources/WebcamCore/SessionGate.swift',
  "        if consumers == 0 {\n            // A session announced", "        if consumers == -1 {\n            // A session announced",
  ["aSessionAnnouncedWithNobodyWatchingIsNeverFed","aSessionWithNoInstalledDeviceIsEndedAtOnceAndNothingIsFed"]),
]
sel = sys.argv[1:] 
for name, path, old, new, expect in M:
    if sel and name.split()[0] not in sel: continue
    full=os.path.join(PKG,path); src=open(full).read()
    assert src.count(old)==1, f"{name}: mutation target not found exactly once"
    open(full,'w').write(src.replace(old,new))
    try:
        t0=time.time()
        r=subprocess.run(['node','run-tests.mjs'],cwd=PKG,capture_output=True,text=True)
        rec=json.load(open(os.path.join(PKG,'.test-run.json')))
        age=time.time()-rec['ranAtMs']/1000
        failed=sorted({l.split('Test ')[1].split('(')[0] for l in r.stdout.splitlines() if l.startswith('✘ Test ') and ' failed after' in l})
        hit=[e for e in expect if e in failed]
        verdict = 'RED as named' if hit==expect else ('RED, partly' if hit else 'NOT CAUGHT')
        if rec['counts'] is None: verdict='NO READING (did not build)'
        print(f"{name}\n   record {age:.1f}s old, exit {rec['exitCode']}, tests {rec['counts'] and rec['counts']['tests']}, failing {len(failed)}: {verdict}\n   failed: {failed}\n   expected red: {expect}", flush=True)
    finally:
        open(full,'w').write(src)
