import {chromium} from 'playwright';
import {createInterface} from 'node:readline/promises';
import {base,readSessions} from './demo-runtime.mjs';
const sessions=readSessions();
const browser=await chromium.launch({headless:false});
try{
 for(const s of sessions){const context=await browser.newContext({ignoreHTTPSErrors:true});await context.addCookies([{name:'__Host-trade_session',value:s.token,url:base,httpOnly:true,secure:true,sameSite:'Lax'}]);const page=await context.newPage();await page.goto(base);if((await context.request.get(base+'/api/me')).status()!==200)throw new Error('Demo session expired or server unavailable.');}
 console.log('Two isolated demo accounts opened. Create a circle, invite/approve the other account, then add listings. This is local seeded-session access, not OAuth.');
 const rl=createInterface({input:process.stdin,output:process.stdout});await rl.question('Press Enter to close both browser windows. ');rl.close();
}finally{await browser.close();}
