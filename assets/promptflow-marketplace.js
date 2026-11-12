(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // BEGIN PUBLIC CATALOG
  const publicCatalog = [{"id":"image-to-180","name":"Image to 180° Equirectangular","category":"Images & VR","description":"Turn an uploaded photo into an AI-assisted 180° panorama, with a projection guide and a review sheet.","input":"One PNG, JPEG or WebP image. A level landscape or interior photo works best.","deliverables":["Square 1024×1024 monoscopic panorama","Your included projection guide","An HTML review sheet with viewing instructions"],"providers":["OpenAI Images"],"sample_input":"Upload a landscape or interior photo. The central subject is preserved while unseen surroundings are generated.","price_tokens":24000,"input_kinds":["image"],"guide_image":"/assets/promptflow-marketplace/vr180-guide.png","version":"1.0","step_count":3,"activities":["Prepare the 180° projection instructions","Convert the photo and generate missing surroundings","Prepare the panorama and viewing notes"],"preview_image":"/assets/promptflow-marketplace/image-to-180.png","output_kind":"image","download_url":"/api/promptflow/marketplace/download/image-to-180.promptflow"},{"id":"research-brief","name":"Research Brief","category":"Research","description":"Turn a question into a source-linked brief with findings, uncertainties and next steps.","input":"A research question, audience and scope.","deliverables":["Evidence summary with source links","Key findings and open questions","A practical next-step checklist"],"providers":["Anthropic","Brave Search"],"sample_input":"How can a small independent bookstore improve local discoverability? Focus on practical, low-budget ideas and distinguish evidence from suggestions.","price_tokens":12000,"input_kinds":["text"],"guide_image":null,"version":"1.0","step_count":4,"activities":["Focus the research","Find web sources","Draft an evidence brief","Check claims and finalize"],"preview_image":"/assets/promptflow-marketplace/research-brief.png","output_kind":"text","download_url":"/api/promptflow/marketplace/download/research-brief.promptflow"},{"id":"meeting-actions","name":"Meeting Action Plan","category":"Productivity","description":"Convert rough meeting notes into decisions, assigned actions and a recap ready to review.","input":"Meeting notes or a transcript, including attendees when known.","deliverables":["Decisions and action table","Unassigned work and open questions","A concise follow-up email draft"],"providers":["Anthropic"],"sample_input":"Demo planning: Maya will prepare the prototype by Friday. Leon will ask two customers for feedback; no deadline agreed. We chose a five-minute demo. Pricing is still undecided. Next check-in is Tuesday.","price_tokens":6000,"input_kinds":["text"],"guide_image":null,"version":"1.0","step_count":3,"activities":["Identify decisions and actions","Write the action plan","Verify commitments"],"preview_image":"/assets/promptflow-marketplace/meeting-actions.png","output_kind":"text","download_url":"/api/promptflow/marketplace/download/meeting-actions.promptflow"},{"id":"feedback-compass","name":"Feedback Compass","category":"Business","description":"Find recurring themes in customer feedback and turn them into an evidence-based improvement backlog.","input":"Customer feedback entries, ideally one numbered entry per line.","deliverables":["Themes with supporting excerpts","Prioritized improvement backlog","Questions to validate before building"],"providers":["Anthropic"],"sample_input":"1. Setup took too long; I could not find the import button.\n2. I love the reports but want CSV export.\n3. The import button label confused me.\n4. Please add weekly report emails.\n5. Reports are helpful, but exporting them is difficult.","price_tokens":10000,"input_kinds":["text"],"guide_image":null,"version":"1.0","step_count":3,"activities":["Group feedback themes","Draft an improvement backlog","Check the evidence"],"preview_image":"/assets/promptflow-marketplace/feedback-compass.png","output_kind":"text","download_url":"/api/promptflow/marketplace/download/feedback-compass.promptflow"},{"id":"launch-campaign","name":"Launch Campaign Kit","category":"Marketing","description":"Build consistent launch messaging, channel drafts and a practical rollout plan from a product brief.","input":"Product, audience, differentiators, channels and launch constraints.","deliverables":["Positioning and message pillars","Landing-page, email and social drafts","Seven-day rollout and review checklist"],"providers":["Anthropic"],"sample_input":"Launch a reusable lunch container for commuters. Dishwasher-safe, 750 ml, leak-resistant lid. Audience: office workers. Channels: website, email and LinkedIn. No verified environmental impact statistics. Launch in two weeks.","price_tokens":10000,"input_kinds":["text"],"guide_image":null,"version":"1.0","step_count":3,"activities":["Define positioning","Draft campaign assets","Review claims and consistency"],"preview_image":"/assets/promptflow-marketplace/launch-campaign.png","output_kind":"text","download_url":"/api/promptflow/marketplace/download/launch-campaign.promptflow"},{"id":"lesson-studio","name":"Visual Lesson Pack","category":"Education","description":"Create a sourced lesson, an original teaching diagram and a printable HTML handout.","input":"A topic, learner age, learning goals and lesson length.","deliverables":["Learning objectives and explanation","One generated teaching diagram","Worked example, quiz and answer key","Printable HTML lesson"],"providers":["Anthropic","Brave Search","OpenAI Images"],"sample_input":"Explain the water cycle to learners aged 11–13 in a 20-minute lesson. Include evaporation, condensation, precipitation and collection, a worked example and three quiz questions.","price_tokens":16000,"input_kinds":["text"],"guide_image":null,"version":"1.0","step_count":5,"activities":["Plan source search","Find educational sources","Draft the lesson and diagram brief","Generate a teaching diagram","Assemble the printable lesson"],"preview_image":"/assets/promptflow-marketplace/lesson-studio.png","output_kind":"document","download_url":"/api/promptflow/marketplace/download/lesson-studio.promptflow"},{"id":"client-proposal","name":"Client Proposal Builder","category":"Business","description":"Turn a client brief into a scoped proposal with deliverables, milestones and explicit assumptions.","input":"Client goals, constraints, deliverables, timeline and budget if known.","deliverables":["Scope and deliverables","Milestones and acceptance criteria","Assumptions, exclusions and open questions"],"providers":["Anthropic"],"sample_input":"A local bakery needs a five-page website with a menu, location information and a contact form. They want to launch in six weeks. Budget has not been agreed. Photography will be supplied by the client.","price_tokens":10000,"input_kinds":["text"],"guide_image":null,"version":"1.0","step_count":3,"activities":["Extract the project requirements","Draft the proposal","Review scope and assumptions"],"preview_image":"/assets/promptflow-marketplace/client-proposal.png","output_kind":"text","download_url":"/api/promptflow/marketplace/download/client-proposal.promptflow"}];
  // END PUBLIC CATALOG
  const PAGE_SIZE=6;
  let root, dialog, items=publicCatalog, access={}, controller, lastFocus, active=false, request=0, page=1, accessReady=false, lastChecked=0;
  function catalogPage(items,query,category,page) {
    const matches=items.filter(x=>(!category||x.category===category)&&`${x.name} ${x.description} ${x.category} ${x.deliverables.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
    const pages=Math.max(1,Math.ceil(matches.length/PAGE_SIZE));
    page=Math.max(1,Math.min(page,pages));
    return {items:matches.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE),total:matches.length,pages,page};
  }
  async function responseJson(response) {
    if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('The service returned an unexpected response.');
    return response.json();
  }
  const el = id => document.getElementById(id);
  const tokens = n => Number(n||0).toLocaleString()+' tokens';
  const owned = item => access.owned?.includes(item.id);
  const unlocked = item => access.subscribed || owned(item);
  function mount() {
    if (root) return;
    root=document.createElement('section'); root.id='pfMarketplace'; root.className='pf-market'; root.hidden=true; root.setAttribute('aria-label','Marketplace');
    root.innerHTML=`<div class="pf-market-inner"><button class="pf-market-back" id="pfMarketBack" type="button">← Back to workspace</button>
      <div class="pf-market-hero"><h1>Marketplace</h1>
      <aside class="pf-market-membership"><strong id="pfMarketAccess">Buy once with tokens</strong><p>Own individual workflows, or get every download included with your subscription. Run costs are separate.</p><button id="pfMarketSubscribe" class="pf-market-btn primary" type="button">View subscription</button></aside></div>
      <div class="pf-market-toolbar"><input id="pfMarketSearch" type="search" placeholder="Find a workflow…" aria-label="Search Marketplace"><select id="pfMarketCategory" aria-label="Filter Marketplace by category"><option value="">All categories</option></select><span class="pf-market-count" id="pfMarketCount" aria-live="polite"></span></div>
      <div id="pfMarketStatus" class="pf-market-status" role="status"></div><div class="pf-market-grid" id="pfMarketGrid"></div><nav class="pf-market-pages" id="pfMarketPages" aria-label="Marketplace pages"></nav></div>`;
    document.body.appendChild(root);
    dialog=document.createElement('dialog'); dialog.className='pf-market-dialog'; dialog.setAttribute('aria-labelledby','pfMarketDetailTitle'); document.body.appendChild(dialog);
    el('pfMarketBack').onclick=()=>close(true);
    el('pfMarketSearch').oninput=()=>{page=1;render();}; el('pfMarketCategory').onchange=()=>{page=1;render();};
    el('pfMarketSubscribe').onclick=()=>!accessReady||access.subscribed?load():openSubscription();
    dialog.addEventListener('keydown',e=>{if(e.key==='Escape')e.stopPropagation();});
    dialog.addEventListener('close',()=>lastFocus?.focus());
    root.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();close(true);}});
    window.addEventListener('focus',()=>{if(active&&!dialog.open&&Date.now()-lastChecked>60000)load();});
    window.addEventListener('online',()=>{if(active)load();});
    populateCategories();updateAccess();render();
  }
  function updateAccess() {
    el('pfMarketAccess').textContent=!accessReady?'Checking your access…':access.subscribed?'Downloads included':access.signed_in?'Your balance: '+tokens(access.tokens):'Buy once with tokens';
    el('pfMarketSubscribe').textContent=!accessReady?'Check access':access.subscribed?'Refresh access':access.signed_in?'View subscription':'Sign in to subscribe';
  }
  function populateCategories() {
    const category=el('pfMarketCategory').value;
    el('pfMarketCategory').innerHTML='<option value="">All categories</option>'+[...new Set(items.map(x=>x.category))].map(x=>`<option>${escape(x)}</option>`).join('');
    el('pfMarketCategory').value=category;
  }
  async function load() {
    controller?.abort(); controller=new AbortController(); const signal=controller.signal,ticket=++request;
    el('pfMarketStatus').textContent='';
    for(let attempt=0;attempt<2;attempt++) {
      try {
        const response=await fetch('/api/promptflow/marketplace',{credentials:'same-origin',signal:AbortSignal.any([signal,AbortSignal.timeout(12000)])});
        const data=await responseJson(response);
        if(!response.ok||!data.ok||!Array.isArray(data.items))throw new Error('Access unavailable');
        if(ticket!==request||!active)return false;
        items=data.items.map(item=>({...publicCatalog.find(x=>x.id===item.id),...item}));
        access=data.access||{};accessReady=data.access_available!==false;lastChecked=Date.now();
        populateCategories();updateAccess();render();
        if(!accessReady)throw new Error('Access unavailable');
        el('pfMarketStatus').textContent='';
        return true;
      } catch(error) {
        if(ticket!==request||!active||signal.aborted)return false;
        if(attempt===0) {await new Promise(resolve=>setTimeout(resolve,500));continue;}
        // Retain the embedded or last successful catalog. Entitlements are
        // never cached or assumed when an account check fails.
        accessReady=false;access={};updateAccess();render();
        el('pfMarketAccess').textContent='Browse workflows';
        el('pfMarketStatus').textContent='Workflows are available. Account access is temporarily unavailable. ';
        const retry=document.createElement('button');retry.type='button';retry.className='pf-market-btn';retry.textContent='Retry connection';retry.onclick=load;el('pfMarketStatus').appendChild(retry);
        return false;
      }
    }
  }
  function render() {
    const q=el('pfMarketSearch').value.trim().toLowerCase(),category=el('pfMarketCategory').value;
    const result=catalogPage(items,q,category,page);page=result.page;const shown=result.items;
    el('pfMarketCount').textContent=result.total?`${(page-1)*PAGE_SIZE+1}–${Math.min(page*PAGE_SIZE,result.total)} of ${result.total} workflows`:'0 workflows';
    el('pfMarketPages').innerHTML=result.pages>1?`<button type="button" class="pf-market-btn" id="pfMarketPrev" ${page===1?'disabled':''}>← Previous</button><span>Page ${page} of ${result.pages}</span><button type="button" class="pf-market-btn" id="pfMarketNext" ${page===result.pages?'disabled':''}>Next →</button>`:'';
    const turn=delta=>{page+=delta;render();el('pfMarketGrid').scrollIntoView({block:'start'});el('pfMarketGrid').querySelector('button')?.focus({preventScroll:true});};
    if(el('pfMarketPrev'))el('pfMarketPrev').onclick=()=>turn(-1);
    if(el('pfMarketNext'))el('pfMarketNext').onclick=()=>turn(1);
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
      <div class="pf-market-dialog-actions">${!accessReady?`<button type="button" id="pfMarketCheckAccess" class="pf-market-btn primary">Check access to download or run</button>`:unlocked(item)?`<button type="button" id="pfMarketRun" class="pf-market-btn primary">${item.input_kinds.includes('image')?'Upload image & prepare run':'Use in PromptFlow'}</button><button type="button" id="pfMarketDownload" class="pf-market-btn">Download .promptflow</button>`:`<button type="button" id="pfMarketPurchase" class="pf-market-btn primary">${access.signed_in?'Unlock for '+tokens(item.price_tokens):'Sign in to unlock'}</button><button type="button" id="pfMarketDetailSubscribe" class="pf-market-btn">Included with subscription</button>`}<a href="promptflow_learn_more.html#run-locally" target="_blank" rel="noopener">Install &amp; run guide ↗</a></div><div id="pfMarketPurchaseReview"></div><div id="pfMarketDownloadStatus" class="pf-market-status" role="status"></div>
      <details id="pfMarketAfterDownload"><summary>How to run this download</summary><pre>python "${escape(item.id)}.promptflow" --input ${item.input_kinds.includes('image')?'image=photo.jpg':'text=@input.txt'} --check\npython "${escape(item.id)}.promptflow" --input ${item.input_kinds.includes('image')?'image=photo.jpg':'text=@input.txt'}</pre><p>${item.input_kinds.includes('image')?'Put your photo beside the download.':'Save your input in input.txt beside the download.'} Set the provider keys first. Results are saved in <code>promptflow-output/</code>. Remove <code>--check</code> only when ready to make provider calls.</p></details></div>`;
    dialog.querySelector('.pf-market-dialog-close').onclick=()=>dialog.close();
    if(el('pfMarketCheckAccess'))el('pfMarketCheckAccess').onclick=async()=>{el('pfMarketCheckAccess').disabled=true;el('pfMarketDownloadStatus').textContent='Checking your account…';const ok=await load();if(dialog.open){showDetails(item,lastFocus);if(!ok)el('pfMarketDownloadStatus').textContent='Cannot reach your account yet. Your workflow remains available to browse; retry the connection before downloading or running.';}};
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
        const data=await responseJson(response);
        if(response.status===401||response.status===403){access={signed_in:response.status!==401,subscribed:false,owned:[]};updateAccess();render();showDetails(item,lastFocus);}
        throw new Error(data.message||'The download could not be prepared.');
      }
      if(!response.headers.get('content-type')?.includes('application/x-promptflow'))throw new Error('The server did not return a workflow bundle. Please try again.');
      const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download=item.id+'.promptflow';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      status.textContent='Download started. No additional tokens were charged.';instructions.open=true;
    } catch(error) {el('pfMarketDownloadStatus').textContent=error.name==='TimeoutError'?'The download timed out. Try again.':error instanceof TypeError?'Connection interrupted. Retry the download; this does not charge tokens.':error.message;}
    finally {button.disabled=false;}
  }
  async function post(path,body={}) {
    let response;try { response=await fetch('/api/promptflow/marketplace/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)}); } catch {throw new Error('Connection interrupted. Check your connection and retry.');}
    const data=await responseJson(response);
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
