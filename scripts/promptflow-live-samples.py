"""Run the catalog's synthetic examples within the explicitly authorized QA cap.
Uses the existing CLI login; never prints credentials. Outputs remain local until
reviewed for publication. No account settings, purchases or existing runs change.
"""
from pathlib import Path
import concurrent.futures
import json
import re
import sys
import time
import httpx

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'promptflow-cli/src'))
from promptflow_cli.config import resolve_api_key
from promptflow_cli.client import PromptFlowClient
SERVER='https://missinglink.build'
CAP=4638  # 5,000 authorized less the prior 362-token verification.
DEST=ROOT/'tmp/marketplace-live-samples'
DEST.mkdir(parents=True,exist_ok=True)
client=PromptFlowClient(SERVER,resolve_api_key(),timeout=240)
headers=client._headers()
catalog=client._get('/api/promptflow/marketplace')['items']
(DEST/'catalog.json').write_text(json.dumps(catalog,indent=2),encoding='utf-8')
ledger_path=DEST/'ledger.json'
ledger=json.loads(ledger_path.read_text('utf-8')) if ledger_path.exists() else {}
retry='--retry' in sys.argv
recover='--recover' in sys.argv
selected=set(arg for arg in sys.argv[1:] if arg not in ('--retry','--recover'))
queued=[]
reserved=sum(row.get('reserved',0) for row in ledger.values())
for item in catalog:
    sid=item['id']
    if selected and sid not in selected:continue
    if recover:
        if sid in ledger:queued.append((sid,ledger[sid]['plan_id']))
        continue
    if sid in ledger:
        if retry and ledger[sid].get('status') in ('error','failed'):
            attempt=1
            while sid+'@'+str(attempt) in ledger:attempt+=1
            ledger[sid+'@'+str(attempt)]=ledger.pop(sid)
        else: print(sid,'already recorded; skipping',flush=True);continue
    files={}
    if 'image' in item['input_kinds']:files['image']=ROOT/f'assets/promptflow-marketplace/samples/{sid}-input.png'
    result=client.plan(item['sample_input'],force_process_id='marketplace-'+sid,files=files,text_inputs={'input_mode':'data','run_name':'Marketplace synthetic sample: '+item['name'],'max_run_tokens':str(max(1,CAP-reserved))})
    quote=int(result.get('cost',{}).get('tokens_charged',-1))
    if quote<0 or reserved+quote>CAP:raise RuntimeError('QA budget exceeded; no further execution authorized.')
    reserved+=quote
    ledger[sid]={'plan_id':result['plan_id'],'reserved':quote,'status':'prepared'}
    ledger_path.write_text(json.dumps(ledger,indent=2),encoding='utf-8')
    (DEST/f'{sid}-plan.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    queued.append((sid,result['plan_id']))
    print(sid,'quote',quote,'aggregate reserved',reserved,flush=True)

def run(entry):
    sid,plan_id=entry
    try:
        try: result=client.status(plan_id) if recover else client.execute(plan_id)
        except Exception as exc:
            # Never replay execute after a transport failure: status recovers the
            # already-reserved run and the server owns dispatch idempotency.
            if getattr(exc,'status',None) is not None:raise
            result=client.status(plan_id)
        end=time.monotonic()+900
        while result.get('status') not in ('complete','failed') and time.monotonic()<end:
            time.sleep(2)
            result=client.status(plan_id)
        (DEST/f'{sid}-result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
        directory=DEST/sid;directory.mkdir(exist_ok=True)
        for i,output in enumerate(result.get('outputs',[])):
            if output.get('text'):(directory/'output.txt').write_text(output['text'],encoding='utf-8')
            for key in ['html_url','download_url','url']:
                url=output.get(key)
                if not url:continue
                parsed=httpx.URL(url)
                if parsed.host!='missinglink.build':raise RuntimeError('Unexpected artifact host')
                response=httpx.get(url,headers=headers,timeout=90);response.raise_for_status()
                ext=Path(parsed.path).suffix or '.txt'
                (directory/f'output-{i}-{key}{ext}').write_bytes(response.content)
                if ext=='.html':
                    for j,asset in enumerate(re.findall(r'<img[^>]+src=["\']([^"\']+)',response.text)):
                        if asset.startswith(SERVER+'/api/promptflow/'):
                            image=httpx.get(asset,headers=headers,timeout=90);image.raise_for_status()
                            (directory/f'image-{i}-{j}{Path(httpx.URL(asset).path).suffix}').write_bytes(image.content)
        return sid,result.get('status','unknown'),result.get('error')
    except Exception as exc:return sid,'error',str(exc)

with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    for future in concurrent.futures.as_completed([pool.submit(run,entry) for entry in queued]):
        sid,status,error=future.result()
        ledger[sid].update(status=status,error=error)
        ledger_path.write_text(json.dumps(ledger,indent=2),encoding='utf-8')
        print(sid,status,error or '',flush=True)
print('Reserved tokens including failures:',reserved,flush=True)
