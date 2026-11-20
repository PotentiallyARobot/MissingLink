/* Small, shared conversation-name indicator. No animation work while idle. */
(()=>{
  function set(element,title,busy){
    if(!element)return;
    title=String(title||'');busy=!!busy;
    let name=element.querySelector('.pf-conversation-name');
    if(!name){
      name=document.createElement('span');name.className='pf-conversation-name';
      const spinner=document.createElement('span');spinner.className='pf-conversation-spinner';spinner.setAttribute('aria-hidden','true');
      element.replaceChildren(name,spinner);element.classList.add('pf-conversation-label');
    }
    if(name.textContent!==title)name.textContent=title;
    element.classList.toggle('pf-conversation-working',busy);
    element.dataset.conversationName=title;
    const label=title+(busy?' — Working':'');
    element.title=label;element.setAttribute('aria-label',label);
  }
  window.PFConversationStatus={set};
})();
