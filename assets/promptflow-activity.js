// Only explicitly public events are rendered. Legacy thinking is never accepted.
window.PFActivity = (() => {
  const allowed=new Set(['step_started','step_completed','step_failed','response_delta','reasoning_summary_delta','tool_started','tool_completed','source','artifact','gpu_status','command_started','command_completed','file_changed']);
  const paths={
    plus:'M12 5v14M5 12h14',
    down:'M12 4v16M5 13l7 7 7-7',
    file:'M14 2H5v20h14V7l-5-5zM14 2v5h5M8 12h8M8 16h6',
    trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
    store:'M3 10h18l-2-7H5zM4 10v11h16V10M9 21v-7h6v7M8 3l-1 7M16 3l1 7',
    settings:'M4 7h6M14 7h6M4 17h10M18 17h2M10 4v6M14 14v6',
    search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    globe:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18',
    workflow:'M3 3h6v6H3zM15 15h6v6h-6zM15 3h6v6h-6zM9 6h6M6 9v9h9',
    design:'M15 4l5 5M4 20l4-1L21 6l-3-3L5 16z',
    terminal:'M3 4h18v16H3zM7 9l3 3-3 3M13 15h4',
    check:'M21 12a9 9 0 1 1-3-7M8 11l4 4L22 5',
    save:'M5 3h12l4 4v14H3V3zM7 3v6h10V3M7 21v-8h10v8',
    copy:'M9 9h12v12H9zM5 15H3V3h12v2',
    open:'M14 3h7v7M21 3L10 14M10 3H3v18h18v-7',
    message:'M21 11a9 8 0 0 1-9 8H7l-5 3 2-6a8 8 0 0 1-1-5 9 8 0 0 1 18 0',
    alert:'M12 3L1 21h22zM12 9v5M12 17v1'
  };
  function icon(name) {
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    for(const [key,value] of Object.entries({viewBox:'0 0 24 24',width:'17',height:'17',fill:'none',stroke:'currentColor','stroke-width':'1.6','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false',class:'pf-action-icon'}))svg.setAttribute(key,value);
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',paths[name]||paths.terminal);svg.append(path);return svg;
  }
  function mount(parent,options={}) {
    const panel=document.createElement(options.compact?'div':'details');panel.className='pf-live-activity'+(options.compact?' pf-activity-compact':'');panel.open=true;
    if(!options.compact){const heading=document.createElement('summary');heading.textContent='Live activity';panel.append(heading);}
    const rows=document.createElement('div');panel.append(rows);
    const actions=window.PFActions?.mount(rows);
    const steps=new Map();let attached=false,timer=null;
    const flush=()=>{timer=null;for(const s of steps.values()) for(const key of ['summary','response']) if(s[key+'Node'] && s[key+'Dirty']) {s[key+'Node'].textContent=s[key];s[key+'Dirty']=false;}};
    const receive=event=>{
      if(!event || !allowed.has(event.kind))return;
      if(event.kind==='artifact'){if(options.onArtifact)options.onArtifact(event);else window.PFFiles?.render(parent,[event]);return;}
      if(!attached){parent.append(panel);attached=true;}
      if(actions?.(event))return;
      const id=String(event.step_id || 'process');
      if(!steps.has(id)) {
        if(steps.size>=100)return;
        const node=document.createElement('details');node.open=!options.compact;
        const label=document.createElement('summary');const name=document.createElement('span');name.className='pf-step-label';name.textContent=event.step_name || (id==='process'?'Process activity':id);label.append(name);node.append(label);
        if(options.compact)label.prepend(icon(/verif|check/i.test(event.step_name||'')?'check':/choos|search/i.test(event.step_name||'')?'search':'terminal'));
        const status=document.createElement('span');status.className='pf-activity-status';label.append(status);
        const work=document.createElement('div');node.append(work);rows.append(node);
        steps.set(id,{node,name,work,status,summary:'',response:'',sources:new Set(),actions:new Map()});
      }
      const s=steps.get(id);
      if(event.kind==='gpu_status') {s.name.textContent=event.text || event.status;s.name.classList.toggle('pf-processing',!['stopped','failed','cancelled'].includes(event.status));s.status.textContent=' · '+(event.gpu || 'L4')+(event.model?' · '+event.model:'');}
      if(event.kind.startsWith('step_')){
        s.name.classList.toggle('pf-processing',event.kind==='step_started');
        s.status.textContent=' · '+({step_started:'Running',step_completed:'Complete',step_failed:'Failed'})[event.kind]+(event.model?' · '+event.model:'');
        if(event.kind!=='step_started')for(const row of s.actions.values())row.querySelector('.pf-step-label')?.classList.remove('pf-processing');
      }
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
        row.replaceChildren();const name=document.createElement('span');name.className='pf-step-label'+(event.kind==='tool_started'?' pf-processing':'');name.textContent=action+(event.query?': '+event.query:event.url?': '+event.url:'')+(event.kind==='tool_started'?'…':' · complete');row.append(name);
        if(options.compact){row.className='pf-tool-action';row.prepend(icon(event.action==='search'?'search':'globe'));}
      }
      if(event.kind==='source' && event.url && !s.sources.has(event.url) && s.sources.size<100) {
        let url;try{url=new URL(event.url);}catch{return;}
        if(!['https:','http:'].includes(url.protocol)||url.username||url.password)return;
        s.sources.add(event.url);
        const a=document.createElement('a');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=event.title || url.hostname;
        const line=document.createElement('div');line.className='pf-activity-source';line.append(a);s.work.append(line);
        if(options.compact)line.prepend(icon('globe'));
      }
    };
    receive.finish=()=>{actions?.finish?.();if(timer)clearTimeout(timer);flush();for(const node of panel.querySelectorAll('.pf-processing'))node.classList.remove('pf-processing');};
    return receive;
  }
  return {mount,icon};
})();
