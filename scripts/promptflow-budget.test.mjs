import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../assets/promptflow-budget.js',import.meta.url),'utf8');
const context={window:{},document:{readyState:'loading',addEventListener(){}}};vm.createContext(context);vm.runInContext(source,context);const budget=context.window.PFRunBudget;
test('budget recovery distinguishes per-run and cumulative task costs',()=>{
  assert.equal(budget.issue('run_budget_exceeded: This run costs 5810 PromptFlow credits; your limit is 5000.').required,5810);
  assert.equal(budget.issue('Auto mode stopped at its 5,000-credit task limit. The next run costs 4,000 credits; 3,000 have already been used.').required,7000);
  assert.equal(budget.issue('The provider rate limit was exceeded'),null);
  assert.equal(budget.suggestion(5810,5000),10000);
});
test('visible budget reflects the lower effective limit',()=>{
  assert.equal(budget.limits({limits:{max_run_tokens:3000,auto_chat_max_tokens:5000}}).effective,3000);
  assert.equal(budget.limits({limits:{max_run_tokens:0,auto_chat_max_tokens:25000}}).effective,25000);
});
test('quick budget updates both caps, preserves models and never executes a run',async()=>{
  const html=readFileSync(new URL('../promptflow.html',import.meta.url),'utf8');const hook=html.slice(html.indexOf('  window.pfSetQuickBudget ='),html.indexOf('  // Read settings → publish',html.indexOf('  window.pfSetQuickBudget =')));
  const calls=[],saved=[];const c={window:{pfSettings:{models:{run:'chosen-model'},limits:{chat_output_tokens:64000,max_run_tokens:5000,auto_chat_max_tokens:5000}}},localStorage:{setItem:(k,v)=>saved.push(JSON.parse(v))},PF_SETTINGS_KEY:'test',dMaPublishSettings:s=>c.window.pfSettings=s,dMaFormRevision:0,D:()=>null,fetch:async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return {ok:true};},AbortSignal};vm.createContext(c);vm.runInContext(hook,c);
  await c.window.pfSetQuickBudget(10000);assert.equal(c.window.pfSettings.limits.max_run_tokens,10000);assert.equal(c.window.pfSettings.limits.auto_chat_max_tokens,10000);assert.equal(c.window.pfSettings.limits.chat_output_tokens,64000);assert.equal(c.window.pfSettings.models.run,'chosen-model');assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/promptflow/me/settings');
  await assert.rejects(c.window.pfSetQuickBudget(0));await assert.rejects(c.window.pfSetQuickBudget(1000001));assert.equal(calls.length,1);
});

test('response-limit recovery is distinct from credits, including errors saved before the fix',()=>{
  const old='The agent response reached its output limit. Raise the chat output limit or narrow the task.';
  assert.equal(budget.issue(old),null);assert.equal(budget.outputIssue(old).output,true);
  assert.equal(budget.outputIssue('Preparing the answer reached the 4,096-token response limit').limit,4096);
  assert.equal(budget.outputIssue('Provider unavailable'),null);
  assert.equal(budget.outputSuggestion(4096),32000);assert.equal(budget.outputSuggestion(64000),128000);assert.equal(budget.outputSuggestion(128000),128000);
});
test('response limit persists independently from credit allowance and validates the model maximum',async()=>{
  const html=readFileSync(new URL('../promptflow.html',import.meta.url),'utf8');const hook=html.slice(html.indexOf('  window.pfSetQuickBudget ='),html.indexOf('  // Read settings → publish',html.indexOf('  window.pfSetQuickBudget =')));
  const calls=[],saved=[];const c={window:{pfSettings:{models:{chat:'chosen-model'},limits:{chat_output_tokens:4096,max_run_tokens:50000,auto_chat_max_tokens:50000}}},localStorage:{setItem:(k,v)=>saved.push(JSON.parse(v))},PF_SETTINGS_KEY:'test',dMaPublishSettings:s=>c.window.pfSettings=s,dMaFormRevision:0,D:()=>null,fetch:async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return {ok:true};},AbortSignal};vm.createContext(c);vm.runInContext(hook,c);
  await c.window.pfSetQuickBudget(50000,32000);assert.equal(c.window.pfSettings.limits.chat_output_tokens,32000);assert.equal(c.window.pfSettings.limits.auto_chat_max_tokens,50000);assert.equal(c.window.pfSettings.models.chat,'chosen-model');assert.equal(saved[0].limits.chat_output_tokens,32000);
  assert.equal(calls[0].url,'/api/promptflow/me/settings');assert.equal(calls[0].body.limits.chat_output_tokens,32000);
  for(const invalid of [0,255,128001,NaN])await assert.rejects(c.window.pfSetQuickBudget(50000,invalid));assert.equal(calls.length,1);
});
