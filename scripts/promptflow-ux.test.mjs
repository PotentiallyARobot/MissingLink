import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../promptflow.html',import.meta.url),'utf8');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(s=>s.trim());
test('every inline script parses',()=>{for(const source of scripts)new vm.Script(source);});
const extract=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));

test('a run form hides the home screen even without a preceding user message',()=>{
  const empty={id:'empty',style:{display:''}},history={id:'history'};
  let children=[empty,history],graphVisible=true;
  history.remove=()=>{children=children.filter(el=>el!==history);};
  const stream={scrollTop:0,scrollHeight:80,querySelectorAll:()=>[...children],appendChild(el){
    assert.equal(empty.style.display,'none','Home must be hidden before the card is appended');
    assert.equal(graphVisible,false);children.push(el);
  }};
  const c=vm.createContext({empty,stream,setHeroGraphVisible:v=>{graphVisible=v;},setConversationTitle(){},document:{createElement(){
    const body={},el={querySelector:()=>body};el.remove=()=>{children=children.filter(x=>x!==el);};return el;
  }}});
  vm.runInContext(extract('  function addAssistMsg()', '  // ── Streaming discuss answer')+
    extract('  function clearStream()', '  // The composer placeholder')+'\nglobalThis.open=addAssistMsg;globalThis.home=clearStream;',c);
  const first=c.open();assert.ok(children.includes(first.el));assert.ok(children.includes(history));
  c.home();assert.deepEqual(children,[empty]);assert.equal(empty.style.display,'');assert.equal(graphVisible,true);
  c.open();assert.equal(empty.style.display,'none');assert.equal(graphVisible,false);assert.equal(children.length,2);
});

function marketplaceLauncher(response, overrides={}) {
  const events=[], alerts=[], requests=[];
  const context=vm.createContext({
    busy:false,_planInFlight:false,_sendInProgress:false,ME:{id:'member'},
    currentEditorProcessId:'previous',currentEditorProcess:{id:'previous'},currentAbortController:null,
    currentConversationId:null,currentRunCancellable:true,refineBoundProcessId:null,refineBoundProcessName:null,
    window:{PFMarketplace:{close:()=>events.push('close')}},
    showFullScreenLoader(){},hideFullScreenLoader(){},paintRefineBindChip(){},paintEditorDoneRow(){},
    paintConversationList(){},paintProcessList(){},paintEditor(){},updateComposerHint(){},updateSend(){},
    openAuth:()=>events.push('auth'),alert:message=>alerts.push(message),console,
    openRunCard:process=>events.push(process),
    fetch:async(url,options)=>{
      requests.push({url,options});
      // Production only supports POST with the process id in its JSON body.
      assert.equal(url,'/api/promptflow/process/get');
      assert.equal(options?.method,'POST');
      assert.equal(JSON.parse(options.body).id,'panorama');
      return response.clone();
    },...overrides
  });
  vm.runInContext(
    extract('  async function openProcessEditor(', '  function closeProcessEditor(')+
    extract('  function runProcessFromEditor(', '  function paintEditor(')+
    extract('  window.openMarketplaceWorkflow =', '  window.startNewConversation ='),context);
  return {context,events,alerts,requests};
}

test('Marketplace loads its private process via POST and opens its image collector',async()=>{
  const {context,events,alerts,requests}=marketplaceLauncher(Response.json({ok:true,process:{id:'panorama',name:'Image to 180° Equirectangular',mine:true,editable:true,input_kinds:['image'],steps:[]}}));
  await context.window.openMarketplaceWorkflow('panorama');
  assert.equal(requests.length,1);
  assert.deepEqual(alerts,[]);
  assert.equal(events[0],'close');
  assert.equal(events[1].id,'panorama');
  assert.equal(events[1].input_kinds[0],'image');
  assert.equal(context.currentEditorProcessId,'panorama');
});

