// Isolated UX QA server. Synthetic data only; never forwards to production.
// Run: node scripts/promptflow-preview.mjs
// Signed out: /promptflow?guest=1; library error: /promptflow?library_error=1
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import {stripTypeScriptTypes,registerHooks} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const backendRoot=process.env.PROMPTFLOW_BACKEND || path.resolve(root,'../../../missinglink-backend');
registerHooks({
  resolve(specifier,context,next){if(specifier.startsWith('./promptflow_')&&!specifier.endsWith('.ts'))specifier+='.ts';return next(specifier,context);},
  load(url,context,next){if(url.endsWith('.ts'))return {format:'module',source:stripTypeScriptTypes(readFileSync(fileURLToPath(url),'utf8')),shortCircuit:true};return next(url,context);}
});
const importBackend=async file=>import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(await readFile(path.join(backendRoot,'src',file),'utf8'))).toString('base64'));
const marketplaceStore=await import(pathToFileURL(path.join(backendRoot,'src/promptflow_marketplace_store.ts')).href);
const marketSql=new DatabaseSync(':memory:');
marketSql.exec(`CREATE TABLE studio_users(id TEXT PRIMARY KEY,tokens INTEGER,total_spent INTEGER,subscription_remaining INTEGER,subscription_status TEXT);
INSERT INTO studio_users VALUES('market-buyer',30000,0,0,NULL),('ux-test',5000,0,0,NULL),('market-member',30000,0,30000,'active');
CREATE TABLE promptflow_processes(id TEXT PRIMARY KEY,name TEXT,description TEXT,steps_json TEXT,input_schema_json TEXT,output_kind TEXT,created_by_user_id TEXT,is_system INTEGER,enabled INTEGER,priority INTEGER,created_at INTEGER,updated_at INTEGER,design_intent TEXT,utility_md TEXT,sample_inputs_json TEXT);`);
marketSql.exec(marketplaceStore.MARKETPLACE_SCHEMA);
const marketDb={prepare(query){let params=[];return{bind(...v){params=v;return this;},run(){return{meta:{changes:Number(marketSql.prepare(query).run(...params).changes)}};},first(){return marketSql.prepare(query).get(...params)||null;},all(){return{results:marketSql.prepare(query).all(...params)};}};},async batch(statements){marketSql.exec('BEGIN');try{const r=statements.map(s=>s.run());marketSql.exec('COMMIT');return r;}catch(e){marketSql.exec('ROLLBACK');throw e;}}};
const sample = {
  id:'ux-test-summary', name:'UX Audit Text Summary', description:'Summarize text into three concise bullets.',
  input_kinds:['text'],output_kind:'text',mine:true,editable:true,is_published:false,is_draft:true,
  is_system:false,runnable:true,created_by_user_id:'ux-test',author_user_id:'ux-test',author_display_name:'QA account',
  steps:[{id:'summary',type:'claude',user_prompt:'Summarize {{user_text}}',output_format:'text'}],
  python_text:'INPUT_IMAGE_URL = "<INPUT_IMAGE_URL>"\nINPUT_VIDEO_URL = "<INPUT_VIDEO_URL>"\nUPLOADED_AUDIO_URL = "<UPLOADED_AUDIO_URL>"\nprint("Synthetic preview only")',public_url:'/api/promptflow/p/qa/summary',updated_at:1794344400,
};
const library = [sample, {...sample,id:'ux-published',name:'Research Paper Web Search',is_draft:false,is_published:true,is_monetized:true,markup_tokens:200,mine:false,editable:false,author_display_name:'Research team',output_kind:'multi'},
  {...sample,id:'ux-system',name:'Generate a process',is_draft:false,is_system:true,mine:false,editable:false,output_kind:'process'},
  ...Array.from({length:62},(_,i)=>({...sample,id:`ux-fixture-${i}`,name:`Sample text process ${i+1}`,is_draft:false,is_published:true,output_kind:i%2?'text':'document'}))];
