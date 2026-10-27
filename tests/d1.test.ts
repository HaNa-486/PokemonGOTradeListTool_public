import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { readFileSync,readdirSync } from 'node:fs';
import { command,D1Unit } from '../core/store';
import { execute } from '../core/service';
import { type Circle, type Listing,type Plan,opaque } from '../core/model';

test('local D1 runtime: SQL guard rollback, concurrent last stock, no partial records',async()=>{
  const mf=new Miniflare({modules:true,script:'export default { fetch(){return new Response("test only")} }',compatibilityDate:'2026-05-15',d1Databases:['DB']});
  try{
    const db=await mf.getD1Database('DB') as unknown as D1Database;
    for(const f of readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+f,'utf8').split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql.trim()).run();
    for(const actor of ['a','b','c'])await db.prepare('INSERT INTO users VALUES(?,?,?)').bind(actor,actor,new Date().toISOString()).run();
    const run=<T>(actor:string,op:string,p:unknown)=>command(db,actor,op,crypto.randomUUID(),p,u=>execute(u,actor,op,p)) as Promise<T>;
    const c=await run<Circle>('a','circle.create',{name:'D1 local integration'});
    for(const other of ['b','c']){const token=opaque();const i=await run<{id:string}>('a','invite.create',{circle:c.id,token});await run(other,'invite.redeem',{...i,token});const fresh=(await new D1Unit(db).get<Circle>(c.id))!;await run('a','circle.member',{id:c.id,version:fresh.version,user:other,action:'approve'});}
    const s=await run<Listing>('a','listing.save',{data:{intent:'provide',species:'10001',family:false,quantity:1,shares:[c.id],purpose:'COLLECTION',note:'',protected:true,status:'active',priority:1,traits:{form:'STANDARD',shiny:'false',size:'NORMAL',state:'NORMAL',costume:'NONE'}}});
    const plans:Plan[]=[];for(const other of ['b','c'])plans.push(await run<Plan>('a','plan.propose',{circle:c.id,other,fast:false,items:[{from:'a',supply:s.id,request:null,quantity:1},{from:other,supply:null,request:null,quantity:1}]}));
    const results=await Promise.allSettled(plans.map((p,i)=>run(['b','c'][i],'plan.accept',{id:p.id,version:p.version,fast:false})));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await new D1Unit(db).get<Listing>(s.id))!.reserved,1);
    const old=(await db.prepare('SELECT version FROM epochs WHERE id=1').first<{version:number}>())!.version;
    await assert.rejects(()=>db.batch([db.prepare('UPDATE epochs SET version=version+1 WHERE id=1'),db.prepare('INSERT INTO transaction_guards VALUES(?,0)').bind('forced-failure')]));
    assert.equal((await db.prepare('SELECT version FROM epochs WHERE id=1').first<{version:number}>())!.version,old);
    await assert.rejects(()=>db.batch([db.prepare('UPDATE epochs SET version=version+1 WHERE id=1 AND version=-1'),db.prepare('INSERT INTO transaction_guards VALUES(?,changes())').bind('zero-update'),db.prepare("UPDATE entities SET data='{}' WHERE id=?").bind(s.id)]));
    assert.equal((await new D1Unit(db).get<Listing>(s.id))!.quantity,1);
  }finally{await mf.dispose();}
});


test('local D1 runtime: incompatible first-use dataset bindings race atomically',async()=>{
  const {catalogDataset}=await import('../core/catalog');
  const {datasetBindingStatements,assertDatasetBinding}=await import('../core/dataset-binding');
  const mf=new Miniflare({modules:true,script:'export default { fetch(){return new Response("test only")} }',compatibilityDate:'2026-05-15',d1Databases:['DB']});
  try{
    const db=await mf.getD1Database('DB') as unknown as D1Database;
    for(const f of readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+f,'utf8').split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql.trim()).run();
    const other={...catalogDataset,datasetId:'different-runtime-package',contentHash:'e'.repeat(64)};
    const outcomes=await Promise.allSettled([db.batch(datasetBindingStatements(db,catalogDataset)),db.batch(datasetBindingStatements(db,other))]);
    assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
    const winner=outcomes[0].status==='fulfilled'?catalogDataset:other;
    await assertDatasetBinding(db,winner);
    assert.equal((await db.prepare('SELECT count(*) n FROM dataset_bindings').first<{n:number}>())!.n,1);
    await assert.rejects(()=>db.prepare("UPDATE dataset_bindings SET version='changed'").run(),/dataset_binding_immutable/);
    assert.equal((await db.prepare('SELECT count(*) n FROM transaction_guards').first<{n:number}>())!.n,0);
  }finally{await mf.dispose();}
});
