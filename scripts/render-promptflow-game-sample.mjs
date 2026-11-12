// Render the already-validated synthetic game's own canvas. This is a test
// harness, not a production sandbox for arbitrary uploaded JavaScript.
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createCanvas,loadImage}=require('../tmp/promptflow-render/node_modules/@napi-rs/canvas');
const html=fs.readFileSync('tmp/marketplace-live-samples/browser-game/output-0-html_url.html','utf8');
const script=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).join('\n');
const image=await loadImage(html.match(/data:image\/png;base64,[A-Za-z0-9+/=]+/)[0]);
// The asset is already decoded. Ignore the game's repeat assignment so native
// Image does not begin an asynchronous reload during this synchronous capture.
Object.defineProperty(image,'src',{set(){}});
const surface=createCanvas(840,520),frames=new Map();let frameId=0;
const canvas={getContext:()=>surface.getContext('2d'),focus(){},addEventListener(){}};
const elements={'#game':canvas,'#status':{},'#start':{}};
const sandbox=vm.createContext({document:{querySelector:s=>elements[s]},window:{addEventListener(){}},performance:{now:()=>0},
  Image:class {constructor(){return image;}},requestAnimationFrame:f=>{frames.set(++frameId,f);return frameId;},cancelAnimationFrame:id=>frames.delete(id)});
vm.runInContext(script,sandbox,{timeout:1000});
elements['#start'].onclick();
for(let i=1;i<=150;i++){
  const entry=[...frames][0];if(!entry)break;frames.delete(entry[0]);entry[1](i*40);
}
const png=await surface.encode('png');
fs.writeFileSync('assets/promptflow-marketplace/samples/browser-game-output.png',png);
fs.writeFileSync('tmp/marketplace-live-samples/browser-game/sample-canvas.png',png);
const path='assets/promptflow-marketplace/samples/manifest.json',manifest=JSON.parse(fs.readFileSync(path,'utf8'));
manifest['browser-game'].output_caption='Actual game canvas after six seconds of play';
fs.writeFileSync(path,JSON.stringify(manifest,null,2)+'\n');
console.log('Rendered the generated game canvas.');
