import subprocess, sys, re
D='/Users/chetan/Desktop/ConnectSuite/desktop/'
M=[
 ('MW1 webcam.state not bound', 'src/main/webcamWiring.ts', "if (envelope?.type === MessageType.WEBCAM_STATE && envelope.payload) controller.onState(envelope.payload);", "void envelope;", 'src/main/webcamWiring.test.ts'),
 ('MW2 resume bound as well (would resume nothing, but binds a coming-back event)', 'src/main/webcamWiring.ts', "  'user-did-resign-active': 'user-switch',", "  'user-did-resign-active': 'user-switch',\n  resume: 'suspend',", 'src/main/webcamWiring.test.ts'),
 ('MW3 lock-screen not bound', 'src/main/webcamWiring.ts', "  'lock-screen': 'lock-screen',\n", "", 'src/main/webcamWiring.test.ts'),
 ('MW4 quit does not reap the bridge', 'src/main/webcamWiring.ts', "dispose: () => (disposing ??= controller.lifecycle('quit')),", "dispose: () => (disposing ??= controller.lifecycle('suspend')),", 'src/main/webcamWiring.test.ts'),
 ('MW5 session-ended not bound', 'src/main/webcamWiring.ts', "    controller.onSessionEnded(ended?.token ?? null, ended?.byThisMac === true),", "    void ended,", 'src/main/webcamWiring.test.ts'),
 ('MW6 a packaged build honours the dev switch', 'src/main/webcamWiring.ts', "const gateOpen = (!opts.packaged && opts.devSwitch) || release;", "const gateOpen = opts.devSwitch || release;", 'src/main/webcamWiring.test.ts'),
 ('MW7 Ask ignores the chosen camera', 'src/main/webcamWiring.ts', "controller.askPhone(facing ?? 'front')", "controller.askPhone('front')", 'src/main/webcamWiring.test.ts'),
 ('MW8 the panel asks on mount (auto-ask)', 'src/renderer/webcam.ts', "    void bridge.webcamCurrent().then((status) => this.setStatus(status));", "    void bridge.webcamCurrent().then((status) => this.setStatus(status));\n    void bridge.webcamAsk('front');", 'src/renderer/webcamView.test.ts'),
 ('MW9 Stop while running sends nothing', 'src/renderer/webcam.ts', "if (spec.canStop) controls.push(webcamButton('Stop webcam', 'button danger webcam-stop', () => void this.bridge.webcamStop()));", "if (spec.canStop) controls.push(webcamButton('Stop webcam', 'button danger webcam-stop', () => undefined));", 'src/renderer/webcamView.test.ts'),
]
only=__import__('sys').argv[1:]
for name, f, old, new, test in M:
    if only and not any(name.startswith(o) for o in only): continue
    p=D+f; src=open(p).read(); assert src.count(old)==1, name
    open(p,'w').write(src.replace(old,new))
    try:
        r=subprocess.run(['node','--import','tsx','--test','--test-reporter=tap',test],cwd=D,capture_output=True,text=True,timeout=600)
        reds=[l[7:] for l in r.stdout.splitlines() if l.startswith('not ok')]
        print(f"== {name}: exit {r.returncode}"); [print('   red:',x) for x in reds]
    finally:
        open(p,'w').write(src)
