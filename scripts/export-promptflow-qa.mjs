// Export private local QA bundles; never place these in the public assets tree.
import {registerHooks,stripTypeScriptTypes} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
registerHooks({resolve(s,c,n){return n(s.startsWith('./promptflow_')&&!s.endsWith('.ts')?s+'.ts':s,c);},load(u,c,n){return u.endsWith('.ts')?{format:'module',source:stripTypeScriptTypes(readFileSync(fileURLToPath(u),'utf8')),shortCircuit:true}:n(u,c);}});
const backend=path.resolve(process.argv[2]||'C:/missinglink-backend');
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const dest=path.join(root,'tmp/workflow-quality');mkdirSync(dest,{recursive:true});
const {marketplaceCatalog,marketplaceProcess}=await import(pathToFileURL(path.join(backend,'src/promptflow_marketplace.ts')));
const {buildPromptflowBundle}=await import(pathToFileURL(path.join(backend,'src/promptflow_runtime.ts')));
const catalog=marketplaceCatalog();
for(const item of catalog){writeFileSync(path.join(dest,item.id+'.promptflow'),buildPromptflowBundle(marketplaceProcess(item.id)));writeFileSync(path.join(dest,item.id+'-input.txt'),item.sample_input);}
writeFileSync(path.join(dest,'catalog.json'),JSON.stringify(catalog,null,2));
console.log('Exported '+catalog.length+' local QA bundles. No provider calls made.');
