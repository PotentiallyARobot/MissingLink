// Local integration fixture: real room/stream/controller, simulated providers.
import http from 'node:http';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
const root=process.cwd(),backend=process.env.PROMPTFLOW_BACKEND||'C:/missinglink-backend',db=new DatabaseSync(':memory:');
const {billingFixture}=await import(pathToFileURL(path.join(backend,'src/promptflow_team_billing_fixture.mjs')).href);
const ledger=billingFixture('local-preview',20000);
const source=name=>stripTypeScriptTypes(readFileSync(path.join(backend,'src',name),'utf8').replace(/^import .*;\r?$/gm,''),{mode:'transform'}).replace(/^export /gm,'');
const pause=(ms,signal)=>new Promise((resolve,reject)=>{const t=setTimeout(resolve,ms);signal?.addEventListener('abort',()=>{clearTimeout(t);reject(signal.reason);},{once:true});});
const answer=text=>[{type:'message',role:'assistant',content:[{type:'output_text',text}]}];
const tool=(name,args)=>[{type:'function_call',call_id:crypto.randomUUID(),name,arguments:JSON.stringify(args)}];
const TEXT_MODELS=vm.runInNewContext(readFileSync(path.join(backend,'src/promptflow_run_controls.ts'),'utf8').match(/export const TEXT_MODELS = (\[[\s\S]*?\n\]);/)[1]);
const sandbox={TEXT_MODELS,DEFAULT_MARKUP:2,USD_PER_TOKEN:.0005,crypto,Response,Request,Headers,URL,TextEncoder,TextDecoder,ReadableStream,AbortSignal,AbortController,Uint8Array,atob,btoa,setTimeout,clearTimeout,setInterval,clearInterval,structuredClone,
  encryptUserSecret:async(_,key)=>btoa(key),decryptUserSecret:async(_,key)=>atob(key),getUser:async()=>({id:'local-preview'}),
  storeArtifact:async(_,filename,bytes)=>({filename,size_bytes:bytes.length,url:'http://127.0.0.1:4174/api/promptflow/outputs/preview.csv'}),
  fetch:async(url,init)=>{if(url.includes('/models'))return Response.json({data:[{id:'gpt-6.2'}]});const body=JSON.parse(init.body);await pause(url.includes('sandbox')?700:1800,init.signal);
    if(url.includes('sandbox'))return Response.json(body.action==='execute'?{exit_code:0,duration_ms:760,output:'2 checks passed. CSV saved.',changes:[{path:'output/comparison.csv',change:'created',added:3,removed:0,diff:'--- a/output/comparison.csv\n+++ b/output/comparison.csv\n@@ -0,0 +1,3 @@\n+option,cost\n+A,12\n+B,18'}],files:[{filename:'comparison.csv',sha256:'test-file',base64:btoa('option,cost\nA,12\nB,18\n')}]}:{ok:true});
    const done=body.input.some(v=>v.type==='function_call_output');let output;
    if(body.tools?.[0]?.name==='configure_team')output=tool('configure_team',{title:'Hosting decision team',task:'Compare cloud hosting options for a small business. Find primary sources, calculate costs and check the recommendation.',plan:'The coordinator defines the decision criteria, the researcher compares costs, and the reviewer checks the evidence independently.',explanation:'Your team is ready. Review the roles below, then start the task.',agents:room.room(room.get('rooms')[0]).agents});
    else if(body.instructions.startsWith('You are Coordinator'))output=done?answer('## Recommendation\nChoose **Option A** for this workload. The researcher checked the numbers, and the reviewer verified both calculations.\n\n| Option | Monthly cost | Check |\n| --- | --- | --- |\n| A | $12 | Passed |\n| B | $18 | Passed |\n\nThe comparison spreadsheet is attached in the researcher’s response. These are local test fixtures.'):tool('delegate',{assignments:[{agent_id:'researcher',task:'Calculate the two options and create a comparison CSV.'},{agent_id:'reviewer',task:'Independently verify the comparison.'}]});
    else if(body.instructions.startsWith('You are Researcher'))output=done?answer('The comparison is ready. Option A is $6 cheaper per month. I saved the calculation as a CSV file.'):tool('execute',{command:"python - <<'PY'\nprint('Check monthly cost and save comparison.csv')\nPY"});
    else output=answer('I checked the arithmetic independently: $18 − $12 = **$6 per month**, or **$72 per year**. Both test cases passed.');
    const chunks=output.filter(o=>o.type==='message').map(o=>({type:'response.output_text.delta',delta:o.content[0].text}));chunks.unshift({type:'response.reasoning_summary_text.delta',delta:'Checking the requested result and using independent verification where useful.'});chunks.push({type:'response.completed',response:{output,usage:{input_tokens:124,output_tokens:62}}});return new Response(chunks.map(c=>'data: '+JSON.stringify(c)+'\n\n').join(''));
  }};
vm.createContext(sandbox);vm.runInContext(source('promptflow_team_billing.ts')+'\n'+source('promptflow_activity.ts')+'\n'+source('promptflow_code.ts')+'\n'+source('promptflow_multiagent_models.ts')+'\n'+source('promptflow_team_files.ts')+'\n'+source('promptflow_multiagent.ts')+'\nglobalThis.MA=PromptFlowMultiagent;',sandbox);
const previewObject={size:22,customMetadata:{owner_user_id:'local-preview'},arrayBuffer:async()=>new TextEncoder().encode('option,cost\nA,12\nB,18\n').buffer,get body(){return new Response('option,cost\nA,12\nB,18\n').body;}};
const room=new sandbox.MA({waitUntil:p=>p.catch(console.error),storage:{sql:{exec(sql,...args){const rows=db.prepare(sql).all(...args);return {toArray:()=>rows};}}}},{PROMPTFLOW_PUBLIC_BASE:'http://127.0.0.1:4174',STUDIO_UPLOADS:{get:async()=>previewObject,head:async()=>previewObject},PROMPTFLOW_HOSTED_AGENTS:'0',DB:ledger.d1,OPENAI_API_KEY:'platform-fixture',STUDIO_JWT_SECRET:'fixture-only',PROMPTFLOW_SANDBOX_URL:'https://sandbox.test',PROMPTFLOW_GPU_KEY:'fixture-only'});
// Start with no personal key to exercise optional BYOK.
http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1:4174');if(url.pathname.startsWith('/api/promptflow/multiagent/')){const chunks=[];for await(const c of req)chunks.push(c);const response=await room.fetch(new Request(url,{method:req.method,headers:{'x-pf-owner':'local-preview','content-type':'application/json'},...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})}));res.writeHead(response.status,Object.fromEntries(response.headers));if(!response.body)return res.end();const reader=response.body.getReader();res.on('close',()=>reader.cancel().catch(()=>{}));for(;;){const {value,done}=await reader.read();if(done)break;res.write(value);}return res.end();}
  if(url.pathname==='/api/promptflow/outputs/preview.csv'){res.writeHead(200,{'content-type':'text/csv'});return res.end('option,cost\nA,12\nB,18\n');}
  const file=url.pathname.startsWith('/assets/')?url.pathname.slice(1):'promptflow-multiagent.html';const resolved=path.resolve(root,file);if(!resolved.startsWith(root+path.sep))throw new Error('Invalid path');res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(readFileSync(resolved));
}catch(e){res.writeHead(500);res.end(e.message);}}).listen(4174,'127.0.0.1',()=>console.log('Multi-agent fixture: http://127.0.0.1:4174/promptflow/multiagent'));
