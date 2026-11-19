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
  const withIcon=(node,name)=>{const icon=window.PFActivity?.icon?.(name);if(icon)node.prepend(icon);return node;};
  function copyButton(parent,value) {
    const button=withIcon(text(parent,'button','','chat-icon-button'),'copy');button.type='button';button.title='Copy response';button.setAttribute('aria-label','Copy response');
    button.onclick=async()=>{try{await navigator.clipboard.writeText(value);button.title='Copied';button.setAttribute('aria-label','Copied');button.replaceChildren();withIcon(button,'check');}catch{button.title='Select text to copy';}};
  }
  // Render a deliberately small Markdown subset with DOM text nodes. Model HTML
  // is never executed, and links are restricted to HTTP(S).
  function inline(parent,value) {
    const pattern=/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;let start=0;
    for(const match of String(value).matchAll(pattern)) {
      parent.append(document.createTextNode(value.slice(start,match.index)));const token=match[0];
      if(token.startsWith('`'))text(parent,'code',token.slice(1,-1));
      else if(token.startsWith('**'))text(parent,'strong',token.slice(2,-2));
      else {const parts=token.match(/^\[([^\]]+)\]\((.+)\)$/);const link=text(parent,'a',parts[1]);link.href=parts[2];link.target='_blank';link.rel='noopener noreferrer';}
      start=match.index+token.length;
    }
    parent.append(document.createTextNode(String(value).slice(start)));
  }
  function markdown(parent,value) {
    const lines=String(value||'').split(/\r?\n/);let list=null;
    const cells=line=>line.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());
    for(let i=0;i<lines.length;i++) {
      const line=lines[i];if(!line.trim()){list=null;continue;}
      if(line.startsWith('```')){const code=[];while(++i<lines.length&&!lines[i].startsWith('```'))code.push(lines[i]);text(parent,'pre',code.join('\n'));list=null;continue;}
      if(line.includes('|')&&/^\s*\|?\s*:?-{3}/.test(lines[i+1]||'')) {
        const wrap=text(parent,'div','','chat-table'),table=text(wrap,'table',''),head=text(table,'thead',''),row=text(head,'tr','');
        for(const cell of cells(line))inline(text(row,'th',''),cell);i++;const body=text(table,'tbody','');
        while(i+1<lines.length&&lines[i+1].includes('|')){const tr=text(body,'tr','');for(const cell of cells(lines[++i]))inline(text(tr,'td',''),cell);}list=null;continue;
      }
      const heading=line.match(/^(#{1,4})\s+(.+)$/),item=line.match(/^\s*(?:([-*])|\d+[.)])\s+(.+)$/);
      if(heading){inline(text(parent,'h'+Math.min(4,heading[1].length+1),''),heading[2]);list=null;}
      else if(item){const kind=item[1]?'ul':'ol';if(!list||list.tagName.toLowerCase()!==kind)list=text(parent,kind,'');inline(text(list,'li',''),item[2]);}
      else {const paragraph=[line];while(i+1<lines.length&&lines[i+1].trim()&&!/^(?:#{1,4}\s|```|\s*(?:[-*]|\d+[.)])\s)/.test(lines[i+1])&&!lines[i+1].includes('|'))paragraph.push(lines[++i]);inline(text(parent,'p',''),paragraph.join('\n'));list=null;}
    }
  }
  function outputs(parent,data,hooks) {
    window.PFFiles?.render(parent,(data.outputs||[]).flatMap(o=>o.artifacts||[]));
    const rich=(data.outputs||[]).filter(o=>o.kind==='text'&&typeof o.text==='string');
    if(rich.length===(data.outputs||[]).length&&rich.length) {
      for(const output of rich){const article=text(parent,'article','','chat-prose');markdown(article,output.text);}
      copyButton(parent,rich.map(o=>o.text).join('\n\n'));
    } else hooks.outputs({body:parent},data.outputs||[],data.output_kind,data.video_url);
  }
  function workflow(parent,process,temporary) {
    const count=(process.steps||[]).length;
    parent.replaceChildren();const detail=text(parent,'details','','chat-workflow-detail');withIcon(text(detail,'summary',process.name+' · '+count+' step'+(count===1?'':'s')+(temporary?' · draft':'')),'workflow');
    const list=document.createElement('ol');detail.append(list);
    for(const step of (process.steps||[]).slice(0,40))text(list,'li',step.name||step.purpose||step.id);
  }
  function verification(parent,value) {
    const box=document.createElement('details');box.className='chat-verification';parent.append(box);
    withIcon(text(box,'summary',value.passed?'Output checks passed':'Output needs work'),value.passed?'check':'alert');text(box,'p',value.summary||'');
    const list=document.createElement('ul');box.append(list);
    for(const check of value.checks||[])text(list,'li',(check.passed?'✓ ':'✕ ')+(check.name?check.name+': ':'')+check.evidence);
    for(const limit of value.limitations||[])text(box,'p','Not verified: '+limit,'status');
  }
  function result(parent,data,hooks,{outputsAlreadyShown=false,verificationAlreadyShown=false}={}) {
    if(!data)return;parent.closest('.msg')?.classList.add('chat-auto-message');
    window.PFFiles?.render(parent,data.artifacts||[]);
    if(data.action!=='complete'||!data.run?.outputs?.length){const answer=String(data.answer||'').replace(/^run_budget_exceeded:\s*/,'');markdown(text(parent,'div','','chat-prose chat-answer'),answer);window.PFRunBudget?.mountError(parent,data.answer);if(data.answer)copyButton(parent,data.answer);}
    if(data.run&&!outputsAlreadyShown)outputs(parent,data.run,hooks);
    if(data.verification&&!verificationAlreadyShown)verification(parent,data.verification);
    if(data.saved&&data.process) {
      const row=withIcon(text(parent,'div','Saved privately','chat-saved'),'save');
      const open=withIcon(text(row,'button',data.process.name,'chat-text-button'),'open');open.type='button';open.onclick=()=>hooks.open(data.process.id);
    }
    if(data.history_warning)text(parent,'p',data.history_warning,'status');
  }
  async function send(form,assist,hooks,signal) {
    assist.el?.classList.add('chat-auto-message');
    const panel=document.createElement('details');panel.className='chat-task';assist.body.append(panel);
    const heading=text(panel,'summary','','chat-task-heading');
    const statusIcon=text(heading,'span','','chat-status-icon');withIcon(statusIcon,'search');
    const setIcon=name=>{statusIcon.replaceChildren();withIcon(statusIcon,name);};
    const title=text(heading,'span','Working…','pf-processing');title.setAttribute('role','status');title.setAttribute('aria-live','polite');
    const connection=text(heading,'span','','chat-task-time');
    const trail=text(panel,'div','','chat-task-trail');
    const explanation=text(trail,'p','','chat-task-note');
    const work=document.createElement('div');work.className='chat-workflow';trail.append(work);
    const cost=text(trail,'p','','chat-task-note'),activity=window.PFActivity?.mount(trail,{compact:true,onArtifact:file=>window.PFFiles?.render(assist.body,[file])})||(()=>{});
    let lastSignal=Date.now(),outputSeen=false,verificationSeen=false,lastWorkflow=null;const started=lastSignal;
    const timer=setInterval(()=>{connection.textContent=Math.floor((Date.now()-started)/1000)+'s'+(Date.now()-lastSignal>20000?' · waiting for connection':'');},1000);
    const event=(name,data)=>{
      const follow=hooks.atBottom?.();
      lastSignal=Date.now();
      if(name==='session'){hooks.session(data);cost.textContent='Auto task limit: '+Number(data.limit).toLocaleString()+' credits';}
      if(name==='stage'){title.textContent=data.message||'Working…';setIcon(({matching:'search',search:'search',designing:'design',planning:'design',preparing:'workflow',testing:'terminal',verifying:'check',validating:'check'})[data.stage]||'workflow');}
      if(name==='decision')explanation.textContent=data.message||'Choosing the next action.';
      if(name==='activity'){activity(data);if(data.kind==='tool_started'){setIcon('globe');title.textContent=(({search:'Searching the web',open_page:'Reading a page',find_in_page:'Finding a passage'})[data.action]||'Using '+(data.tool||'a tool'))+(data.query?' · '+data.query.slice(0,120):'');}}
      if(name==='activity' && data.kind==='gpu_status'){setIcon('terminal');title.textContent=data.text || data.status;}
      if(name==='workflow'){lastWorkflow=data.process;workflow(work,data.process,data.temporary);}
      if(name==='quote')cost.textContent='Run '+data.attempt+': '+Number(data.cost.tokens_charged).toLocaleString()+' credits · task limit '+Number(data.limit).toLocaleString();
      if(name==='outputs'){const output=document.createElement('div');output.className='chat-test-output';assist.body.append(output);outputs(output,data,hooks);outputSeen=true;hooks.balance(data.tokens_remaining);}
      if(name==='verification'){title.textContent=data.passed?'Output checks passed':'Checking improvements';verification(trail,data);verificationSeen=true;}
      if(name==='saved'){title.textContent='Verified workflow saved';if(lastWorkflow)workflow(work,lastWorkflow,false);}
      if(name!=='heartbeat')hooks.scroll?.(follow);
    };
    try {
      const response=await fetch('/api/promptflow/chat/stream',{method:'POST',body:form,signal});
      if([400,401,402,403,404,413,415,422].includes(response.status)) {
        const error=await response.json().catch(()=>({}));
        title.textContent='Couldn’t send';setIcon('alert');
        text(assist.body,'p',error.message || (response.status===401?'Please sign in to use Chat.':'Chat could not start. Your message and attachments are still in the composer.'),'status');
        window.PFRunBudget?.mountError(assist.body,error.message);
        return {not_started:true};
      }
      const complete=await read(response,event);
      panel.classList.add('chat-task-finished');panel.open=false;
      setIcon(complete.result?.action==='complete'?'check':['failed','stopped'].includes(complete.result?.action)?'alert':'message');
      title.textContent=({complete:'Completed',answer:'Reviewed request',ask:'Reviewed request',failed:'Stopped',stopped:'Stopped'})[complete.result?.action]||'Finished';
      const follow=hooks.atBottom?.();result(assist.body,complete.result,hooks,{outputsAlreadyShown:outputSeen,verificationAlreadyShown:verificationSeen});hooks.scroll?.(follow);hooks.balance(complete.tokens_remaining);return complete;
    }catch(error) {
      title.textContent=signal.aborted?'Stopping':'Connection interrupted';
      text(assist.body,'p',signal.aborted?'Stopped requesting further work. A provider call already in progress may still finish.':error.message,'status');
      if(!signal.aborted)window.PFRunBudget?.mountError(assist.body,error.message);
      const check=text(assist.body,'button','Check existing task','btn');check.type='button';
      let recovered;
      check.onclick=async()=>{
        check.disabled=true;
        try {
          const response=await fetch('/api/promptflow/chat/status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({turn_id:form.get('turn_id')}),signal:AbortSignal.timeout(30000)});
          const saved=await response.json();if(!response.ok||!saved.ok)throw new Error('This task could not be found.');
          if(saved.result){
            if(!recovered){recovered=document.createElement('div');assist.body.append(recovered);}recovered.replaceChildren();
            result(recovered,saved.result,hooks,{outputsAlreadyShown:outputSeen,verificationAlreadyShown:verificationSeen});
            title.textContent=saved.result.action==='review_pending'?'Output recovered · review pending':'Task result recovered';
            if(saved.status==='chat_complete')check.remove();else check.textContent='Refresh review status';
          }
          else title.textContent='The existing task is still finishing. Check again shortly.';
        }catch(e){title.textContent=e.message;}finally{check.disabled=false;}
      };
    }finally{clearInterval(timer);title.classList.remove('pf-processing');activity.finish?.();panel.classList.add('chat-task-finished');connection.textContent=Math.floor((Date.now()-started)/1000)+'s';}
  }
  return {send,result,read,markdown};
})();
