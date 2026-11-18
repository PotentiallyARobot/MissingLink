window.PFFiles = (()=>{
  function fileType(file) {
    const ext=(file.filename || file.url || '').split(/[?#]/)[0].split('.').pop().toLowerCase();
    const mime=String(file.media_type || '').toLowerCase();
    if(['csv','xlsx','xls','tsv'].includes(ext))return {ext,label:'Spreadsheet',color:'#8fc9a4'};
    if(['json','yaml','yml','xml'].includes(ext))return {ext,label:'Data file',color:'#e8c477'};
    if(ext==='pdf')return {ext,label:'PDF document',color:'#e6a099'};
    if(mime.startsWith('image/')||['png','jpg','jpeg','webp','gif','svg'].includes(ext))return {ext,label:'Image',color:'#b6ade5'};
    if(mime.startsWith('video/'))return {ext,label:'Video',color:'#a4b9e6'};
    if(mime.startsWith('audio/'))return {ext,label:'Audio',color:'#d6a9d4'};
    if(['zip','tar','gz','7z'].includes(ext))return {ext,label:'Archive',color:'#d4bd8c'};
    if(['html','css','js','ts','py'].includes(ext))return {ext,label:'Code file',color:'#9bbfd6'};
    if(['glb','gltf','obj','stl'].includes(ext))return {ext,label:'3D model',color:'#a8c4db'};
    if(ext==='md')return {ext,label:'Markdown',color:'#d8bd7e'};
    return {ext:ext.length<=5?ext:'FILE',label:'Document',color:'#c5c1b5'};
  }
  function fileIcon(type) {
    const icon=document.createElement('span');icon.className='pf-file-icon';icon.setAttribute('aria-hidden','true');icon.style.setProperty('--file-accent',type.color);
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 24 24');
    const page=document.createElementNS(ns,'path');page.setAttribute('d','M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z M14 2v6h6 M8 13h8 M8 17h5');
    svg.append(page);icon.append(svg);return icon;
  }
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
      const type=fileType(file);
      const open=document.createElement('a');open.className='pf-file-open';open.href=url.href;open.target='_blank';open.rel='noopener noreferrer';
      const filename=file.filename || url.pathname.split('/').pop();open.setAttribute('aria-label','Open '+filename);open.title='Open '+filename;
      open.append(fileIcon(type));
      const info=document.createElement('div');info.className='pf-file-info';
      const name=document.createElement('span');name.className='pf-file-name';name.textContent=filename;
      const meta=document.createElement('small'),size=Number(file.size_bytes);meta.textContent=type.label+(Number.isFinite(size)?' · '+(size<1024?size+' B':size<1048576?(size/1024).toFixed(1)+' KB':(size/1048576).toFixed(1)+' MB'):'');
      info.append(name,meta);open.append(info);card.append(open);
      const download=document.createElement('a');url.searchParams.set('download','1');download.href=url.href;download.download=file.filename || '';download.setAttribute('aria-label','Download '+filename);download.title='Download '+filename;download.className='pf-file-download';
      const ns='http://www.w3.org/2000/svg',glyph=document.createElementNS(ns,'svg');glyph.setAttribute('viewBox','0 0 24 24');glyph.setAttribute('aria-hidden','true');
      const arrow=document.createElementNS(ns,'path');arrow.setAttribute('d','M12 3v12 M7 10l5 5 5-5 M5 17v3h14v-3');glyph.append(arrow);download.append(glyph);card.append(download);tray.append(card);
    }
  }
  return {render};
})();
