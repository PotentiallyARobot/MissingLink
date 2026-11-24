import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.textContent='';this.open=false;this.classList={toggle(){},remove(){}};}
 append(...items){this.children.push(...items);}
 replaceChildren(...items){this.children=items;}
 setAttribute(k,v){this[k]=v;}
 querySelectorAll(){return [];}
}
function ui(debug=false){const c=vm.createContext({window:{},document:{createElement:t=>new Element(t)}});vm.runInContext(readFileSync(new URL('../assets/promptflow-actions.js',import.meta.url),'utf8'),c);const root=new Element('div');return {root,receive:(debug?c.window.PFDebugConsole:c.window.PFActions).mount(root)};}
function all(root){return [root,...root.children.flatMap(all)];}
test('command starts then updates one expandable row with actual output and failure code',()=>{
 const {root,receive}=ui();receive({kind:'command_started',call_id:'a',command:'python build.py'});
 receive({kind:'command_completed',call_id:'a',command:'python build.py',exit_code:1,text:'AssertionError: bad output',duration_ms:1200});
 assert.equal(all(root).filter(n=>n.tagName==='details').length,1);
 assert.ok(all(root).some(n=>n.textContent==='Exit 1 · 1.2s'));
 assert.ok(all(root).some(n=>n.tagName==='pre'&&n.textContent==='AssertionError: bad output'));
});

test('visible console appends real output, stays inert, respects collapse and replaces final snapshots',()=>{
 const {root,receive}=ui(true);receive({kind:'command_started',call_id:'run',command:'python -u app.py'});
 const box=all(root).find(n=>n.tagName==='details');assert.equal(box.open,true);box.open=false;
 receive({kind:'command_output',call_id:'run',text:'<script>not HTML</script>\n'});
 receive({kind:'command_output',call_id:'run',text:'progress\n'});
 assert.ok(all(root).some(n=>n.textContent==='<script>not HTML</script>\nprogress\n'));assert.equal(box.open,false);
 receive({kind:'command_completed',call_id:'run',exit_code:0,text:'final snapshot'});receive.finish();
 assert.equal(all(root).filter(n=>n.tagName==='details').length,1);
 assert.ok(all(root).some(n=>n.textContent==='final snapshot'));assert.ok(all(root).some(n=>n.textContent==='Exit 0'));
 assert.equal(receive({kind:'thinking',text:'private'}),false);
});
test('file rows show measured counts and correct line numbers; code stays inert',()=>{
 const {root,receive}=ui();receive({kind:'file_changed',call_id:'a',path:'app.js',change:'modified',added:1,removed:1,diff:'@@ -9,2 +9,2 @@\n same\n-old\n+<script>evil()</script>'});
 const nodes=all(root),lines=nodes.filter(n=>n.tagName==='tr');
 assert.deepEqual(lines[2].children.slice(0,2).map(n=>n.textContent),['10','']);
 assert.deepEqual(lines[3].children.slice(0,2).map(n=>n.textContent),['','10']);
 assert.ok(nodes.some(n=>n.textContent==='+<script>evil()</script>'));
 assert.ok(!nodes.some(n=>n.tagName==='script'));
 assert.ok(nodes.some(n=>n.textContent==='1 file changed'));
 assert.equal(receive({kind:'thinking',text:'private'}),false);
});
