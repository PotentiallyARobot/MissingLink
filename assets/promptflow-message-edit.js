// Shared message editor. Saving creates a history branch; Cancel changes nothing.
window.PFMessageEdit=(()=>{
  const make=(parent,tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;parent.append(n);return n;};
  function mount(parent,{text,onSave,maxLength=4000}){
    const row=make(parent,'div','','pf-message-tools'),button=make(row,'button','','pf-edit-button');button.type='button';button.title='Edit message';button.setAttribute('aria-label','Edit message');
    const svg=window.PFActivity?.icon('design');if(svg)button.append(svg);else button.textContent='Edit';
    button.onclick=()=>{
      if(parent.querySelector('.pf-message-editor'))return;
      const editor=make(parent,'form','','pf-message-editor'),input=make(editor,'textarea');input.value=text;input.maxLength=maxLength;input.setAttribute('aria-label','Edit message text');
      make(editor,'p','This starts a new history from here. Later replies stay in the previous version. Active work on that version will stop.','pf-edit-note');
      const error=make(editor,'p','','pf-edit-error');error.setAttribute('role','alert');
      const controls=make(editor,'div','','pf-edit-controls'),cancel=make(controls,'button','Cancel'),save=make(controls,'button','Save & send');cancel.type='button';save.type='submit';save.className='pf-edit-save';
      const close=()=>{editor.remove();button.hidden=false;button.focus();};cancel.onclick=close;input.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();close();}};
      editor.onsubmit=async e=>{e.preventDefault();const value=input.value.trim();if(!value){error.textContent='Enter a message.';return;}if(value===text.trim()){close();return;}save.disabled=true;cancel.disabled=true;error.textContent='';save.textContent='Saving…';try{await onSave(value);editor.remove();button.hidden=false;}catch(e){error.textContent=e.message;save.disabled=false;cancel.disabled=false;save.textContent='Save & send';}};
      button.hidden=true;input.focus();input.style.height=Math.min(280,Math.max(100,input.scrollHeight))+'px';
    };
  }
  function history(parent,branches,active,onSelect){
    parent.replaceChildren();parent.hidden=branches.length<2;if(parent.hidden)return;
    const label=make(parent,'label','History '),select=make(label,'select');select.setAttribute('aria-label','Conversation history version');
    branches.forEach((b,i)=>select.append(new Option((i+1)+' · '+b.label,b.id)));select.value=active;
    select.onchange=async()=>{select.disabled=true;try{await onSelect(select.value);}catch(e){select.value=active;const note=make(parent,'span',e.message,'pf-edit-error');note.setAttribute('role','alert');}finally{select.disabled=false;}};
  }
  return {mount,history};
})();
