import json,sys,collections
for v in ['ui-before','ui-harness']:
    r=json.load(open(f'{sys.argv[1]}/{v}/out/results.json'))
    print('=====',v)
    for job in r:
        if 'error' in job: print(job['job']['label'],'ERROR',job['error'][:200]); continue
        lab=job['job']['label']; res=job['results']
        tot=lambda k: sum(len(x.get(k,[])) for x in res)
        to=sum(x.get('textOverlapCount',0) for x in res)
        per=collections.Counter()
        for x in res:
            if x.get('textOverlapCount'): per[x['id']]=x['textOverlapCount']
        sb=[x['extra'] for x in res if x['id']=='settings'][0]
        print(f"{lab:22} control={job['controlOk']} panes={len(res)} textOverlaps={to} {dict(per)} ctrlOverlaps={tot('overlaps')} clipped={tot('clippedControls')} offViewport={tot('offViewport')} unnamed={tot('unnamed')} docOverflow={sum(1 for x in res if x['docOverflow'])} errors={len(job['errors'])} | nav sh/ch={sb['scroller']['sh']}/{sb['scroller']['ch']} settingsRowHit={sb['hitIsLastRow']}")
