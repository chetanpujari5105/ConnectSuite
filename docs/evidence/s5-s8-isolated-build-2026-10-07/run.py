#!/usr/bin/env python3
"""S5 launch tests. Each test runs on the fused harness and on the unfused, unguarded control. Every bound is printed."""
import subprocess, os, time, json, shutil, sys
H=os.path.dirname(os.path.abspath(__file__))
APPS={'fused': f'{H}/app/release-fused/mac-arm64/S5Harness.app', 'control': f'{H}/app/release-control/mac-arm64/S5HarnessControl.app'}
BIN={'fused':'S5Harness','control':'S5HarnessControl'}
LIMIT=20.0
def listening(port):
    r=subprocess.run(['lsof','-nP',f'-iTCP:{port}','-sTCP:LISTEN'],capture_output=True,text=True); return r.returncode==0 and str(port) in r.stdout
def run(kind, args=(), env_extra=None, watch_port=None, via_open=False):
    work=f'{H}/work-{kind}'; shutil.rmtree(work, ignore_errors=True); os.makedirs(work)
    res=f'{work}/result.json'
    env=dict(os.environ, S5_RESULT_FILE=res, S5_WORK_DIR=work); env.pop('ELECTRON_RUN_AS_NODE',None); env.pop('NODE_OPTIONS',None)
    if env_extra: env.update(env_extra)
    if via_open:
        cmd=['open','-n','-W','--env',f'S5_RESULT_FILE={res}','--env',f'S5_WORK_DIR={work}',APPS[kind],'--args',*args]
    else:
        cmd=[f'{APPS[kind]}/Contents/MacOS/{BIN[kind]}',*args]
    t0=time.time(); p=subprocess.Popen(cmd,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    seen_port=False; samples=0
    while p.poll() is None and time.time()-t0<LIMIT:
        if watch_port: samples+=1; seen_port = seen_port or listening(watch_port)
        time.sleep(0.05)
    killed=False
    if p.poll() is None: p.kill(); killed=True
    out,err=p.communicate()
    result=json.load(open(res)) if os.path.exists(res) else None
    return dict(exit=p.returncode, killed=killed, secs=round(time.time()-t0,1), result=result, port_seen=seen_port if watch_port else None, port_samples=samples, stderr=err.strip()[:160], work=work)
def xattr(path):
    r=subprocess.run(['/usr/bin/xattr','-p','com.apple.quarantine',path],capture_output=True,text=True)
    return 'present' if r.returncode==0 else ('absent' if 'No such xattr' in r.stderr else f'unknown({r.stderr.strip()[:60]})')
for p in (9333,9334): assert not listening(p), f'port {p} busy before the run'
print(f'bounds: {LIMIT}s per launch; port sampled every ~50ms while the process lives')
report={}
for kind in ('fused','control'):
    r={}
    a=run(kind); r['T1 direct launch']=a
    b=run(kind, via_open=True); r['T1b launch via open (LaunchServices)']=b
    r['T1b quarantine']={k:xattr(f"{b['work']}/{k}") for k in ('received/plain.bin','received/nested/deeper/deep.bin','excluded/top.bin','excluded/nested/deeper/deep.bin')}
    r['T1 quarantine (direct exec)']={k:xattr(f"{a['work']}/{k}") for k in ('received/plain.bin',)}
    r['T2 --remote-debugging-port']=run(kind, args=['--remote-debugging-port=9333'], watch_port=9333)
    marker=f'{H}/runasnode-{kind}.marker'
    if os.path.exists(marker): os.remove(marker)
    c=run(kind, args=['-e', f"require('fs').writeFileSync('{marker}','ran as node')"], env_extra={'ELECTRON_RUN_AS_NODE':'1'})
    c['marker']=os.path.exists(marker); r['T3 ELECTRON_RUN_AS_NODE']=c
    inj=f'{H}/inject-{kind}.js'; im=f'{H}/inject-{kind}.marker'
    if os.path.exists(im): os.remove(im)
    open(inj,'w').write(f"require('fs').writeFileSync('{im}','injected')")
    d=run(kind, env_extra={'NODE_OPTIONS':f'--require {inj}'}); d['marker']=os.path.exists(im); r['T4 NODE_OPTIONS --require']=d
    r['T5 --inspect']=run(kind, args=['--inspect=9334'], watch_port=9334)
    report[kind]=r
for p in (9333,9334): assert not listening(p), f'port {p} left listening'
json.dump(report, open(f'{H}/launch-report.json','w'), indent=1)
for kind,r in report.items():
    print('==',kind)
    for k,v in r.items():
        if 'quarantine' in k: print(f'  {k}: {v}'); continue
        res=v.get('result'); page=(res or {}).get('page')
        print(f"  {k}: exit={v['exit']} killed={v['killed']} {v['secs']}s result={'yes' if res else 'no'} page={page} port_seen={v['port_seen']} ({v['port_samples']} samples) marker={v.get('marker')} stderr={v['stderr'][:90]!r}")
