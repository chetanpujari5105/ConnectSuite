import sys, subprocess, os, re, shutil
ROOT='/Users/chetan/Desktop/ConnectSuite'
W=ROOT+'/camera-module/src/main/java/com/chetan/connectsuite/camera/webcam/'
C=ROOT+'/camera-module/src/main/java/com/chetan/connectsuite/camera/'
M=[
 ('MB1 a tap after the deadline still opens', W+'WebcamSessionMachine.kt', 'if (nowMillis >= l.deadlineMillis) return stop(WebcamStopReason.EXPIRED)\n        if (busyNow', 'if (false) return stop(WebcamStopReason.EXPIRED)\n        if (busyNow'),
 ('MB2 a P-frame may announce running', W+'WebcamSessionMachine.kt', '            if (!keyframe) {\n                if (!next.keyframeRequested)', '            if (false) {\n                if (!next.keyframeRequested)'),
 ('MB3 failure worded as stopped-by-mac', W+'WebcamVocabulary.kt', 'FAILURE("failure", WebcamStopReason.MAC_FAILED)', 'FAILURE("failure", WebcamStopReason.STOPPED_BY_MAC)'),
 ('MB4 the arbiter does not hold its lock', C+'CameraUse.kt', 'fun <T> admit(decision: () -> T): T = synchronized(lock) { decision() }', 'fun <T> admit(decision: () -> T): T { val r = decision(); Thread.yield(); return r }'),
 ('MB5 the writer evicts the oldest (Camera v1 rule)', W+'WebcamStreamWriter.kt', '            } else if (awaitingKeyframe || free <= 0) {', '            } else if (free <= 0) {\n                droppedBackpressure++; queue.pollFirst(); queue.addLast(Pending(frame, false)); true\n            } else if (awaitingKeyframe) {'),
 ('MB6 a late capture is bound', W+'WebcamCaptureCore.kt', 'val wanted = mine == ticket && isCurrent(sessionId, generation)', 'val wanted = true'),
 ('MB7 SPS/PPS not prepended to the IDR', W+'WebcamAu.kt', '            ByteArrayOutputStream(c.size + data.size).apply { write(c); write(data) }.toByteArray()', '            data.also { c.size }'),
 ('MB8 thermal stops only above critical', W+'WebcamSessionMachine.kt', 'fun mustStop(status: Int): Boolean = status >= CRITICAL', 'fun mustStop(status: Int): Boolean = status > CRITICAL'),
 ('MB9 a second claim attaches', W+'WebcamSessionMachine.kt', '!l.phase.isLive || l.channelAttached) return false', '!l.phase.isLive) return false'),
 ('MB10 release builds install', W+'WebcamFeature.kt', 'fun allows(debuggable: Boolean, release: Boolean = Extensions.WEBCAM_RELEASE): Boolean = debuggable || release', 'fun allows(debuggable: Boolean, release: Boolean = Extensions.WEBCAM_RELEASE): Boolean = true'),
 ('MB11 an unknown detail is trusted', W+'WebcamVocabulary.kt', 'entries.firstOrNull { it.wire != null && it.wire == value } ?: UNSPECIFIED', 'entries.firstOrNull { it.wire != null && it.wire == value } ?: STREAM_MALFORMED'),
 ('MB12 a malformed stop leaves the camera running', W+'WebcamSessionMachine.kt', 'if (cause == null) return stop(WebcamStopReason.STOPPED_BY_MAC) + badCause', 'if (cause == null) return listOf(badCause)'),
 ('MB13 the switch keeps the generation', W+'WebcamSessionMachine.kt', 'return l.copy(generation = l.generation + 1, producing', 'return l.copy(generation = l.generation, producing'),
 ('MB14 v1 ignores the webcam', C+'CameraEngine.kt', 'webcamBusy = webcamBusy,', 'webcamBusy = false,'),
 ('MB16 the arbiter tells v1 the camera is free', C+'CameraUse.kt', 'fun <T> admitCamera(request: (webcamBusy: Boolean) -> T): T = admit { request(webcamOpen()) }', 'fun <T> admitCamera(request: (webcamBusy: Boolean) -> T): T = admit { request(false) }'),
 ('MB17 the arbiter forgets Camera v1', C+'CameraUse.kt', '                cameraV1Open() -> OtherCapture.CAMERA_V1\n', ''),
 ('MB15 the phone stamps no discontinuity at a switch (engine rule, mirrored in the fixture test)', ROOT+'/camera-module/src/test/java/com/chetan/connectsuite/camera/webcam/WebcamPhoneStreamFixtureTest.kt', 'discontinuity = ticket.firstOfGeneration && g.number > 1', 'discontinuity = false'),
]
only = sys.argv[1:] 
env=dict(os.environ, JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home")
out=[]
for name, path, old, new in M:
    if only and not any(name.startswith(o) for o in only): continue
    src=open(path).read()
    assert src.count(old)==1, (name, src.count(old))
    open(path,'w').write(src.replace(old,new))
    try:
        resdir=ROOT+'/camera-module/build/test-results/testDebugUnitTest'
        shutil.rmtree(resdir, ignore_errors=True)
        import time; t0=time.time()
        r=subprocess.run(['./gradlew','-q',':camera-module:testDebugUnitTest','--offline','--rerun-tasks' if False else '--offline'],cwd=ROOT,env=env,capture_output=True,text=True,timeout=900)
        code=r.returncode
        txt=r.stdout+r.stderr
        comp='e: ' in txt
        reds=[]
        xmls=[f for f in (os.listdir(resdir) if os.path.isdir(resdir) else []) if f.endswith('.xml')]
        ages=[time.time()-os.path.getmtime(os.path.join(resdir,f)) for f in xmls]
        age=f"{len(xmls)} result files, newest {min(ages):.1f}s old, run took {time.time()-t0:.0f}s" if xmls else "NO RESULT FILES - no reading"
        for f in xmls:
            x=open(os.path.join(resdir,f)).read()
            for m in re.finditer(r'<testcase name="([^"]+)" classname="([^"]+)"[^>]*>\s*<failure', x):
                reds.append(m.group(2).split('.')[-1]+' :: '+m.group(1))
        out.append((name, code, comp, reds))
        print(f"== {name}: gradle exit {code}{' (COMPILE ERROR)' if comp else ''}; {age}")
        for t in reds: print("   red:", t)
    finally:
        open(path,'w').write(src)
