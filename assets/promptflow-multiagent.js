/* Separate multi-agent surface: no changes to the regular Chat state/runtime. */
(()=>{
  const $=s=>document.querySelector(s), api='/api/promptflow/multiagent/';
  let state={rooms:[],room:null,keys:{}},stream=null,files=[],draftAgents=[],sending=false;
  const nodes=new Map(),dirty=new Set();let paintTimer;
  const node=(parent,tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;parent.append(n);return n;};
  const icon=(parent,name)=>{const svg=window.PFActivity?.icon(name);if(svg)parent.append(svg);};
  document.querySelectorAll('[data-icon]').forEach(n=>icon(n,n.dataset.icon));
  const notice=message=>{$('#notice').textContent=message;$('#notice').hidden=!message;};
  async function call(action,body){const r=await fetch(api+action,{credentials:'same-origin',...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});const data=await r.json().catch(()=>({message:'The server returned an unexpected response.'}));if(!r.ok){if(r.status===401){notice('Sign in to use your private team workspace.');const a=node($('#notice'),'a',' Sign in →');a.href='/auth/google?return='+encodeURIComponent('/promptflow/multiagent');}throw new Error(data.message||'The request failed.');}return data;}
  const fail=e=>{if(!$('#notice a'))notice(e.message);};
  const initials=name=>name.trim().split(/\s+/).map(s=>s[0]).slice(0,2).join('').toUpperCase();
  function selectedRoom(next){state=next;nodes.clear();$('#thread').replaceChildren();render();if(state.room)history.replaceState(null,'','/promptflow/multiagent?room='+state.room.id);}
  function render(){
    $('#roomTitle').textContent=state.room?.title||'Your team, one conversation';$('#rooms').replaceChildren();
    for(const r of state.rooms){const b=node($('#rooms'),'button',r.title,r.id===state.room?.id?'selected':'');b.title=r.title;b.onclick=()=>call('state?room='+r.id).then(selectedRoom).then(()=>document.body.classList.remove('show-sidebar')).catch(fail);}
    $('#keyStatus').textContent=Object.keys(state.keys).length?'Your API keys · connected':'Bring your own key';
    const current=$('#target').value;$('#target').replaceChildren(new Option('Whole team',''));
    for(const a of state.room?.agents||[])$('#target').append(new Option(a.name,a.id));$('#target').value=[...$('#target').options].some(o=>o.value===current)?current:'';
    renderAgents();
    if(!state.room?.messages.length)empty();else for(const m of state.room.messages)renderMessage(m);
  }
  function empty(){if($('#thread .empty'))return;$('#thread').replaceChildren();const wrap=node($('#thread'),'section','','empty'),emblem=node(wrap,'div','','team-emblem');icon(emblem,'workflow');node(wrap,'h2','Put your team to work.');node(wrap,'p','Give them one task. Follow their research, code and decisions—and step in with any agent along the way.');const examples=node(wrap,'div','','suggestions');for(const [label,text]of[['Research & verify','Research three approaches to reducing a small business’s cloud bill. Compare current primary sources, challenge the assumptions, and give me a practical recommendation.'],['Build & test','Create a browser-based expense tracker with CSV import. Work together on the implementation and tests, then attach the files.']]){const b=node(examples,'button',label);b.onclick=()=>{$('#message').value=text;$('#message').focus();};}}
  function renderAgents(){
    $('#agents').replaceChildren();let active=0;const chosen=$('#target').value;
    for(const a of state.room?.agents||[]){const working=[...state.room.messages].reverse().find(m=>m.agent_id===a.id&&m.status==='running');if(working)active++;
      const card=node($('#agents'),'div','','agent'+(chosen===a.id?' selected':''));node(card,'span',initials(a.name),'avatar');const b=node(card,'button');b.setAttribute('aria-label','Message '+a.name);node(b,'span',a.name,'agent-name');node(b,'span',working?'Working…':'Ready','agent-status'+(working?' running-label':''));b.onclick=()=>{$('#target').value=a.id;targetChanged();$('#message').focus();};
      if(working){const stop=node(card,'button','■','agent-stop');stop.title='Interrupt '+a.name;stop.setAttribute('aria-label','Interrupt '+a.name);stop.onclick=()=>stopAgent(a.id);}
    }
    $('#stopAll').hidden=!state.room?.messages.some(m=>m.status==='running');$('#composerHint').textContent=$('#sendMode').value==='design'?'Describe the problem; the model will propose specialist roles.':$('#sendMode').value==='interrupt'?'Stops the selected agent’s work before redirecting it.':'New guidance leaves current work running.';
  }
  function targetChanged(){renderAgents();$('#message').placeholder=$('#target').value?'Message '+($('#target').selectedOptions[0]?.textContent||'this agent')+'…':'Give your team a task…';}
  $('#target').onchange=targetChanged;
  $('#sendMode').onchange=()=>{renderAgents();$('#message').placeholder=$('#sendMode').value==='design'?'Describe the problem you want a team for…':'Give your team a task or add guidance…';};
  function renderMessage(m){
    $('#thread .empty')?.remove();let el=nodes.get(m.id);const wasNearBottom=$('#scroll').scrollHeight-$('#scroll').scrollTop-$('#scroll').clientHeight<110;
    if(!el){el=node($('#thread'),'article','','msg '+m.role);nodes.set(m.id,el);}if(el.dataset.status==='running'&&m.status!=='running')$('#thread').append(el);el.dataset.status=m.status||'';const expanded=[...el.querySelectorAll('.pf-action-detail')].map(n=>n.open);const open=el.querySelector('details')?.open||false;el.replaceChildren();
    if(m.role==='user'){if(m.attachments?.length)window.PFInputFiles.render(el,m.attachments);node(el,'div',m.text,'user-text');if(m.target!=='team'||m.delivery)node(el,'small',(m.target!=='team'?'To '+(state.room.agents.find(a=>a.id===m.target)?.name||m.target)+' · ':'')+(m.delivery==='queued'?'Guidance queued':m.delivery==='received'?'Guidance received':''),'target-note');}
    else{
      const head=node(el,'div','','message-head');node(head,'span',initials(m.agent_name),'avatar');node(head,'strong',m.agent_name);node(head,'span',m.model,'model');const dm=node(head,'button','Message');dm.onclick=()=>{$('#target').value=m.agent_id;targetChanged();$('#message').focus();};
      if(m.status==='running'){const stop=node(head,'button','Stop');stop.onclick=()=>stopAgent(m.agent_id);}
      const activity=node(el,'details','','activity');activity.open=open;const sum=node(activity,'summary');icon(sum,m.status==='running'?'workflow':m.status==='complete'?'check':'alert');
      const last=m.activity?.at(-1)?.command?.split('\n')[0]||m.activity?.at(-1)?.path||m.activity?.at(-1)?.text?.split('\n')[0]||'Working';node(sum,'span',m.status==='running'?last.slice(0,110):m.status==='complete'?'Completed':m.status==='interrupted'?'Interrupted':'Could not complete',m.status==='running'?'running-label':'');
      const details=node(activity,'div','','activity-body');if(m.summary)node(details,'div',m.summary,'summary-text');const actions=window.PFActions?.mount(details);for(const item of m.activity||[]){if(actions?.(item))continue;const row=node(details,'div','','activity-row');icon(row,item.icon||'workflow');node(row,'pre',item.text);}
      if(m.text){const prose=node(el,'div','','chat-prose');window.PFAutoChat.markdown(prose,m.text);}
      if(m.artifacts?.length)window.PFFiles.render(el,m.artifacts);
      if(m.error)node(el,'p',m.error,'error');
      if(m.team_updated){const edit=node(el,'button','Review team prompts','review-team');edit.onclick=()=>editTeam();}
      if(m.sources?.length){const sources=node(el,'div','','sources');for(const s of m.sources){if(!/^https?:\/\//.test(s.url))continue;const link=node(sources,'a',s.title||new URL(s.url).hostname);link.href=s.url;link.target='_blank';link.rel='noopener noreferrer';}}
    }
    el.querySelectorAll('.pf-action-detail').forEach((n,i)=>{n.open=!!expanded[i];});
    if(wasNearBottom)$('#scroll').scrollTop=$('#scroll').scrollHeight;
  }
  function schedule(m){dirty.add(m.id);if(!paintTimer)paintTimer=setTimeout(()=>{paintTimer=null;for(const id of dirty){const m=state.room?.messages.find(m=>m.id===id);if(m)renderMessage(m);}dirty.clear();},100);}
  function connect(){stream?.close();stream=new EventSource(api+'events');stream.addEventListener('connected',()=>{if(state.room)call('state?room='+state.room.id).then(data=>{state=data;render();}).catch(fail);});
    stream.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.room_id!==state.room?.id)return;const i=state.room.messages.findIndex(m=>m.id===data.message.id);if(i<0)state.room.messages.push(data.message);else state.room.messages[i]=data.message;schedule(data.message);renderAgents();});
    stream.addEventListener('team',event=>{const e=JSON.parse(event.data);if(e.room_id===state.room?.id){state.room.agents=e.agents;render();}});
    stream.addEventListener('delta',event=>{const e=JSON.parse(event.data);if(e.room_id!==state.room?.id)return;const m=state.room.messages.find(m=>m.id===e.message_id);if(!m)return;if(e.kind==='text')m.text+=e.text||'';if(e.kind==='summary')m.summary+=e.text||'';if(e.kind==='activity')m.activity.push({...e,kind:e.activity_kind});if(e.kind==='artifact')m.artifacts.push(e);if(e.kind==='source'&&!m.sources.some(s=>s.url===e.url))m.sources.push(e);schedule(m);});
    stream.onerror=()=>notice('Reconnecting to your team… Work is stopped if the connection stays closed.');stream.onopen=()=>notice('');
  }
  async function ensureRoom(){if(!state.room){selectedRoom(await call('rooms',{}));if(!stream)connect();}}
  $('#newRoom').onclick=()=>call('rooms',{}).then(selectedRoom).then(()=>{if(!stream)connect();}).catch(fail);
  $('#composer').onsubmit=async e=>{e.preventDefault();if(sending)return;const text=$('#message').value.trim();if(!text)return;try{sending=true;$('#send').disabled=true;await ensureRoom();const sent=files.slice();await call($('#sendMode').value==='design'?'design':'run',{room_id:state.room.id,agent_id:$('#target').value||undefined,interrupt:$('#sendMode').value==='interrupt',text,attachments:sent.map(f=>({filename:f.filename||f.file?.name||'Pasted text.txt',content:f.content}))});$('#message').value='';files=[];renderFiles();notice('');state=await call('state?room='+state.room.id);render();}catch(e){fail(e);if(/API key/.test(e.message))openKeys();}finally{sending=false;$('#send').disabled=false;}};
  $('#message').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('#composer').requestSubmit();}};
  async function stopAgent(agent_id){try{await call('stop',{room_id:state.room.id,agent_id});notice('');}catch(e){fail(e);}}
  $('#stopAll').onclick=()=>stopAgent();
  $('#menuButton').onclick=()=>document.body.classList.toggle('show-sidebar');
  function renderFiles(){$('#attachments').replaceChildren();window.PFInputFiles.render($('#attachments'),files,entry=>{files=files.filter(f=>f!==entry);renderFiles();});}
  window.PFInputFiles.bind($('#message'),{getEntries:()=>files,add:entry=>{files.push(entry);renderFiles();},onError:message=>notice(message)});
  $('#attach').onclick=()=>$('#fileInput').click();$('#fileInput').onchange=async()=>{try{for(const f of $('#fileInput').files){if(files.length>=8||f.size+files.reduce((n,v)=>n+new Blob([v.content]).size,0)>200000)throw new Error('Attach up to eight files, 200 KB total.');const content=await f.text();if(content.includes('\0'))throw new Error('Attach a plain text or code file.');files.push({filename:f.name,content,source:'file',kind:'text',file:f});}renderFiles();}catch(e){fail(e);}finally{$('#fileInput').value='';}};
  function keyView(){const provider=$('#keyProvider').value,key=state.keys[provider];$('#savedKey').textContent=key?'Saved key ending '+key.last4:'No key saved for this provider.';$('#removeKey').hidden=!key;$('#apiKey').value='';}
  function openKeys(){keyView();$('#keysDialog').showModal();}$('#keysButton').onclick=openKeys;$('#keyProvider').onchange=keyView;
  $('#keyForm').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;button.textContent='Validating…';try{const result=await call('keys',{provider:$('#keyProvider').value,key:$('#apiKey').value.trim()});state.keys=result.keys;$('#apiKey').value='';keyView();$('#keyForm .form-error').textContent='Key saved.';render();}catch(e){$('#keyForm .form-error').textContent=e.message;}finally{button.disabled=false;button.textContent='Validate & save';}};
  $('#removeKey').onclick=()=>call('keys',{provider:$('#keyProvider').value,remove:true}).then(r=>{state.keys=r.keys;keyView();render();}).catch(e=>$('#keyForm .form-error').textContent=e.message);
  async function editTeam(add=false){try{await ensureRoom();draftAgents=structuredClone(state.room.agents);if(add)addDraft();editors();$('#teamForm .form-error').textContent='';$('#teamDialog').showModal();}catch(e){fail(e);}}
  $('#editTeam').onclick=()=>editTeam();$('#addAgent').onclick=()=>editTeam(true);
  function addDraft(){if(draftAgents.length>=6)return;draftAgents.push({id:crypto.randomUUID(),name:'Specialist',prompt:'Contribute your expertise to the shared task. Verify your work and collaborate with teammates.',provider:'openai',model:'gpt-6.2-astra',reasoning:'medium',max_output_tokens:0,web:true,sandbox:true});}
  function editors(){const root=$('#agentEditors');root.replaceChildren();draftAgents.forEach((a,index)=>{
    const editor=node(root,'section','','agent-editor'),heading=node(editor,'div','','editor-heading');node(heading,'span',String(index+1),'avatar');const name=node(heading,'input');name.value=a.name;name.maxLength=60;name.setAttribute('aria-label','Agent name');name.oninput=()=>a.name=name.value;
    if(draftAgents.length>1){const remove=node(heading,'button','Remove');remove.type='button';remove.onclick=()=>{draftAgents.splice(index,1);editors();};}
    const fields=node(editor,'div','','fields');const select=(parent,label,values,value,change)=>{const l=node(parent,'label',label),s=node(l,'select');for(const [v,t]of values)s.append(new Option(t,v));s.value=value;s.onchange=()=>change(s.value);return s;};
    select(fields,'Provider',[['openai','OpenAI'],['anthropic','Anthropic']],a.provider,v=>{a.provider=v;a.model=v==='openai'?'gpt-6.2-astra':'claude-sonnet-5-5';editors();});
    const modelLabel=node(fields,'label','Model ID'),model=node(modelLabel,'input');model.value=a.model;model.required=true;model.oninput=()=>a.model=model.value;const list=node(modelLabel,'datalist');list.id='models-'+a.id;model.setAttribute('list',list.id);for(const m of state.keys[a.provider]?.models||[])list.append(new Option(m,m));
    const promptLabel=node(editor,'label','System prompt'),prompt=node(promptLabel,'textarea');prompt.value=a.prompt;prompt.maxLength=32000;prompt.oninput=()=>a.prompt=prompt.value;
    const options=node(editor,'div','','fields');select(options,'Reasoning',[['off','Off / unsupported'],['low','Low'],['medium','Medium'],['high','High'],['xhigh','Extra high (supported models)'],['max','Maximum (supported models)']],a.reasoning,v=>a.reasoning=v);
    const maxLabel=node(options,'label','Response limit · 0 = provider default'),max=node(maxLabel,'input');max.type='number';max.min=0;max.max=1000000;max.value=a.max_output_tokens;max.oninput=()=>a.max_output_tokens=Number(max.value);
    const caps=node(editor,'div','','capabilities');for(const [key,text]of [['web','Web search'],['sandbox','Code sandbox']]){const label=node(caps,'label'),input=node(label,'input');input.type='checkbox';input.checked=a[key];input.onchange=()=>a[key]=input.checked;label.append(text);}
  });$('#newAgent').disabled=draftAgents.length>=6;}
  $('#newAgent').onclick=()=>{addDraft();editors();};$('#teamForm').onsubmit=async e=>{e.preventDefault();try{const r=await call('agents',{room_id:state.room.id,agents:draftAgents});state.room=r.room;render();$('#teamDialog').close();}catch(e){$('#teamForm .form-error').textContent=e.message;}};
  $('#clearRoom').onclick=()=>{if(state.room)$('#confirmDialog').showModal();};$('#confirmDelete').onclick=()=>call('rooms',{room_id:state.room.id,remove:true}).then(s=>{selectedRoom(s);$('#confirmDialog').close();}).catch(fail);
  $('#usageButton').onclick=()=>{const usage=(state.room?.messages||[]).reduce((total,m)=>({input:total.input+(m.usage?.input_tokens||0),output:total.output+(m.usage?.output_tokens||0)}),{input:0,output:0});notice(`This conversation: ${usage.input.toLocaleString()} input tokens · ${usage.output.toLocaleString()} output tokens reported by providers. BYOK calls do not deduct PromptFlow credits. Provider billing includes model and search use. Sandboxes shut down when their agent finishes; no scheduled agents run.`);};
  const initialRoom=new URL(location.href).searchParams.get('room');call('state'+(initialRoom?'?room='+encodeURIComponent(initialRoom):'')).then(async s=>{if(!s.room)s=await call('rooms',{});selectedRoom(s);connect();}).catch(e=>{empty();fail(e);});
})();
