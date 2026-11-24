(function(root){
  function agentStatus(messages,agentId){
    const own=(messages||[]).filter(m=>m.role==='assistant'&&m.agent_id===agentId),message=own.findLast(m=>m.status==='running')||own.at(-1);
    if(!message)return{label:'Ready',busy:false,kind:'ready'};
    if(message.status!=='running'){
      if(message.status==='complete')return{label:'Completed',busy:false,kind:'complete'};
      const error=String(message.error||'');
      return{label:/budget|credits/i.test(error)?'Budget reached':message.status==='interrupted'?'Stopped':'Needs attention',busy:false,kind:'attention',detail:error};
    }
    if(message.approvals?.some(a=>a.status==='waiting'))return{label:'Waiting for browser access',busy:true,kind:'waiting'};
    const activity=(message.activity||[]).filter(a=>!/^\d+.*credits/.test(a.text||''));
    // A progress note must not hide a command or browser action still in flight.
    const pending=new Map();
    for(const action of activity){
      if(['command_started','tool_started'].includes(action.kind)&&action.call_id)pending.set(action.call_id,action);
      if(['command_completed','tool_completed'].includes(action.kind))pending.delete(action.call_id);
    }
    const last=[...pending.values()].at(-1)||activity.at(-1);
    if(!last)return{label:'Reviewing the task',busy:true,kind:'working'};
    if(last.kind==='command_started'){
      const command=String(last.command||'').split('\n')[0].replace(/^\/bin\/(ba)?sh\s+-lc\s+["']?/,'');
      return{label:command?'Running '+command.slice(0,65):'Running code',detail:last.command,busy:true,kind:'working'};
    }
    if(last.kind==='command_completed')return{label:last.exit_code===0?'Checking command results':'Reviewing command failure',busy:true,kind:'working'};
    if(last.kind==='file_changed')return{label:'Updated '+(last.path||'a file'),detail:last.path,busy:true,kind:'working'};
    if(last.kind==='tool_started')return{label:/browser/i.test(last.tool)?'Using the cloud browser':/search/i.test(last.tool)?'Searching the web':'Using '+(last.tool||'a tool'),detail:last.text,busy:true,kind:'working'};
    if(last.kind==='tool_completed')return{label:'Reviewing '+(last.tool||'tool')+' results',busy:true,kind:'working'};
    const text=String(last.text||'');
    if(/^Delegated to/.test(text))return{label:messages.some(m=>m.agent_id!==agentId&&m.status==='running')?'Waiting for teammates':'Combining team results',detail:text,busy:true,kind:'working'};
    if(/Starting.*sandbox/i.test(text))return{label:'Starting sandbox'+(/browser/.test(text)?' & browser':''),busy:true,kind:'working'};
    return{label:(text.split('\n')[0]||'Working').slice(0,90),detail:text,busy:true,kind:'working'};
  }
  root.PFTeamStatus={agentStatus};
})(typeof window==='undefined'?globalThis:window);
