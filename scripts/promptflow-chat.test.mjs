import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../assets/promptflow-chat.js',import.meta.url),'utf8');
const c=vm.createContext({window:{},TextDecoder,Uint8Array});vm.runInContext(source,c);
function streamed(parts){let canceled=false;return{response:new Response(new ReadableStream({start(controller){for(const part of parts)controller.enqueue(new TextEncoder().encode(part));controller.close();},cancel(){canceled=true;}})),canceled:()=>canceled};}
test('Chat streams real actions and returns once, even when frames cross chunks',async()=>{
  const events=[],s=streamed(['event: stage\r\ndata: {"message":"Checking',' the output"}\r\n\r\nevent: done\r\ndata: {"result":{"action":"complete"}}\r\n\r\n']);
  const result=await c.window.PFAutoChat.read(s.response,(...v)=>events.push(v));assert.equal(result.result.action,'complete');assert.equal(events.length,2);assert.equal(events[0][1].message,'Checking the output');
});
test('a lost connection or denied request never looks like success',async()=>{
  await assert.rejects(c.window.PFAutoChat.read(streamed(['event: heartbeat\ndata: {}\n\n']).response,()=>{}),/interrupted/);
  await assert.rejects(c.window.PFAutoChat.read(Response.json({message:'Balance too low'},{status:402}),()=>{}),/Balance too low/);
});
test('mode choices are keyboard buttons and automatic work precedes interpreter heuristics',()=>{
  const html=readFileSync(new URL('../promptflow.html',import.meta.url),'utf8');
  assert.match(html,/<button[^>]+id="chatModeBtn"[^>]+aria-pressed="false"/);assert.match(html,/id="interpreterModeBtn"/);
  const send=html.slice(html.indexOf('  async function send()'),html.indexOf('    const earlyIntent'));
  assert.match(send,/composerMode === 'chat'/);assert.match(send,/await sendAutoChat/);
  assert.match(html,/auto_chat_max_tokens: Number\(D\("dMaAutoChatLimit"\)/);
});

test('chat prose renders tables and emphasis while model HTML stays inert',()=>{
  class Node {constructor(tag,text=''){this.tagName=tag.toUpperCase();this.textContent=text;this.children=[];}append(...nodes){this.children.push(...nodes);}}
  c.document={createElement:tag=>new Node(tag),createTextNode:text=>new Node('#text',text)};
  const root=new Node('div');c.window.PFAutoChat.markdown(root,'## Result\n\n**Checked** <img src=x onerror=alert(1)> [bad](javascript:alert)\n\n| Owner | Due |\n| --- | --- |\n| Maya | Friday |\n\n[Source](https://example.com)');
  const all=[];const visit=node=>{all.push(node);node.children.forEach(visit);};visit(root);
  assert.ok(all.some(n=>n.tagName==='TABLE'));assert.ok(all.some(n=>n.tagName==='STRONG'&&n.textContent==='Checked'));
  assert.equal(all.filter(n=>n.tagName==='A').length,1);assert.equal(all.find(n=>n.tagName==='A').href,'https://example.com');
  assert.ok(!all.some(n=>n.tagName==='IMG'||n.tagName==='SCRIPT'));assert.ok(all.some(n=>n.textContent.includes('<img')));
});