test('Marketplace never starts a stale process after load failure or during another action',async()=>{
  for(const response of [new Response('<!DOCTYPE html><html>Not found</html>',{status:404}),Response.json({ok:false,error:'not_found'},{status:404}),Response.json({ok:false},{status:401})]) {
    const {context,events}=marketplaceLauncher(response);
    await assert.rejects(context.window.openMarketplaceWorkflow('panorama'),/Could not open this workflow/);
    assert.equal(context.currentEditorProcessId,'previous');
    assert.ok(events.every(event=>event==='auth'));
  }
  const {context,events,requests}=marketplaceLauncher(Response.json({}),{busy:true});
  await assert.rejects(context.window.openMarketplaceWorkflow('panorama'),/Finish the current action/);
  assert.equal(requests.length,0);assert.equal(events.length,0);
});

test('interpreter distinguishes questions, edits, runs and ambiguous follow-ups',()=>{
  const context=vm.createContext({});
  vm.runInContext(extract('  function interpreterMessageIntent(', '  function activeInterpreterProcess(')+'\nglobalThis.intent=interpreterMessageIntent;',context);
  for(const text of ['genreate','generate','I want you to generate this','please do it','make it better','retry']) assert.equal(context.intent(text),'clarify',text);
  for(const text of ['Why did this fail?','Can this generate synthetic input data?','What if we add web search?','Do not change this process','Could you explain these steps?']) assert.equal(context.intent(text),'discuss',text);
  for(const text of ['Run it but generate synthetic data first','Can you run it?','Generate five synthetic input records first']) assert.equal(context.intent(text),'run',text);
  for(const text of ['Add a web search step','Can you change the output to JSON?','Change this process to generate synthetic data first']) assert.equal(context.intent(text),'edit',text);
  assert.equal(context.intent('Build a new workflow for summarizing invoices'),'create');
  assert.equal(context.intent('try again',true),'retry');
  assert.equal(context.intent('you needed to get the information on the headquarters also this should have been a much more specific process you should have first looked for all the companies with ai agent products in texas',true),'edit');
  assert.equal(context.intent('Why should you have searched Texas first?',true),'discuss');
  assert.equal(context.intent('Do not change the headquarters step',true),'discuss');
});

test('open workflow messages only call refinement for a specific edit',async()=>{
  for(const [message,expected] of [['Why did this fail?','discuss'],['hello','discuss'],['Can this generate synthetic data?','discuss'],['Can you add a search step?','edit'],['Run it but generate synthetic input first','run']]) {
    const calls=[];
    const c=vm.createContext({userText:message,window:{},currentEditorProcessId:'chosen',currentEditorProcess:{id:'chosen',name:'Selected',editable:true},refineBoundProcessId:'chosen',refineBoundProcessName:'Selected',interpreterProcessContext:null,attachedFiles:[],processesCache:[],textInput:{value:message,style:{}},stream:{querySelector:()=>null},updateSend(){},paintRefineBindChip(){},paintEditorDoneRow(){},paintProcessList(){},updateComposerHint(){},streamDiscussAnswer:async(t,p)=>calls.push(['discuss',t,p.id]),refineBoundProcess:async t=>calls.push(['edit',t])});
    Object.assign(c,{AbortSignal,setStatus(){},addAssistMsg:()=>({el:{remove(){}}}),buildConversationHistoryForRefine:()=>[],fetch:async()=>({ok:true,json:async()=>({ok:true,intent:'discuss'})}),setError:(_a,error)=>assert.fail(error)});
    vm.runInContext(extract('  function interpreterMessageIntent(', '  function clarifyInterpreterMessage(')+ '\nglobalThis.route=async()=>{'+extract('    // An open process supplies context', '    // Classify attachments.')+'};',c);
    await c.route();
    if(expected==='run') {assert.equal(c.window._forceRunProcessId,'chosen');assert.equal(c.window._pendingRunOptions.run_instructions,message);assert.equal(calls.length,0);}
    else {assert.equal(calls.length,1);assert.equal(calls[0][0],expected,message);}
  }
});

