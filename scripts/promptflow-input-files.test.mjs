import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const c=vm.createContext({window:{},File});
vm.runInContext(readFileSync(new URL('../assets/promptflow-input-files.js',import.meta.url),'utf8'),c);
const api=c.window.PFInputFiles;
function composer(entries=[]) {
  let paste,prevented=false,error;
  const input={addEventListener(name,fn){assert.equal(name,'paste');paste=fn;},value:'Explain this code'};
  api.bind(input,{getEntries:()=>entries,add:file=>entries.push(file),onError:message=>{error=message;}});
  return {input,entries,paste(text,files=[]){paste({clipboardData:{getData:()=>text,files},preventDefault(){prevented=true;}});return{prevented,error};}};
}
test('a long paste becomes a separate file and preserves typed instructions and every byte',async()=>{
  const h=composer(),content='# Code sample\r\n'+('const message = "你好 👋";\r\n'.repeat(120))+'TAIL_SENTINEL';
  assert.equal(h.paste(content).prevented,true);assert.equal(h.input.value,'Explain this code');assert.equal(h.entries.length,1);
  assert.equal(await h.entries[0].file.text(),content);
  const form=new FormData();form.set('text',h.input.value);api.append(form,h.entries);
  assert.equal(form.get('text'),'Explain this code');assert.equal(await form.get('text_files').text(),content);
});
test('short text and clipboard image pastes keep their normal behavior',()=>{
  assert.equal(composer().paste('a normal message').prevented,false);
  assert.equal(composer().paste('x'.repeat(3000),[{}]).prevented,false);
  assert.equal(api.largePaste('line\n'.repeat(30)),true);
});
test('multiple pastes get distinct filenames and excessive data leaves the existing draft intact',()=>{
  const h=composer();h.paste('a'.repeat(2000));h.paste('b'.repeat(2000));
  assert.equal(h.entries[1].file.name,'Pasted text 2.txt');
  assert.match(h.paste('x'.repeat(201*1024)).error,/200 KB/);assert.equal(h.entries.length,2);assert.equal(h.input.value,'Explain this code');
  for(let i=0;i<6;i++)h.paste('z'.repeat(2000));assert.match(h.paste('more'.repeat(600)).error,/8 text files/);assert.equal(h.entries.length,8);
});
