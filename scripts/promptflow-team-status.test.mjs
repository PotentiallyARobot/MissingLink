import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const c={window:{}};vm.createContext(c);vm.runInContext(readFileSync(new URL('../assets/promptflow-team-status.js',import.meta.url),'utf8'),c);
const status=(messages,id='a')=>c.window.PFTeamStatus.agentStatus(messages,id);
const running=activity=>({role:'assistant',agent_id:'a',status:'running',activity});
test('each card follows its own latest task and retains the completed outcome',()=>{
 const messages=[{...running([]),status:'complete'},running([{text:'Checking sources'}]),{...running([]),agent_id:'b',status:'complete'}];
 assert.equal(status(messages).label,'Checking sources');assert.equal(status(messages,'b').label,'Completed');assert.equal(status(messages,'c').label,'Ready');
});
test('actual in-flight tool actions survive unrelated progress and finish on their matching result',()=>{
 const m=running([{kind:'command_started',call_id:'cmd',command:'python -m unittest'}, {text:'40 credits reserved'}]);
 assert.equal(status([m]).label,'Running python -m unittest');
 m.activity.push({kind:'command_completed',call_id:'other',exit_code:0});assert.equal(status([m]).label,'Running python -m unittest');
 m.activity.push({kind:'command_completed',call_id:'cmd',exit_code:0});assert.equal(status([m]).label,'Checking command results');
 m.status='interrupted';assert.equal(status([m]).label,'Stopped');assert.equal(status([m]).busy,false);
});
test('web, browser, provisioning and approval states are distinguishable',()=>{
 assert.equal(status([running([{kind:'tool_started',tool:'Web search',call_id:'s'}])]).label,'Searching the web');
 assert.equal(status([running([{kind:'tool_started',tool:'Cloud browser',call_id:'s'}])]).label,'Using the cloud browser');
 assert.equal(status([running([{text:'Starting a private OpenAI sandbox'}])]).label,'Starting sandbox');
 assert.equal(status([running([{kind:'file_changed',path:'output/report.csv'}])]).label,'Updated output/report.csv');
 assert.equal(status([{...running([]),approvals:[{status:'waiting'}]}]).label,'Waiting for browser access');
});
test('coordinator waits for teammates, then combines their results',()=>{
 const m=running([{text:'Delegated to Researcher: check sources'}]),child={...running([]),agent_id:'b'};
 assert.equal(status([m,child]).label,'Waiting for teammates');child.status='complete';assert.equal(status([m,child]).label,'Combining team results');
});
test('budget and other failures remain visible instead of resetting to Ready',()=>{
 assert.equal(status([{...running([]),status:'failed',error:'Task budget reached'}]).label,'Budget reached');
 assert.equal(status([{...running([]),status:'failed',error:'Provider unavailable'}]).label,'Needs attention');
});