library[1].author_user_id = 'research-team';
library[1].created_by_user_id = 'research-team';
const legacyCost = {fal_usd:0.3,anthropic_usd:0.005,markup:2,tokens_charged:1260,bill_usd:0.63};
const cost = {pricing_version:2,fal_usd:0,anthropic_usd:0.005,claude_steps_usd:0.005,markup:2,tokens_charged:40,bill_usd:0.02,estimate_notes:[]};
let reviewedPlan=null;
const server = http.createServer(async (req,res) => {
  const url = new URL(req.url,'http://'+req.headers.host);
  const ref = new URL(req.headers.referer || 'http://127.0.0.1:4173');
  const guest = ref.searchParams.has('guest');
  const marketUser=ref.searchParams.has('subscriber')?'market-member':ref.searchParams.has('marketplace_test')?'market-buyer':'ux-test';
  const send = (data,status=200) => {res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
  const events = async frames => {
    res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
    for (const [delay,event,data] of frames) {
      await new Promise(resolve=>setTimeout(resolve,delay));
      if(res.destroyed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
    res.end();
  };
  let raw=''; for await (const chunk of req) raw+=chunk;
  let body={};try{body=JSON.parse(raw);}catch{}
  if(ref.searchParams.has('interpreter_routing') && req.method==='POST') console.log('Routing QA:',url.pathname,body.process_id || body.id || '');
  if(url.pathname==='/api/promptflow/discuss/stream') {
    const answer=body.process_id
      ? 'This workflow summarizes your text into three bullets. Asking about its steps does not change or run it. To change its behavior, describe a specific edit; to execute it, say run it.'
      : 'Describe the output you want so I can help choose the next action.';
    return events([[0,'message_start',{type:'message_start'}],[0,'content_block_start',{type:'content_block_start',index:0,content_block:{type:'text'}}],[300,'content_block_delta',{type:'content_block_delta',index:0,delta:{type:'text_delta',text:answer}}],[0,'message_stop',{type:'message_stop'}]]);
  }
  if(url.pathname==='/auth/me') return send(guest ? {logged_in:false} : {logged_in:true,display_name:'QA account',...await marketplaceStore.marketplaceAccount(marketDb,marketUser)});
  if(url.pathname==='/api/promptflow/marketplace'||url.pathname.startsWith('/api/promptflow/marketplace/')) {
    if(ref.searchParams.has('market_error')) return send({ok:false,message:'Marketplace is temporarily unavailable.'},503);
    const market=await importBackend('promptflow_marketplace.ts');
    const runtime=await import(pathToFileURL(path.join(backendRoot,'src/promptflow_runtime.ts')).href);
    const response=await market.handleMarketplaceRequest(new Request(url,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:raw}:{})}),{
      getAccount:async()=>guest?null:marketplaceStore.marketplaceAccount(marketDb,marketUser),
      buildBundle:p=>runtime.buildPromptflowBundle(p,[],[p]),
      purchase:(...args)=>marketplaceStore.purchaseMarketplace(marketDb,...args),
      install:async(userId,p)=>{const id=await marketplaceStore.installMarketplace(marketDb,userId,p);if(!library.some(p=>p.id===id))library.unshift({...p,id,created_by_user_id:userId,mine:true,editable:true,runnable:true});return id;}
    });
    res.writeHead(response.status,Object.fromEntries(response.headers));return res.end(Buffer.from(await response.arrayBuffer()));
  }
  if(url.pathname==='/api/promptflow/processes') return ref.searchParams.has('library_error') ? send({ok:false,error:'unavailable'},503) : send({ok:true,processes:guest?library.filter(p=>p.is_published||p.is_system).map(p=>({...p,mine:false,editable:false})):library});
  if(url.pathname==='/api/promptflow/process/get') {
    if(req.method!=='POST')return send({ok:false,message:'Use POST to load a workflow.'},405);
    if(guest)return send({ok:false,error:'not_logged_in'},401);
    const process=library.find(p=>p.id===body.id);
    return process?send({ok:true,process}):send({ok:false,error:'not_found'},404);
  }
  if(url.pathname==='/api/promptflow/conversations') return send({ok:true,conversations:[{id:'ux-history',title:'Completed research run',turn_count:1,updated_at:1794344400}],has_more:false});
  if(url.pathname==='/api/promptflow/conversation/get') return send({ok:true,conversation:{id:'ux-history',title:'Completed research run'},turns:[{user_text:'Research holographic displays',plan:{...sample,picked_process_id:sample.id},status:'complete',cost:legacyCost,outputs:[{kind:'text',url:'/api/promptflow/outputs/ux-preview.txt'}],output_kind:'text'}]});
  if(url.pathname==='/api/promptflow/outputs/ux-preview.txt') {res.writeHead(200,{'content-type':'text/plain'});return res.end('- A completed research result.\n- Provider labels should reflect actual usage.\n- Show the result in the conversation.');}
  if(url.pathname==='/api/promptflow/process/quote') return send({ok:true,total_markup_tokens:0,total_bonus_tokens:0,tokens_remaining:5000,compute_estimate:cost});
  if(ref.searchParams.has('marketplace_test') || ref.searchParams.has('subscriber')) {
    if(['/api/promptflow/plan','/api/promptflow/plan/stream'].includes(url.pathname)) {
      const form=await new Response(raw,{headers:{'content-type':req.headers['content-type']}}).formData();
      const p=library.find(p=>p.id===form.get('force_process_id'));
      if(!p)return send({ok:false,message:'Choose a Marketplace workflow first.'},400);
      if(p.input_kinds.includes('image') && !form.get('image'))return send({ok:false,message:'Upload an image first.'},400);
      reviewedPlan={...p,picked_process_id:p.id,run_name:'Marketplace fixture run',requires_confirmation:true,is_text_only:!p.input_kinds.includes('image')};
      const result={ok:true,intent:'run_process',plan_id:'market-fixture',plan:reviewedPlan,cost,outputs:[]};
      if(url.pathname.endsWith('/stream'))return events([[0,'stage',{stage:'reading'}],[300,'done',result]]);
      return send(result);
    }
    if(url.pathname==='/api/promptflow/execute/stream')return events([[0,'heartbeat',{seconds:0}],[400,'done',{ok:true,status:'complete',plan:reviewedPlan,cost,tokens_remaining:5960,outputs:[{kind:'image',url:'/assets/promptflow-marketplace/vr180-guide.png',step_id:'panorama'}]}]]);
    if(url.pathname==='/api/promptflow/status')return send({ok:true,status:'complete',plan:reviewedPlan,cost,outputs:[{kind:'image',url:'/assets/promptflow-marketplace/vr180-guide.png',step_id:'panorama'}]});
  }
  if(ref.searchParams.has('planning_timeout') && url.pathname==='/api/promptflow/plan/stream') {res.writeHead(200,{'content-type':'text/event-stream'});res.write('event: stage\ndata: {"stage":"planning"}\n\n');return;}
  if(ref.searchParams.has('adaptive_run')) {
    if(['/api/promptflow/plan','/api/promptflow/plan/stream'].includes(url.pathname)) {
      const form=await new Response(raw,{headers:{'content-type':req.headers['content-type']}}).formData();
      reviewedPlan={...sample,picked_process_id:sample.id,run_name:form.get('run_name')||'Synthetic summary test',run_instructions:form.get('run_instructions'),max_run_tokens:Number(form.get('max_run_tokens')||0),requires_confirmation:true,
        steps:[{id:'generate_synthetic_input',type:'claude',text_model:form.get('text_model')||'claude-haiku-5-5',user_prompt:'Create synthetic input data'},{id:'summary',type:'claude',text_model:form.get('text_model')||'claude-haiku-5-5',user_prompt:'Summarize the prepared data'}]};
      if(ref.searchParams.has('real_preparation')) {
        const prep=await importBackend('promptflow_run_preparation.ts');
        const controls=await importBackend('promptflow_run_controls.ts');
        const target={process_id:sample.id,name:sample.name,description:sample.description,input_kinds:sample.input_kinds,input_schema:sample.input_kinds,steps:sample.steps};
        reviewedPlan=await prep.prepareRunInputs(target,String(form.get('run_instructions')||form.get('text')||''),{text:''},[],async()=>{throw new Error('This fixture only supports the deterministic sample-data path');});
        reviewedPlan.steps=controls.freezeTextModels(await controls.compileProcessSteps(reviewedPlan.steps,async()=>sample),{ANTHROPIC_STAGE_MODEL:'claude-haiku-5-5'});
      }
      const result=reviewedPlan.max_run_tokens && reviewedPlan.max_run_tokens<cost.tokens_charged ? {ok:false,error:'run_budget_exceeded',message:'This run costs 40 PromptFlow credits; your limit is '+reviewedPlan.max_run_tokens+'.'} : {ok:true,plan_id:'synthetic-adaptive',conversation_id:form.get('conversation_id')||'ux-sample-run',conversation_title:form.get('conversation_id')==='ux-history'?'Completed research run':reviewedPlan.run_name,plan:reviewedPlan,cost,multi_step:true};
      if(url.pathname.endsWith('/stream'))return events([[0,'stage',{stage:form.get('force_process_id')?'reading':'search'}],[800,'stage',{stage:'planning'}],[800,'stage',{stage:'validating'}],[500,'done',result]]);
      return send(result);
    }
    if(url.pathname==='/api/promptflow/execute/stream')return events([[0,'heartbeat',{seconds:0}],[1000,'done',{ok:true,status:'complete',plan:reviewedPlan,cost,tokens_remaining:4960,outputs:[{kind:'text',url:'/api/promptflow/outputs/ux-preview.txt'}]}]]);
    if(url.pathname==='/api/promptflow/status')return send({ok:true,status:'complete',plan:reviewedPlan,cost,tokens_remaining:4960,outputs:[{kind:'text',url:'/api/promptflow/outputs/ux-preview.txt'}]});
    if(url.pathname==='/api/promptflow/status/steps')return send({ok:true,steps:[{step_id:'generate_synthetic_input',type:'claude',status:'complete'},{step_id:'summary',type:'claude',status:'running'}]});
  }
  if(ref.searchParams.has('execution_slow')) {
    if(url.pathname==='/api/promptflow/plan')return send({ok:true,plan_id:'synthetic-run',plan:{...sample,picked_process_id:sample.id},cost});
    if(url.pathname==='/api/promptflow/execute/stream') {
      await new Promise(resolve=>setTimeout(resolve,25000));
      return send({ok:false,error:'plan_already_used',status:'complete'},409);
    }
    if(url.pathname==='/api/promptflow/status/steps')return send({ok:true,steps:[{step_id:'summary',type:'claude',status:'running'}]});
    if(url.pathname==='/api/promptflow/status')return send({ok:true,status:'complete',plan:sample,cost,tokens_remaining:4960,outputs:[{kind:'text',url:'/api/promptflow/outputs/ux-preview.txt'}],output_kind:'text'});
  }
  if(url.pathname==='/api/promptflow/plan/compose') return events([
    [150,'phase',{phase:'rerank'}],
    [600,'no_match',{reasoning:'Synthetic catalog decision; internal narrative must not appear.'}],
    [0,'done',{}],
  ]);
  if(url.pathname==='/api/promptflow/plan/stream') {
    sample.is_draft = true;
    const delay=ref.searchParams.has('generation_slow')?8000:1500;
    const frames=[
      [0,'stage',{stage:'planning'}],
      [delay,'thinking',{text:'PRIVATE_MODEL_NARRATIVE: this must never be rendered in the UI.'}],
      [delay,'heartbeat',{seconds:3}],
    ];
    if(ref.searchParams.has('generation_error'))frames.push([delay,'error',{message:'The generation service is temporarily unavailable. Please try again.'}]);
    else if(!ref.searchParams.has('generation_disconnect'))frames.push([delay,'done',{ok:true,intent:'design_process',process:{...sample,is_draft:true},message:'Draft created.'}]);
    return events(frames);
  }
  if(url.pathname==='/api/promptflow/process/refine')return send({ok:true,process:{...sample,description:'Updated summary process: concise and ready to review.'},rationale:'Updated the description.'});
  if(url.pathname==='/api/promptflow/process/refine/stream')return events([
    [0,'stage',{stage:'reading'}],
    [1200,'stage',{stage:'editing'}],
    [1200,'stage',{stage:'reasoning'}],
    [1200,'stage',{stage:'validating'}],
    [500,'stage',{stage:'saving'}],
    [400,'done',{ok:true,process:{...sample,description:'Updated summary process: concise and ready to review.'},rationale:'Updated the description.'}],
  ]);
  if(url.pathname==='/api/promptflow/process/commit_draft'){sample.is_draft=false;return send({ok:true});}
  if(url.pathname==='/api/promptflow/plan') return send({ok:false,message:'Preview only: execution is disabled. No tokens were charged.'},503);
  if(url.pathname==='/api/promptflow/graph/data') return send({ok:true,nodes:library.slice(1,3).map(p=>({id:'process:'+p.id,type:'process',label:p.name,meta:p,stats:{runs:2}})),edges:[]});
  if(url.pathname==='/api/promptflow/search') return send({ok:true,result:{picks:[{process_id:'ux-published',description:'Research',output_kind:'multi',relevance_reason:'Matches your research request.'}],meta:{shortlist_candidates:[{process_id:sample.id,name:sample.name,cosine:0.8},{process_id:'ux-published',name:'Research Paper Web Search',cosine:0.7}]}}});
  if(url.pathname.includes('/agents/')||url.pathname.includes('/cron/')) return send({ok:false,error:'not_available'},404);
  if(url.pathname.startsWith('/api/')) return send({ok:true,settings:{},preferences:[],secrets:[],recipes:[],api_keys:[],compositions:[],suggestions:[],items:[],cost});
  if(url.pathname==='/promptflow'||url.pathname==='/promptflow.html'||url.pathname==='/'||url.pathname==='/promptflow_learn_more.html') {
    let html=await readFile(path.join(root,url.pathname==='/promptflow_learn_more.html'?'promptflow_learn_more.html':'promptflow.html'),'utf8');
    if(url.searchParams.has('planning_timeout')) html=html.replaceAll('AbortSignal.timeout(180000)','AbortSignal.timeout(1500)').replace('armBusyWatchdog(3 * 60_000)','armBusyWatchdog(1500)');
    html=html.replace('<body','<body data-ux-preview="true"');
    html=html.replaceAll('https://github.com/PotentiallyARobot/MissingLink/raw/main/promptflow-cli.zip','/promptflow-cli.zip');
    html=html.replace('</head>','<style>body::after{content:"LOCAL QA · SYNTHETIC DATA · NO PRODUCTION WRITES";position:fixed;top:0;left:0;padding:4px 10px;background:#19362b;color:#ceffe2;z-index:999999;font:11px monospace;pointer-events:none}</style></head>');
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});return res.end(html);
  }
  // Only serve public image assets used by this page; never repository files.
  if(['/assets/promptflow-marketplace.css','/assets/promptflow-marketplace.js'].includes(url.pathname)) {
    res.writeHead(200,{'content-type':url.pathname.endsWith('.css')?'text/css':'text/javascript'});return res.end(await readFile(path.join(root,url.pathname)));
  }
  if(url.pathname==='/promptflow-cli.zip') {res.writeHead(200,{'content-type':'application/zip','content-disposition':'attachment; filename="promptflow-cli.zip"'});return res.end(await readFile(path.join(root,'promptflow-cli.zip')));}
  if(url.pathname==='/examples/text-summary.promptflow') {res.writeHead(200,{'content-type':'application/x-promptflow'});return res.end(await readFile(path.join(root,'examples/text-summary.promptflow')));}
  const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(root+path.sep)||! /\.(png|jpg|jpeg|webp|svg|ico)$/.test(file)) return send({ok:false},404);
  try{const bytes=await readFile(file);res.writeHead(200,{'content-type':file.endsWith('.svg')?'image/svg+xml':`image/${path.extname(file).slice(1)}`});res.end(bytes);}catch{send({ok:false},404);}
});
server.listen(Number(process.env.PORT || 4173),'127.0.0.1',()=>console.log('Promptflow synthetic QA: http://127.0.0.1:'+ (process.env.PORT || 4173) +'/promptflow'));
