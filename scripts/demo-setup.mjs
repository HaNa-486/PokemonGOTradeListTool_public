// Offline fixture creation only. No login bypass is added to the application.
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {demo,state,config,wrangler,demoEnv,verifyDemoBuild} from './demo-runtime.mjs';
const receipt=verifyDemoBuild();
if(existsSync(state)||existsSync(demo+'/sessions.json'))throw new Error('Demo state already exists. Keep using it; setup never overwrites an existing database.');
mkdirSync(demo,{recursive:true});
const sessions=['demo-alex','demo-river'].map((id,i)=>({id,name:i?'River · 示範乙':'Alex · 示範甲',token:randomBytes(32).toString('hex')}));
const sql=readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort().map(f=>readFileSync('drizzle/'+f,'utf8')).join('\n')+'\n'+sessions.map(s=>`INSERT INTO users(id,display_name,created_at) VALUES('${s.id}','${s.name}','${new Date().toISOString()}'); INSERT INTO sessions(hash,user_id,expires_at) VALUES('${createHash('sha256').update(s.token).digest('hex')}','${s.id}',${Date.now()+86400000});`).join('\n');
writeFileSync(demo+'/setup.sql',sql,{flag:'wx'});
const result=spawnSync(process.execPath,[wrangler,'d1','execute','DB','--local','--persist-to',state,'--config',config,'--file',demo+'/setup.sql','--yes'],{stdio:'inherit',env:demoEnv});
if(result.error||result.status!==0)throw new Error('Local demo initialization failed; inspect ignored demo files before retrying.');
writeFileSync(demo+'/sessions.json',JSON.stringify(sessions),{flag:'wx'});
writeFileSync(demo+'/receipt.json',JSON.stringify(receipt),{flag:'wx'});
console.log('Created isolated local D1 and two 24-hour demo sessions. No cloud writes or OAuth login performed. Run npm run demo:start, then npm run demo:open in another terminal.');
