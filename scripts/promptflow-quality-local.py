"""Opt-in real local interpreter QA. Uses existing provider keys, never prints them.
Run only with authorized provider spend. A completed workflow is not a quality verdict;
review its exported content and visual artifacts separately.
"""
from pathlib import Path
import argparse
import concurrent.futures
import json
import os
import subprocess
import time

ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'tmp/workflow-quality'
parser=argparse.ArgumentParser()
parser.add_argument('--run-live',action='store_true')
parser.add_argument('--retry-failed',action='store_true')
parser.add_argument('--rerun',action='store_true',help='Explicitly rerun selected workflows after a change; incurs provider costs again')
parser.add_argument('--model',default='gpt-6.1-sol')
parser.add_argument('--python',default=str(ROOT/'tmp/promptflow-cli-qa/Scripts/python.exe'))
parser.add_argument('ids',nargs='*')
args=parser.parse_args()
if not args.run_live: raise SystemExit('Use --run-live only with authorized provider spend.')
catalog=json.loads((DEST/'catalog.json').read_text('utf-8'))
ledger_path=DEST/'local-ledger.json'
ledger=json.loads(ledger_path.read_text('utf-8')) if ledger_path.exists() else {}

def run(item):
    sid=item['id'];output=DEST/'local'/sid;output.mkdir(parents=True,exist_ok=True)
    command=[args.python,'-m','promptflow_cli','run',str(DEST/(sid+'.promptflow')),
             '--input','text=@'+str(DEST/(sid+'-input.txt')),'--model',args.model,
             '--max-output-tokens','8192','--override-step-limits','--output-dir',str(output)]
    if 'image' in item['input_kinds']: command += ['--input','image='+str(ROOT/'assets/promptflow-marketplace/samples'/(sid+'-input.png'))]
    started=time.monotonic()
    if (output/'run.log').exists():
        (output/'run.log').rename(output/('run-'+str(time.time_ns())+'.log'))
    with (output/'run.log').open('w',encoding='utf-8') as log:
        result=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT,env=dict(os.environ),timeout=1200)
    return sid,{'status':'complete' if result.returncode==0 else 'failed','exit_code':result.returncode,'seconds':round(time.monotonic()-started,1),'model':args.model,'provider_billing':'Existing local provider key; no PromptFlow credits deducted','output_dir':str(output)}

if args.rerun and not args.ids: raise SystemExit('--rerun requires explicit workflow IDs.')
selected=[x for x in catalog if (not args.ids or x['id'] in args.ids) and (args.rerun or x['id'] not in ledger or (args.retry_failed and ledger[x['id']]['status']=='failed'))]
failed=False
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    futures={pool.submit(run,item):item['id'] for item in selected}
    for future in concurrent.futures.as_completed(futures):
        sid=futures[future]
        try: sid,row=future.result()
        except Exception as exc: row={'status':'failed','error':type(exc).__name__}
        (DEST/'local'/sid/'run-record.json').write_text(json.dumps(row,indent=2),encoding='utf-8')
        latest=json.loads(ledger_path.read_text('utf-8')) if ledger_path.exists() else {}
        if sid in latest: row['previous_attempts']=latest[sid].get('previous_attempts',[])+[{k:v for k,v in latest[sid].items() if k!='previous_attempts'}]
        latest[sid]=row;ledger_path.write_text(json.dumps(latest,indent=2),encoding='utf-8')
        failed = failed or row['status'] != 'complete'
        print(sid,row['status'],flush=True)

raise SystemExit(1 if failed else 0)
