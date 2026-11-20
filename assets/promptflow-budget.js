window.PFRunBudget=(()=>{
  const presets=[5000,10000,25000,50000,100000,250000,1000000];
  const number=value=>Number(String(value).replace(/,/g,''));
  function issue(message){const text=String(message||'');if(!/run_budget_exceeded|auto mode stopped at|task limit.*next run costs/i.test(text))return null;
    const required=number(text.match(/(?:run costs|next run costs)\s+([\d,]+)/i)?.[1]||0),spent=number(text.match(/([\d,]+) have already been used/i)?.[1]||0);return {required:required+spent};}
  function outputIssue(message,details){
    if(details?.code==='chat_output_limit')return {...details,output:true};
    if(/agent response reached its output limit|reached the [\d,]+-token response limit|chat output limit/i.test(String(message||'')))return {output:true,limit:number(String(message).match(/([\d,]+)-token response limit/)?.[1]||0)};
    return null;
  }
  const responseMax=()=>window.PFTextModels?.find(window.pfSettings?.models?.chat)?.max||128000;
  function outputSuggestion(current,max=128000){return Math.min(max,Math.max(32000,current*2));}
  function limits(settings){const s=settings?.limits||{},task=Number(s.auto_chat_max_tokens)||5000,run=Number(s.max_run_tokens)||0;return {task,run,effective:run?Math.min(task,run):task};}
  function suggestion(required,current){return presets.find(n=>n>=Math.max(required,current))||Math.min(1000000,Math.ceil(Math.max(required,current)));}
  let dialog,input,outputInput,status,chip,selectedError;
  const el=(parent,tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;parent.append(n);return n;};
  function update(){if(!chip)return;const s=limits(window.pfSettings);chip.textContent='Budget '+s.effective.toLocaleString()+' ▾';chip.title='Run budget: '+s.effective.toLocaleString()+' credits';chip.setAttribute('aria-label','Run budget: '+s.effective.toLocaleString()+' credits');}
  function open(details={}){
    selectedError=details;const s=limits(window.pfSettings);input.value=details.required?suggestion(details.required,s.effective):s.effective;
    const current=Number(window.pfSettings?.limits?.chat_output_tokens)||4096;
    outputInput.max=responseMax();outputInput.value=details.output?outputSuggestion(Math.max(current,details.limit||0),responseMax()):current;
    dialog.querySelector('.pf-budget-context').textContent=details.output?`The response allowance ran out${details.stage?' during '+details.stage.toLowerCase():''}. Raising the credit budget alone does not change it.`:details.required?`This task needs at least ${details.required.toLocaleString()} credits. Your current Chat Auto limit is ${s.effective.toLocaleString()}.`:`Current Chat Auto limit: ${s.effective.toLocaleString()} credits${s.run?' · per-run cap: '+s.run.toLocaleString():''}.`;
    status.textContent='';dialog.showModal();const target=details.output?outputInput:input;target.focus();target.select();
  }
  function mountError(parent,message,metadata){const details=outputIssue(message,metadata)||issue(message);if(!details||parent.querySelector('.pf-budget-increase'))return;
    const b=el(parent,'button',details.output?'Adjust response limit':'Increase budget','pf-budget-increase');b.type='button';b.onclick=()=>open(details);
  }
  function init(){
    const wrap=document.querySelector('.input-bar');if(!wrap)return;
    chip=el(wrap,'button',null,'pf-quick-budget');chip.type='button';chip.onclick=()=>open();document.getElementById('sendBtn')?.before(chip);
    dialog=el(document.body,'dialog',null,'pf-budget-dialog');dialog.setAttribute('aria-labelledby','pfBudgetTitle');const form=el(dialog,'form');const header=el(form,'header');el(header,'h2','Run budget').id='pfBudgetTitle';const close=el(header,'button','×','pf-budget-close');close.type='button';close.setAttribute('aria-label','Close budget settings');close.onclick=()=>dialog.close();
    el(form,'p',null,'pf-budget-context');const choices=el(form,'div',null,'pf-budget-presets');for(const amount of presets){const b=el(choices,'button',amount.toLocaleString());b.type='button';b.onclick=()=>{input.value=amount;input.focus();};}
    const label=el(form,'label','Custom credit limit');input=el(label,'input');input.type='number';input.min='1';input.max='1000000';input.step='1';input.required=true;input.setAttribute('aria-label','Custom credit limit');
    el(form,'p','Applies to each run and the combined runs in a Chat Auto task. Your available credit balance still applies.','pf-budget-help');
    const outputLabel=el(form,'label','Chat response limit · tokens');outputInput=el(outputLabel,'input');outputInput.type='number';outputInput.min='256';outputInput.max=responseMax();outputInput.step='1';outputInput.required=true;outputInput.setAttribute('aria-label','Chat response limit in tokens');
    const outputChoices=el(form,'div',null,'pf-budget-presets pf-output-presets');for(const [label,value] of [['16k',16000],['32k',32000],['64k',64000],['Model maximum',null]]){const b=el(outputChoices,'button',label);b.type='button';b.onclick=()=>{outputInput.max=responseMax();outputInput.value=Math.min(value||responseMax(),responseMax());outputInput.focus();};}
    el(form,'p','Includes reasoning and the answer, per response. Deep reasoning may use the allowance before producing visible text. Larger limits can increase cost and waiting time.','pf-budget-help');el(form,'p','Saving changes the next request. It does not restart this task or spend credits.','pf-budget-help');
    const actions=el(form,'div',null,'pf-budget-actions'),save=el(actions,'button','Save budget','pf-budget-save');save.type='submit';status=el(form,'p',null,'pf-budget-status');status.setAttribute('role','status');
    save.textContent='Save limits';
    form.onsubmit=async e=>{e.preventDefault();if(!input.reportValidity()||!outputInput.reportValidity())return;save.disabled=true;status.textContent='Saving…';try{const value=number(input.value);const result=await window.pfSetQuickBudget(value,number(outputInput.value));update();status.textContent=result.synced?'Limits saved. Send your next message when ready.':'Limits applied in this browser. Account sync is unavailable; your next request will use the new limits.';if(selectedError.required&&value<selectedError.required)status.textContent+=' This is still below the amount this task needs.';}catch(e){status.textContent=e.message;}finally{save.disabled=false;}};
    window.addEventListener('pf-settings-changed',update);update();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
  return {issue,outputIssue,outputSuggestion,limits,suggestion,open,mountError};
})();
