// Explicit local data selection; never fetches a catalog or silently falls back.
import {readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {validateCatalogPack} from '../core/catalog-schema';
export function prepareCatalog(input:string,output:string,expectedId?:string){
const pack=validateCatalogPack(JSON.parse(readFileSync(input,'utf8')));
const hash=createHash('sha256').update(JSON.stringify(pack.items)).digest('hex');
if(hash!==pack.contentHash)throw new Error('Catalog content hash mismatch; normalized items SHA-256 should be '+hash);
if(expectedId&&pack.datasetId!==expectedId)throw new Error('Catalog dataset ID mismatch');
mkdirSync(dirname(output),{recursive:true});const tmp=output+'.tmp';
writeFileSync(tmp,JSON.stringify(pack,null,2)+'\n');renameSync(tmp,output);return pack;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
const input=process.env.CATALOG_PACK;
if(input&&!process.env.CATALOG_DATASET_ID)throw new Error('External catalog requires CATALOG_DATASET_ID');
const pack=prepareCatalog(input||'data/demo-catalog.json','data/active-catalog.generated.json',process.env.CATALOG_DATASET_ID||'trade-ledger-demo');
console.log('Prepared catalog: '+pack.datasetId+' / '+pack.kind+' / '+pack.items.length+' entries');
}
