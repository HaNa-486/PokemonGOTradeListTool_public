import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
export const base='https://127.0.0.1:8787';
export const demo='.sites-runtime/demo';
export const state=demo+'/state';
export const config='dist/server/wrangler.json';
export const wrangler=resolve('node_modules/wrangler/bin/wrangler.js');
export function distributionHash(){
 const hash=createHash('sha256');
 function walk(dir){for(const name of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const p=dir+'/'+name.name;if(p==='dist/catalog-build.json')continue;if(name.isDirectory())walk(p);else if(name.isFile())hash.update(p).update(readFileSync(p));else throw new Error('Unexpected build entry');}}
 walk('dist');return hash.digest('hex');
}
export function verifyDemoIdentity(receipt,pack){
 const contentHash=createHash('sha256').update(JSON.stringify(pack.items)).digest('hex');
 if(pack.datasetId!=='trade-ledger-demo'||pack.kind!=='synthetic'||contentHash!==pack.contentHash||receipt.contentHash!==contentHash||receipt.datasetId!==pack.datasetId||receipt.kind!==pack.kind)throw new Error('Rebuild the checked-in original demo catalog; selected build data differs.');
}
export function verifyDemoBuild(){
 if(!existsSync(config)||!existsSync('dist/catalog-build.json'))throw new Error('Run npm run build first.');
 const receipt=JSON.parse(readFileSync('dist/catalog-build.json','utf8'));
 if(receipt.datasetId!=='trade-ledger-demo'||receipt.kind!=='synthetic'||receipt.distributionHash!==distributionHash())throw new Error('Demo requires an unchanged build of the original synthetic dataset.');
 verifyDemoIdentity(receipt,JSON.parse(readFileSync('data/demo-catalog.json','utf8')));
 const hosting=JSON.parse(readFileSync('.openai/hosting.json','utf8'));
 if(hosting.project_id)throw new Error('Local demo requires an unbound checkout; do not use a deployed project checkout.');
 if(['.','dist/server'].some(dir=>readdirSync(dir).some(name=>(name.startsWith('.env')&&name!=='.env.example')||name.startsWith('.dev.vars'))))throw new Error('Use a clean checkout without local production configuration for the demo.');
 return receipt;
}
export const demoEnv={...process.env,APP_ORIGIN:base,SITES_CHATGPT_AUTH:'disabled',GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:'',CLOUDFLARE_CF_FETCH_ENABLED:'false',WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false',WRANGLER_LOG_PATH:resolve(demo+'/logs'),WRANGLER_REGISTRY_PATH:resolve(demo+'/registry'),MINIFLARE_REGISTRY_PATH:resolve(demo+'/registry')};
export function readSessions(){verifyDemoBuild();return JSON.parse(readFileSync(demo+'/sessions.json','utf8'));}
