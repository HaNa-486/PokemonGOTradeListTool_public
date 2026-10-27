import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteD1 } from './sqlite';
import { command,D1Unit } from '../core/store';
import { execute,pickInput } from '../core/service';
import { available,fingerprint,listingInput,type Circle,type Listing,type Plan,type Completion, type Correction, type Grant } from '../core/model';
import pack from '../data/demo-catalog.json';
import { match,catalog,catalogById,tradeStatus,catalogDataset } from '../core/catalog';
import type { Variant } from '../core/model';
import { handle } from '../server/api';
import { digest,opaque } from '../core/model';
import { projectResult } from '../server/projection';
import {deploymentBackup,validateBackup} from '../core/backup';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join as joinPath} from 'node:path';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

const basic={intent:'provide' as const,species:'10001',family:false as const,traits:{form:'STANDARD',shiny:'false' as const,size:'NORMAL' as const,state:'NORMAL' as const,costume:'NONE'},quantity:8,shares:[] as string[],purpose:'COLLECTION' as const,note:'',protected:true,status:'active' as const,priority:1};
const want={...basic,intent:'request' as const,traits:{form:{mode:'ANY' as const},shiny:{mode:'ANY' as const},size:{mode:'ANY' as const},state:{mode:'ANY' as const},costume:{mode:'ANY' as const}},quantity:10};

