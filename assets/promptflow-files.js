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
    return {ext:ext.length<=5?ext:'FILE',label:'Document',color:'#c5c1b5'};
  }
  function fileIcon(type) {
    const icon=document.createElement('span');icon.className='pf-file-icon';icon.setAttribute('aria-hidden','true');icon.style.setProperty('--file-accent',type.color);
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 44 54');
    const page=document.createElementNS(ns,'path');page.setAttribute('d','M7 1.5h20L41 15v35a2.5 2.5 0 0 1-2.5 2.5h-32A2.5 2.5 0 0 1 4 50V4A2.5 2.5 0 0 1 7 1.5Z');
    const fold=document.createElementNS(ns,'path');fold.setAttribute('d','M27 2v10.5a2.5 2.5 0 0 0 2.5 2.5H40');fold.setAttribute('class','pf-file-fold');
    svg.append(page,fold);icon.append(svg);
    const badge=document.createElement('span');badge.className='pf-file-ext';badge.textContent=type.ext.toUpperCase().slice(0,5);icon.append(badge);return icon;
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
      const type=fileType(file);card.append(fileIcon(type));
      const info=document.createElement('div');info.className='pf-file-info';
      const open=document.createElement('a');open.href=url.href;open.target='_blank';open.rel='noopener noreferrer';open.textContent=file.filename || url.pathname.split('/').pop();open.title='Open '+open.textContent;
      const meta=document.createElement('small'),size=Number(file.size_bytes);meta.textContent=type.label+(Number.isFinite(size)?' · '+(size<1024?size+' B':size<1048576?(size/1024).toFixed(1)+' KB':(size/1048576).toFixed(1)+' MB'):'');
      info.append(open,meta);card.append(info);
      const actions=document.createElement('div');actions.className='pf-file-actions';
      const view=document.createElement('a');view.href=open.href;view.target='_blank';view.rel='noopener noreferrer';view.textContent='Open';view.setAttribute('aria-label','Open '+open.textContent);actions.append(view);
      const download=document.createElement('a');url.searchParams.set('download','1');download.href=url.href;download.download=file.filename || '';download.setAttribute('aria-label','Download '+open.textContent);download.title='Download';download.className='pf-file-download';
      const icon=window.PFActivity?.icon('down');if(icon)download.append(icon);download.append(document.createTextNode('Download'));actions.append(download);info.append(actions);tray.append(card);
    }
  }
  return {render};
})();
