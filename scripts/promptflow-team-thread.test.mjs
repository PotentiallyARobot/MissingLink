import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const ctx=vm.createContext({window:{}});vm.runInContext(readFileSync(new URL('../assets/promptflow-team-thread.js',import.meta.url),'utf8'),ctx);
const {recipient,visible,name}=ctx.window.PFTeamThread;
const agents=[{id:'coordinator',name:'Coordinator'},{id:'researcher',name:'Researcher'},{id:'reviewer',name:'Reviewer'}];
const messages=[{id:'u',role:'user',target:'team'},{id:'c',role:'assistant',agent_id:'coordinator',agent_name:'Coordinator',to:'user',created:1},{id:'r',role:'assistant',agent_id:'researcher',to:'coordinator',created:2},{id:'dm',role:'user',target:'reviewer'},{id:'v',role:'assistant',agent_id:'reviewer',to:'user',created:3}];
test('coordinator view includes relevant replies but excludes unrelated direct conversations',()=>{
 assert.deepEqual(messages.filter(m=>visible(m,'coordinator',messages,agents)).map(m=>m.id),['u','c','r']);
 assert.deepEqual(messages.filter(m=>visible(m,'reviewer',messages,agents)).map(m=>m.id),['u','dm','v']);
 assert.ok(messages.every(m=>visible(m,'',messages,agents)));assert.equal(name('user',agents),'You');assert.equal(recipient(messages[2],messages,agents),'coordinator');
});
test('legacy replies infer recipients only from an explicit delegation',()=>{
 const legacy=[{role:'assistant',id:'c',agent_id:'coordinator',created:1,activity:[{text:'Delegated to Researcher: Check the report'}]},{role:'assistant',id:'r',agent_id:'researcher',agent_name:'Researcher',created:2},{role:'assistant',id:'v',agent_id:'reviewer',agent_name:'Reviewer',created:2}];
 assert.equal(recipient(legacy[1],legacy,agents),'coordinator');assert.equal(recipient(legacy[2],legacy,agents),'user');
});

test('legacy delegation does not mislabel a later direct reply',()=>{
 const legacy=[{role:'assistant',id:'c',agent_id:'coordinator',created:1,activity:[{text:'Delegated to Researcher: Check the report'}]},{role:'user',id:'u',target:'researcher',created:3},{role:'assistant',id:'r',agent_id:'researcher',agent_name:'Researcher',created:4}];
 assert.equal(recipient(legacy[2],legacy,agents),'user');assert.equal(visible(legacy[2],'coordinator',legacy,agents),false);
});
