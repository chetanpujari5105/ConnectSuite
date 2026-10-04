import sys, subprocess, os, re, shutil
ROOT='/Users/chetan/Desktop/ConnectSuite'
W=ROOT+'/camera-module/src/main/java/com/chetan/connectsuite/camera/webcam/'
C=ROOT+'/camera-module/src/main/java/com/chetan/connectsuite/camera/'
M=[
 ('MP1 the mirror gate ignores the webcam', ROOT+'/mirror-module/src/main/java/com/chetan/connectsuite/mirror/v2/MirrorAdmission.kt', '        if (webcamOpen()) {', '        if (false) {'),
 ('MP2 the mirror gate decides outside the shared lock', ROOT+'/mirror-module/src/main/java/com/chetan/connectsuite/mirror/v2/MirrorAdmission.kt', 'fun tryBegin(): MirrorFailure? = synchronized(lock) {', 'fun tryBegin(): MirrorFailure? = run { Thread.yield();'),
 ('MP3 the app wiring never tells the mirror about the webcam', ROOT+'/app/src/main/java/com/chetan/connectsuite/CaptureWiring.kt', '        mirror.webcamOpen = { camera.webcamOpen() }', '        Unit'),
 ('MP4 a mirror being admitted does not count as busy', ROOT+'/mirror-module/src/main/java/com/chetan/connectsuite/mirror/v2/MirrorAdmission.kt', 'fun busy(running: Boolean, phase: MirrorPhase): Boolean = isStarting || running', 'fun busy(running: Boolean, phase: MirrorPhase): Boolean = running'),
 ('MP5 handlers registered before the gate', ROOT+'/camera-module/src/main/java/com/chetan/connectsuite/camera/webcam/WebcamFeature.kt', '        if (!WebcamReleaseGate.allows(target.debuggable, release)) return false\n', '        handledTypes.forEach { type -> target.register(type, handlerFor(type)) }\n        if (!WebcamReleaseGate.allows(target.debuggable, release)) return false\n'),
 ('MP6 the claim is not taken', ROOT+'/camera-module/src/main/java/com/chetan/connectsuite/camera/webcam/WebcamFeature.kt', '        target.setWebcamSink { channel, claim -> WebcamEngine.onChannel(channel, claim) }\n', ''),
 ('MP7 the mirror start is not gated', ROOT+'/mirror-module/src/main/java/com/chetan/connectsuite/mirror/v2/MirrorEngine.kt', '        val busy = MirrorAdmission.gate.tryBegin()\n        if (busy != null) {\n            LinkLog.w("mirror", "mirror.start', '        val busy: MirrorFailure? = null\n        if (busy != null) {\n            LinkLog.w("mirror", "mirror.start'),
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
        resdirs=[ROOT+f'/{m}/build/test-results/testDebugUnitTest' for m in ('camera-module','mirror-module','app')]
        for d in resdirs: shutil.rmtree(d, ignore_errors=True)
        resdir=resdirs[0]
        import time; t0=time.time()
        r=subprocess.run(['./gradlew','-q',':camera-module:testDebugUnitTest',':mirror-module:testDebugUnitTest',':app:testDebugUnitTest','--offline'],cwd=ROOT,env=env,capture_output=True,text=True,timeout=900)
        code=r.returncode
        txt=r.stdout+r.stderr
        comp='e: ' in txt
        reds=[]
        xmls=[os.path.join(d,f) for d in resdirs if os.path.isdir(d) for f in os.listdir(d) if f.endswith('.xml')]
        ages=[time.time()-os.path.getmtime(f) for f in xmls]
        age=f"{len(xmls)} result files, newest {min(ages):.1f}s old, run took {time.time()-t0:.0f}s" if xmls else "NO RESULT FILES - no reading"
        for f in xmls:
            x=open(f).read()
            for m in re.finditer(r'<testcase name="([^"]+)" classname="([^"]+)"[^>]*>\s*<failure', x):
                reds.append(m.group(2).split('.')[-1]+' :: '+m.group(1))
        out.append((name, code, comp, reds))
        print(f"== {name}: gradle exit {code}{' (COMPILE ERROR)' if comp else ''}; {age}")
        for t in reds: print("   red:", t)
    finally:
        open(path,'w').write(src)