async function reader(f:Awaited<ReturnType<typeof fixture>>,actor:string){
  const token=opaque();await f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await digest(token),actor,Date.now()+60000).run();
  return async(path:string,op?:{data:unknown;key:string})=>handle(new Request('https://test.example'+path,{headers:{Cookie:'__Host-trade_session='+token,...(op?{Origin:'https://test.example','Content-Type':'application/json','Idempotency-Key':op.key}:{})},...(op?{method:'POST',body:JSON.stringify(op.data)}:{})}),{DB:f.db.db(),APP_ORIGIN:'https://test.example'});
}
test('personal hiding is actor-only, cross-circle durable, before pagination, and leaves existing plans intact',async()=>{
  const f=await fixture(),a=await reader(f,'a'),b=await reader(f,'b');const c=await f.run<Circle>('a','circle.create',{name:'second'});await f.join('b',c);
  const r=await f.run<Listing>('b','listing.save',{id:f.request.id,version:1,data:{...pickInput(f.request),shares:[f.circle.id,c.id]}}),before=await f.get<Listing>(r.id),plan=await f.propose(1,'a','b',f.supply,r);
  const payload={listing:r.id,hidden:true,version:0},key=opaque();await f.run('a','visibility.set',payload,key);assert.deepEqual(await f.get(r.id),before);
  for(const scope of [f.circle.id,c.id]){const visible=await (await a('/api/listings?circle='+scope+'&intent=request')).json() as {items:Listing[]};assert.equal(visible.items.length,0);const hidden=await (await a('/api/listings?circle='+scope+'&visibility=hidden')).json() as {items:Listing[]};assert.deepEqual(hidden.items.map(l=>l.id),[r.id]);}
  assert.equal(((await (await b('/api/listings?circle='+f.circle.id+'&intent=request')).json()) as {items:unknown[]}).items.length,1);
  assert.equal(((await (await a('/api/matches?circle=all')).json()) as {items:unknown[]}).items.length,0);
  assert.equal(((await (await b('/api/matches?circle=all')).json()) as {items:unknown[]}).items.length,1);
  await f.accept(plan);assert.equal((await f.get<Listing>(r.id)).reserved,1);
  assert.deepEqual(await f.run('a','visibility.set',payload,key),{listing:r.id,hidden:true,version:1});await assert.rejects(f.run('a','visibility.set',{...payload,hidden:false},key),{code:'idempotency_mismatch'});
  const reservedPlan=await f.get<Plan>(plan.id);await f.run('a','plan.cancel',{id:plan.id,version:reservedPlan.version});
  const rr=await f.get<Listing>(r.id);await f.run('b','listing.save',{id:r.id,version:rr.version,data:{...pickInput(rr),shares:[]}});
  assert.equal(((await (await a('/api/listings?circle='+f.circle.id+'&visibility=hidden')).json()) as {items:unknown[]}).items.length,0);assert.equal((await a('/api/listing?id='+r.id)).status,404);
  await assert.rejects(f.run('c','visibility.set',{listing:r.id,hidden:true,version:0}),{status:404});
  // Clearing one's own preference remains safe after losing read access: returns no listing data.
  await f.run('a','visibility.set',{listing:r.id,hidden:false,version:1});
  const backup=await deploymentBackup(f.db.db());assert.doesNotThrow(()=>validateBackup(backup));const bad=structuredClone(backup),row=bad.tables.entities.find(e=>e.kind==='visibility')!;const v=JSON.parse(String(row.data));v.id='wrong';row.id='wrong';row.data=JSON.stringify(v);assert.throws(()=>validateBackup(bad));
});
test('hidden listing pages fill before LIMIT and preference races have one version winner',async()=>{
  const f=await fixture(),a=await reader(f,'a');
  for(let i=0;i<53;i++){const l=await f.run<Listing>('b','listing.save',{data:{...want,note:'hidden '+i,shares:[f.circle.id]}});await f.run('a','visibility.set',{listing:l.id,hidden:true,version:0});}
  const p=await (await a('/api/listings?circle='+f.circle.id+'&intent=request')).json() as {items:Listing[];next:string|null};assert.deepEqual(p.items.map(l=>l.id),[f.request.id]);assert.equal(p.next,null);
  const hidden=await (await a('/api/listings?circle='+f.circle.id+'&visibility=hidden')).json() as {items:Listing[];next:string};assert.equal(hidden.items.length,50);const last=await (await a('/api/listings?circle='+f.circle.id+'&visibility=hidden&after='+hidden.next)).json() as {items:Listing[]};assert.equal(last.items.length,3);
  const races=await Promise.allSettled([f.run('a','visibility.set',{listing:f.request.id,hidden:true,version:0}),f.run('a','visibility.set',{listing:f.request.id,hidden:true,version:0})]);assert.equal(races.filter(x=>x.status==='fulfilled').length,1);
});
test('admin restores exact legacy removal without leaking other circles, and revoked admin cannot replay',async()=>{
  const f=await fixture(),a=await reader(f,'a'),c=await reader(f,'c');let circle=await f.get<Circle>(f.circle.id);await f.run('a','circle.member',{id:circle.id,version:circle.version,user:'c',action:'admin'});
  const privateCircle=await f.run<Circle>('b','circle.create',{name:'private source circle'}),r=await f.run<Listing>('b','listing.save',{id:f.request.id,version:1,data:{...pickInput(f.request),shares:[f.circle.id,privateCircle.id],note:'private history marker'}});
  // Generate the v8 server-owned audit format directly through the command gate.
  const hidePayload={id:r.id,version:r.version,circle:f.circle.id},hideKey=opaque();await command(f.db.db(),'c','listing.hide',hideKey,hidePayload,async u=>{const after={...r,version:r.version+1,updatedAt:new Date().toISOString(),shares:[privateCircle.id]};u.put(after);u.event(r.owner,r.id,{actor:'c',reason:'管理員隱藏此圈分享；全球數量不變',before:r,after});return after;});
  const receipt=await (await a('/api/moderation?circle='+f.circle.id)).json() as {items:{id:string;version:number;event:string}[]};assert.equal(receipt.items.length,1);assert.ok(!JSON.stringify(receipt).includes(privateCircle.id));assert.ok(!JSON.stringify(receipt).includes('private history marker'));
  const replay=await c('/api/commands/listing.hide',{data:hidePayload,key:hideKey});assert.equal(replay.status,200);assert.ok(!JSON.stringify(await replay.json()).includes(privateCircle.id));
  const item=receipt.items[0],payload={id:item.id,version:item.version,event:item.event,circle:f.circle.id},key=opaque();await f.run('c','listing.unhide',payload,key);const restored=await f.get<Listing>(r.id);assert.deepEqual(restored.shares.sort(),[privateCircle.id,f.circle.id].sort());assert.equal(restored.quantity,r.quantity);
  await f.run('c','listing.unhide',payload,key);assert.equal((await f.get<Listing>(r.id)).version,restored.version);
  circle=await f.get<Circle>(circle.id);await f.run('a','circle.member',{id:circle.id,version:circle.version,user:'c',action:'member'});
  await assert.rejects(f.run('c','listing.unhide',payload,key),{status:404});await assert.rejects(f.run('c','listing.hide',hidePayload,hideKey),{status:404});assert.equal((await c('/api/moderation?circle='+circle.id)).status,404);
});
test('restore rejects owner edits, deletion, departed owner, and concurrent newer sharing decisions',async()=>{
  for(const action of ['edit','delete','leave','race']){const f=await fixture(),a=await reader(f,'a');await f.run('a','listing.hide',{id:f.request.id,version:1,circle:f.circle.id});const row=(await (await a('/api/moderation?circle='+f.circle.id)).json() as {items:{id:string;version:number;event:string}[]}).items[0];const payload={id:row.id,version:row.version,event:row.event,circle:f.circle.id};const l=await f.get<Listing>(row.id);
    const edit=()=>f.run('b','listing.save',{id:l.id,version:l.version,data:{...pickInput(l),note:'new private content',shares:[]}});
    if(action==='race'){const races=await Promise.allSettled([edit(),f.run('a','listing.unhide',payload)]);assert.equal(races.filter(x=>x.status==='fulfilled').length,1);continue;}
    if(action==='edit')await edit();if(action==='delete')await f.run('b','listing.delete',{id:l.id,version:l.version});if(action==='leave'){const c=await f.get<Circle>(f.circle.id);await f.run('b','circle.member',{id:c.id,version:c.version,user:'b',action:'remove'});}
    await assert.rejects(f.run('a','listing.unhide',payload),{code:'restore_changed'});assert.equal((await f.get<Listing>(l.id)).shares.length,0);const response=await (await a('/api/moderation?circle='+f.circle.id)).json() as {items:unknown[]};assert.equal(response.items.length,0);assert.ok(!JSON.stringify(response).includes('new private content'));
  }
});
test('visibility and share restore injected failures roll back all writes and receipts',async()=>{
  for(const op of ['visibility.set','listing.unhide'])for(let at=0;at<9;at++){const f=await fixture();let payload:unknown={listing:f.request.id,version:0,hidden:true};if(op==='listing.unhide'){await f.run('a','listing.hide',{id:f.request.id,version:1,circle:f.circle.id});const row=f.db.sql.prepare("SELECT id FROM audit_events WHERE operation='listing.hide'").get() as {id:string};payload={id:f.request.id,version:2,event:row.id,circle:f.circle.id};}
    const before=await deploymentBackup(f.db.db());f.db.failAt=at;const [result]=await Promise.allSettled([f.run('a',op,payload)]);f.db.failAt=-1;if(result.status==='rejected'){const after=await deploymentBackup(f.db.db());assert.deepEqual(after.tables,before.tables);}else validateBackup(await deploymentBackup(f.db.db()));
  }
});
test('original demo catalog matches its manifest and preserves independent variant identities',()=>{
  assert.equal(catalog.length,pack.items.length);assert.ok(catalog.length>0);assert.equal(catalogById.size,catalog.length);for(const c of catalog){assert.ok(c?.zh&&c.en);assert.ok(c.forms.every(v=>v.label.trim()));assert.ok(c.costumes.every(v=>v.label.trim()));}
  assert.equal(catalogById.get('10006')?.zh,'織雲');assert.equal(catalogById.get('10005')?.forms.length,3);assert.equal(catalogById.get('10001')!.costumes.length,3);assert.equal(catalogById.get('10002')!.family,'folded-light');
  assert.equal(catalogById.get('10003')!.forms.some(f=>f.id==='CLOUD_SAIL'),true);
});
test('authorized pagination preserves later circles and plans; search covers records beyond the first page',async()=>{
  const f=await fixture();const token=opaque();await f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await digest(token),'a',Date.now()+60000).run();
  const get=async(path:string)=>handle(new Request('https://example.test'+path,{headers:{Cookie:'__Host-trade_session='+token}}),{DB:f.db.db(),APP_ORIGIN:'https://example.test'});
  for(let n=0;n<102;n++)await f.run('a','circle.create',{name:'分頁圈 '+n});
  const c1=await (await get('/api/circles?paged=true')).json() as {items:Circle[];next:string};assert.equal(c1.items.length,100);assert.ok(c1.next);
  const c2=await (await get('/api/circles?paged=true&after='+c1.next)).json() as {items:Circle[];next:null};assert.equal(c2.items.length,3);assert.equal(c2.next,null);assert.equal(new Set([...c1.items,...c2.items].map(c=>c.id)).size,103);
  const last=c2.items.at(-1)!;const rare=await f.run<Listing>('a','listing.save',{data:{...basic,species:'10006',shares:[last.id]}});
  for(let n=0;n<52;n++)await f.run('a','listing.save',{data:{...basic,note:'分頁供給 '+n}});
  const found=await (await get('/api/listings?q='+encodeURIComponent('織雲'))).json() as {items:Listing[]};assert.deepEqual(found.items.map(l=>l.id),[rare.id]);
  for(let n=0;n<51;n++)await f.propose(1);
  const p1=await (await get('/api/plans')).json() as {plans:Plan[];next:string};const p2=await (await get('/api/plans?cursor='+encodeURIComponent(p1.next))).json() as {plans:Plan[];next:null};assert.equal(p1.plans.length,50);assert.equal(p2.plans.length,1);assert.equal(new Set([...p1.plans,...p2.plans].map(p=>p.id)).size,51);assert.equal(p2.next,null);
  assert.equal((await get('/api/plans?cursor=invalid')).status,400);assert.equal((await get('/api/plan-history?id=missing')).status,404);
  const outsideToken=opaque();await f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await digest(outsideToken),'outsider',Date.now()+60000).run();assert.equal((await handle(new Request('https://example.test/api/plan-history?id='+p1.plans[0].id,{headers:{Cookie:'__Host-trade_session='+outsideToken}}),{DB:f.db.db(),APP_ORIGIN:'https://example.test'})).status,404);
  const english=await (await get('/api/listings?q=Paperwing')).json() as {items:Listing[]};assert.ok(english.items.length>0);
  const shared=await f.run<Listing>('a','listing.save',{id:f.supply.id,version:1,data:{...basic,shares:[last.id,f.circle.id]}});assert.equal(shared.shares.length,2);
  const bt=opaque();await f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await digest(bt),'b',Date.now()+60000).run();const oracle=await handle(new Request('https://example.test/api/listings?circle='+f.circle.id+'&q='+last.id,{headers:{Cookie:'__Host-trade_session='+bt}}),{DB:f.db.db(),APP_ORIGIN:'https://example.test'});assert.deepEqual((await oracle.json() as {items:Listing[]}).items,[]);
});
test('catalog conditions and family requests are enforced on both supply and request',async()=>{
  const f=await fixture();const l=await f.run<Listing>('a','listing.save',{data:{...basic,species:'10003',traits:{...basic.traits,form:'CLOUD_SAIL'}}});assert.equal(l.species,'10003');
  await assert.rejects(f.run('a','listing.save',{data:{...basic,traits:{...basic.traits,form:'CLOUD_SAIL'}}}));
  await assert.rejects(f.run('a','listing.save',{data:{...want,traits:{...want.traits,shiny:{mode:'IN',values:['UNKNOWN']}}}}));
  await assert.rejects(f.run('a','listing.save',{data:{...want,traits:{...want.traits,form:{mode:'IN',values:['CLOUD_SAIL']}}}}));
  const r=await f.run<Listing>('b','listing.save',{data:{...want,family:true,species:'folded-light'}});assert.ok(match(f.supply,r));
});
test('grant and completion history cursors preserve every authorized row, including timestamp ties',async()=>{
  const f=await fixture();const token=opaque();await f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await digest(token),'a',Date.now()+60000).run();
  const get=async(path:string)=>(await handle(new Request('https://example.test'+path,{headers:{Cookie:'__Host-trade_session='+token}}),{DB:f.db.db(),APP_ORIGIN:'https://example.test'})).json();
  for(let n=0;n<101;n++)await f.run('a','grant.create',{delegate:'b',targets:[f.supply.id],circles:[f.circle.id],create:false});
  const g1=await get('/api/grants?paged=true') as {items:Grant[];next:string},g2=await get('/api/grants?paged=true&after='+g1.next) as {items:Grant[];next:null};assert.equal(g1.items.length,100);assert.equal(g2.items.length,1);assert.equal(new Set([...g1.items,...g2.items].map(g=>g.id)).size,101);assert.equal(g2.next,null);
  const supply=await f.run<Listing>('a','listing.save',{id:f.supply.id,version:1,data:{...pickInput(f.supply),quantity:60}});const proposed=await f.propose(51,'a','b',supply,null);await f.accept(proposed);
  for(let n=0;n<51;n++){const p=await f.get<Plan>(proposed.id);const b=await f.run<Completion>('a','completion.report',{id:p.id,version:p.version,lines:Object.fromEntries(p.items.map(i=>[i.id,1]))});await f.run('b','completion.confirm',{id:b.id,version:b.version});}
  // Equal timestamps are legal; tie-break by immutable entity ID must not lose rows.
  f.db.sql.prepare("UPDATE entities SET created_at='2026-10-02T00:00:00.000Z',data=json_set(data,'$.createdAt','2026-10-02T00:00:00.000Z') WHERE kind='completion'").run();
  const h1=await get('/api/plan-history?id='+proposed.id) as {batches:Completion[];next:string},h2=await get('/api/plan-history?id='+proposed.id+'&cursor='+encodeURIComponent(h1.next)) as {batches:Completion[];next:null};assert.equal(h1.batches.length,50);assert.equal(h2.batches.length,1);assert.equal(new Set([...h1.batches,...h2.batches].map(b=>b.id)).size,51);assert.equal(h2.next,null);
});
test('custom variants retain exact IDs and labels across shares without exposing origin circle',async()=>{
  const f=await fixture();const source=await f.run<Circle>('a','circle.create',{name:'secret-source'});
  const v=await f.run<Variant>('a','variant.create',{circle:source.id,species:'10001',trait:'costume',label:'活動帽 2026'});
  await assert.rejects(f.run('a','listing.save',{data:{...basic,traits:{...basic.traits,costume:v.id}}}));
  await f.run('a','variant.review',{id:v.id,version:v.version,approve:true});
  const l=await f.run<Listing>('a','listing.save',{data:{...basic,shares:[f.circle.id],traits:{...basic.traits,costume:v.id}}});
  const r=await f.run<Listing>('b','listing.save',{data:{...want,shares:[f.circle.id],traits:{...want.traits,costume:{mode:'IN',values:[v.id]}}}});assert.ok(match(l,r));
  await assert.rejects(f.run('outsider','listing.save',{data:{...want,traits:{...want.traits,costume:{mode:'IN',values:[v.id]}}}}));
  const v2=await f.run<Variant>('a','variant.create',{circle:source.id,species:'10001',trait:'costume',label:'活動帽 2026'});await f.run('a','variant.review',{id:v2.id,version:v2.version,approve:true});assert.notEqual(fingerprint(l),fingerprint({...l,traits:{...l.traits,costume:v2.id}} as Listing));
  const token=opaque();await f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await digest(token),'b',Date.now()+60000).run();const res=await handle(new Request('https://example.test/api/variants?circle='+f.circle.id,{headers:{Cookie:'__Host-trade_session='+token}}),{DB:f.db.db(),APP_ORIGIN:'https://example.test'});const text=await res.text();assert.equal(res.status,200);assert.ok(text.includes(v.id));assert.ok(!text.includes(source.id)&&!text.includes('secret-source'));
});
test('custom costume cannot override known non-tradable species or form',async()=>{
  const f=await fixture();const v=await f.run<Variant>('a','variant.create',{circle:f.circle.id,species:'10004',trait:'costume',label:'精確測試裝扮'});await f.run('a','variant.review',{id:v.id,version:v.version,approve:true});
  const l=await f.run<Listing>('a','listing.save',{data:{...basic,species:'10004',shares:[f.circle.id],traits:{...basic.traits,costume:v.id}}});assert.equal(tradeStatus(l),false);assert.equal(match(l,{...f.request,species:'10004'}),null);await assert.rejects(f.propose(1,'a','b',l,null));
  const blocked=catalogById.get('10005')!.forms.find(x=>x.tradable===false);assert.ok(blocked);assert.equal(tradeStatus({...l,species:'10005',traits:{...basic.traits,form:blocked.id,costume:'custom:unknown'}} as Listing),false);
});
test('batch quantity edits are atomic, target scoped and revoke old replay receipts',async()=>{
  const f=await fixture();const key=crypto.randomUUID();await assert.rejects(f.run('a','listing.batch',{items:[{id:f.supply.id,version:1,quantity:20},{id:f.request.id,version:1,quantity:20}]}));assert.equal((await f.get<Listing>(f.supply.id)).quantity,8);
  const g=await f.run<Grant>('a','grant.create',{delegate:'b',targets:[f.supply.id],circles:[f.circle.id],create:false});const payload={items:[{id:f.supply.id,version:1,quantity:6}]};await f.run('b','listing.batch',payload,key);await f.run('a','grant.revoke',{id:g.id,version:g.version});await assert.rejects(f.run('b','listing.batch',payload,key));assert.equal((await f.get<Listing>(f.supply.id)).quantity,6);
});
test('circle moderation hides only that share, preserves pending reservations, conceals outside IDs',async()=>{
  const f=await fixture();const p=await f.propose(3);await f.accept(p);const plan=await f.get<Plan>(p.id);await f.run('a','completion.report',{id:p.id,version:plan.version,lines:Object.fromEntries(plan.items.map(i=>[i.id,1]))});
  const l=await f.get<Listing>(f.supply.id);await f.run('a','listing.hide',{id:l.id,version:l.version,circle:f.circle.id});const after=await f.get<Listing>(l.id);assert.equal(after.quantity,l.quantity);assert.equal(after.reserved,l.reserved);assert.equal(after.shares.length,0);
  await assert.rejects(f.run('a','listing.hide',{id:l.id,version:999,circle:f.circle.id}),{status:404});
  await assert.rejects(f.run('a','listing.hide',{id:'missing',version:999,circle:f.circle.id}),{status:404});
  const batch=(await new D1Unit(f.db.db()).list<Completion>('completion'))[0];await f.run('b','completion.confirm',{id:batch.id,version:batch.version});assert.equal((await f.get<Listing>(l.id)).quantity,7);
});
test('deployment backup gate, consistent history and isolated full restore with credentials excluded',async()=>{
  const f=await fixture();const p=await f.propose(5);await f.accept(p);const plan=await f.get<Plan>(p.id);const b=await f.run<Completion>('a','completion.report',{id:p.id,version:plan.version,lines:Object.fromEntries(plan.items.map(i=>[i.id,2]))});await f.run('b','completion.confirm',{id:b.id,version:b.version});
  const correction=await f.run<Correction>('a','correction.propose',{completion:b.id,reason:'測試誤登需求完成數',restoreInventory:false});await f.run('b','correction.confirm',{id:correction.id,version:correction.version});
  const token=opaque();await f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await digest(token),'a',Date.now()+60000).run();const req=new Request('https://example.test/api/deployment-backup',{headers:{Cookie:'__Host-trade_session='+token}});
  assert.equal((await handle(req,{DB:f.db.db(),APP_ORIGIN:'https://example.test'})).status,404);
  const response=await handle(req,{DB:f.db.db(),APP_ORIGIN:'https://example.test',MAINTENANCE_USER_IDS:'a'});assert.equal(response.status,200);const backup=validateBackup(await response.json());
  const text=JSON.stringify(backup);assert.ok(!text.includes(token)&&!text.includes('"hash":"'+await digest(token)));assert.ok(!backup.tables.entities.some(e=>e.kind==='invitation'));
  const bad=structuredClone(backup);const row=bad.tables.entities.find(e=>e.id===f.supply.id)!;const data=JSON.parse(String(row.data));data.reserved++;row.data=JSON.stringify(data);assert.throws(()=>validateBackup(bad));
  for(const patch of [{quantity:800},{intent:'invalid-intent',traits:{}},{traits:{...f.supply.traits,shiny:'invalid'}}]){const corrupt=structuredClone(backup);const row=corrupt.tables.entities.find(e=>e.id===f.supply.id)!;row.data=JSON.stringify({...JSON.parse(String(row.data)),...patch});assert.throws(()=>validateBackup(corrupt));}
  const missingConsent=structuredClone(backup);const completion=missingConsent.tables.entities.find(e=>e.id===b.id)!;completion.data=JSON.stringify({...JSON.parse(String(completion.data)),consents:[]});assert.throws(()=>validateBackup(missingConsent));
  const corruptCorrection=structuredClone(backup);const cr=corruptCorrection.tables.entities.find(e=>e.id===correction.id)!;cr.data=JSON.stringify({...JSON.parse(String(cr.data)),consents:[]});assert.throws(()=>validateBackup(corruptCorrection));
  const duplicateCorrection=structuredClone(backup),copy=structuredClone(duplicateCorrection.tables.entities.find(e=>e.id===correction.id)!);copy.id='duplicate-correction';copy.data=JSON.stringify({...JSON.parse(String(copy.data)),id:copy.id});duplicateCorrection.tables.entities.push(copy);assert.throws(()=>validateBackup(duplicateCorrection));
  const dir=mkdtempSync(joinPath(tmpdir(),'trade-restore-'));
  try{const input=joinPath(dir,'backup.json'),output=joinPath(dir,'restored.sqlite');writeFileSync(input,text);execFileSync(process.execPath,['--import','tsx','scripts/restore-backup.mts',input,output,'--confirm-new-empty-database'],{stdio:'pipe'});const db=new DatabaseSync(output);assert.equal(db.prepare('SELECT count(*) AS n FROM entities').get()!.n,backup.tables.entities.length);assert.equal(db.prepare('SELECT count(*) AS n FROM sessions').get()!.n,0);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);const restored=JSON.parse(String(db.prepare('SELECT data FROM entities WHERE id=?').get(f.supply.id)!.data));assert.deepEqual([restored.quantity,restored.reserved,restored.fulfilled],[6,3,2]);db.close();assert.throws(()=>execFileSync(process.execPath,['--import','tsx','scripts/restore-backup.mts',input,output,'--confirm-new-empty-database'],{stdio:'pipe'}));}finally{rmSync(dir,{recursive:true,force:true});}
  assert.equal((await deploymentBackup(f.db.db())).kind,'deployment');
  const proposed=await f.propose(1,'a','b',await f.get<Listing>(f.supply.id),await f.get<Listing>(f.request.id));await f.run('a','plan.cancel',{id:proposed.id,version:proposed.version});assert.equal((await deploymentBackup(f.db.db())).kind,'deployment');
});
test('correction rejection and confirmation race has one winner and immutable history',async()=>{
  const f=await fixture();const p=await f.propose(1);await f.accept(p);const plan=await f.get<Plan>(p.id);const b=await f.run<Completion>('a','completion.report',{id:p.id,version:plan.version,lines:Object.fromEntries(plan.items.map(i=>[i.id,1]))});await f.run('b','completion.confirm',{id:b.id,version:b.version});const c=await f.run<Correction>('a','correction.propose',{completion:b.id,reason:'確認誤登交換紀錄',restoreInventory:false});
  const outcomes=await Promise.allSettled([f.run('b','correction.reject',{id:c.id,version:c.version,reason:'我已確認實際完成交換'}),f.run('b','correction.confirm',{id:c.id,version:c.version})]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal((await f.get<Completion>(b.id)).status,'posted');
});
test('A05 exact finite progress 10/2/5 across circles and A22 ongoing progress',async()=>{
  const f=await fixture();const other=await f.run<Circle>('a','circle.create',{name:'第二個共享圈'});await f.join('b',other);
  for(const l of [f.supply,f.request])await f.run(l.owner,'listing.save',{id:l.id,version:l.version,data:{...pickInput(l),shares:[f.circle.id,other.id]}});
  const complete=async(p:Plan,q:number)=>{await f.accept(p);const fresh=await f.get<Plan>(p.id);const b=await f.run<Completion>('a','completion.report',{id:p.id,version:fresh.version,lines:Object.fromEntries(fresh.items.map(i=>[i.id,q]))});await f.run('b','completion.confirm',{id:b.id,version:b.version});};
  await complete(await f.propose(2,'a','b',await f.get<Listing>(f.supply.id),await f.get<Listing>(f.request.id)),2);
  await f.accept(await f.propose(3,'a','b',await f.get<Listing>(f.supply.id),await f.get<Listing>(f.request.id)));
  await f.accept(await f.propose(2,'a','b',await f.get<Listing>(f.supply.id),await f.get<Listing>(f.request.id),other));
  const r=await f.get<Listing>(f.request.id);assert.deepEqual([r.quantity,r.fulfilled,r.reserved,available(r)],[10,2,5,3]);await assert.rejects(f.run('b','listing.save',{id:r.id,version:r.version,data:{...pickInput(r),quantity:6}}));
  const g=await fixture();const ongoing=await g.run<Listing>('b','listing.save',{data:{...want,quantity:null,shares:[g.circle.id]}});const p=await g.propose(3,'a','b',g.supply,ongoing);await g.accept(p);const fresh=await g.get<Plan>(p.id);const b=await g.run<Completion>('a','completion.report',{id:p.id,version:fresh.version,lines:Object.fromEntries(fresh.items.map(i=>[i.id,1]))});await g.run('b','completion.confirm',{id:b.id,version:b.version});const o=await g.get<Listing>(ongoing.id);assert.deepEqual([o.quantity,o.fulfilled,o.reserved,available(o)],[null,1,2,null]);
});
test('matching across circles de-duplicates records and preserves global priority on next page',async()=>{
  const f=await fixture();const c=await f.run<Circle>('a','circle.create',{name:'second'});await f.join('b',c);
  for(const l of [f.supply,f.request])await f.run(l.owner,'listing.save',{id:l.id,version:l.version,data:{...pickInput(l),shares:[f.circle.id,c.id]}});
  const token=opaque();await f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await digest(token),'a',Date.now()+60000).run();const env={DB:f.db.db(),APP_ORIGIN:'https://test.example'},headers={cookie:'__Host-trade_session='+token};
  const read=async(after='')=>(await handle(new Request('https://test.example/api/matches?circle=all&after='+encodeURIComponent(after),{headers}),env)).json() as Promise<{items:{supply:Listing;request:Listing;circle:string}[];next:string|null}>;
  const first=await read();assert.equal(first.items.length,1);assert.ok([f.circle.id,c.id].includes(first.items[0].circle));
  for(let n=0;n<103;n++)await f.run('b','listing.save',{data:{...want,note:'unique '+n,priority:n%4,shares:[f.circle.id]}});
  const a=await read(),b=await read(a.next!);const all=[...a.items,...b.items];assert.equal(all.length,104);assert.equal(new Set(all.map(x=>x.supply.id+':'+x.request.id)).size,104);assert.ok(all.every((x,i)=>!i||all[i-1].request.priority>=x.request.priority));
});
async function fixture(){
  const db=new SqliteD1();for(const actor of ['a','b','c','outsider'])await db.prepare('INSERT INTO users VALUES(?,?,?)').bind(actor,actor,new Date().toISOString()).run();
  const run=<T>(actor:string,op:string,p:unknown,key=crypto.randomUUID())=>command(db.db(),actor,op,key,p,u=>execute(u,actor,op,p)) as Promise<T>;
  const get=<T extends import('../core/model').Entity>(id:string)=>new D1Unit(db.db()).get<T>(id) as Promise<T>;
  const circle=await run<Circle>('a','circle.create',{name:'測試圈'});
  const join=async(user:string,c=circle)=>{const token=opaque();const invite=await run<{id:string}>('a','invite.create',{circle:c.id,token});await run(user,'invite.redeem',{...invite,token});const fresh=await get<Circle>(c.id);await run('a','circle.member',{id:c.id,version:fresh.version,user,action:'approve'});};
  await join('b');await join('c');
  const supply=await run<Listing>('a','listing.save',{data:{...basic,shares:[circle.id]}});
  const request=await run<Listing>('b','listing.save',{data:{...want,shares:[circle.id]}});
  const propose=async(q=5,actor='a',other='b',s=supply,r:Listing|null=request,c=circle)=>run<Plan>(actor,'plan.propose',{circle:c.id,other,fast:false,items:[{from:actor,supply:s.id,request:r?.id??null,quantity:q},{from:other,supply:null,request:null,quantity:q}]});
  const accept=async(p:Plan,actor='b',fast=false)=>run<Plan>(actor,'plan.accept',{id:p.id,version:p.version,fast});
  return {db,run,get,circle,supply,request,propose,accept,join};
}
test('A11/A13/A15 partial completion, both consents, cancellation, conservation',async()=>{
  const f=await fixture();const p=await f.propose();assert.equal((await f.get<Listing>(f.supply.id)).reserved,0);await f.accept(p);
  let plan=await f.get<Plan>(p.id);let supply=await f.get<Listing>(f.supply.id);assert.equal(supply.reserved,5);
  const lines=Object.fromEntries(plan.items.map(i=>[i.id,2]));const batch=await f.run<Completion>('a','completion.report',{id:plan.id,version:plan.version,lines});
  assert.equal((await f.get<Listing>(supply.id)).quantity,8);
  await f.run('a','completion.confirm',{id:batch.id,version:batch.version});assert.equal((await f.get<Listing>(supply.id)).quantity,8);
  const current=await f.get<Completion>(batch.id);await f.run('b','completion.confirm',{id:batch.id,version:current.version});
  supply=await f.get<Listing>(supply.id);assert.deepEqual([supply.quantity,supply.reserved,available(supply)],[6,3,3]);
  plan=await f.get<Plan>(plan.id);await f.run('b','plan.cancel',{id:plan.id,version:plan.version});supply=await f.get<Listing>(supply.id);assert.deepEqual([supply.quantity,supply.reserved,available(supply)],[6,0,6]);assert.equal((await f.get<Listing>(f.request.id)).fulfilled,2);
});
test('A06 last item concurrent reservations: one succeeds',async()=>{
  const f=await fixture();await f.run('a','listing.save',{id:f.supply.id,version:1,data:{...pickInput(f.supply),quantity:1}});const s=await f.get<Listing>(f.supply.id);
  const p1=await f.propose(1,'a','b',s,null),p2=await f.propose(1,'a','c',s,null);
  const results=await Promise.allSettled([f.accept(p1,'b'),f.accept(p2,'c')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.get<Listing>(s.id)).reserved,1);
});
test('A06 injected SQL failure at every write position rolls entire command back',async()=>{
  for(let at=0;at<10;at++){const f=await fixture();const p=await f.propose();const before=f.db.sql.prepare('SELECT * FROM entities ORDER BY id').all();f.db.failAt=at;
    const result=await Promise.allSettled([f.accept(p)]);if(result[0].status==='rejected')assert.deepEqual(f.db.sql.prepare('SELECT * FROM entities ORDER BY id').all(),before);else assert.equal((await f.get<Listing>(f.supply.id)).reserved,5);
  }
});
test('A12 insufficient second side never reserves first',async()=>{
  const f=await fixture();const other=await f.run<Listing>('b','listing.save',{data:{...basic,quantity:1,shares:[f.circle.id]}});
  const p=await f.run<Plan>('a','plan.propose',{circle:f.circle.id,other:'b',fast:false,items:[{from:'a',supply:f.supply.id,request:null,quantity:2},{from:'b',supply:other.id,request:null,quantity:2}]});await assert.rejects(()=>f.accept(p));assert.equal((await f.get<Listing>(f.supply.id)).reserved,0);
});
test('A04/A05 quantities are shared across two circles',async()=>{
  const f=await fixture(),second=await f.run<Circle>('a','circle.create',{name:'第二圈'});await f.join('b',second);await f.join('c',second);
  const supply=await f.run<Listing>('a','listing.save',{id:f.supply.id,version:1,data:{...pickInput(f.supply),quantity:5,shares:[f.circle.id,second.id]}});
  await f.accept(await f.propose(4,'a','b',supply,null));const p=await f.propose(2,'a','c',supply,null,second);await assert.rejects(()=>f.accept(p,'c'));assert.equal(available(await f.get<Listing>(supply.id)),1);
});
test('A07/A08/A09 comparison excludes quantities but includes all meaning and sharing',async()=>{
  const l={...basic,owner:'a'};assert.equal(fingerprint(l),fingerprint({...l,quantity:100}));
  for(const [key,value] of [['form','ALOLAN'],['shiny','true'],['size','XXL'],['state','PURIFIED'],['costume','hat']])assert.notEqual(fingerprint(l),fingerprint({...l,traits:{...l.traits,[key]:value}}));
  assert.equal(fingerprint({...l,traits:{...l.traits,form:'UNKNOWN'}}),null);
  for(const diff of [{owner:'b'},{shares:['another']},{purpose:'CANDY' as const},{protected:false},{note:'different'}])assert.notEqual(fingerprint(l),fingerprint({...l,...diff}));
  assert.throws(()=>listingInput.parse({...want,traits:{...want.traits,size:{mode:'IN',values:[]}}}));
});
test('A14 unequal completion rejected; placeholder creates no inventory',async()=>{
  const f=await fixture();const p=await f.propose();await f.accept(p);const plan=await f.get<Plan>(p.id);
  await assert.rejects(()=>f.run('a','completion.report',{id:p.id,version:plan.version,lines:{[plan.items[0].id]:1,[plan.items[1].id]:2}}));
  assert.equal((await new D1Unit(f.db.db()).list<Listing>('listing',{owner:'b'})).filter(x=>x.intent==='provide').length,0);
});
test('A15 pending batches cannot overlap and pending delivery cannot be cancelled',async()=>{
  const f=await fixture();const p=await f.propose(1);await f.accept(p);let plan=await f.get<Plan>(p.id);const lines=Object.fromEntries(plan.items.map(i=>[i.id,1]));await f.run('a','completion.report',{id:p.id,version:plan.version,lines});plan=await f.get<Plan>(p.id);
  await assert.rejects(()=>f.run('b','completion.report',{id:p.id,version:plan.version,lines}));await assert.rejects(()=>f.run('a','plan.cancel',{id:p.id,version:plan.version}));assert.equal((await f.get<Listing>(f.supply.id)).reserved,1);
});
test('A17 idempotency key same content replays; changed content conflicts',async()=>{
  const f=await fixture();const key=crypto.randomUUID();const a=await f.run('a','circle.create',{name:'only once'},key),b=await f.run('a','circle.create',{name:'only once'},key);assert.deepEqual(a,b);await assert.rejects(()=>f.run('a','circle.create',{name:'changed'},key));
});
test('A18 stale version cannot overwrite and numbers reject coercion',async()=>{
  const f=await fixture();await f.run('a','listing.save',{id:f.supply.id,version:1,data:{...pickInput(f.supply),quantity:9}});await assert.rejects(()=>f.run('a','listing.save',{id:f.supply.id,version:1,data:pickInput(f.supply)}));
  for(const quantity of [-1,0.5,'',NaN,1000001])assert.throws(()=>listingInput.parse({...basic,quantity}));
});
test('A19 delegation has explicit targets and immediate revocation',async()=>{
  const f=await fixture();await assert.rejects(()=>f.run('b','listing.save',{id:f.supply.id,version:1,data:pickInput(f.supply)}));
  const g=await f.run<Grant>('a','grant.create',{delegate:'b',targets:[f.supply.id],circles:[f.circle.id],create:false});await f.run('b','listing.save',{id:f.supply.id,version:1,data:{...pickInput(f.supply),quantity:9}});await f.run('a','grant.revoke',{id:g.id,version:1});await assert.rejects(()=>f.run('b','listing.save',{id:f.supply.id,version:2,data:pickInput(f.supply)}));
});
test('A20 removal releases undelivered remainder but retains pending quantity',async()=>{
  const f=await fixture();const p=await f.propose(5);await f.accept(p);const plan=await f.get<Plan>(p.id);await f.run('a','completion.report',{id:p.id,version:plan.version,lines:Object.fromEntries(plan.items.map(i=>[i.id,2]))});const c=await f.get<Circle>(f.circle.id);await f.run('a','circle.member',{id:c.id,version:c.version,user:'b',action:'remove'});assert.equal((await f.get<Listing>(f.supply.id)).reserved,2);
});
test('A21 trash/restore preserves stable ID; reservation blocks deletion',async()=>{
  const f=await fixture();await f.run('a','listing.delete',{id:f.supply.id,version:1});await f.run('a','listing.restore',{id:f.supply.id,version:2});assert.equal((await f.get<Listing>(f.supply.id)).quantity,8);const s=await f.get<Listing>(f.supply.id);await f.accept(await f.propose(1,'a','b',s));await assert.rejects(()=>f.run('a','listing.delete',{id:s.id,version:s.version+1}));
});
test('A25 protected shiny not recommended to ANY candy; precise collection matches',async()=>{
  const f=await fixture();const s={...f.supply,traits:{...basic.traits,shiny:'true' as const}} as Listing;const r={...f.request,purpose:'CANDY' as const};assert.equal(match(s,r),null);const precise={...r,traits:{...want.traits,shiny:{mode:'IN' as const,values:['true']}}} as Listing;assert.ok(match(s,precise));
});
test('A02 unauthenticated and forged headers fail; Origin blocks writes',async()=>{
  const f=await fixture();const env={DB:f.db.db(),APP_ORIGIN:'https://test.example'};
  for(const path of ['/api/listings','/api/export','/api/circles']){const r=await handle(new Request('https://test.example'+path,{headers:{'oai-authenticated-user-email':'a@test','x-user-id':'a','role':'owner'}}),env);assert.equal(r.status,401);assert.match(r.headers.get('cache-control')!,/no-store/);}
  const token='1'.repeat(64);await f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await digest(token),'a',Date.now()+60000).run();const r=await handle(new Request('https://test.example/api/commands/circle.create',{method:'POST',headers:{cookie:'__Host-trade_session='+token,Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'}),env);assert.equal(r.status,403);
});

test('security regression: plaintext invite never appears in any DB column',async()=>{
  const f=await fixture();const token=opaque();await f.run('a','invite.create',{circle:f.circle.id,token});
  for(const table of ['entities','idempotency_records','audit_events'])assert.ok(!JSON.stringify(f.db.sql.prepare(`SELECT * FROM ${table}`).all()).includes(token));
});
test('security regression: revoked delegate cannot replay old receipt',async()=>{
  const f=await fixture();const g=await f.run<Grant>('a','grant.create',{delegate:'b',targets:[f.supply.id],circles:[f.circle.id],create:false});const key=crypto.randomUUID(),payload={id:f.supply.id,version:1,data:pickInput(f.supply)};await f.run('b','listing.save',payload,key);await f.run('a','grant.revoke',{id:g.id,version:1});await assert.rejects(()=>f.run('b','listing.save',payload,key));
});
test('security regression: command plans remove unauthorized circle shares',async()=>{
  const f=await fixture(),hidden=await f.run<Circle>('a','circle.create',{name:'private other circle'});const s=await f.run<Listing>('a','listing.save',{id:f.supply.id,version:1,data:{...pickInput(f.supply),shares:[f.circle.id,hidden.id]}});const p=await f.propose(1,'a','b',s);const result=await projectResult(f.db.db(),'b',p);assert.ok(!JSON.stringify(result).includes(hidden.id));
});
test('circle-view export requires admin, contains only that circle and no member history',async()=>{
  const f=await fixture(),secret=await f.run<Circle>('a','circle.create',{name:'private circle'});await f.run('a','listing.save',{id:f.supply.id,version:1,data:{...pickInput(f.supply),shares:[secret.id,f.circle.id]}});
  const get=async(actor:string)=>{const token=opaque();await f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await digest(token),actor,Date.now()+60000).run();return handle(new Request('https://example.test/api/export?circle='+f.circle.id,{headers:{Cookie:'__Host-trade_session='+token}}),{DB:f.db.db(),APP_ORIGIN:'https://example.test'});};
  assert.equal((await get('b')).status,404);const response=await get('a');assert.equal(response.status,200);const body=await response.text();assert.ok(!body.includes(secret.id));const parsed=JSON.parse(body);assert.equal(parsed.kind,'circle-view');assert.deepEqual(parsed.history,[]);assert.ok(parsed.listings.every((l:Listing)=>l.shares.length===1&&l.shares[0]===f.circle.id));
});
test('A16 fast consent cannot be given while circle disabled; disable clears old consent',async()=>{
  const f=await fixture();const p=await f.propose(1);await assert.rejects(()=>f.accept(p,'b',true));let c=await f.get<Circle>(f.circle.id);await f.run('a','circle.update',{id:c.id,version:c.version,name:c.name,fast:true});
  let plan=await f.get<Plan>(p.id);await f.accept(plan,'b',true);c=await f.get<Circle>(c.id);await f.run('a','circle.update',{id:c.id,version:c.version,name:c.name,fast:false});plan=await f.get<Plan>(p.id);assert.deepEqual(plan.fastConsents,[]);
});
test('pending completion void requires both parties and frees occupancy exactly once',async()=>{
  const f=await fixture();const p=await f.propose(2);await f.accept(p);let plan=await f.get<Plan>(p.id);const b=await f.run<Completion>('a','completion.report',{id:p.id,version:plan.version,lines:Object.fromEntries(plan.items.map(i=>[i.id,1]))});
  await f.run('a','completion.void',{id:b.id,version:b.version,reason:'數量誤填需要更正'});let current=await f.get<Completion>(b.id);assert.equal(current.status,'pending');assert.equal((await f.get<Plan>(p.id)).items[0].pending,1);
  await f.run('b','completion.void',{id:b.id,version:current.version,reason:'核對後同意更正'});current=await f.get<Completion>(b.id);assert.equal(current.status,'void');plan=await f.get<Plan>(p.id);assert.equal(plan.items[0].pending,0);assert.equal((await f.get<Listing>(f.supply.id)).reserved,2);
});

test('A23 correction keeps immutable history identity, never silently restores inventory',async()=>{
  const f=await fixture();const p=await f.propose(1);await f.accept(p);const plan=await f.get<Plan>(p.id);const b=await f.run<Completion>('a','completion.report',{id:p.id,version:plan.version,lines:Object.fromEntries(plan.items.map(i=>[i.id,1]))});await f.run('b','completion.confirm',{id:b.id,version:b.version});
  for(const id of [f.supply.id,f.request.id]){const l=await f.get<Listing>(id);await assert.rejects(()=>f.run(l.owner,'listing.save',{id,version:l.version,data:{...pickInput(l),species:'1'}}));}
  const c=await f.run<Correction>('a','correction.propose',{completion:b.id,reason:'需求進度登記錯誤',restoreInventory:false});await f.run('b','correction.confirm',{id:c.id,version:c.version});assert.equal((await f.get<Listing>(f.supply.id)).quantity,7);const r=await f.get<Listing>(f.request.id);assert.equal(r.fulfilled,0);await assert.rejects(()=>f.run('b','listing.save',{id:r.id,version:r.version,data:{...pickInput(r),species:'1'}}));assert.equal((await f.get<Completion>(b.id)).status,'posted');
});
test('A26 import dry-run rejects roles/other owners and duplicate inventory; confirmed import is private',async()=>{
  const f=await fixture();const row={...f.supply,id:'old-id-from-backup',shares:[f.circle.id]};
  const preview=await f.run<{id:string;version:number;count:number;conflicts:string[]}>('a','import.preview',{schema_version:2,dataset:{datasetId:catalogDataset.datasetId,version:catalogDataset.version,contentHash:catalogDataset.contentHash},listings:[row]});assert.equal(preview.count,1);assert.equal((await new D1Unit(f.db.db()).list('listing',{owner:'a'})).length,1);
  await assert.rejects(()=>f.run('a','import.apply',{id:preview.id,version:1,confirmed:true,backupDownloaded:false}));await f.run('a','import.apply',{id:preview.id,version:1,confirmed:true,backupDownloaded:true});const imported=(await new D1Unit(f.db.db()).list<Listing>('listing',{owner:'a'})).find(l=>l.id!==f.supply.id)!;assert.deepEqual(imported.shares,[]);assert.equal(imported.status,'draft');
  const duplicate=await f.run<{conflicts:string[]}>('a','import.preview',{schema_version:2,dataset:{datasetId:catalogDataset.datasetId,version:catalogDataset.version,contentHash:catalogDataset.contentHash},listings:[row]});assert.equal(duplicate.conflicts.length,1);const foreign=await f.run<{conflicts:string[]}>('b','import.preview',{schema_version:2,dataset:{datasetId:catalogDataset.datasetId,version:catalogDataset.version,contentHash:catalogDataset.contentHash},listings:[row]});assert.equal(foreign.conflicts.length,1);
});
test('A30 bounded pagination at 20 users / 3 circles / 1000 listings',{timeout:60000},async()=>{
  const f=await fixture();for(let n=0;n<16;n++)await f.db.prepare('INSERT INTO users VALUES(?,?,?)').bind('perf-'+n,'test','2026-10-02T00:00:00Z').run();for(let n=0;n<2;n++)await f.run('a','circle.create',{name:'Performance circle '+n});
  const insert=f.db.sql.prepare('INSERT INTO entities VALUES(?,?,?,?,?,?,?,?)'),share=f.db.sql.prepare('INSERT INTO shares VALUES(?,?)');
  for(let n=0;n<998;n++){const owner=n%2?'a':'b',l={...(n%2?f.supply:f.request),id:'perf-'+String(n).padStart(4,'0'),owner};insert.run(l.id,'listing',owner,null,1,JSON.stringify(l),l.createdAt,l.updatedAt);share.run(l.id,f.circle.id);}
  const token='2'.repeat(64);await f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await digest(token),'a',Date.now()+60000).run();const env={DB:f.db.db(),APP_ORIGIN:'https://test.example'},headers={cookie:'__Host-trade_session='+token};
  const started=performance.now();const response=await handle(new Request('https://test.example/api/matches?circle='+f.circle.id,{headers}),env);assert.equal(response.status,200);const data=await response.json() as {items:unknown[];next:string};assert.ok(data.items.length<=100);assert.ok(data.next);const listing=await handle(new Request('https://test.example/api/listings',{headers}),env);const page=await listing.json() as {items:unknown[];next:string};assert.equal(page.items.length,50);assert.ok(page.next);// Timing is diagnostic; shared CI hardware is not a throughput guarantee.
  console.log('PERF_LOCAL_1000_MS',Math.round(performance.now()-started));
});

test('malformed personal-import record IDs cannot poison full deployment backups',async()=>{
  const f=await fixture();
  const dataset={datasetId:catalogDataset.datasetId,version:catalogDataset.version,contentHash:catalogDataset.contentHash};
  for(const id of [123,{nested:'id'},'x'.repeat(101),null]){
    const preview=await f.run<{count:number;conflicts:string[]}>('a','import.preview',{schema_version:2,dataset,listings:[{...f.supply,id}]});
    assert.equal(preview.count,0);assert.equal(preview.conflicts.length,1);
    validateBackup(await deploymentBackup(f.db.db()));
  }
});
