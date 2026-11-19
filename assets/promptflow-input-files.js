/* Text pasted into the composer stays a file, separate from the user's request.
   Nothing is uploaded until Send. File content is rendered only as plain text. */
window.PFInputFiles = (() => {
  const MAX_BYTES = 200 * 1024, MAX_FILES = 8;
  const largePaste = text => text.length >= 2000 || text.split(/\r\n|\r|\n/).length >= 30;
  const title = text => String(text).split(/\r\n|\r|\n/).find(line => line.trim())?.trim().slice(0,100) || 'Pasted text';
  function fromPaste(text, entries) {
    const existing = entries.filter(entry => entry.kind === 'text');
    const file = new File([text], 'Pasted text.txt', {type:'text/plain;charset=utf-8'});
    if(existing.length >= MAX_FILES) throw new Error('You can attach up to 8 text files per message.');
    if(file.size + existing.reduce((sum,entry)=>sum+entry.file.size,0) > MAX_BYTES) throw new Error('Text attachments can total up to 200 KB per message. Split this paste into smaller files.');
    let number=1, filename=file.name;
    while(existing.some(entry=>entry.file.name===filename)) filename='Pasted text '+(++number)+'.txt';
    return {kind:'text', file:new File([text],filename,{type:file.type}), content:text, title:title(text), source:'paste'};
  }
  function bind(input, {getEntries,add,onError}) {
    input.addEventListener('paste',event=>{
      const data=event.clipboardData;
      if(!data || data.files?.length) return;
      const content=data.getData('text/plain');
      if(!largePaste(content))return;
      event.preventDefault();
      try {add(fromPaste(content,getEntries()));} catch(error) {onError(error.message);}
    });
  }
  function append(form, entries) {
    for(const entry of entries.filter(e=>e.kind==='text'))form.append('text_files',entry.file);
  }
  function render(parent, files, onRemove) {
    for(const entry of files || []) {
      const filename=entry.filename || entry.file?.name || 'Pasted text.txt';
      const card=document.createElement('div');card.className='pf-input-file';
      const open=document.createElement('button');open.type='button';open.className='pf-input-file-open';open.title='Open '+filename;open.setAttribute('aria-label','Open '+filename);
      const icon=document.createElement('span');icon.className='pf-input-file-icon';icon.setAttribute('aria-hidden','true');
      icon.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z M14 2v6h6 M8 13h8 M8 17h5"/></svg>';
      const info=document.createElement('span');info.className='pf-input-file-info';
      const heading=document.createElement('strong');heading.textContent=entry.title || title(entry.content || '') || filename;
      const label=document.createElement('small');label.textContent=entry.source==='paste' || /^Pasted text/.test(filename)?'Pasted text':filename;
      info.append(heading,label);open.append(icon,info);open.onclick=()=>preview(entry,filename);card.append(open);
      if(onRemove) {
        const remove=document.createElement('button');remove.type='button';remove.className='pf-input-file-remove';remove.textContent='×';remove.setAttribute('aria-label','Remove '+filename);remove.title='Remove '+filename;
        remove.onclick=()=>onRemove(entry);card.append(remove);
      }
      parent.append(card);
    }
  }
  function preview(entry,filename) {
    const dialog=document.createElement('dialog');dialog.className='pf-text-preview';dialog.setAttribute('aria-label',filename);
    const header=document.createElement('header'),name=document.createElement('strong');name.textContent=filename;
    const download=document.createElement('a'),blob=new Blob([entry.content || ''],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob);download.href=url;download.download=filename;download.textContent='Download';
    const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Close text preview');close.onclick=()=>dialog.close();
    header.append(name,download,close);const content=document.createElement('pre');content.textContent=entry.content || '';dialog.append(header,content);document.body.append(dialog);
    dialog.addEventListener('close',()=>{URL.revokeObjectURL(url);dialog.remove();},{once:true});dialog.showModal();
  }
  return {bind,fromPaste,largePaste,append,render};
})();
