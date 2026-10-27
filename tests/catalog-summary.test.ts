import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeCatalog} from '../core/catalog-summary';

test('catalog description expands beyond the previous upper bound and does not invent missing IDs',()=>{
  const future=Array.from({length:1030},(_,i)=>({id:String(i+1)}));
  assert.deepEqual(summarizeCatalog(future),{count:1030,maxId:1030,description:'目錄 1–1030（1030 種）'});
  assert.deepEqual(summarizeCatalog([{id:'1'},{id:'2000'}]),{count:2,maxId:2000,description:'已收錄 2 種物種（最高編號 #2000）'});
  assert.equal(summarizeCatalog([]).description,'目錄尚無資料');
});
