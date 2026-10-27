import {readFileSync,writeFileSync} from 'node:fs';
import {distributionHash} from './demo-runtime.mjs';
const p=JSON.parse(readFileSync('data/active-catalog.generated.json','utf8'));
writeFileSync('dist/catalog-build.json',JSON.stringify({datasetId:p.datasetId,kind:p.kind,contentHash:p.contentHash,distributionHash:distributionHash()},null,2)+'\n');
