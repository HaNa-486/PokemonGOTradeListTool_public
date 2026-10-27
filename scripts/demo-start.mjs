import {spawn} from 'node:child_process';
import {readSessions,base,state,config,wrangler,demoEnv} from './demo-runtime.mjs';
readSessions();
const child=spawn(process.execPath,[wrangler,'dev','--config',config,'--local','--persist-to',state,'--ip','127.0.0.1','--port','8787','--local-protocol','https','--upstream-protocol','https','--inspector-port','0','--var','APP_ORIGIN:'+base,'--var','SITES_CHATGPT_AUTH:disabled'],{stdio:'inherit',env:demoEnv});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('error',e=>{console.error(e.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
