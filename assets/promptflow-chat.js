/* User-initiated automatic tasks. Recovery reads an existing turn; it never
   replays generation or execution after a lost connection. */
window.PFAutoChat = (() => {
  async function read(response,onEvent) {
    if(!response.ok || !response.body) {
      const error=await response.json().catch(()=>({}));
      throw new Error(error.message || (response.status===401?'Please sign in to use Chat.':'Chat could not start. Please try again.'));
    }
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
    try {
      for(;;) {
        const {value,done}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});buffer=buffer.replace(/\r\n/g,'\n');
        let boundary;
        while((boundary=buffer.indexOf('\n\n'))>=0) {
          const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
          const name=frame.split('\n').find(l=>l.startsWith('event:'))?.slice(6).trim();
          const data=frame.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
          if(!data)continue;const event=JSON.parse(data);onEvent(name,event);
          if(name==='done')return event;
        }
        if(done)throw new Error('The connection was interrupted. Check the existing task; it will not be submitted again.');
      }
    }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  }
  const text=(parent,tag,value,className)=>{const node=document.createElement(tag);node.textContent=value;if(className)node.className=className;parent.append(node);return node;};
  function workflow(parent,process,temporary) {
    parent.replaceChildren();text(parent,'strong',(temporary?'Testing draft: ':'Using: ')+process.name);
    const list=document.createElement('ol');parent.append(list);
    for(const step of (process.steps||[]).slice(0,40))text(list,'li',step.name||step.purpose||step.id);
  }
  function verification(parent,value) {
    const box=document.createElement('section');box.className='chat-verification';parent.append(box);
    text(box,'strong',value.passed?'Output checks passed':'Output needs work');text(box,'p',value.summary||'');
    const list=document.createElement('ul');box.append(list);
    for(const check of value.checks||[])text(list,'li',(check.passed?'✓ ':'✕ ')+(check.name?check.name+': ':'')+check.evidence);
    for(const limit of value.limitations||[])text(box,'p','Not verified: '+limit,'status');
  }
  function result(parent,data,hooks,{outputsAlreadyShown=false,verificationAlreadyShown=false}={}) {
    if(!data)return;text(parent,'p',data.answer||'', 'text chat-answer');
    if(data.verification&&!verificationAlreadyShown)verification(parent,data.verification);
    if(data.run&&!outputsAlreadyShown)hooks.outputs({body:parent},data.run.outputs||[],data.run.output_kind,data.run.video_url);
    if(data.saved&&data.process) {
      const row=text(parent,'div','Saved to your private library · tested and checked by the agent','chat-saved');
      const open=text(row,'button','Open workflow','btn');open.type='button';open.onclick=()=>hooks.open(data.process.id);
    }
    if(data.history_warning)text(parent,'p',data.history_warning,'status');
  }
  async function send(form,assist,hooks,signal) {
    const panel=document.createElement('section');panel.className='chat-task';assist.body.append(panel);
    const title=text(panel,'strong','Connecting to Chat…');title.setAttribute('role','status');title.setAttribute('aria-live','polite');
    const connection=text(panel,'span','','chat-task-time');
    const explanation=text(panel,'p','Auto mode finds or creates a workflow, tests it, and saves successful drafts.','status');
    const work=document.createElement('div');work.className='chat-workflow';panel.append(work);
    const cost=text(panel,'p','','status'),activity=window.PFActivity?.mount(panel)||(()=>{});
    let lastSignal=Date.now(),outputSeen=false,verificationSeen=false;const started=lastSignal;
    const timer=setInterval(()=>{connection.textContent=Math.floor((Date.now()-started)/1000)+'s'+(Date.now()-lastSignal>20000?' · waiting for connection':'');},1000);
    const event=(name,data)=>{
      lastSignal=Date.now();
      if(name==='session'){hooks.session(data);cost.textContent='Auto task limit: '+Number(data.limit).toLocaleString()+' credits';}
      if(name==='stage')title.textContent=data.message||'Working…';
      if(name==='decision')explanation.textContent=data.message||'Choosing the next action.';
      if(name==='activity')activity(data);
      if(name==='workflow')workflow(work,data.process,data.temporary);
      if(name==='quote')cost.textContent='Run '+data.attempt+': '+Number(data.cost.tokens_charged).toLocaleString()+' credits · task limit '+Number(data.limit).toLocaleString();
      if(name==='outputs'){const output=document.createElement('div');output.className='chat-test-output';assist.body.append(output);text(output,'strong','Run output');hooks.outputs({body:output},data.outputs||[],data.output_kind,data.video_url);outputSeen=true;hooks.balance(data.tokens_remaining);}
      if(name==='verification'){title.textContent=data.passed?'Output checks passed':'Checking improvements';verification(assist.body,data);verificationSeen=true;}
      if(name==='saved')title.textContent='Verified workflow saved';
    };
    try {
      const response=await fetch('/api/promptflow/chat/stream',{method:'POST',body:form,signal});
      const complete=await read(response,event);
      title.textContent=({complete:'Task complete',answer:'Answered',ask:'More information needed',failed:'Task stopped',stopped:'Stopped'})[complete.result?.action]||'Finished';
      result(assist.body,complete.result,hooks,{outputsAlreadyShown:outputSeen,verificationAlreadyShown:verificationSeen});hooks.balance(complete.tokens_remaining);return complete;
    }catch(error) {
      title.textContent=signal.aborted?'Stopping':'Connection interrupted';
      text(assist.body,'p',signal.aborted?'Stopped requesting further work. A provider call already in progress may still finish.':error.message,'status');
      const check=text(assist.body,'button','Check existing task','btn');check.type='button';
      check.onclick=async()=>{
        check.disabled=true;
        try {
          const response=await fetch('/api/promptflow/chat/status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({turn_id:form.get('turn_id')}),signal:AbortSignal.timeout(30000)});
          const saved=await response.json();if(!response.ok||!saved.ok)throw new Error('This task could not be found.');
          if(saved.result){result(assist.body,saved.result,hooks);title.textContent='Task result recovered';check.remove();}
          else title.textContent='The existing task is still finishing. Check again shortly.';
        }catch(e){title.textContent=e.message;}finally{check.disabled=false;}
      };
    }finally{clearInterval(timer);connection.textContent=Math.floor((Date.now()-started)/1000)+'s';}
  }
  return {send,result,read};
})();