test('retry reopens the selected workflow with prior inputs and never executes it',async()=>{
  const inputs={supplied_text:'Texas companies and headquarters',run_name:'Research',run_instructions:'Use primary sources',files:[{kind:'image',name:'reference.png'}]};
  const calls=[];
  const c=vm.createContext({AbortSignal,interpreterProcessContext:{id:'marketplace-research-brief',runOptions:inputs},textInput:{value:'try again',style:{}},
    addUserMsg:t=>calls.push(['message',t]),addAssistMsg:()=>({el:{remove(){}}}),setStatus(){},updateSend(){},
    fetch:async(url,options)=>{calls.push(['fetch',url,JSON.parse(options.body)]);return {ok:true,json:async()=>({ok:true,process:{id:'marketplace-research-brief'}})};},
    openRunCard:async(p,i)=>calls.push(['review',p,i]),setError:(_a,e)=>assert.fail(e)});
  vm.runInContext(extract('  async function reviewPreviousRun(', '  function runUsesSelectedProcess(')+'\nglobalThis.retry=reviewPreviousRun;',c);
  await c.retry('try again',{id:'marketplace-research-brief'});
  assert.equal(calls[1][1],'/api/promptflow/process/get');assert.equal(calls[2][0],'review');assert.equal(calls[2][2],inputs);assert.equal(c.busy,false);
});

test('clearing a chat requires confirmation and deletes only its conversation record',async()=>{
  for(const confirmed of [false,true]) {
    const calls=[];
    const c=vm.createContext({busy:false,_planInFlight:false,_sendInProgress:false,currentConversationId:'chat',currentConversationTitle:'Research',conversationsCache:[{id:'chat'},{id:'keep'}],
      pfConfirm:async()=>confirmed,updateSend(){},paintAttach(){},fileInput:{value:''},textInput:{value:'unfinished'},window:{},
      startNewConversation:()=>calls.push('new'),refreshConversations:()=>calls.push('refresh'),
      fetch:async(url,options)=>{calls.push([url,JSON.parse(options.body)]);return {ok:true,json:async()=>({ok:true})};},setError:(_a,e)=>assert.fail(e)});
    vm.runInContext(extract('  async function clearConversation(', "  document.getElementById('clearConversationBtn')")+'\nglobalThis.clear=clearConversation;',c);
    await c.clear();
    if(!confirmed)assert.deepEqual(calls,[]);
    else {assert.deepEqual(calls[0],['/api/promptflow/conversation/delete',{id:'chat'}]);assert.equal(calls[1],'new');assert.equal(c.conversationsCache.length,1);assert.equal(c.conversationsCache[0].id,'keep');assert.equal(c.textInput.value,'');}
  }
});

test('a catalog adaptation binds to its private copy and displays the revised steps',async()=>{
  const element=()=>({children:[],appendChild(e){this.children.push(e);}}),body=element(),calls=[];
  const process={id:'private-copy',name:'Texas research',steps:[{name:'Discover companies'},{name:'Verify headquarters'}]};
  const c=vm.createContext({refineBoundProcessId:'marketplace-research-brief',currentConversationId:'chat',currentEditorProcessId:null,processesCache:[],interpreterProcessContext:{runOptions:{supplied_text:'Original brief'}},
    document:{createElement:element},addUserMsg(){},addAssistMsg:()=>({body}),setStatus(){},clearStatus(){},updateSend(){},paintProcessList(){},paintRefineBindChip(){},updateComposerHint(){},
    buildConversationHistoryForRefine:()=>[],requestProcessRefinement:async p=>{assert.equal(p.conversation_id,'chat');return {ok:true,copied:true,process,rationale:'Added evidence checks.'};},
    renderProcessCard:(_a,p)=>calls.push(p.id),setError:(_a,e)=>assert.fail(e),openRunCard:(p,o)=>calls.push([p.id,o.supplied_text])});
  vm.runInContext(extract('  async function refineBoundProcess(', '  // ── Graph view')+'\nglobalThis.edit=refineBoundProcess;',c);
  await c.edit('you needed to verify headquarters');
  assert.equal(c.refineBoundProcessId,'private-copy');assert.equal(c.interpreterProcessContext.id,'private-copy');assert.equal(c.processesCache[0].id,'private-copy');
  assert.deepEqual(body.children.find(e=>e.className==='updated-workflow-steps').children.map(e=>e.textContent),['Discover companies','Verify headquarters']);
  body.children.find(e=>e.textContent==='Review updated run').onclick();assert.deepEqual(calls.at(-1),['private-copy','Original brief']);
});

