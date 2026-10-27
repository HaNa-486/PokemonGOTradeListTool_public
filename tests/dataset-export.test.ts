import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteD1} from './sqlite';
import {catalogDataset} from '../core/catalog';
import {digest,opaque} from '../core/model';
import {handle} from '../server/api';
import {execute} from '../core/service';
test('wrongly bound database cannot export or relabel data with current catalog metadata',async()=>{
 const db=new SqliteD1(),token=opaque();
 await db.prepare('INSERT INTO users VALUES(?,?,?)').bind('actor','Synthetic actor',new Date().toISOString()).run();
 await db.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await digest(token),'actor',Date.now()+60000).run();
 await db.prepare('INSERT INTO dataset_bindings VALUES(1,?,?,?,?,?)').bind('other-catalog',1,catalogDataset.version,'synthetic',catalogDataset.contentHash).run();
 for(const path of ['/api/export','/api/import-backup?id=anything','/api/listings','/api/catalog']){
 const response=await handle(new Request('https://test.example'+path,{headers:{Cookie:'__Host-trade_session='+token}}),{DB:db.db(),APP_ORIGIN:'https://test.example'});
 assert.equal(response.status,409);assert.equal((await response.json() as {code:string}).code,'dataset_mismatch');
 }
});
test('personal import rejects wrong data identity before looking at ledger records',async()=>{
 const untouched=new Proxy({},{get(){throw new Error('Ledger accessed');}});
 for(const dataset of [undefined,{datasetId:'other',version:catalogDataset.version,contentHash:catalogDataset.contentHash}]){
 await assert.rejects(execute(untouched as never,'actor','import.preview',{schema_version:2,dataset,listings:[]}),error=>String(error).includes('Invalid'));
 }
});
