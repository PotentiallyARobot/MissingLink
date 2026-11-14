// Interactive API limits verified against provider documentation, 2026-11-14.
window.PFTextModels = (() => {
  const models = [
    {id:'claude-haiku-5-5',provider:'anthropic',name:'Claude Haiku 5.5',max:128000,output:0.5},
    {id:'claude-sonnet-5-5',provider:'anthropic',name:'Claude Sonnet 5.5',max:128000,output:10},
    {id:'claude-opus-5-5',provider:'anthropic',name:'Claude Opus 5.5',max:128000,output:20},
    {id:'gpt-6-luna',provider:'openai',name:'GPT-6 Luna',max:128000,output:0.5},
    {id:'gpt-6.1-terra',provider:'openai',name:'GPT-6.1 Terra',max:128000,output:5},
    {id:'gpt-6.1-sol',provider:'openai',name:'GPT-6.1 Sol',max:128000,output:10},
    {id:'gpt-6-astra',provider:'openai',name:'GPT-6 Astra',max:128000,output:50},
  ];
  const presets = {
    economy:{name:'Economy',planning:8192,chat:2048,step:2048,tier:0},
    balanced:{name:'Balanced',planning:16000,chat:4096,step:4096,tier:1},
    detailed:{name:'Detailed',planning:32000,chat:16000,step:16000,tier:1},
    deep:{name:'Deep work',planning:64000,chat:32000,step:32000,tier:2},
    maximum:{name:'Model maximum',planning:128000,chat:128000,step:128000,tier:2},
  };
  const find = id=>models.find(m=>m.id === String(id || '').replace(/^(anthropic|openai):/,''));
  function options(prefixed=true) {
    return ['anthropic','openai'].map(provider=>'<optgroup label="'+(provider === 'openai' ? 'OpenAI (optional)' : 'Anthropic')+'">'+models.filter(m=>m.provider===provider).map(m=>'<option value="'+(prefixed?m.provider+':':'')+m.id+'">'+m.name+' · $'+m.output+'/1M output</option>').join('')+'</optgroup>').join('');
  }
  function preset(settings,key,provider) {
    const p=presets[key]; if (!p) return settings;
    const family=provider === 'openai' ? ['gpt-6-luna','gpt-6.1-sol','gpt-6-astra'] : ['claude-haiku-5-5','claude-sonnet-5-5','claude-opus-5-5'];
    const main=provider+':'+family[p.tier], cheap=provider+':'+family[0];
    if (key === 'maximum') return {...settings,limits:{...settings.limits,
      planning_output_tokens:p.planning,chat_output_tokens:p.chat,step_output_tokens:p.step,override_step_limits:true}};
    return {...settings,models:{generate:main,adapt:main,chat:main,run:main,learn:main,search:cheap},limits:{...settings.limits,
      planning_output_tokens:p.planning,chat_output_tokens:p.chat,step_output_tokens:p.step,override_step_limits:true}};
  }
  function timeout(limits={}) { return Math.min(3600000,Math.max(120000,Number(limits.chat_output_tokens || 4096)*30)); }
  return {models,presets,find,options,preset,timeout};
})();