test('read-only discussion carries workflow context and stops at the terminal event',async()=>{
  const element=()=>({style:{},textContent:'',innerHTML:'',appendChild(){},querySelector(){return element();}});
  let request,canceled=false;
  const c=vm.createContext({AbortController,AbortSignal,TextDecoder,document:{createElement:element},textInput:{value:'Why?',style:{}},stream:{scrollHeight:0},currentConversationId:null,buildConversationHistoryForRefine:()=>[{role:'assistant',content:'The workflow needs input text.'}],addUserMsg(){},addAssistMsg:()=>({body:element()}),updateSend(){},setError:(_a,e)=>assert.fail(e),fetch:async(_url,options)=>{
    request=JSON.parse(options.body);
    return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"This workflow summarizes text."}}\n\ndata: {"type":"message_stop"}\n\n'));},cancel(){canceled=true;}}));
  }});
  vm.runInContext(extract('  async function streamDiscussAnswer(', '  // Generation progress follows server events.')+'\nglobalThis.discuss=streamDiscussAnswer;',c);
  await c.discuss('Why does it need text?',{id:'selected',name:'Summary'});
  assert.equal(request.process_id,'selected');assert.equal(request.text,'Why does it need text?');assert.equal(canceled,true);assert.equal(c.busy,false);
  assert.equal(request.conversation_history[0].content,'The workflow needs input text.');
});

test('an explicitly named different run is not forced onto the open workflow',()=>{
  const c=vm.createContext({});
  vm.runInContext(extract('  function runUsesSelectedProcess(', '  function clarifyInterpreterMessage(')+'\nglobalThis.matches=runUsesSelectedProcess;',c);
  assert.equal(c.matches('Run it with synthetic input',{name:'Summary'}),true);
  assert.equal(c.matches('Can you run Summary with this data?',{name:'Summary'}),true);
  assert.equal(c.matches('Run "Research Paper Web Search" for holographic TV',{name:'Summary'}),false);
});

test('named run review shows preparation, nested text models and a credit cap without raw HTML',()=>{
  const card={innerHTML:''};
  const context=vm.createContext({document:{createElement:()=>card},escapeHtml:s=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;')});
  vm.runInContext(extract('  function renderRunReview(', '  function renderEditablePlan(')+'\nglobalThis.review=renderRunReview;',context);
  const api=context.review({body:{appendChild(){}}},{run_name:'Synthetic <img>',run_instructions:'Research then generate input',max_run_tokens:100,steps:[{type:'loop',body:[{type:'claude',text_model:'claude-haiku-5-5'}]}]});
  assert.match(card.innerHTML,/Synthetic &lt;img&gt;/);assert.match(card.innerHTML,/Research then generate input/);assert.match(card.innerHTML,/claude-haiku-5-5/);assert.match(card.innerHTML,/100 PromptFlow credits/);
  assert.equal(Object.keys(api.getOverrides()).length,0);
});
function render(cost,status,completedCost){
  const card={innerHTML:''};
  const context=vm.createContext({document:{createElement:()=>card},escapeHtml:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))});
  vm.runInContext(extract('  function renderCost(', '  function prettyModel(')+'\nglobalThis.render = renderCost;',context);
  const api=context.render({body:{appendChild(){}}},cost,{status});
  if(completedCost)api.update(completedCost,{status:'complete'});
  return card.innerHTML;
}
test('unconfirmed quote never says Charged or fabricates a fal provider',()=>{
  const markup=render({pricing_version:2,anthropic_usd:0.005,claude_steps_usd:0.005,tokens_charged:40,bill_usd:0.02,markup:2},'pending');
  assert.match(markup,/Estimated cost/);assert.doesNotMatch(markup,/Charged|fal.ai/);
});

test('OpenAI image quote displays its provider calculation before confirmation',()=>{
  const markup=render({pricing_version:3,openai_images_usd:0.090448,tokens_charged:362,bill_usd:0.1809,markup:2},'pending');
  assert.match(markup,/OpenAI images estimate/);assert.match(markup,/362 tokens/);
  assert.doesNotMatch(markup,/fal.ai|Charged/);
});

