// Actual execution events only. File content and logs remain inert text.
window.PFActions=(()=>{
  const kinds=new Set(['command_started','command_completed','file_changed']);
  const el=(parent,tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;parent.append(n);return n;};
  const icon=(parent,name)=>{const svg=window.PFActivity?.icon(name);if(svg)parent.append(svg);};
  function diff(parent,value){
    const table=el(parent,'table','','pf-diff');table.setAttribute('aria-label','File changes with line numbers');
    const body=el(table,'tbody');let old=0,next=0;
    for(const line of String(value||'').split('\n')){
      const hunk=/^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
      const header=hunk||line.startsWith('--- ')||line.startsWith('+++ ');
      if(hunk){old=Number(hunk[1]);next=Number(hunk[2]);}
      const add=!header&&line.startsWith('+'),remove=!header&&line.startsWith('-');
      const row=el(body,'tr','',header?'pf-diff-hunk':add?'pf-diff-added':remove?'pf-diff-removed':'');
      el(row,'td',header||add?'':String(old++),'pf-line-number');el(row,'td',header||remove?'':String(next++),'pf-line-number');
      el(row,'td',line,'pf-diff-code');
    }
  }
  function mount(parent){
    const root=document.createElement('div');root.className='pf-actions';
    const list=el(root,'div','','pf-action-list'),totals=el(root,'div','','pf-change-totals');totals.hidden=true;
    const rows=new Map(),files=new Map();let attached=false;
    const receive=e=>{
      if(!kinds.has(e?.kind))return false;
      if(!attached){parent.append(root);attached=true;}
      const file=e.kind==='file_changed',key=file?'file:'+e.call_id+':'+e.path:'command:'+e.call_id;
      let row=rows.get(key);if(!row){row=el(list,'details','','pf-action-detail');rows.set(key,row);}const open=row.open;row.replaceChildren();row.open=open;
      const sum=el(row,'summary');icon(sum,file?'design':'terminal');
      const label=el(sum,'span',file?(({created:'Created',deleted:'Deleted',modified:'Edited'})[e.change]||'Changed')+' '+e.path:String(e.command||'Command').split('\n')[0],'pf-action-title');
      label.title=file?e.path:e.command;const running=e.kind==='command_started';label.classList.toggle('pf-processing',running);
      if(file){
        files.set(key,e);
        if(Number.isInteger(e.added))el(sum,'span','+'+e.added,'pf-lines-added');
        if(Number.isInteger(e.removed))el(sum,'span','−'+e.removed,'pf-lines-removed');
      }else el(sum,'span',running?'Running':Number.isInteger(e.exit_code)?'Exit '+e.exit_code+(Number.isFinite(e.duration_ms)?' · '+(e.duration_ms/1000).toFixed(1)+'s':''):'Failed','pf-command-status'+(!running&&e.exit_code!==0?' failed':''));
      const detail=el(row,'div','','pf-action-content');
      if(file){if(e.diff)diff(detail,e.diff);else el(detail,'p',e.detail||'No text diff available.');}
      else{
        const head=el(detail,'div','','pf-command-heading');el(head,'span','Command');
        const copy=el(head,'button','Copy command');copy.type='button';copy.onclick=async()=>{try{await navigator.clipboard.writeText(e.command||'');copy.textContent='Copied';}catch{copy.textContent='Select command to copy';}};
        el(detail,'pre',e.command||'','pf-command-code');
        if(e.kind==='command_completed')el(detail,'pre',e.text||'(No output)','pf-command-output');
      }
      if(e.truncated)el(detail,'p','Preview truncated.','pf-action-note');
      if(files.size){let added=0,removed=0;const paths=new Set();for(const f of files.values()){paths.add(f.path);added+=f.added||0;removed+=f.removed||0;}
        totals.replaceChildren();totals.hidden=false;icon(totals,'design');el(totals,'span',paths.size+' '+(paths.size===1?'file changed':'files changed'));el(totals,'span','+'+added,'pf-lines-added');el(totals,'span','−'+removed,'pf-lines-removed');totals.title='Cumulative measured changes during this task';}
      return true;
    };
    receive.finish=()=>{for(const n of root.querySelectorAll('.pf-processing'))n.classList.remove('pf-processing');};
    return receive;
  }
  return {mount,kinds};
})();

// An execution console belongs to the reply, outside its collapsed activity
// trail. Only measured command events enter this panel; logs are inert text.
window.PFDebugConsole=(()=>{
  const el=(p,tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;p.append(n);return n;};
  function mount(parent){
    const rows=new Map();let root;
    const receive=e=>{
      if(!['command_started','command_output','command_completed'].includes(e?.kind))return false;
      if(!root){root=el(parent,'section','','pf-debug-console');root.setAttribute('aria-label','Execution debug output');}
      const id=String(e.call_id||e.step_id||'command');let row=rows.get(id);
      if(!row){
        const box=el(root,'details','','pf-debug-command');box.open=true;box.setAttribute('data-call-id',id);
        const head=el(box,'summary');const icon=window.PFActivity?.icon('terminal');if(icon)head.append(icon);
        el(head,'span','Execution output');const status=el(head,'span','Running','pf-debug-status');status.setAttribute('role','status');
        const command=el(box,'pre','','pf-debug-code');
        const log=el(box,'pre','Waiting for output…','pf-debug-log');log.tabIndex=0;log.setAttribute('aria-label','Command output');
        const footer=el(box,'div','','pf-debug-footer');const note=el(footer,'span','stdout + stderr');
        const copy=el(footer,'button','Copy log');copy.type='button';
        row={box,status,command,log,note,value:'',ended:false};rows.set(id,row);
        copy.onclick=async()=>{try{await navigator.clipboard.writeText(row.command.textContent+'\n'+row.value);copy.textContent='Copied';}catch{copy.textContent='Select output to copy';}};
      }
      if(e.command)row.command.textContent=e.command;
      const follow=row.log.scrollHeight-row.log.scrollTop-row.log.clientHeight<60;
      if(e.kind==='command_output'&&!row.ended)row.value=(row.value+String(e.text||'')).slice(-48000);
      if(e.kind==='command_completed'){
        row.ended=true;row.value=String(e.text||row.value||'').slice(-48000);
        row.status.textContent=Number.isInteger(e.exit_code)?'Exit '+e.exit_code+(Number.isFinite(e.duration_ms)?' · '+(e.duration_ms/1000).toFixed(1)+'s':''):'Stopped';
        row.status.classList.toggle('failed',e.exit_code!==0);
      }
      row.log.textContent=row.value||(row.ended?'Command finished without output.':'Waiting for output…');
      if(e.truncated)row.note.textContent='Output preview truncated';
      if(follow)row.log.scrollTop=row.log.scrollHeight;
      return true;
    };
    receive.finish=()=>{for(const row of rows.values())if(!row.ended){row.ended=true;row.status.textContent='No exit status received';row.status.classList.toggle('failed',true);}};
    return receive;
  }
  return {mount};
})();
