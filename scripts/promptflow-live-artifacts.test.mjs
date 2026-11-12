// Validate the actual synthetic QA artifacts, not a canned fixture.
// Run after scripts/promptflow-live-samples.py. No provider calls or credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const root=path.resolve('tmp/marketplace-live-samples');
test('generated website has complete markup, artwork and usable internal links',()=>{
  const html=fs.readFileSync(path.join(root,'website-rebrand/output-0-html_url.html'),'utf8');
  assert.match(html,/<!doctype html>/i);assert.match(html,/Fern\s*(?:&amp;|&)\s*Field/i);
  assert.match(html,/data:image\/png;base64,/);assert.doesNotMatch(html,/__HERO_IMAGE__/);
  assert.match(html,/connect-src 'none'/);
  const ids=new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map(m=>m[1]));
  for(const [,id] of html.matchAll(/href=["']#([^"']+)["']/g))assert.ok(ids.has(id),'Missing anchor: '+id);
});
test('generated game runs controls, scoring, collisions, timer and restart without network or DOM privileges',()=>{
  const html=fs.readFileSync(path.join(root,'browser-game/output-0-html_url.html'),'utf8');
  const script=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).join('\n');
  const events={},canvasEvents={},frames=new Map();let next=0;
  const ctx=new Proxy({},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
  const canvas={getContext:()=>ctx,focus(){},setPointerCapture(){},getBoundingClientRect:()=>({left:0,top:0,width:840,height:520}),addEventListener:(n,f)=>canvasEvents[n]=f};
  const elements={'#game':canvas,'#status':{},'#start':{}};
  const sandbox=vm.createContext({document:{querySelector:s=>elements[s]},window:{addEventListener:(n,f)=>events[n]=f},
    Image:class{complete=false;naturalWidth=0},performance:{now:()=>0},
    requestAnimationFrame:f=>{frames.set(++next,f);return next;},cancelAnimationFrame:id=>frames.delete(id)});
  vm.runInContext(script,sandbox,{timeout:1000});
  const read=s=>vm.runInContext(s,sandbox,{timeout:1000});
  const tick=t=>{const entry=[...frames][0];assert.ok(entry);frames.delete(entry[0]);entry[1](t);};
  elements['#start'].onclick();assert.equal(frames.size,1);
  const x=read('player.x');events.keydown({key:'ArrowRight',preventDefault(){}});tick(40);assert.ok(read('player.x')>x);
  events.keyup({key:'ArrowRight'});assert.equal(read('keys.size'),0);
  read('objects=[{x:player.x,y:player.y,good:true,rot:0,sz:14}]');tick(80);assert.equal(read('score'),10);
  read('objects=[{x:player.x,y:player.y,good:false,rot:0,sz:14}]');tick(120);assert.equal(read('shields'),2);
  canvasEvents.pointerdown({pointerId:1,clientX:100,clientY:200});assert.equal(read('player.x'),100);assert.equal(read('player.y'),200);
  read('elapsed=44.99');tick(160);assert.equal(read('running'),false);assert.equal(frames.size,0);assert.match(elements['#status'].textContent,/Shift complete/);
  elements['#start'].onclick();elements['#start'].onclick();assert.equal(frames.size,1);assert.equal(read('score'),0);assert.equal(read('shields'),3);
  read('shields=1;hurt=0;objects=[{x:player.x,y:player.y,good:false,rot:0,sz:14}]');tick(200);assert.equal(read('running'),false);assert.match(elements['#status'].textContent,/Shields down/);
});
