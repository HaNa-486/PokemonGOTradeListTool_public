import {ensure,invariant,listingInput,canonical,type Listing,type Plan,type Completion,type Correction,type Entity} from './model';
import type {D1Unit} from './store';
import {validateEntitySchema} from './backup-schemas';
import {visibilityId} from './visibility';
import {catalogDataset,catalog} from './catalog';
import {datasetFromRow,datasetIdentity,sameDataset} from './dataset-binding';
export const backupTables={dataset_bindings:['id','dataset_id','schema_version','version','kind','content_hash'],users:['id','display_name','created_at'],identities:['provider','subject','user_id'],entities:['id','kind','owner_id','circle_id','version','data','created_at','updated_at'],shares:['entity_id','circle_id'],epochs:['id','version'],audit_events:['id','actor','operation','entity_id','owner_id','data','created_at'],idempotency_records:['actor','operation','key','hash','result','created_at']} as const;
type Table=keyof typeof backupTables;
export type DeploymentBackup={schema_version:2;kind:'deployment';exported_at:string;tables:Record<Table,Record<string,unknown>[]>};
// D1 batch makes the SELECTs one consistent database snapshot. Sessions, OAuth
// flows, runtime secrets and invitation credentials are intentionally excluded.
export async function deploymentBackup(db:D1Unit['db']):Promise<DeploymentBackup>{
  const tables=Object.keys(backupTables) as Table[];
  const results=await db.batch(tables.map(t=>db.prepare(`SELECT ${backupTables[t].join(',')} FROM ${t}${t==='entities'?" WHERE kind<>'invitation'":t==='idempotency_records'?" WHERE operation NOT LIKE 'invite.%'":''}`)));
  const backup={schema_version:2 as const,kind:'deployment' as const,exported_at:new Date().toISOString(),tables:Object.fromEntries(tables.map((t,i)=>[t,results[i].results])) as DeploymentBackup['tables']};
  validateBackup(backup);return backup;
}
export function validateBackup(raw:unknown):DeploymentBackup{
  const b=raw as DeploymentBackup;ensure(b?.schema_version===2&&b.kind==='deployment'&&b.tables,'backup_schema','備份版本或類型不支援。',400);
  ensure(Object.keys(b.tables).length===Object.keys(backupTables).length,'backup_schema','備份表格不完整。',400);
  for(const [table,columns] of Object.entries(backupTables)){
    const rows=b.tables[table as Table];ensure(Array.isArray(rows),'backup_schema','缺少備份表格。',400);
    for(const row of rows)ensure(row&&Object.keys(row).length===columns.length&&columns.every(c=>Object.hasOwn(row,c))&&Object.values(row).every(v=>v===null||typeof v==='string'||(typeof v==='number'&&Number.isSafeInteger(v))),'backup_schema','備份欄位不符。',400);
  }
  ensure(b.tables.dataset_bindings.length===1&&b.tables.dataset_bindings[0].id===1,'backup_dataset','Backup requires exactly one persisted dataset binding.',400);
  ensure(sameDataset(datasetFromRow(b.tables.dataset_bindings[0]),datasetIdentity(catalogDataset)),'backup_dataset','Backup belongs to a different dataset; no restore was performed.',409);
  const users=new Set(b.tables.users.map(r=>String(r.id)));ensure(users.size===b.tables.users.length,'backup_duplicate','重複帳號。',400);
  const latest=new Map<string,Listing>();for(const row of b.tables.audit_events){const d=JSON.parse(String(row.data));if(d?.after?.kind==='listing'){const l=d.after as Listing;ensure(l.id===row.entity_id&&l.owner===row.owner_id,'backup_audit','調整紀錄對應錯誤。',400);if(!latest.has(l.id)||latest.get(l.id)!.version<l.version)latest.set(l.id,l);}}
  for(const r of b.tables.identities)ensure(users.has(String(r.user_id))&&['google','chatgpt'].includes(String(r.provider)),'backup_identity','身分外鍵不符。',400);
  const entities=new Map<string,Entity>();
  for(const r of b.tables.entities){const e=JSON.parse(String(r.data)) as Entity;validateEntitySchema(e);ensure(!entities.has(e.id)&&e.id===r.id&&e.owner===r.owner_id&&e.kind===r.kind&&e.version===r.version&&e.version>0&&(e.circle??null)===r.circle_id&&users.has(e.owner),'backup_entity','資料外鍵或版本不符。',400);entities.set(e.id,e);}
  const kind=<T extends Entity>(id:string,k:string)=>{const e=entities.get(id);ensure(e?.kind===k,'backup_reference','備份的記錄關聯遺失。',400);return e as T;};
  const reserved=new Map<string,number>(),fulfilled=new Map<string,number>();const add=(m:Map<string,number>,id:string,q:number)=>m.set(id,(m.get(id)??0)+q);
  const completions=[...entities.values()].filter(e=>e.kind==='completion') as Completion[];
  const corrections=new Set<string>();
  const visibilityKeys=new Set<string>();
  for(const e of entities.values()){
    if(e.kind==='variant')ensure(catalog.some(c=>c.id===(e as Entity&{species:string}).species),'backup_catalog','Variant species is absent from the bound catalog.',400);
    if(e.kind==='visibility'){const v=e as import('./model').Visibility;kind(v.listing,'listing');const key=JSON.stringify([v.owner,v.listing]);ensure(v.id===visibilityId(v.owner,v.listing)&&!visibilityKeys.has(key),'backup_visibility','個人隱藏設定識別或唯一性不符。',400);visibilityKeys.add(key);}
    if(e.circle)kind(e.circle,'circle');
    if(e.kind==='circle'){const c=e as Entity&{members:Record<string,{role:string;status:string}>};ensure(Object.entries(c.members).every(([id])=>users.has(id))&&Object.values(c.members).some(m=>m.role==='owner'&&m.status==='active'),'backup_circle','圈成員或圈主遺失。',400);}
    if(e.kind==='grant'){const g=e as Entity&{delegate:string;targets:string[];circles:string[]};ensure(users.has(g.delegate),'backup_grant','代管身分遺失。',400);for(const id of g.targets)ensure(kind<Listing>(id,'listing').owner===e.owner,'backup_grant','代管目標擁有者錯誤。',400);for(const id of g.circles)kind(id,'circle');}
    if(e.kind==='plan'){
      const p=e as Plan;ensure(p.parties.length===2&&new Set(p.parties).size===2&&p.parties.every(id=>users.has(id))&&['proposed','reserved','in_progress','completed','cancelled','declined'].includes(p.status)&&p.consents.every(id=>p.parties.includes(id))&&p.fastConsents.every(id=>p.parties.includes(id)),'backup_plan','計畫當事人或狀態不符。',400);
      if(['reserved','in_progress','completed'].includes(p.status))ensure(p.parties.every(id=>p.consents.includes(id)),'backup_consent','預留計畫缺少雙方同意。',400);
      for(const i of p.items){ensure(p.parties.includes(i.from)&&Number.isSafeInteger(i.quantity)&&i.quantity>0&&[i.completed,i.pending,i.cancelled].every(n=>Number.isSafeInteger(n)&&n>=0)&&i.completed+i.pending+i.cancelled<=i.quantity,'backup_quantity','計畫數量不守恆。',400);
        if(i.supply)ensure(kind<Listing>(i.supply,'listing').owner===i.from&&kind<Listing>(i.supply,'listing').intent==='provide','backup_owner','供給擁有者或類型錯誤。',400);
        if(i.request)ensure(i.supply&&kind<Listing>(i.request,'listing').intent==='request'&&kind<Listing>(i.request,'listing').owner!==i.from&&p.parties.includes(kind<Listing>(i.request,'listing').owner),'backup_owner','需求擁有者或類型錯誤。',400);
        const rows=completions.filter(b=>b.plan===p.id);ensure(rows.filter(b=>b.status==='posted').reduce((n,b)=>n+(b.lines[i.id]??0),0)===i.completed&&rows.filter(b=>b.status==='pending').reduce((n,b)=>n+(b.lines[i.id]??0),0)===i.pending,'backup_ledger','完成帳本與計畫不一致。',400);
        if(['reserved','in_progress'].includes(p.status))for(const id of [i.supply,i.request])if(id)add(reserved,id,i.quantity-i.completed-i.cancelled);
        for(const id of [i.supply,i.request])if(id)add(fulfilled,id,i.completed);
      }
    }
    if(e.kind==='completion'){const c=e as Completion,p=kind<Plan>(c.plan,'plan');ensure(['pending','posted','void'].includes(c.status)&&Object.entries(c.lines).every(([id,q])=>p.items.some(i=>i.id===id)&&Number.isSafeInteger(q)&&q>0),'backup_completion','完成明細無效。',400);ensure(c.consents.every(id=>p.parties.includes(id))&&c.voidConsents.every(id=>p.parties.includes(id)),'backup_consent','批次確認身分不符。',400);if(c.status==='posted')ensure(c.fast?c.consents.length>0:p.parties.every(id=>c.consents.includes(id)),'backup_consent','完成批次缺少確認。',400);if(c.status==='void')ensure(p.parties.every(id=>c.voidConsents.includes(id)),'backup_consent','作廢批次缺少雙方確認。',400);const totals=p.parties.map(party=>p.items.filter(i=>i.from===party).reduce((n,i)=>n+(c.lines[i.id]??0),0));ensure(totals[0]===totals[1]&&totals[0]>0,'backup_balance','交換雙方數量不平衡。',400);}
    if(e.kind==='correction'){const c=e as Correction,batch=kind<Completion>(c.completion,'completion'),p=kind<Plan>(c.plan,'plan');ensure(batch.plan===p.id&&batch.status==='posted'&&c.consents.every(id=>p.parties.includes(id)),'backup_correction','更正對應或同意身分錯誤。',400);if(c.status!=='rejected'){ensure(!corrections.has(c.completion),'backup_correction','同一完成批次有重複更正。',400);corrections.add(c.completion);}if(c.status==='posted'){ensure(p.parties.every(id=>c.consents.includes(id)),'backup_consent','更正缺少雙方確認。',400);for(const i of p.items)if(i.request)add(fulfilled,i.request,-(batch.lines[i.id]??0));}}
  }
  for(const e of entities.values())if(e.kind==='listing'){const l=e as Listing;ensure(catalog.some(c=>l.family?c.family===l.species:c.id===l.species),'backup_catalog','Listing species or family is absent from the bound catalog.',400);invariant(l);const input=Object.fromEntries(Object.entries(l).filter(([key])=>['intent','species','family','traits','quantity','shares','purpose','note','protected','status','priority'].includes(key)));listingInput.parse(input);const after=latest.get(l.id);ensure(after&&after.quantity===l.quantity&&after.intent===l.intent&&after.species===l.species&&canonical(after.traits)===canonical(l.traits),'backup_inventory','持有量／條件與最後調整帳本不一致。',400);ensure(l.reserved===(reserved.get(l.id)??0)&&l.fulfilled===(fulfilled.get(l.id)??0),'backup_ledger','供需與預留／完成帳本不一致。',400);const shares=b.tables.shares.filter(s=>s.entity_id===l.id).map(s=>String(s.circle_id)).sort();ensure(JSON.stringify(shares)===JSON.stringify(l.deletedAt?[]:[...l.shares].sort()),'backup_shares','分享關係不一致。',400);}
  for(const r of b.tables.shares){kind(String(r.entity_id),'listing');kind(String(r.circle_id),'circle');}
  for(const r of b.tables.audit_events)ensure(users.has(String(r.actor))&&users.has(String(r.owner_id)),'backup_audit','操作紀錄使用者遺失。',400);
  for(const r of b.tables.idempotency_records)ensure(users.has(String(r.actor))&&!String(r.operation).startsWith('invite.'),'backup_receipt','重試收據使用者或類型錯誤。',400);
  return b;
}
