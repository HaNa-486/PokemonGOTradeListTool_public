// Run the built synthetic demo locally. Never starts a deploy or uses cloud state.
import {spawn,execFile} from 'node:child_process';
import {get} from 'node:https';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {base,demoEnv,readSessions,root} from './demo-runtime.mjs';

const origin=new URL(base);
if(origin.href!=='https://127.0.0.1:8787/')throw new Error('CI demo must use the fixed loopback origin.');
readSessions(); // Checks the synthetic build receipt and unbound local configuration.
const processes=new Set();
let stopPromise;
function start(script,quiet=false){
  const child=spawn(process.execPath,['scripts/'+script],{
    cwd:root,env:demoEnv,stdio:quiet?'ignore':'inherit',detached:process.platform!=='win32'
  });
  const owned={child,exited:false,error:false,done:null};
  owned.done=new Promise(resolve=>{
    child.once('error',()=>{owned.error=true;resolve({code:1});});
    child.once('close',(code,signal)=>{owned.exited=true;resolve({code,signal});});
  });
  processes.add(owned);
  return owned;
}
async function stop(owned){
  if(!owned.child.pid)return;
  if(process.platform==='win32'){
    // Only this runner's child tree; never match a port, executable name, or other task.
    if(!owned.exited)await new Promise(resolve=>{
      execFile('taskkill',['/PID',String(owned.child.pid),'/T','/F'],{timeout:4000,windowsHide:true},()=>resolve());
    });
  }else{
    // Each owned process has its own group, covering Wrangler/workerd and browsers.
    try{process.kill(-owned.child.pid,'SIGTERM');}catch{}
    await Promise.race([owned.done,delay(2500)]);
    try{process.kill(-owned.child.pid,'SIGKILL');}catch{}
  }
  await Promise.race([owned.done,delay(1000)]);
}
function stopAll(){
  return stopPromise??=Promise.all([...processes].reverse().map(stop));
}
for(const signal of ['SIGINT','SIGTERM']){
  process.once(signal,()=>{void stopAll().finally(()=>process.exit(signal==='SIGINT'?130:143));});
}
async function availablePort(){
  await new Promise((resolve,reject)=>{
    const probe=createServer();
    probe.once('error',()=>reject(new Error('Demo port is already in use; stop the existing local demo first.')));
    probe.listen({host:'127.0.0.1',port:8787,exclusive:true},()=>probe.close(resolve));
  });
}
function status(){
  return new Promise(resolve=>{
    let timer;
    const finish=value=>{clearTimeout(timer);resolve(value);};
    // TLS relaxation is scoped to this literal loopback request, never an env/global switch.
    const request=get('https://127.0.0.1:8787/api/status',{rejectUnauthorized:false,timeout:1500},response=>{
      let body='';
      response.setEncoding('utf8');
      response.on('data',chunk=>{body+=chunk;if(body.length>8192)request.destroy();});
      response.on('end',()=>{
        try{const value=JSON.parse(body);finish(response.statusCode===200&&value.storage==='D1'&&value.siteOrigin===base);}
        catch{finish(false);}
      });
      response.on('error',()=>finish(false));
    });
    timer=setTimeout(()=>{request.destroy();finish(false);},1500);
    request.on('timeout',()=>request.destroy());
    request.on('error',()=>finish(false));
  });
}
async function ready(server){
  const until=Date.now()+45000;
  while(Date.now()<until){
    if(server.exited||server.error)throw new Error('Local demo server exited before readiness.');
    if(await status())return;
    await delay(300);
  }
  throw new Error('Local demo readiness timed out.');
}
async function run(script){
  const owned=start(script);
  let timer;
  try{
    const result=await Promise.race([
      owned.done,
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Local browser checks timed out.')),180000);})
    ]);
    if(result.code!==0)throw new Error('Local browser checks failed.');
  }finally{clearTimeout(timer);}
}
try{
  await availablePort();
  const server=start('demo-start.mjs',true);
  await ready(server);
  console.log('Local synthetic demo is ready; running two browser journeys.');
  await run('demo-qa.mjs');
  await run('demo-visibility-qa.mjs');
  console.log('Local browser journeys passed. No deployment or cloud writes were performed.');
}catch(error){
  console.error(error instanceof Error?error.message:'Local demo CI failed.');
  process.exitCode=1;
}finally{
  await stopAll();
}