test('only account-protected PromptFlow files receive the private output label',()=>{
  for(const [url,expected] of [['https://missinglink.build/api/promptflow/image/test.png',true],['https://example.test/api/promptflow/image/test.png',false]]) {
    const notes=[];const body={querySelector:()=>null,appendChild:node=>notes.push(node)};
    const c=vm.createContext({URL,location:{origin:'https://missinglink.build'},document:{createElement:()=>({style:{}})},renderSingleImage(){}});
    vm.runInContext(extract('  function renderOutputs(', '  // Lazy-load model-viewer')+';globalThis.render=renderOutputs;',c);
    c.render({body},[{url}],'image');assert.equal(notes.length,expected?1:0);
    if(expected)assert.match(notes[0].textContent,/only accessible to your account/);
  }
});

test('late folder responses cannot replace the folder opened afterwards',async()=>{
  const pending=[],paint=[];
  const c=vm.createContext({_dFolderLoadVersion:0,_dFolderActive:'processes',_dFolderItems:{},window:{},
    dFetchJson:()=>new Promise(resolve=>pending.push(resolve)),dMapProcess:p=>p,dMapConversation:p=>p,
    dRenderFolderItems:(items)=>paint.push(items),D:()=>({value:''}),dEsc:s=>s});
  vm.runInContext(extract('  async function dLoadFolderItems(', '  function dRenderFolderItems(')+';globalThis.load=dLoadFolderItems;',c);
  const old=c.load('processes');c._dFolderActive='chats';const current=c.load('chats');
  pending[1]({conversations:[{name:'New chat'}]});await current;
  pending[0]({processes:[{name:'Old process'}]});await old;
  assert.equal(paint.length,1);assert.equal(paint[0][0].name,'New chat');
  assert.equal(c._dFolderItems.processes[0].name,'Old process');
});
test('historical totals survive without repeating unverified legacy provider labels',()=>{
  const markup=render({fal_usd:0.3,tokens_charged:1260,bill_usd:0.63},'complete');
  assert.match(markup,/Charged/);assert.match(markup,/1,260/);assert.match(markup,/Legacy cost record/);assert.doesNotMatch(markup,/fal.ai/);
});

