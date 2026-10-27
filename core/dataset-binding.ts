import { z } from 'zod';
import { ensure, id } from './model';

export const datasetIdentitySchema = z.object({
  datasetId: z.string().min(1).max(100), schemaVersion: z.literal(1),
  version: z.string().min(1).max(100), kind: z.enum(['synthetic','external']),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type DatasetIdentity = z.infer<typeof datasetIdentitySchema>;
type Db = Pick<D1Database,'prepare'|'batch'>;
export const datasetColumns = ['dataset_id','schema_version','version','kind','content_hash'] as const;
const occupied = `EXISTS(SELECT 1 FROM entities) OR EXISTS(SELECT 1 FROM shares)
  OR EXISTS(SELECT 1 FROM audit_events) OR EXISTS(SELECT 1 FROM idempotency_records)
  OR EXISTS(SELECT 1 FROM epochs WHERE version<>0)`;
export function datasetIdentity(value:unknown):DatasetIdentity { return datasetIdentitySchema.parse(value); }
export function datasetFromRow(row:Record<string,unknown>):DatasetIdentity {
  return datasetIdentity({datasetId:row.dataset_id,schemaVersion:row.schema_version,
    version:row.version,kind:row.kind,contentHash:row.content_hash});
}
export function sameDataset(a:DatasetIdentity,b:DatasetIdentity) {
  return a.datasetId===b.datasetId&&a.schemaVersion===b.schemaVersion&&a.version===b.version&&a.kind===b.kind&&a.contentHash===b.contentHash;
}
// Read-only preflight: session/user rows do not bind a business ledger. A legacy
// ledger is never adopted based on the currently installed package's claim.
export async function assertDatasetBinding(db:Db,expected:DatasetIdentity,allowFresh=false) {
  const identity=datasetIdentity(expected);
  const row=await db.prepare(`SELECT *, (${occupied}) AS occupied FROM (SELECT 1 AS singleton)
    LEFT JOIN dataset_bindings ON dataset_bindings.id=singleton`).first<Record<string,unknown>>();
  if(row?.id==null){ensure(allowFresh&&!row?.occupied,'dataset_unbound','帳本尚未綁定資料包，既有資料不得自動採用新的目錄。',409);return;}
  ensure(sameDataset(datasetFromRow(row),identity),'dataset_mismatch','資料包與此帳本的綁定不同，操作已停止。',409);
}
// Called inside the SAME atomic batch as epoch and business writes. A competing
// first command with another dataset can never bind and write this database.
export function datasetBindingStatements(db:Db,expected:DatasetIdentity) {
  const d=datasetIdentity(expected),guard=id();
  const values=[d.datasetId,d.schemaVersion,d.version,d.kind,d.contentHash];
  return [
    db.prepare(`INSERT INTO dataset_bindings(id,${datasetColumns.join(',')})
      SELECT 1,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM dataset_bindings) AND NOT (${occupied})`).bind(...values),
    db.prepare(`INSERT INTO transaction_guards(id,ok) SELECT ?,CASE WHEN EXISTS(
      SELECT 1 FROM dataset_bindings WHERE id=1 AND dataset_id=? AND schema_version=? AND version=? AND kind=? AND content_hash=?
    ) THEN 1 ELSE 0 END`).bind(guard,...values),
    db.prepare('DELETE FROM transaction_guards WHERE id=?').bind(guard),
  ];
}
