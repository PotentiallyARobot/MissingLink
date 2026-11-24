/* Private team workspace. Content is rendered as text or passive media. */
window.PFTeamFiles=(()=>{
  const make=(parent,tag,text='',cls='')=>{const e=document.createElement(tag);e.textContent=text;e.className=cls;parent.append(e);return e;};
  function mount({button,getRoom,call}){
    const dialog=make(document.body,'dialog','','team-files-dialog'),head=make(dialog,'header');
    const title=make(head,'div');make(title,'h2','Team files');make(title,'p','Private files shared with every agent in this team.','muted');
    const close=make(head,'button','×','icon-button');close.setAttribute('aria-label','Close team files');close.onclick=()=>dialog.close();
    const toolbar=make(dialog,'div','','team-files-toolbar'),search=make(toolbar,'input');search.type='search';search.placeholder='Find a file…';search.setAttribute('aria-label','Find a team file');
    const history=make(toolbar,'button','Show versions');
    const status=make(dialog,'p','','muted'),list=make(dialog,'div','','team-file-list');status.setAttribute('role','status');
    let entries=[],versions=false,roomId='',request=0;
    const preview=make(document.body,'dialog','','team-file-preview'),previewHead=make(preview,'header'),previewTitle=make(previewHead,'h2'),previewClose=make(previewHead,'button','×','icon-button');previewClose.setAttribute('aria-label','Close file preview');previewClose.onclick=()=>preview.close();
    const previewMeta=make(preview,'p','','muted'),content=make(preview,'div','','team-file-content'),actions=make(preview,'div','','dialog-actions'),download=make(actions,'a','Download file','file-download-button');
    let previewRequest=0;
    async function open(file){
      const current=++previewRequest;previewTitle.textContent=file.path||file.filename;previewMeta.textContent='Version '+(file.version||1)+(file.agent_name?' · '+file.agent_name:'');content.replaceChildren();download.href=file.download_url||file.url+'?download=1';download.download=file.filename;preview.showModal();
      const ext=(file.filename||'').split('.').pop().toLowerCase();
      if(['png','jpg','jpeg','webp','gif','avif'].includes(ext)){const img=make(content,'img');img.src=file.url;img.alt=file.filename;return;}
      if(['mp4','webm','mp3','wav','ogg'].includes(ext)){const media=make(content,['mp4','webm'].includes(ext)?'video':'audio');media.src=file.url;media.controls=true;return;}
      if(!['txt','md','csv','tsv','json','yaml','yml','xml','html','css','js','ts','tsx','jsx','py','sh','sql','log','ini','toml','svg'].includes(ext)){make(content,'p','Download this file to open it in its application.');return;}
      if(file.size_bytes>2*1024*1024){make(content,'p','This file is too large to preview. Download it to see the full contents.');return;}
      const loading=make(content,'p','Opening file…');
      try{const response=await fetch(file.url,{credentials:'same-origin'});if(!response.ok)throw new Error('This file could not be opened. Try again.');const text=await response.text();if(current!==previewRequest)return;content.replaceChildren();make(content,'pre',text);}
      catch(e){if(current===previewRequest)loading.textContent=e.message;}
    }
    function draw(){
      list.replaceChildren();const query=search.value.trim().toLowerCase(),shown=entries.filter(f=>f.path.toLowerCase().includes(query));
      status.textContent=entries.length?shown.length+' '+(versions?(shown.length===1?'version':'versions'):(shown.length===1?'file':'files'))+(query?' matching “'+search.value+'”':''):'Files will appear here as agents save their work.';
      history.textContent=versions?'Latest files':'Show versions';history.setAttribute('aria-pressed',String(versions));
      for(const f of shown){
        const row=make(list,'div','','team-file-row'),card=make(row,'div','','team-file-card');window.PFFiles.render(card,[f]);
        const link=card.querySelector('.pf-file-open');if(link)link.onclick=e=>{e.preventDefault();open(f);};
        const info=make(row,'div','','team-file-details');make(info,'span',f.path,'team-file-path');make(info,'span','v'+f.version+(f.agent_name?' · '+f.agent_name:'')+(f.created?' · '+new Date(f.created).toLocaleDateString():''),'muted');
      }
    }
    async function refresh(){
      const room=getRoom();if(!room)return;const current=++request;roomId=room.id;status.textContent='Loading files…';
      try{const data=await call('files?room='+encodeURIComponent(room.id)+(versions?'&history=1':''));if(current!==request||getRoom()?.id!==room.id)return;entries=data.files;draw();}
      catch(e){if(current===request)status.textContent=e.message;}
    }
    button.onclick=()=>{if(!getRoom())return;search.value='';dialog.showModal();refresh();};search.oninput=draw;history.onclick=()=>{versions=!versions;refresh();};
    return {refresh(){button.disabled=!getRoom();if(dialog.open)refresh();},open};
  }
  async function downloadOutputs(roomId,messageId,button){
    const original=button.textContent;button.disabled=true;button.textContent='Preparing ZIP…';
    try{const response=await fetch('/api/promptflow/multiagent/outputs.zip?room='+encodeURIComponent(roomId)+'&message='+encodeURIComponent(messageId),{credentials:'same-origin'});if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.message||'Could not download output files.');}const url=URL.createObjectURL(await response.blob()),a=make(document.body,'a');a.href=url;a.download='outputs.zip';a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}finally{button.disabled=false;button.textContent=original;}
  }
  return {mount,downloadOutputs};
})();
