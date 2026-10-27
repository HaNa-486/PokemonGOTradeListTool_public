import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import pack from '../data/demo-catalog.json';
import {verifyDemoIdentity} from '../scripts/demo-runtime.mjs';
test('local demo rejects stale build data and a different pack reusing the demo identity',()=>{
 const receipt={datasetId:pack.datasetId,kind:pack.kind,contentHash:pack.contentHash};
 assert.doesNotThrow(()=>verifyDemoIdentity(receipt,pack));
 const changed=structuredClone(pack);changed.items[0].zh='Changed synthetic name';
 changed.contentHash=createHash('sha256').update(JSON.stringify(changed.items)).digest('hex');
 assert.throws(()=>verifyDemoIdentity(receipt,changed),/Rebuild/);
 assert.throws(()=>verifyDemoIdentity({...receipt,contentHash:changed.contentHash},pack),/Rebuild/);
 assert.throws(()=>verifyDemoIdentity({...receipt,kind:'external'},pack),/Rebuild/);
});
