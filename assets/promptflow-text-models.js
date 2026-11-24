// Interactive API limits; GPT-6.2 verified against provider documentation, 2026-11-24.
window.PFTextModels = (() => {
  const models = [
    {id:'claude-haiku-5-5',provider:'anthropic',name:'Claude Haiku 5.5',max:128000,output:0.5},
    {id:'claude-sonnet-5-5',provider:'anthropic',name:'Claude Sonnet 5.5',max:128000,output:10},
    {id:'claude-opus-5-5',provider:'anthropic',name:'Claude Opus 5.5',max:128000,output:20},
    {id:'gpt-6-luna',provider:'openai',name:'GPT-6 Luna',max:128000,output:0.5},
    {id:'gpt-6.1-terra',provider:'openai',name:'GPT-6.1 Terra',max:128000,output:5},
    {id:'gpt-6.1-sol',provider:'openai',name:'GPT-6.1 Sol',max:128000,output:10},
    {id:'gpt-6-astra',provider:'openai',name:'GPT-6 Astra',max:128000,output:50},
    {id:'gpt-6.2-sol',provider:'openai',name:'GPT-6.2 Sol',max:128000,output:10},
    {id:'gpt-6.2-astra',provider:'openai',name:'GPT-6.2 Astra',max:128000,output:40},
  ];
  const presets = {
    economy:{name:'Economy',planning:8192,chat:2048,step:2048,tier:0},
    balanced:{name:'Balanced',planning:16000,chat:4096,step:4096,tier:1},
    detailed:{name:'Detailed',planning:32000,chat:16000,step:16000,tier:1},
    deep:{name:'Deep work',planning:64000,chat:32000,step:32000,tier:2},
    maximum:{name:'Model maximum',planning:128000,chat:128000,step:128000,tier:2},
  };
  const qualityPresets = {
    draft:{name:'Fast draft',tier:0,effort:'low',description:'Quick drafts and routine extraction. Lowest model cost and less reasoning.'},
    everyday:{name:'Everyday',tier:1,effort:'medium',description:'General writing, analysis and everyday workflows. Moderate cost and reasoning.'},
    high:{name:'High quality',tier:2,effort:'high',description:'Stronger models and deeper reasoning for difficult work. Raises small response allowances to 32k tokens. Higher cost and latency.'},
    maximum:{name:'Maximum quality',tier:2,effort:'max',description:'Strongest listed models at maximum reasoning effort. Raises small response allowances to 64k tokens. Highest potential cost and latency; results still need review.'},
  };
  const find = id=>models.find(m=>m.id === String(id || '').replace(/^(anthropic|openai):/,''));
  function options(prefixed=true) {
    return ['anthropic','openai'].map(provider=>'<optgroup label="'+(provider === 'openai' ? 'OpenAI (optional)' : 'Anthropic')+'">'+models.filter(m=>m.provider===provider).map(m=>'<option value="'+(prefixed?m.provider+':':'')+m.id+'">'+m.name+' · $'+m.output+'/1M output</option>').join('')+'</optgroup>').join('');
  }
  function preset(settings,key,provider) {
    const p=presets[key]; if (!p) return settings;
    const family=provider === 'openai' ? ['gpt-6-luna','gpt-6.2-sol','gpt-6.2-astra'] : ['claude-haiku-5-5','claude-sonnet-5-5','claude-opus-5-5'];
    const main=provider+':'+family[p.tier], cheap=provider+':'+family[0];
    if (key === 'maximum') return {...settings,limits:{...settings.limits,
      planning_output_tokens:p.planning,chat_output_tokens:p.chat,step_output_tokens:p.step,override_step_limits:true}};
    return {...settings,reasoning_effort:key==='economy'?'low':key==='balanced'?'medium':'high',models:{generate:main,adapt:main,chat:main,run:main,learn:main,search:cheap},limits:{...settings.limits,
      planning_output_tokens:p.planning,chat_output_tokens:p.chat,step_output_tokens:p.step,override_step_limits:true}};
  }
  function qualityPreset(settings,key,provider) {
    const p=qualityPresets[key]; if (!p) return settings;
    provider=provider==='openai'?'openai':'anthropic';
    const family=provider==='openai'?['gpt-6-luna','gpt-6.2-sol','gpt-6.2-astra']:['claude-haiku-5-5','claude-sonnet-5-5','claude-opus-5-5'];
    const model=provider+':'+family[p.tier];
    const allowance=({draft:2048,everyday:8192,high:32000,maximum:64000})[key];
    return {...settings,reasoning_effort:p.effort,override_step_models:true,
      limits:{...settings.limits,chat_output_tokens:Math.max(settings.limits?.chat_output_tokens||0,allowance),
        planning_output_tokens:Math.max(settings.limits?.planning_output_tokens||0,allowance),step_output_tokens:Math.max(settings.limits?.step_output_tokens||0,allowance)},
      models:{...settings.models,generate:model,chat:model,adapt:model,run:model,learn:model,search:provider+':'+family[0]}};
  }
  function selectedQuality(settings) {
    const provider=find(settings.models?.chat)?.provider || 'anthropic';
    return Object.keys(qualityPresets).find(key=>{
      const expected=qualityPreset(settings,key,provider);
      return settings.override_step_models===true && settings.reasoning_effort===expected.reasoning_effort
        && Object.keys(expected.models).every(k=>find(settings.models?.[k])?.id===find(expected.models[k])?.id);
    }) || '';
  }
  function timeout(limits={}) { return Math.min(3600000,Math.max(120000,Number(limits.chat_output_tokens || 4096)*30)); }
  return {models,presets,qualityPresets,find,options,preset,qualityPreset,selectedQuality,timeout};
})();
