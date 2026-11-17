// Only explicitly public events are rendered. Legacy thinking is never accepted.
window.PFActivity = (() => {
  const allowed=new Set(['step_started','step_completed','step_failed','response_delta','reasoning_summary_delta','tool_started','tool_completed','source']);
  function mount(parent,options={}) {
    const panel=document.createElement(options.compact?'div':'details');panel.className='pf-live-activity'+(options.compact?' pf-activity-compact':'');panel.open=true;
    if(!options.compact){const heading=document.createElement('summary');heading.textContent='Live activity';panel.append(heading);}
    const rows=document.createElement('div');panel.append(rows);
    const steps=new Map();let attached=false,timer=null;
    const flush=()=>{timer=null;for(const s of steps.values()) for(const key of ['summary','response']) if(s[key+'Node'] && s[key+'Dirty']) {s[key+'Node'].textContent=s[key];s[key+'Dirty']=false;}};
    return event=>{
      if(!event || !allowed.has(event.kind))return;
      if(!attached){parent.append(panel);attached=true;}
      const id=String(event.step_id || 'process');
      if(!steps.has(id)) {
        if(steps.size>=100)return;
        const node=document.createElement('details');node.open=!options.compact;
        const label=document.createElement('summary');label.textContent=event.step_name || (id==='process'?'Process activity':id);node.append(label);
        const status=document.createElement('span');status.className='pf-activity-status';label.append(status);
        const work=document.createElement('div');node.append(work);rows.append(node);
        steps.set(id,{node,work,status,summary:'',response:'',sources:new Set(),actions:new Map()});
      }
      const s=steps.get(id);
      if(event.kind.startsWith('step_'))s.status.textContent=' · '+({step_started:'Running',step_completed:'Complete',step_failed:'Failed'})[event.kind]+(event.model?' · '+event.model:'');
      if(event.kind==='response_delta'||event.kind==='reasoning_summary_delta') {
        const key=event.kind==='response_delta'?'response':'summary';
        if(!s[key+'Node']) {
          const detail=document.createElement('details');detail.open=key==='summary';
          const title=document.createElement('summary');title.textContent=key==='summary'?'Reasoning summary':'Response draft';
          const text=document.createElement('pre');detail.append(title,text);s.work.append(detail);s[key+'Node']=text;
        }
        s[key]=(s[key]+String(event.text || '')).slice(-64000);s[key+'Dirty']=true;
        if(!timer)timer=setTimeout(flush,150);
      }
      if(event.kind==='tool_started'||event.kind==='tool_completed') {
        const key=event.call_id || event.tool || 'tool';let row=s.actions.get(key);
        if(!row){if(s.actions.size>=40)return;row=document.createElement('div');s.work.append(row);s.actions.set(key,row);}
        const action=({search:'Web search',open_page:'Read page',find_in_page:'Find passage'})[event.action] || event.tool || 'Tool';
        row.textContent=action+(event.query?': '+event.query:event.url?': '+event.url:'')+(event.kind==='tool_started'?'…':' · complete');
      }
      if(event.kind==='source' && event.url && !s.sources.has(event.url) && s.sources.size<100) {
        let url;try{url=new URL(event.url);}catch{return;}
        if(!['https:','http:'].includes(url.protocol)||url.username||url.password)return;
        s.sources.add(event.url);
        const a=document.createElement('a');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=event.title || url.hostname;
        const line=document.createElement('div');line.className='pf-activity-source';line.append(a);s.work.append(line);
      }
    };
  }
  return {mount};
})();
