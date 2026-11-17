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