test('completion replaces the estimate with the server-reported charge',()=>{
  const markup=render({pricing_version:2,tokens_charged:40,bill_usd:0.02},'pending',
    {pricing_version:2,tokens_charged:60,bill_usd:0.03});
  assert.match(markup,/Charged/);assert.match(markup,/60 tokens/);assert.doesNotMatch(markup,/40 tokens|Estimated cost/);
});
test('cost notes are text and missing numeric fields do not crash rendering',()=>{
  const markup=render({pricing_version:2,estimate_notes:['<img src=x onerror=alert(1)>']},'failed');
  assert.match(markup,/&lt;img/);assert.doesNotMatch(markup,/<img/);assert.match(markup,/0 tokens/);
});
test('editor Run opens the input collector and never dispatches an edit',()=>{
  let collected=null;
  const context=vm.createContext({busy:false,_planInFlight:false,_sendInProgress:false,openRunCard:p=>collected=p,alert:()=>{},send:()=>assert.fail('Run must not call send before inputs')});
  const functions=[...html.matchAll(/function runProcessFromEditor\(/g)];assert.equal(functions.length,1);
  vm.runInContext(extract('  function runProcessFromEditor(', '  function paintEditor(')+'\nglobalThis.run = runProcessFromEditor;',context);
  context.run({id:'test',name:'Test process'});assert.equal(collected.id,'test');
});

test('run inputs follow executable references rather than unused Python scaffolding',()=>{
  const context=vm.createContext({});
  vm.runInContext(extract('  function reconcileInputKinds(', '  // Normalize ownership')+'\nglobalThis.reconcile=reconcileInputKinds;',context);
  const kinds=p=>Array.from(context.reconcile(p).kinds);
  assert.deepEqual(kinds({input_kinds:['text'],python_text:'INPUT_IMAGE_URL = "<INPUT_IMAGE_URL>"; INPUT_VIDEO_URL; UPLOADED_AUDIO_URL',sample_inputs:{image:'<INPUT_IMAGE_URL>'},steps:[{type:'recipe',recipe_id:'gpt_image_2',params:{prompt:'{{user_text}}'}},{type:'recipe',recipe_id:'assemble_document',params:{image_url:'{{art.image_url}}'}}]}),['text']);
  assert.deepEqual(kinds({input_kinds:['text'],steps:[{type:'loop',body:[{params:{image_url:'{{INPUT_IMAGE_URL}}',text:'{{user_text}}'}}]}]}),['image','text']);
  assert.deepEqual(kinds({input_kinds:['image','text'],steps:[{params:{prompt:'{{user_text}}'}}]}),['image','text']);
  assert.deepEqual(kinds({python_text:'image = "<INPUT_IMAGE_URL>"'}),['image']);
});

test('execution recovery follows the same plan without replaying paid work',async()=>{
  for (const response of [
    {status:409,json:async()=>({ok:false,error:'plan_already_used'})},
    {status:504},
    new Error('connection lost'),
  ]) {
    const calls=[];
    const context=vm.createContext({fetch:async(url,options)=>{calls.push([url,JSON.parse(options.body)]);if(response instanceof Error)throw response;return response;}});
    vm.runInContext(extract('  async function requestProcessExecution(', '  function executionActivityLabel(')+'\nglobalThis.begin=requestProcessExecution;',context);
    const result=await context.begin('same-plan',null,{aborted:false});
    assert.equal(result.reconnecting,true);
    assert.deepEqual(calls,[['/api/promptflow/execute/stream',{plan_id:'same-plan'}]]);
  }
  const context=vm.createContext({fetch:async()=>({status:400,json:async()=>({ok:false,error:'input_image_missing'})})});
  vm.runInContext(extract('  async function requestProcessExecution(', '  function executionActivityLabel(')+'\nglobalThis.begin=requestProcessExecution;',context);
  assert.equal((await context.begin('plan',null,{})).error,'input_image_missing');
});

test('execution activity names observed steps without exposing prompts',()=>{
  const context=vm.createContext({});
  vm.runInContext(extract('  function executionActivityLabel(', '  // Read-only progress')+'\nglobalThis.label=executionActivityLabel;',context);
  const steps=[{id:'research',recipe_id:'brave_web_search'},{id:'art',recipe_id:'gpt_image_2',prompt:'PRIVATE PROMPT'},{id:'review',type:'claude'},{id:'doc',recipe_id:'assemble_document'}];
  assert.equal(context.label([{step_id:'art',status:'running'}],steps),'Generating an image with OpenAI · Step 2 of 4');
  assert.match(context.label([{step_id:'review',status:'running'}],steps),/Writing or reviewing text/);
  assert.match(context.label([{step_id:'doc',status:'running'}],steps),/Assembling the document/);
});

test('execution consumes its streamed result and preserves input failures',async()=>{
  const context=vm.createContext({TextDecoder,Uint8Array,fetch:async()=>new Response('event: heartbeat\ndata: {}\n\nevent: done\ndata: {"ok":false,"error":"input_image_missing"}\n\n',{headers:{'content-type':'text/event-stream'}})});
  vm.runInContext(extract('  async function readGenerationStream(', '  function executionActivityLabel(')+'\nglobalThis.begin=requestProcessExecution;',context);
  assert.equal((await context.begin('plan',null,{})).error,'input_image_missing');
});

test('stopped execution observers cannot repaint after a late response',async()=>{
  let deliver,scheduled=0;
  const node={textContent:'',setAttribute(){},remove(){this.removed=true;}};
  const context=vm.createContext({AbortController,Date,document:{createElement:()=>node},setTimeout:()=>scheduled++,clearTimeout(){},fetch:()=>new Promise(resolve=>deliver=resolve)});
  vm.runInContext(extract('  function executionActivityLabel(', '  function setStatus(')+'\nglobalThis.watch=watchExecutionActivity;',context);
  const stop=context.watch({body:{appendChild(){}}},'plan',[]);
  stop();
  deliver({json:async()=>({ok:true,steps:[]})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(node.removed,true);assert.equal(scheduled,0);
  assert.equal(node.textContent,'Checking execution progress…');
});

test('late discovery responses cannot replace the newest search',async()=>{
  const elements=new Map();
  const D=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',value:''});return elements.get(id);};
  const requests=[];
  const context=vm.createContext({AbortController,AbortSignal,D,dEsc:String,
    fetch:(url,options)=>new Promise(resolve=>requests.push({url,options,resolve})),
    dPgRender:()=>{},
  });
  vm.runInContext('let _dPgRequest=0, _dPgController=null, _dPgAllItems=[], _dPgItems=[];'+
    extract('  async function dPgFetch(', '  function dPgRender(')+
    '\nglobalThis.search=dPgFetch; globalThis.items=()=>_dPgItems;',context);
  const old=context.search('');
  const newest=context.search('');
  assert.equal(requests[0].options.signal.aborted,true);
  const response=name=>({ok:true,text:async()=>JSON.stringify({ok:true,nodes:[
    {type:'process',id:name,label:name,meta:{is_published:true,is_system:false}},
    {type:'process',id:'system',label:'Internal',meta:{is_published:true,is_system:true}},
    {type:'process',id:'private',label:'Private',meta:{is_published:false,is_system:false}},
  ],edges:[]})});
  requests[1].resolve(response('newest'));await newest;
  requests[0].resolve(response('stale'));await old;
  assert.equal(context.items()[0].node.label,'newest');
  assert.equal(context.items().length,1);
});

test('opening a conversation clears the previous process refinement target',async()=>{
  const context=vm.createContext({busy:false,loadingConvoId:null,fetch:async()=>({json:async()=>({ok:true,turns:[]})}),
    currentEditorProcessId:'old-process',currentEditorProcess:{id:'old-process'},currentGraphProcessId:'old-process',
    refineBoundProcessId:'old-process',refineBoundProcessName:'Old process',
    empty:{style:{}},stream:{scrollHeight:0},
    ...Object.fromEntries(['paintConversationList','showStreamLoadingOverlay','hideStreamLoadingOverlay','paintRefineBindChip','paintEditorDoneRow','clearStream','setConversationTitle','titleFromRequest','setHeroGraphVisible','renderHistoricalTurn','paintProcessList','updateComposerHint','updateSend'].map(k=>[k,()=>{}])),
  });
  vm.runInContext(extract('  async function loadConversation(', '  // Stream-level loading overlay')+'\nglobalThis.open=loadConversation;',context);
  await context.open('different-chat');
  assert.equal(context.refineBoundProcessId,null);assert.equal(context.currentEditorProcessId,null);
  assert.equal(context.refineBoundProcessName,null);assert.equal(context.currentConversationId,'different-chat');
});

const streamContext=vm.createContext({TextDecoder,Uint8Array});
vm.runInContext(extract('  async function readGenerationStream(', '  function setStatus(')+'\nglobalThis.read=readGenerationStream;',streamContext);
const streamResponse=chunks=>new Response(new ReadableStream({start(controller){
  for(const chunk of chunks)controller.enqueue(new TextEncoder().encode(chunk));controller.close();
}}),{headers:{'content-type':'text/event-stream'}});

test('generation parses chunked events and never forwards internal narrative',async()=>{
  const events=[];
  const response=streamResponse(['event: stage\r\ndata: {"stage":"planning"}\r','\n\r\nevent: think',
    'ing\ndata: {"text":"PRIVATE NARRATIVE"}\n\nevent: done\ndata: {"ok":true,\n',
    'data: "intent":"design_process"}\n\n']);
  const result=await streamContext.read(response,(event,data)=>events.push([event,data]));
  assert.equal(result.ok,true);assert.equal(result.intent,'design_process');
  assert.deepEqual(JSON.parse(JSON.stringify(events)),[['stage',{stage:'planning'}],['thinking',{}]]);
});

test('generation distinguishes interrupted streams from successful completion',async()=>{
  await assert.rejects(streamContext.read(streamResponse(['event: heartbeat\ndata: {}\n\n']),()=>{}),/connection ended before the process was ready/);
});

test('generation surfaces a server failure without waiting forever for done',async()=>{
  await assert.rejects(streamContext.read(streamResponse(['event: error\ndata: {"message":"Temporarily unavailable"}\n\n']),()=>{}),/Temporarily unavailable/);
});

test('generation returns on a terminal event even when the server keeps the connection open',async()=>{
  let canceled=false;
  const response=new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('event: done\ndata: {"ok":true}\n\n'));},cancel(){canceled=true;}}));
  assert.equal((await streamContext.read(response,()=>{})).ok,true);assert.equal(canceled,true);
});

