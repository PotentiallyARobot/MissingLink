import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../promptflow.html',import.meta.url),'utf8');
const models=readFileSync(new URL('../assets/promptflow-text-models.js',import.meta.url),'utf8');
const extract=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
function harness() {
  const nodes=new Map();const D=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:false,textContent:'',innerHTML:''});return nodes.get(id);};
  const c=vm.createContext({window:{},D,dMaUpdateKeySection(){}});
  vm.runInContext(models+extract('  function dMaApplyToForm(', '  function dMaUpdateKeySection(')+'\nglobalThis.apply=dMaApplyToForm;globalThis.read=dMaReadFromForm;',c);
  return {c,D};
}
test('max preset round-trips through actual form and preserves the credit and loop caps',()=>{
  const {c,D}=harness();
  const settings=c.window.PFTextModels.preset({keys:{},models:{chat:'openai:gpt-6.1-sol'},limits:{max_run_tokens:5000,max_loop_items:5}},'maximum','openai');
  c.apply(settings);const result=c.read();
  assert.equal(D('dMaModelChat').value,'openai:gpt-6.1-sol');assert.equal(result.limits.chat_output_tokens,128000);assert.equal(result.limits.planning_output_tokens,128000);assert.equal(result.limits.override_step_limits,true);assert.equal(result.limits.max_run_tokens,5000);assert.equal(result.limits.max_loop_items,5);
  assert.match(D('dMaBudgetSummary').textContent,/1.2800/);
  for(const field of ['dMaModelRun','dMaModelGenerate','dMaModelAdapt','dMaModelSearch','dMaModelLearn']) assert.match(D(field).innerHTML,/gpt-6.1-sol/);
});
test('custom budgets and canonical server model names survive reopening settings',()=>{
  const {c,D}=harness();c.apply({keys:{},models:{chat:'gpt-6.1-sol',run:'claude-sonnet-5-5'},limits:{chat_output_tokens:90000,planning_output_tokens:75000,step_output_tokens:64000}});
  assert.equal(D('dMaModelChat').value,'openai:gpt-6.1-sol');assert.equal(c.read().limits.chat_output_tokens,90000);assert.equal(c.read().limits.planning_output_tokens,75000);
  assert.equal(c.window.PFTextModels.timeout({chat_output_tokens:128000}),3600000);
});

test('saved OpenAI choices survive the actual storage loader and the reopened form',()=>{
  const {c,D}=harness();
  for (const chat of ['openai:gpt-6-luna','gpt-6.1-sol','anthropic:claude-sonnet-4-6']) {
    c.PF_SETTINGS_KEY='test';
    c.localStorage={getItem:()=>JSON.stringify({models:{chat},limits:{chat_output_tokens:128000}})};
    vm.runInContext(extract('  function dMaLoadSettings(', '  function dMaApplyToForm(')+'\nglobalThis.loadSettings=dMaLoadSettings;',c);
    c.apply(c.loadSettings());
    const expected=chat.includes('claude')?'anthropic:claude-sonnet-5-5':chat.startsWith('openai:')?chat:'openai:'+chat;
    assert.equal(D('dMaModelChat').value,expected);
    assert.equal(c.read().limits.chat_output_tokens,128000);
  }
});
test('home-page list requests enter streaming discussion before recipe planning',async()=>{
  for(const userText of ['generate a list of processes that are extremely usefu;','create five useful workflow ideas','suggest useful workflows']) {
    const calls=[];const c=vm.createContext({userText,window:{},attachedFiles:[],pendingContrib:null,pendingParentProcess:null,refineBoundProcessId:null,currentEditorProcessId:null,interpreterProcessContext:null,activeInterpreterProcess:()=>null,streamDiscussAnswer:t=>calls.push(t)});
    vm.runInContext(extract('  function interpreterMessageIntent(', '  function activeInterpreterProcess(')+'\nglobalThis.route=async()=>{'+extract('    const earlyIntent = interpreterMessageIntent(', '    // ── Verb dispatcher')+'};',c);
    await c.route();assert.deepEqual(calls,[userText]);
  }
});

test('quality presets change models and effort while preserving every output and spending limit',()=>{
  const {c,D}=harness();
  for(const provider of ['anthropic','openai']) for(const key of ['draft','everyday','high','maximum']) {
    const before={keys:{},models:{chat:'claude-sonnet-5-5'},limits:{chat_output_tokens:64000,planning_output_tokens:32000,step_output_tokens:8192,max_run_tokens:500,max_loop_items:5,override_step_limits:false}};
    const preset=c.window.PFTextModels.qualityPreset(before,key,provider);
    assert.deepEqual(preset.limits,before.limits);
    c.apply(preset); const read=c.read();
    assert.equal(read.reasoning_effort,c.window.PFTextModels.qualityPresets[key].effort);
    assert.equal(read.override_step_models,true);assert.equal(read.limits.chat_output_tokens,64000);
    assert.equal(D('dMaQualityPreset').value,key);assert.equal(c.window.PFTextModels.find(read.models.chat).provider,provider);
    read.models.chat='';assert.equal(c.window.PFTextModels.selectedQuality(read),'');
  }
});

test('quality survives storage and is sent with live requests without keys',()=>{
  const {c,D}=harness();
  const settings=c.window.PFTextModels.qualityPreset({keys:{},limits:{chat_output_tokens:32000}},'maximum','openai');
  c.PF_SETTINGS_KEY='test'; c.localStorage={getItem:()=>JSON.stringify(settings)};
  vm.runInContext(extract('  function dMaLoadSettings(', '  function dMaApplyToForm(')+'\nglobalThis.loadSettings=dMaLoadSettings;',c);
  c.apply(c.loadSettings());assert.equal(D('dMaQualityPreset').value,'maximum');
  let sent;
  c.Headers=Headers;c.URL=URL;c.location={href:'https://example.test/promptflow',origin:'https://example.test'};
  c.window.pfSettings=c.read();c.window.fetch=async(_url,init)=>{sent=JSON.parse(init.headers.get('X-PF-Settings'));};
  vm.runInContext(extract('  (function installSettingsFetchHeader()', '  async function dMaSave('),c);
  c.window.fetch('/api/promptflow/discuss/stream',{});
  assert.equal(sent.reasoning_effort,'max');assert.equal(sent.override_step_models,true);assert.equal(sent.keys,undefined);
});
