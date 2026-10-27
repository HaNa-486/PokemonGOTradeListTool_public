import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteD1 } from './sqlite';
import { handle } from '../server/api';
import { currentUser, resolveIdentity, type Runtime } from '../server/auth';
import { chatGPTReady, chatGPTSubject } from '../server/sites-auth';
import { digest, opaque } from '../core/model';

const site='https://test.chatgpt.site';
const headers=(subject='platform-a',email='private@example.test')=>({
  'oai-authenticated-user-id':subject,'oai-authenticated-user-email':email,
});
function setup(){const db=new SqliteD1();const env:Runtime={DB:db.db(),APP_ORIGIN:site,SITES_CHATGPT_AUTH:'enabled'};return {db,env};}
function request(path='/api/me',identity:Record<string,string>=headers()){
  return new Request(site+path,{headers:identity});
}

test('SIWC trust configuration fails closed outside managed Site; bypass token is not user identity',async()=>{
  const {env,db}=setup();
  for(const candidate of [undefined,'disabled','true']){
    const runtime={...env,SITES_CHATGPT_AUTH:candidate};assert.equal(chatGPTReady(runtime),false);
    assert.equal((await handle(request(),runtime)).status,401);
  }
  for(const origin of ['http://test.chatgpt.site','https://localhost','https://example.com','https://test.chatgpt.site.evil.test',site+'/','invalid']){
    assert.equal(chatGPTReady({...env,APP_ORIGIN:origin}),false);
  }
  assert.equal(chatGPTSubject(new Request('https://direct-worker.example/api/me',{headers:headers()}),env),null);
  assert.equal((await handle(request('/api/me',{'OAI-Sites-Authorization':'Bearer not-a-user'}),env)).status,401);
  const incomplete:Record<string,string>[]=[{'oai-authenticated-user-id':'platform-a'},{'oai-authenticated-user-email':'a@example.test'},headers('a,b'),headers('a'.repeat(257))];
  for(const h of incomplete)assert.equal((await handle(request('/api/me',h),env)).status,401);
  assert.equal(db.sql.prepare('SELECT count(*) n FROM users').get()!.n,0);
});

test('SIWC stable subject creates one internal user concurrently, never saves email or ChatGPT app session',async()=>{
  const {env,db}=setup();
  const people=await Promise.all(Array.from({length:6},()=>currentUser(request(),env)));
  assert.equal(new Set(people.map(p=>p!.id)).size,1);
  const user=people[0]!;assert.equal(user.provider,'chatgpt');assert.notEqual(user.id,'platform-a');
  const changedEmail=await currentUser(request('/api/me',headers('platform-a','different@example.test')),env);
  assert.equal(changedEmail!.id,user.id);
  assert.equal(db.sql.prepare('SELECT count(*) n FROM users').get()!.n,1);
  assert.equal(db.sql.prepare('SELECT count(*) n FROM sessions').get()!.n,0);
  const data=JSON.stringify(db.sql.prepare('SELECT * FROM users').all())+JSON.stringify(db.sql.prepare('SELECT * FROM identities').all());
  assert.ok(!data.includes('@'));assert.equal((await handle(request('/api/me',{}),env)).status,401);
});

test('SIWC atomic first login rolls back failed identity insert, and providers never merge automatically',async()=>{
  const {env,db}=setup();db.failAt=1;await assert.rejects(()=>currentUser(request(),env));
  assert.equal(db.sql.prepare('SELECT count(*) n FROM users').get()!.n,0);db.failAt=-1;
  const a=await currentUser(request(),env);const google=await resolveIdentity(env,'google','platform-a');assert.notEqual(a!.id,google.id);
});

