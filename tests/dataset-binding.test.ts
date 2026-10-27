import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteD1} from './sqlite';
import {command} from '../core/store';
import {execute} from '../core/service';
import {catalogDataset} from '../core/catalog';
import {assertDatasetBinding,datasetBindingStatements,datasetIdentity, datasetFromRow} from '../core/dataset-binding';
import {deploymentBackup,validateBackup} from '../core/backup';
import {digest,canonical,Problem} from '../core/model';

function fresh(){const db=new SqliteD1();db.sql.prepare('INSERT INTO users VALUES(?,?,?)').run('actor','Synthetic actor',new Date().toISOString());return db;}
const create=(db:SqliteD1,key=crypto.randomUUID())=>command(db.db(),'actor','circle.create',key,{name:'Synthetic circle'},u=>execute(u,'actor','circle.create',{name:'Synthetic circle'}));
const failure=(code:string)=>(error:unknown)=>error instanceof Problem&&error.code===code;
function bind(db:SqliteD1,patch:Record<string,unknown>={}){const d={...catalogDataset,...patch};db.sql.prepare('INSERT INTO dataset_bindings VALUES(1,?,?,?,?,?)').run(d.datasetId,d.schemaVersion,d.version,d.kind,d.contentHash);}

test('fresh auth-only DB binds once with the first business command and supports replay',async()=>{
  const db=fresh();try{
    await assertDatasetBinding(db.db(),catalogDataset,true);
    assert.equal(db.sql.prepare('SELECT count(*) n FROM dataset_bindings').get()!.n,0);
    const key=crypto.randomUUID(),first=await create(db,key);
    assert.deepEqual(datasetFromRow(db.sql.prepare('SELECT * FROM dataset_bindings').get()!),datasetIdentity(catalogDataset));
    assert.deepEqual(await create(db,key),first);
    assert.equal(db.sql.prepare('SELECT count(*) n FROM entities').get()!.n,1);
    assert.throws(()=>db.sql.exec("UPDATE dataset_bindings SET version='changed'"),/dataset_binding_immutable/);
    assert.throws(()=>db.sql.exec('DELETE FROM dataset_bindings'),/dataset_binding_immutable/);
    assert.throws(()=>db.sql.exec("INSERT OR REPLACE INTO dataset_bindings SELECT id,dataset_id,schema_version,'changed',kind,content_hash FROM dataset_bindings"),/dataset_binding_immutable/);
  }finally{db.sql.close();}
});

test('dataset id, version, kind and content hash mismatches fail before business code',async()=>{
  for(const patch of [{datasetId:'different'},{version:'different'},{kind:'external'},{contentHash:'f'.repeat(64)}]){
    const db=fresh();try{bind(db,patch);let entered=false;
      await assert.rejects(()=>command(db.db(),'actor','circle.create',crypto.randomUUID(),{},async()=>{entered=true;return {};}),failure('dataset_mismatch'));
      assert.equal(entered,false);assert.equal(db.sql.prepare('SELECT count(*) n FROM entities').get()!.n,0);
      assert.equal(db.sql.prepare('SELECT count(*) n FROM epochs').get()!.n,0);
    }finally{db.sql.close();}
  }
});

test('unbound legacy business rows and used epochs cannot be automatically adopted',async()=>{
  for(const setup of [
    (db:SqliteD1)=>db.sql.prepare('INSERT INTO entities VALUES(?,?,?,?,?,?,?,?)').run('legacy','circle','actor',null,1,'{}','now','now'),
    (db:SqliteD1)=>db.sql.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?,?,?)').run('audit','actor','legacy',null,'actor','{}','now'),
    (db:SqliteD1)=>db.sql.exec('INSERT INTO epochs VALUES(1,4)'),
  ]){const db=fresh();try{setup(db);await assert.rejects(()=>create(db),failure('dataset_unbound'));assert.equal(db.sql.prepare('SELECT count(*) n FROM dataset_bindings').get()!.n,0);}finally{db.sql.close();}}
});

test('cached idempotency results never bypass an absent or wrong dataset binding',async()=>{
  for(const bound of [false,true]){const db=fresh();try{
    if(bound)bind(db,{datasetId:'different'});
    const key=crypto.randomUUID(),payload={name:'Synthetic circle'};
    db.sql.prepare('INSERT INTO idempotency_records VALUES(?,?,?,?,?,?)').run('actor','circle.create',key,await digest(canonical(payload)),'{}','now');
    await assert.rejects(()=>create(db,key),failure(bound?'dataset_mismatch':'dataset_unbound'));
  }finally{db.sql.close();}}
});

test('first command rollback leaves no binding, business record, audit or receipt',async()=>{
  for(let at=0;at<9;at++){const db=fresh();try{db.failAt=at;
    await assert.rejects(()=>create(db),/INJECTED_SQL_FAILURE/);
    for(const table of ['dataset_bindings','entities','audit_events','idempotency_records','transaction_guards'])assert.equal(db.sql.prepare(`SELECT count(*) n FROM ${table}`).get()!.n,0,`${table} at ${at}`);
    assert.equal(db.sql.prepare('SELECT version FROM epochs').get()!.version,0);
  }finally{db.sql.close();}}
});

test('different datasets racing for an empty DB have exactly one binding winner',async()=>{
  const db=fresh();try{
    const other={...catalogDataset,datasetId:'other-dataset',contentHash:'e'.repeat(64)};
    const results=await Promise.allSettled([db.db().batch(datasetBindingStatements(db.db(),catalogDataset)),db.db().batch(datasetBindingStatements(db.db(),other))]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(db.sql.prepare('SELECT count(*) n FROM dataset_bindings').get()!.n,1);
    await assertDatasetBinding(db.db(),catalogDataset);
    await assert.rejects(()=>assertDatasetBinding(db.db(),other),failure('dataset_mismatch'));
  }finally{db.sql.close();}
});

test('binding batch rechecks emptiness after preflight, before any business write',async()=>{
  const db=fresh();try{
    await assertDatasetBinding(db.db(),catalogDataset,true);
    db.sql.prepare('INSERT INTO entities VALUES(?,?,?,?,?,?,?,?)').run('legacy','circle','actor',null,1,'{}','now','now');
    await assert.rejects(()=>db.db().batch(datasetBindingStatements(db.db(),catalogDataset)),/transaction_precondition/);
    assert.equal(db.sql.prepare('SELECT count(*) n FROM dataset_bindings').get()!.n,0);
  }finally{db.sql.close();}
});

test('deployment backup v2 carries the persisted binding and rejects legacy or cross-dataset restore input',async()=>{
  const db=fresh();try{
    await create(db);const backup=await deploymentBackup(db.db());assert.equal(backup.schema_version,2);assert.equal(backup.tables.dataset_bindings.length,1);
    assert.doesNotThrow(()=>validateBackup(backup));
    for(const patch of [{dataset_id:'different'},{version:'different'},{content_hash:'d'.repeat(64)}]){const bad=structuredClone(backup);Object.assign(bad.tables.dataset_bindings[0],patch);assert.throws(()=>validateBackup(bad),failure('backup_dataset'));}
    const missing=structuredClone(backup);missing.tables.dataset_bindings=[];assert.throws(()=>validateBackup(missing));
    assert.throws(()=>validateBackup({...backup,schema_version:1}));
  }finally{db.sql.close();}
});