test('a delayed rotating example cannot overwrite the process edit instructions',()=>{
  let scheduled;
  const ti={value:'',dataset:{mode:'new'},placeholder:'Original example'};
  const context=vm.createContext({paused:false,ti,idx:0,placeholders:[{command:'Generate',rest:' something'},{command:'Run',rest:' something'}],
    overlay:{classList:{add(){},remove(){}}},renderOverlay(){},setTimeout:callback=>{scheduled=callback;}});
  vm.runInContext(extract('    function applyNext() {','    // Initial render of the first placeholder')+'\nglobalThis.rotate=applyNext;',context);
  context.rotate();
  ti.dataset.mode='edit';ti.placeholder='Describe a change to this process';scheduled();
  assert.equal(ti.placeholder,'Describe a change to this process');
  scheduled=null;context.rotate();assert.equal(scheduled,null);
});


test('conversation title uses text safely, survives rename and clears for a new chat',()=>{
  const label={};const doc={getElementById:()=>label,title:''};
  const c=vm.createContext({document:doc,window:{},currentConversationId:'chat',currentConversationTitle:''});
  vm.runInContext(extract('  function setConversationTitle(', '  function startNewConversation(')+'\nglobalThis.title=setConversationTitle;globalThis.fromRequest=titleFromRequest;',c);
  assert.equal(c.fromRequest('use a process with some test data and show me it running'),'Sample process run');
  c.title('<img src=x>');assert.equal(label.textContent,'<img src=x>');assert.equal(label.innerHTML,undefined);
  c.window.updateActiveConversationTitle('other','Wrong chat');assert.equal(label.textContent,'<img src=x>');
  c.window.updateActiveConversationTitle('chat','Search policy test');assert.equal(doc.title,'Search policy test · PromptFlow');
  c.title('');assert.equal(label.hidden,true);
});

