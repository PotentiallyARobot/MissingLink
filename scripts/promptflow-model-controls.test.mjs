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
test('home-page list requests enter streaming discussion before recipe planning',async()=>{
  for(const userText of ['generate a list of processes that are extremely usefu;','create five useful workflow ideas','suggest useful workflows']) {
    const calls=[];const c=vm.createContext({userText,window:{},attachedFiles:[],pendingContrib:null,pendingParentProcess:null,refineBoundProcessId:null,currentEditorProcessId:null,interpreterProcessContext:null,activeInterpreterProcess:()=>null,streamDiscussAnswer:t=>calls.push(t)});
    vm.runInContext(extract('  function interpreterMessageIntent(', '  function activeInterpreterProcess(')+'\nglobalThis.route=async()=>{'+extract('    const earlyIntent = interpreterMessageIntent(', '    // ── Verb dispatcher')+'};',c);
    await c.route();assert.deepEqual(calls,[userText]);
  }
});
