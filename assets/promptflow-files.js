window.PFFiles = (()=>{
  function render(parent,files) {
    const root=parent.closest?.('.msg') || parent;
    let tray=root.querySelector('.pf-files');
    for(const file of files || []) {
      let url;try{url=new URL(file.url,location.origin);}catch{continue;}
      if(url.origin!==location.origin || !/^\/api\/promptflow\/(image|video|audio|outputs|documents)\/[\w-]+\.[\w]+$/.test(url.pathname))continue;
      url.search='';
      if(tray && [...tray.children].some(node=>node.dataset.file===url.href))continue;
      if(!tray){tray=document.createElement('div');tray.className='pf-files';tray.setAttribute('aria-label','Workflow files');parent.append(tray);}
      const card=document.createElement('div');card.className='pf-file';card.dataset.file=url.href;
      const glyph=window.PFActivity?.icon('copy');if(glyph)card.append(glyph);
      const info=document.createElement('div');info.className='pf-file-info';
      const open=document.createElement('a');open.href=url.href;open.target='_blank';open.rel='noopener noreferrer';open.textContent=file.filename || url.pathname.split('/').pop();open.title='Open '+open.textContent;
      const meta=document.createElement('small'),size=Number(file.size_bytes);meta.textContent=(file.media_type || 'File').split(';')[0]+(Number.isFinite(size)?' · '+(size<1024?size+' B':size<1048576?(size/1024).toFixed(1)+' KB':(size/1048576).toFixed(1)+' MB'):'');
      info.append(open,meta);card.append(info);
      const download=document.createElement('a');url.searchParams.set('download','1');download.href=url.href;download.download=file.filename || '';download.setAttribute('aria-label','Download '+open.textContent);download.title='Download';download.className='pf-file-download';
      const icon=window.PFActivity?.icon('down');if(icon)download.append(icon);else download.textContent='Download';card.append(download);tray.append(card);
    }
  }
  return {render};
})();
