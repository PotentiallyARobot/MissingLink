(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let root, dialog, items=[], access={}, controller, lastFocus, active=false, request=0;
  const el = id => document.getElementById(id);
  const tokens = n => Number(n||0).toLocaleString()+' tokens';
  const owned = item => access.owned?.includes(item.id);
  const unlocked = item => access.subscribed || owned(item);
  function mount() {
    if (root) return;
    root=document.createElement('section'); root.id='pfMarketplace'; root.className='pf-market'; root.hidden=true; root.setAttribute('aria-label','Marketplace');
    root.innerHTML=`<div class="pf-market-inner"><button class="pf-market-back" id="pfMarketBack" type="button">← Back to workspace</button>
      <div class="pf-market-hero"><div><div class="pf-market-eyebrow">PromptFlow Marketplace</div><h1>Good work starts here.</h1><p class="pf-market-intro">Useful workflows for the work you do every day. Download a complete process, make it yours, and run it with your own tools.</p></div>
      <aside class="pf-market-membership"><strong id="pfMarketAccess">Buy once with tokens</strong><p>Own individual workflows, or get every download included with your subscription. Run costs are separate.</p><button id="pfMarketSubscribe" class="pf-market-btn primary" type="button">View subscription</button></aside></div>
      <div class="pf-market-toolbar"><input id="pfMarketSearch" type="search" placeholder="Find a workflow…" aria-label="Search Marketplace"><select id="pfMarketCategory" aria-label="Filter Marketplace by category"><option value="">All categories</option></select><span class="pf-market-count" id="pfMarketCount" aria-live="polite"></span></div>
      <p class="pf-market-note">Cover images are AI-generated illustrations, not sample results. Local runs use your API keys; model, search and image usage is billed separately by your providers.</p>
      <div id="pfMarketStatus" class="pf-market-status" role="status"></div><div class="pf-market-grid" id="pfMarketGrid"></div></div>`;
    document.body.appendChild(root);
    dialog=document.createElement('dialog'); dialog.className='pf-market-dialog'; dialog.setAttribute('aria-labelledby','pfMarketDetailTitle'); document.body.appendChild(dialog);
    el('pfMarketBack').onclick=()=>close(true);
    el('pfMarketSearch').oninput=render; el('pfMarketCategory').onchange=render;
    el('pfMarketSubscribe').onclick=()=>access.subscribed?load():openSubscription();
    dialog.addEventListener('keydown',e=>{if(e.key==='Escape')e.stopPropagation();});
    dialog.addEventListener('close',()=>lastFocus?.focus());
    root.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();close(true);}});
    window.addEventListener('focus',()=>{if(active&&!dialog.open)load();});
  }
  function updateAccess() {
    el('pfMarketAccess').textContent=access.subscribed?'Downloads included':access.signed_in?'Your balance: '+tokens(access.tokens):'Buy once with tokens';
    el('pfMarketSubscribe').textContent=access.subscribed?'Refresh access':access.signed_in?'View subscription':'Sign in to subscribe';
  }
  async function load() {
    controller?.abort(); controller=new AbortController(); const ticket=++request;
    el('pfMarketStatus').textContent='Loading workflows and your access…';
    try {
      const response=await fetch('/api/promptflow/marketplace',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
      const data=await response.json();
      if(!response.ok||!data.ok||!Array.isArray(data.items))throw new Error(data.message||'Marketplace is temporarily unavailable.');
      if(ticket!==request||!active)return;
      items=data.items;access=data.access||{};updateAccess();
      const category=el('pfMarketCategory').value;
      el('pfMarketCategory').innerHTML='<option value="">All categories</option>'+[...new Set(items.map(x=>x.category))].map(x=>`<option>${escape(x)}</option>`).join('');
      el('pfMarketCategory').value=category;el('pfMarketStatus').textContent='';render();
    } catch(error) {
      if(ticket!==request||!active)return;
      items=[];render();el('pfMarketGrid').innerHTML='';
      el('pfMarketStatus').textContent=(error.name==='TimeoutError'?'Marketplace took too long to respond.':error.message)+' ';
      const retry=document.createElement('button');retry.type='button';retry.className='pf-market-btn';retry.textContent='Try again';retry.onclick=load;el('pfMarketStatus').appendChild(retry);
    }
  }
  function render() {
    const q=el('pfMarketSearch').value.trim().toLowerCase(),category=el('pfMarketCategory').value;
    const shown=items.filter(x=>(!category||x.category===category)&&`${x.name} ${x.description} ${x.category} ${x.deliverables.join(' ')}`.toLowerCase().includes(q));
    el('pfMarketCount').textContent=`${shown.length} workflow${shown.length===1?'':'s'}`;
    el('pfMarketGrid').innerHTML=shown.length?shown.map(x=>`<article class="pf-market-card"><img src="${escape(x.preview_image)}" alt="Illustrated cover for ${escape(x.name)}" loading="lazy" width="1536" height="1024"><div class="pf-market-card-content"><span class="pf-market-category">${escape(x.category)}</span><h2>${escape(x.name)}</h2><p>${escape(x.description)}</p><div class="pf-market-meta">${x.step_count} steps · ${escape(x.providers.join(' + '))}</div><div class="pf-market-card-footer"><span class="pf-market-included">${owned(x)?'Owned':access.subscribed?'Included':tokens(x.price_tokens)+' once'}<small>Included with subscription</small></span><button type="button" class="pf-market-btn" data-market-id="${escape(x.id)}" aria-label="View ${escape(x.name)}">View workflow →</button></div></div></article>`).join(''):'<div class="pf-market-empty">No matching workflows. Try another search or category.</div>';
    root.querySelectorAll('[data-market-id]').forEach(button=>button.onclick=()=>showDetails(items.find(x=>x.id===button.dataset.marketId),button));
  }
  function showDetails(item,button) {
    lastFocus=button;
    const list=values=>values.map(x=>`<li>${escape(x)}</li>`).join('');
    dialog.innerHTML=`<div class="pf-market-dialog-head"><h2 id="pfMarketDetailTitle">${escape(item.name)}</h2><button class="pf-market-dialog-close" type="button" aria-label="Close workflow details">✕</button></div><div class="pf-market-dialog-body"><div class="pf-market-detail-top"><div><img src="${escape(item.preview_image)}" alt="Illustrated cover for ${escape(item.name)}"><p class="pf-market-note">AI-generated cover · Version ${escape(item.version)}</p></div><div><span class="pf-market-category">${escape(item.category)}</span><p>${escape(item.description)}</p><h3>What you get</h3><ul>${list(item.deliverables)}</ul></div></div>
      <h3>Bring this input</h3><p>${escape(item.input)}</p><pre>${escape(item.sample_input)}</pre>
      ${item.guide_image?`<details class="pf-market-guide"><summary>180° projection guide &amp; instructions</summary><img src="${escape(item.guide_image)}" alt="Projection guide showing left -90°, front 0°, right +90°, top and bottom poles"><p>Upload a level photo. Your photo supplies the scene; this guide supplies directions. The download includes this original image, instructions and runnable steps.</p><p>Output: a square 1024×1024 monoscopic texture covering 180° horizontally and vertically. The guide’s rectangular illustration is not the output aspect ratio. Use a viewer configured for half-equirectangular / 180° mono; inspect the subject, horizon, edges and poles.</p><p>Unseen areas are AI-generated. This is an approximate reconstruction, not measured scene geometry, a 360° panorama or stereoscopic VR180. No headset-specific metadata is added.</p></details>`:''}
      <h3>How it works · ${item.step_count} steps</h3><ol>${list(item.activities)}</ol>
      <h3>Before you run</h3><p>In PromptFlow, add your input and review the run quote. To run a download on your computer, use Python 3.9+ and credentials for ${escape(item.providers.join(', '))}. The download includes the execution runtime, editable prompts, manifest and instructions. Provider usage costs extra. Review AI output before use.</p>
      <div class="pf-market-price"><strong>${owned(item)?'You own this workflow':access.subscribed?'Included in your subscription':tokens(item.price_tokens)+' · one-time unlock'}</strong><p>${owned(item)?'Download again or run it whenever you need.':access.subscribed?'No unlock fee. Download it or add a private copy to your workspace.':'Purchases stay available after a subscription ends. Re-downloads are free.'} Hosted runs use additional tokens after you review the quote; local runs use your provider keys.</p></div>
      <div class="pf-market-dialog-actions">${unlocked(item)?`<button type="button" id="pfMarketRun" class="pf-market-btn primary">${item.input_kinds.includes('image')?'Upload image & prepare run':'Use in PromptFlow'}</button><button type="button" id="pfMarketDownload" class="pf-market-btn">Download .promptflow</button>`:`<button type="button" id="pfMarketPurchase" class="pf-market-btn primary">${access.signed_in?'Unlock for '+tokens(item.price_tokens):'Sign in to unlock'}</button><button type="button" id="pfMarketDetailSubscribe" class="pf-market-btn">Included with subscription</button>`}<a href="promptflow_learn_more.html#run-locally" target="_blank" rel="noopener">Install &amp; run guide ↗</a></div><div id="pfMarketPurchaseReview"></div><div id="pfMarketDownloadStatus" class="pf-market-status" role="status"></div>
      <details id="pfMarketAfterDownload"><summary>How to run this download</summary><pre>python "${escape(item.id)}.promptflow" --input ${item.input_kinds.includes('image')?'image=photo.jpg':'text=@input.txt'} --check\npython "${escape(item.id)}.promptflow" --input ${item.input_kinds.includes('image')?'image=photo.jpg':'text=@input.txt'}</pre><p>${item.input_kinds.includes('image')?'Put your photo beside the download.':'Save your input in input.txt beside the download.'} Set the provider keys first. Results are saved in <code>promptflow-output/</code>. Remove <code>--check</code> only when ready to make provider calls.</p></details></div>`;
    dialog.querySelector('.pf-market-dialog-close').onclick=()=>dialog.close();
    if(el('pfMarketDownload'))el('pfMarketDownload').onclick=()=>download(item);
    if(el('pfMarketRun'))el('pfMarketRun').onclick=()=>install(item);
    if(el('pfMarketPurchase'))el('pfMarketPurchase').onclick=()=>reviewPurchase(item);
    if(el('pfMarketDetailSubscribe'))el('pfMarketDetailSubscribe').onclick=openSubscription;
    if(!dialog.open)dialog.showModal();
  }
  async function download(item) {
    const button=el('pfMarketDownload'),status=el('pfMarketDownloadStatus'),instructions=el('pfMarketAfterDownload');button.disabled=true;status.textContent='Preparing your download…';
    try {
      const response=await fetch(item.download_url,{signal:AbortSignal.timeout(30000)});
      if(!response.ok) {
        const data=await response.json();
        if(response.status===401||response.status===403){access={signed_in:response.status!==401,subscribed:false,owned:[]};updateAccess();render();showDetails(item,lastFocus);}
        throw new Error(data.message||'The download could not be prepared.');
      }
      if(!response.headers.get('content-type')?.includes('application/x-promptflow'))throw new Error('The server did not return a workflow bundle. Please try again.');
      const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download=item.id+'.promptflow';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      status.textContent='Download started. No additional tokens were charged.';instructions.open=true;
    } catch(error) {el('pfMarketDownloadStatus').textContent=error.name==='TimeoutError'?'The download timed out. Try again.':error.message;}
    finally {button.disabled=false;}
  }
  async function post(path,body={}) {
    const response=await fetch('/api/promptflow/marketplace/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
    const data=await response.json();
    if(data.access){access=data.access;updateAccess();render();}
    if(!response.ok||!data.ok)throw new Error(data.message||'The request could not be completed.');
    return data;
  }
  function reviewPurchase(item) {
    if(!access.signed_in){openSubscription();return;}
    const review=el('pfMarketPurchaseReview');
    if(access.tokens<item.price_tokens){review.innerHTML=`<p>You need ${tokens(item.price_tokens-access.tokens)} more. Your balance is ${tokens(access.tokens)}.</p><button class="pf-market-btn" id="pfMarketGetTokens">Get tokens</button>`;el('pfMarketGetTokens').onclick=()=>{close();window.openPromptflowTokens?.();};return;}
    review.innerHTML=`<div class="pf-market-purchase-review"><h3>Confirm token purchase</h3><p>Unlock <strong>${escape(item.name)}</strong> for <strong>${tokens(item.price_tokens)}</strong>. Balance after purchase: ${tokens(access.tokens-item.price_tokens)}. This unlock does not start a run.</p><button class="pf-market-btn primary" id="pfMarketConfirm">Confirm · ${tokens(item.price_tokens)}</button> <button class="pf-market-btn" id="pfMarketCancel">Cancel</button></div>`;
    el('pfMarketCancel').onclick=()=>{review.innerHTML='';el('pfMarketPurchase').focus();};
    el('pfMarketConfirm').focus();
    el('pfMarketConfirm').onclick=async()=>{
      const confirm=el('pfMarketConfirm');confirm.disabled=true;el('pfMarketCancel').disabled=true;el('pfMarketDownloadStatus').textContent='Confirming your purchase…';
      try {const result=await post('purchase/'+item.id,{expected_tokens:item.price_tokens});showDetails(item,lastFocus);el('pfMarketDownloadStatus').textContent=result.charged_tokens?'Unlocked for '+tokens(result.charged_tokens)+'. You can now download or prepare a run.':'Already available. No tokens charged.';window.refreshPromptflowAccount?.();}
      catch(error){el('pfMarketDownloadStatus').textContent=error.message+' Refresh Marketplace to check ownership. Retrying cannot charge an owned workflow twice.';confirm.disabled=false;if(el('pfMarketCancel'))el('pfMarketCancel').disabled=false;}
    };
  }
  async function install(item) {
    const button=el('pfMarketRun');button.disabled=true;el('pfMarketDownloadStatus').textContent='Adding your private workflow…';
    try {const data=await post('install/'+item.id);await window.openMarketplaceWorkflow(data.process.id);}
    catch(error){el('pfMarketDownloadStatus').textContent=error.message;button.disabled=false;}
  }
  function open() {mount();active=true;root.hidden=false;document.body.classList.add('d-market-mode');el('pfMarketBack').focus();load();}
  function openSubscription() {close();window.openPromptflowSubscription?.();}
  function close(restoreFocus=false) {
    active=false;++request;controller?.abort();if(dialog?.open)dialog.close();if(root)root.hidden=true;document.body.classList.remove('d-market-mode');
    document.querySelector('[data-folder="marketplace"]')?.classList.remove('active');
    if(restoreFocus)document.querySelector('[data-folder="marketplace"]')?.focus();
  }
  window.PFMarketplace={open,close};
})();
