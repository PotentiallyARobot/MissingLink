import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../assets/promptflow-marketplace.js',import.meta.url),'utf8');
function context(fetch) {
  const elements=new Map();
  const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',children:[],appendChild(x){this.children.push(x);}});return elements.get(id);};
  const c=vm.createContext({window:{},document:{getElementById:element,createElement:()=>({})},AbortController,AbortSignal,Date,TypeError,fetch,setTimeout:fn=>{fn();}});
  vm.runInContext(source.replace('window.PFMarketplace={open,close};',`window.PFMarketplace={load,catalogPage,responseJson,state:()=>({items,access,accessReady}),activate:()=>{active=true;},deactivate:()=>{active=false;++request;controller?.abort();}}; render=()=>{};updateAccess=()=>{};populateCategories=()=>{};`),c);
  c.window.PFMarketplace.activate();return {api:c.window.PFMarketplace,element};
}
test('failed network retries once, preserves browsable listings, and grants no entitlement',async()=>{
  let calls=0;const {api,element}=context(async()=>{calls++;throw new TypeError('Failed to fetch');});
  const count=api.state().items.length;assert.ok(count>=7);
  assert.equal(await api.load(),false);assert.equal(calls,2);assert.equal(api.state().items.length,count);
  assert.equal(api.state().accessReady,false);assert.equal(api.state().access.subscribed,undefined);
  assert.match(element('pfMarketStatus').textContent,/Workflows are available/);
  assert.equal(element('pfMarketStatus').children[0].textContent,'Retry connection');
});
test('a successful retry restores access without dropping catalog metadata',async()=>{
  let calls=0;const {api}=context(async()=>{if(++calls===1)throw new TypeError('interrupted');return Response.json({ok:true,items:[{id:'research-brief',name:'Research Brief'}],access:{signed_in:true,subscribed:true}});});
  assert.equal(await api.load(),true);assert.equal(api.state().accessReady,true);assert.equal(api.state().access.subscribed,true);
  assert.ok(api.state().items[0].sample_input);
});
test('HTML errors do not erase the catalog or leak JSON parser errors into the UI',async()=>{
  const {api,element}=context(async()=>new Response('<!doctype html><h1>Proxy error</h1>',{status:502,headers:{'content-type':'text/html'}}));
  await api.load();assert.ok(api.state().items.length>=7);assert.doesNotMatch(element('pfMarketStatus').textContent,/Unexpected token|DOCTYPE|Failed to fetch/);
});
test('late account responses after closing cannot change access',async()=>{
  let respond;const {api}=context(()=>new Promise(resolve=>{respond=resolve;}));const request=api.load();api.deactivate();
  respond(Response.json({ok:true,items:[],access:{subscribed:true}}));await request;
  assert.equal(api.state().accessReady,false);assert.ok(api.state().items.length>=7);
});
test('pagination covers every result once, clamps filtered pages, and supports empty results',()=>{
  const {api}=context();const items=Array.from({length:19},(_,i)=>({id:String(i),name:'Workflow '+i,category:i%2?'Images':'Code',description:'',deliverables:[]}));
  const ids=[1,2,3,4].flatMap(page=>api.catalogPage(items,'','',page).items.map(x=>x.id));assert.equal(new Set(ids).size,19);
  const filtered=api.catalogPage(items,'','Code',4);assert.equal(filtered.page,2);assert.equal(filtered.total,10);
  assert.equal(api.catalogPage(items,'absent','',3).total,0);
});