test('SIWC conflicting Google cookie fails closed; reset remains available and clears both auth contexts',async()=>{
  const {env,db}=setup();const a=await currentUser(request(),env);const google=await resolveIdentity(env,'google','other-user');
  const token=opaque();await db.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await digest(token),google.id,Date.now()+60000).run();
  const h={...headers(),Cookie:'__Host-trade_session='+token};const conflict=await handle(request('/api/me',h),env);
  assert.equal(conflict.status,409);assert.equal((await conflict.json() as {code:string}).code,'identity_conflict');
  const logout=await handle(new Request(site+'/auth/logout',{method:'POST',headers:{...h,Origin:site}}),env);
  assert.equal(logout.status,200);assert.equal((await logout.json() as {next:string}).next,'/signout-with-chatgpt?return_to=%2F');
  assert.ok(logout.headers.get('set-cookie')!.includes('__Host-trade_oauth=;'));
  assert.equal(db.sql.prepare('SELECT count(*) n FROM sessions').get()!.n,0);
  assert.equal((await currentUser(request(),env))!.id,a!.id);
  assert.equal((await handle(new Request(site+'/auth/logout',{method:'POST',headers:{Origin:'https://attacker.test'}}),env)).status,403);
});

test('SIWC invitation survives top-level start using HttpOnly cookie without redirect token or DB plaintext',async()=>{
  const {env,db}=setup();const id=crypto.randomUUID(),token=opaque();
  const start=await handle(new Request(site+'/auth/chatgpt',{method:'POST',headers:{Origin:site,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({id,token})}),env);
  assert.equal(start.status,303);assert.equal(start.headers.get('location'),'/signin-with-chatgpt?return_to=%2F');
  assert.ok(!start.headers.get('location')!.includes(token));const cookie=start.headers.get('set-cookie')!;
  for(const flag of ['HttpOnly','Secure','SameSite=Lax','Max-Age=600'])assert.ok(cookie.includes(flag));
  const pending=await handle(request('/api/pending-invite',{...headers(),Cookie:'__Host-trade_invitation='+id+'.'+token}),env);
  assert.deepEqual(await pending.json(),{id,token});assert.ok(pending.headers.get('set-cookie')!.includes('Max-Age=0'));
  assert.equal(db.sql.prepare('SELECT count(*) n FROM entities').get()!.n,0);
  const oversized=await handle(new Request(site+'/auth/chatgpt',{method:'POST',headers:{Origin:site,'Content-Type':'application/x-www-form-urlencoded'},body:'x'.repeat(401)}),env);
  assert.equal(oversized.status,413);
  const csrf=await handle(new Request(site+'/auth/chatgpt',{method:'POST',headers:{Origin:'https://attacker.test','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({id,token})}),env);
  assert.equal(csrf.status,403);
});

test('SIWC two dispatcher identities use the same authorized durable ledger without trusting role/owner headers',async()=>{
  const {env}=setup();const a=(await currentUser(request(),env))!;const b=(await currentUser(request('/api/me',headers('platform-b')),env))!;
  async function command(subject:string,op:string,data:unknown){
    const response=await handle(new Request(site+'/api/commands/'+op,{method:'POST',headers:{...headers(subject),Origin:site,'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(data)}),env);
    assert.equal(response.status,200);return response.json() as Promise<Record<string,unknown>>;
  }
  const circle=await command('platform-a','circle.create',{name:'登入契約測試圈'});const token=opaque();
  const invite=await command('platform-a','invite.create',{circle:circle.id,token});await command('platform-b','invite.redeem',{id:invite.id,token});
  const before=await handle(request('/api/listings?circle='+circle.id,headers('platform-b')),env);assert.equal(before.status,404);
  const circles=await (await handle(request('/api/circles'),env)).json() as {id:string;version:number}[];
  await command('platform-a','circle.member',{id:circle.id,version:circles[0].version,user:b.id,action:'approve'});
  const supply=await command('platform-a','listing.save',{data:{intent:'provide',species:'10001',family:false,traits:{form:'STANDARD',shiny:'false',size:'NORMAL',state:'NORMAL',costume:'NONE'},quantity:8,shares:[circle.id],purpose:'COLLECTION',note:'',protected:true,status:'active',priority:1}});
  const visible=await handle(request('/api/listings?circle='+circle.id,headers('platform-b')),env);const data=await visible.json() as {items:{id:string;owner:string;quantity:number}[]};assert.equal(data.items[0].id,supply.id);assert.equal(data.items[0].quantity,8);
  const outsider=await handle(request('/api/listings?circle='+circle.id,{...headers('outsider'),'x-user-id':a.id,'x-role':'admin'}),env);assert.equal(outsider.status,404);
  const revision=await handle(request('/api/revision',headers('platform-b')),env);assert.equal((await revision.json() as {actor:string}).actor,b.id);
});
