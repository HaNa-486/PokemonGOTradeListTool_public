import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import pack from '../data/demo-catalog.json';
import {validateCatalogPack,type CatalogPack} from '../core/catalog-schema';
import {prepareCatalog} from '../scripts/prepare-catalog.mjs';
test('catalog rejects duplicate IDs, reserved variants, inconsistent labels and undeclared keys',()=>{
 for(const mutate of [(p:CatalogPack)=>p.items.push(p.items[0]),(p:CatalogPack)=>p.items[0].forms.push({...p.items[0].forms[0],id:'UNKNOWN'}),(p:CatalogPack)=>p.items[1].forms[0].label='conflicting', (p:CatalogPack)=>p.items[0].forms.push({id:'custom:collision',label:'Reserved',tradable:true}), (p:CatalogPack)=>p.items[0].costumes.splice(0), (p:CatalogPack)=>p.items[0].forms.push({id:'SHADOW',label:'Conflicting label',tradable:true}), (p:CatalogPack)=>Object.assign(p,{undeclared:true})]){
 const p=validateCatalogPack(structuredClone(pack));mutate(p);assert.throws(()=>validateCatalogPack(p));}
});
test('catalog preparation verifies content and identity, missing files never fall back or replace a valid output',()=>{
 const dir=mkdtempSync(join(tmpdir(),'catalog-pack-'));const input=join(dir,'input.json'),output=join(dir,'output.json');
 try{writeFileSync(input,JSON.stringify(pack));prepareCatalog(input,output,pack.datasetId);const before=readFileSync(output,'utf8');
 assert.throws(()=>prepareCatalog(join(dir,'missing.json'),output));assert.throws(()=>prepareCatalog(input,output,'wrong-dataset'));
 const changed=structuredClone(pack);changed.items[0].tradable=false;writeFileSync(input,JSON.stringify(changed));assert.throws(()=>prepareCatalog(input,output),/hash mismatch/);assert.equal(readFileSync(output,'utf8'),before);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
