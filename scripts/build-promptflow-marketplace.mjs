// Embed public catalog metadata in the UI: browsing never waits on account APIs.
import {registerHooks,stripTypeScriptTypes} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
registerHooks({
  resolve(specifier,context,next){if(specifier.startsWith('./promptflow_')&&!specifier.endsWith('.ts'))specifier+='.ts';return next(specifier,context);},
  load(url,context,next){if(url.endsWith('.ts'))return {format:'module',source:stripTypeScriptTypes(readFileSync(fileURLToPath(url),'utf8')),shortCircuit:true};return next(url,context);}
});
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const backend=process.argv[2]||path.resolve(root,'../../../missinglink-backend');
const {marketplaceCatalog}=await import(pathToFileURL(path.join(backend,'src/promptflow_marketplace.ts')).href);
const target=path.join(root,'assets/promptflow-marketplace.js');
const source=readFileSync(target,'utf8');
const block='// BEGIN PUBLIC CATALOG\n  const publicCatalog = '+JSON.stringify(marketplaceCatalog())+';\n  // END PUBLIC CATALOG';
writeFileSync(target,source.replace(/\/\/ BEGIN PUBLIC CATALOG[\s\S]*?\/\/ END PUBLIC CATALOG/,block));
console.log('Embedded '+marketplaceCatalog().length+' public Marketplace listings. No prompts or account data included.');