test('hidden desktop hero creates no animation work',()=>{
  let frames=0,cleared=0;
  const c=vm.createContext({$:()=>({getClientRects:()=>[]}),_heroGraphTimer:1,clearInterval:()=>cleared++,requestAnimationFrame:()=>frames++,document:{hidden:false},window:{matchMedia:()=>({matches:false})}});
  vm.runInContext(extract('  function initHeroGraph(', '  function buildHeroGraph(')+'\nglobalThis.init=initHeroGraph;',c);
  c.init();assert.equal(cleared,1);assert.equal(frames,0);assert.equal(c._heroGraphTimer,null);
});

test('graph dragging is scoped to its stage and stops after pointer capture is lost',()=>{
  const events={};let updates=0,captures=0;
  const c=vm.createContext({stageWrap:{style:{},addEventListener:(name,fn)=>events[name]=fn,setPointerCapture:()=>captures++},panX:0,panY:0,startX:0,startY:0,basePanX:0,basePanY:0,dragging:false,applyXform:()=>updates++});
  vm.runInContext(extract('    // Mouse drag → pan.', '    // Wheel — trackpad'),c);
  const event={button:0,pointerId:1,clientX:5,clientY:5,target:{closest:()=>false},preventDefault(){}};
  events.pointerdown(event);events.pointermove({...event,clientX:10});assert.equal(captures,1);assert.equal(c.panX,5);assert.equal(updates,1);
  events.lostpointercapture();events.pointermove({...event,clientX:50});assert.equal(updates,1);assert.equal(c.dragging,false);
});


test('planning watchdog aborts the exact request instead of leaving a zombie spinner',()=>{
  const first=new AbortController();let fire;
  const c=vm.createContext({DOMException,console:{warn(){}},setTimeout:fn=>{fire=fn;return 1;},clearTimeout(){},_busyWatchdog:null,currentAbortController:first,currentRunCancellable:true,busy:true,_planInFlight:true,_sendInProgress:false,updateSend(){}});
  vm.runInContext(extract('  function armBusyWatchdog(', '  // Stop-generation infrastructure.')+'\nglobalThis.arm=armBusyWatchdog;',c);
  c.arm();fire();assert.equal(first.signal.reason.name,'TimeoutError');
  assert.equal(c.busy,true); // the aborted fetch owns terminal rendering and unlocking
  const old=new AbortController();c.currentAbortController=old;c.arm();c.currentAbortController=new AbortController();fire();assert.equal(old.signal.aborted,false);assert.equal(c.currentAbortController.signal.aborted,false);
});
