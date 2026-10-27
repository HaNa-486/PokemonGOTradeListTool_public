import {backupListing} from './backup-schemas';
import { z } from 'zod';
import { available, canonical, change, digest, ensure, fingerprint, invariant, listingInput, make, now, positive, type Circle, type Completion, type Correction, type Entity, type Grant, type Invitation, type Listing, type Plan, type TradeItem, type Unit } from './model';
import { catalog, catalogById, catalogDataset, match, tradeStatus } from './catalog';
import type { Variant } from './model';
import {restorable,visibilityId,visibleListing} from './visibility';

const str=z.string().min(1).max(100);
const ref=z.object({id:str,version:positive});
export async function required<T extends Entity>(u:Unit,id:string,kind:string) { const e=await u.get<T>(id);ensure(e&&e.kind===kind,'not_found','找不到這筆資料。',404);return e; }
export async function circleFor(u:Unit,id:string,actor:string,admin=false) {
  const c=await required<Circle>(u,id,'circle');const m=c.members[actor];ensure(m?.status==='active'&&(!admin||['owner','admin'].includes(m.role)),'not_found','找不到這個圈或沒有權限。',404);return c;
}
function version(e:Entity,v:number){ensure(e.version===v,'version_conflict','這筆資料已由其他操作更新；輸入已保留，請比較最新資料後重試。');}
async function writable(u:Unit,l:Listing,actor:string) {
  if(l.owner===actor)return null;
  const grants=await u.list<Grant>('grant',{owner:l.owner});const g=grants.find(g=>g.delegate===actor&&!g.revoked&&g.targets.includes(l.id));
  ensure(g,'not_found','找不到這筆資料或代管已撤銷。',404);return g;
}
async function checkListing(u:Unit,data:z.infer<typeof listingInput>,owner:string) {
  for(const circle of data.shares)await circleFor(u,circle,owner);
  ensure(data.family ? catalog.some(c=>c.family===data.species) : catalog.some(c=>c.id===data.species),'catalog','此物種尚未收錄於已查核目錄。',400);
  const species=data.family?catalog.filter(c=>c.family===data.species):[catalogById.get(data.species)!];
  const allowed:Record<string,Set<string>>={form:new Set(species.flatMap(c=>c.forms.map(f=>f.id))),costume:new Set(species.flatMap(c=>c.costumes.map(f=>f.id))),shiny:new Set(['true','false']),size:new Set(['XXS','XS','NORMAL','XL','XXL']),state:new Set(['NORMAL','SHADOW','PURIFIED'])};
  for(const trait of ['form','costume','shiny','size','state'] as const){
    const value=data.traits[trait];const values=typeof value==='string'?[value]:value.mode==='IN'?value.values:[];
    for(const v of values){
      if(v==='UNKNOWN'&&data.intent==='provide')continue;
      if(v.startsWith('custom:')&&(trait==='form'||trait==='costume')){
        const variant=await required<Variant>(u,v,'variant');
        ensure(variant.status==='approved'&&variant.trait===trait&&species.some(s=>s.id===variant.species),'variant','此自訂條件尚未核准或不適用於此物種。',400);
        const source=await u.get<Circle>(variant.circle!);
        if(source?.members[owner]?.status!=='active'){
          const circles=await u.list<Circle>('circle');const visible=new Set(circles.filter(c=>c.members[owner]?.status==='active').map(c=>c.id));
          const shared=(await u.list<Listing>('listing')).some(l=>!l.deletedAt&&l.shares.some(c=>visible.has(c))&&canonical(l.traits).includes(JSON.stringify(v)));
          ensure(shared,'not_found','找不到可使用的自訂條件。',404);
        }
      }else ensure(allowed[trait].has(v),'catalog','條件不屬於選取的物種，請重新選擇。',400);
    }
  }
  if(data.intent==='provide'){
    ensure(!Object.values(data.traits).includes('ANY'),'traits','供給必須是實際屬性。',400);
    ensure(data.status!=='active'||!Object.values(data.traits).includes('UNKNOWN'),'unknown','有未知條件時請先存為草稿。',400);
    if(data.traits.costume!=='NONE'&&data.traits.costume!=='UNKNOWN'&&!data.traits.costume.startsWith('custom:'))ensure(data.traits.form==='STANDARD','combination','GO 裝扮資料沒有確認這種形態組合；請使用標準形態，或申請精確自訂變體。',400);
  }
}
async function saveListing(u:Unit,l:Listing,before:Listing|null,actor:string,reason:string){
  invariant(l);const labels:Record<string,string>={};
  for(const trait of ['form','costume'] as const){const v=l.traits[trait];for(const value of typeof v==='string'?[v]:v.mode==='IN'?v.values:[])if(value.startsWith('custom:')){const variant=await required<Variant>(u,value,'variant');labels[value]='自訂 · '+variant.label;}}
  l.variantLabels=labels;u.put(l);u.event(l.owner,l.id,{actor,reason,before,after:l});return l;
}
export async function execute(u:Unit,actor:string,op:string,raw:unknown):Promise<unknown> {
  switch(op){
    case 'visibility.set': {
      const p=z.object({listing:str,version:z.number().int().min(0),hidden:z.boolean()}).strict().parse(raw);
      const id=await visibilityId(actor,p.listing),before=await u.get<import('./model').Visibility>(id);
      if(p.hidden){const l=await visibleListing(u,p.listing,actor);ensure(l.owner!==actor,'own_listing','自己的項目請使用清單狀態管理。',400);}
      else ensure(before?.owner===actor,'not_found','找不到自己的隱藏設定。',404);
      ensure((before?.version??0)===p.version,'version_conflict','隱藏設定已更新，請重新整理。');
      const result:import('./model').Visibility={...(before?change(before):make('visibility',actor)),id,kind:'visibility',listing:p.listing,hidden:p.hidden};u.put(result);u.event(actor,id,{listing:p.listing,hidden:p.hidden});
      return {listing:p.listing,hidden:p.hidden,version:result.version};
    }
    case 'listing.unhide': {
      const p=ref.extend({circle:str,event:str}).strict().parse(raw),l=await restorable(u,actor,p.circle,p.event);
      ensure(l.id===p.id,'not_found','找不到可復原的撤下紀錄。',404);version(l,p.version);
      ensure(l.shares.length<30,'shares','分享圈數已達上限。');
      await saveListing(u,{...change(l),shares:[...l.shares,p.circle]},l,actor,'管理員復原本圈分享；數量不變');
      return {id:l.id,circle:p.circle,version:l.version+1,restored:true};
    }
    case 'variant.create': {
      const p=z.object({circle:str,species:str,trait:z.enum(['form','costume']),label:z.string().trim().min(2).max(60)}).strict().parse(raw);
      const c=await circleFor(u,p.circle,actor);ensure(catalogById.has(p.species),'catalog','物種不存在。',400);
      const e=make('variant',actor,c.id);const v:Variant={...e,...p,id:'custom:'+e.id,status:'pending'};u.put(v);u.event(actor,v.id,{submitted:true});return v;
    }
    case 'variant.review': {
      const p=ref.extend({approve:z.boolean()}).strict().parse(raw);const v=await required<Variant>(u,p.id,'variant');await circleFor(u,v.circle!,actor,true);version(v,p.version);ensure(v.status==='pending','state','已審核的變體不可改名或改義。');const result={...change(v),status:p.approve?'approved' as const:'rejected' as const};u.put(result);u.event(v.owner,v.id,{reviewedBy:actor,status:result.status});return result;
    }
    case 'listing.hide': {
      const p=ref.extend({circle:str}).strict().parse(raw);await circleFor(u,p.circle,actor,true);const l=await required<Listing>(u,p.id,'listing');ensure(l.shares.includes(p.circle),'not_found','這筆資料未分享於此圈。',404);version(l,p.version);
      await saveListing(u,{...change(l),shares:l.shares.filter(c=>c!==p.circle)},l,actor,'管理員從本圈撤下；數量不變');
      return {id:l.id,circle:p.circle,version:l.version+1,removed:true};
    }
    case 'listing.batch': {
      const p=z.object({items:z.array(ref.extend({quantity:z.number().int().min(0).max(1000000)})).min(1).max(50)}).strict().parse(raw);ensure(new Set(p.items.map(i=>i.id)).size===p.items.length,'duplicate','不可重複調整同筆資料。',400);
      const results=[];for(const item of p.items){const l=await required<Listing>(u,item.id,'listing');await writable(u,l,actor);version(l,item.version);ensure(!l.deletedAt&&l.quantity!==null,'quantity','只能調整有限數量的現有資料。');results.push(await saveListing(u,{...change(l),quantity:item.quantity} as Listing,l,actor,'批次調整數量'));}return {items:results};
    }
    case 'import.preview': {
      const p=z.object({schema_version:z.literal(2),dataset:z.object({datasetId:z.literal(catalogDataset.datasetId),version:z.literal(catalogDataset.version),contentHash:z.literal(catalogDataset.contentHash)}).strict(),listings:z.array(z.unknown()).max(100),history:z.array(z.unknown()).optional(),exported_at:z.string().optional()}).strict().parse(raw);
      const rows:{sourceId:string;id:string;data:z.infer<typeof listingInput>}[]=[];const conflicts:string[]=[];
      for(const [index,value] of p.listings.entries()){
        if(!value||typeof value!=='object'||Array.isArray(value)){conflicts.push(`第 ${index+1} 筆：格式不正確。`);continue;}
        const envelope=backupListing.safeParse(value);
        if(!envelope.success){conflicts.push('第 '+(index+1)+' 筆：備份記錄欄位格式不正確。');continue;}
        const row=envelope.data as Listing;const parsed=listingInput.safeParse(pickInput(row));
        if(!parsed.success||row.kind!=='listing'||row.owner!==actor){conflicts.push(`第 ${index+1} 筆：格式不正確或不是本人的資料。`);continue;}
        if(row.reserved||row.fulfilled||row.historyBound){conflicts.push(`第 ${index+1} 筆：有預留／歷史，必須走維運還原，不能由個人匯入製造帳本。`);continue;}
        const target='import-'+(await digest(actor+':'+row.id)).slice(0,40);
        if(await u.get(row.id)||await u.get(target)||rows.some(r=>r.sourceId===row.id)){conflicts.push(`第 ${index+1} 筆：記錄已存在或重複，沒有覆寫。`);continue;}
        rows.push({sourceId:row.id,id:target,data:{...parsed.data,shares:[],status:'draft'}});
      }
      const backup=await u.list<Listing>('listing',{owner:actor});
      const job={...make('import',actor),rows,conflicts,backup,status:'preview'};u.put(job);return {id:job.id,version:job.version,conflicts,count:rows.length,impact:'僅建立本人的私人草稿；不匯入角色、分享權限、預留或完成歷史。'};
    }
    case 'import.apply': {
      const p=ref.extend({backupDownloaded:z.literal(true),confirmed:z.literal(true)}).strict().parse(raw);
      const job=await required<Entity&{rows:{id:string;data:z.infer<typeof listingInput>}[];conflicts:string[];status:string}>(u,p.id,'import');ensure(job.owner===actor,'not_found','找不到匯入預覽。',404);version(job,p.version);ensure(job.status==='preview'&&!job.conflicts.length,'import_conflict','請先解決預覽中的衝突。');
      for(const row of job.rows){ensure(!await u.get(row.id),'import_duplicate','已有匯入記錄；整批未匯入。');const l={...make('listing',actor),...row.data,id:row.id,reserved:0,fulfilled:0,deletedAt:null} as Listing;await checkListing(u,row.data,actor);await saveListing(u,l,null,actor,'personal import');}
      u.put({...change(job),status:'applied'});return {id:job.id,count:job.rows.length};
    }
    case 'circle.create': {
      const p=z.object({name:z.string().trim().min(1).max(60)}).strict().parse(raw);
      const c:Circle={...make('circle',actor),kind:'circle',name:p.name,fast:false,members:{[actor]:{role:'owner',status:'active'}}};u.put(c);u.event(actor,c.id,{created:true});return c;
    }
    case 'circle.update': {
      const p=ref.extend({name:z.string().trim().min(1).max(60),fast:z.boolean()}).strict().parse(raw);const c=await circleFor(u,p.id,actor,true);version(c,p.version);
      const next={...change(c),name:p.name,fast:p.fast};
      if(!p.fast){
        for(const plan of await u.list<Plan>('plan',{circle:c.id})){plan.fastConsents=[];u.put(change(plan));}
        for(const batch of await u.list<Completion>('completion',{circle:c.id}))if(batch.status==='pending'){batch.fast=false;u.put(change(batch));}
      }
      u.put(next);u.event(c.owner,c.id,{name:p.name,fast:p.fast});return next;
    }
    case 'invite.create': {
      const p=z.object({circle:str,token:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(raw);await circleFor(u,p.circle,actor,true);const invite:Invitation={...make('invitation',actor,p.circle),hash:await digest(p.token),expires:Date.now()+7*86400000,used:false,revoked:false};u.put(invite);return {id:invite.id};
    }
    case 'invite.revoke': {
      const p=ref.strict().parse(raw);const i=await required<Invitation>(u,p.id,'invitation');await circleFor(u,i.circle!,actor,true);version(i,p.version);u.put({...change(i),revoked:true});return {ok:true};
    }
    case 'invite.redeem': {
      const p=z.object({id:str,token:z.string().length(64)}).strict().parse(raw);const i=await required<Invitation>(u,p.id,'invitation');ensure(!i.used&&!i.revoked&&i.expires>Date.now()&&i.hash===await digest(p.token),'invite','邀請已失效。',404);
      const c=await required<Circle>(u,i.circle!,'circle');ensure(c.members[actor]?.status!=='active','member','你已經是圈內成員。');c.members[actor]={role:'member',status:'pending'};u.put(change(c));u.put({...change(i),used:true});u.event(c.owner,c.id,{joinRequest:actor});return {pending:true};
    }
    case 'circle.member': {
      const p=ref.extend({user:str,action:z.enum(['approve','remove','admin','member'])}).strict().parse(raw);
      const c=await circleFor(u,p.id,actor,p.user!==actor);version(c,p.version);ensure(c.members[p.user]&&c.members[p.user].role!=='owner','owner','圈主不可被移除；請保留至少一名圈主。');
      if(p.user===actor)ensure(p.action==='remove','role','不能自行提升角色。',403);
      if(['admin','member'].includes(p.action))ensure(c.members[actor].role==='owner','role','只有圈主可以調整管理員。',403);
      if(p.action==='approve'){ensure(c.members[p.user].status==='pending');c.members[p.user].status='active';}
      else if(p.action==='remove'){
        c.members[p.user].status='removed';
        for(const plan of await u.list<Plan>('plan',{circle:c.id}))if(plan.parties.includes(p.user)&&['reserved','in_progress'].includes(plan.status))await cancelRemainder(u,plan,true);
      }else c.members[p.user].role=p.action;
      u.put(change(c));u.event(c.owner,c.id,{member:p.user,action:p.action});return {ok:true};
    }
    case 'grant.create': {
      const p=z.object({delegate:str,targets:z.array(str).max(100),circles:z.array(str).max(30),create:z.boolean()}).strict().parse(raw);ensure(p.delegate!==actor,'delegate','不能授權自己。',400);
      ensure(p.targets.length||p.create,'grant','請選取至少一筆資料或明確允許建立。',400);
      for(const c of p.circles){await circleFor(u,c,actor);await circleFor(u,c,p.delegate);}
      for(const target of p.targets){const l=await required<Listing>(u,target,'listing');ensure(l.owner===actor,'not_found','找不到可授權的資料。',404);}
      const g:Grant={...make('grant',actor),...p,revoked:false};u.put(g);u.event(actor,g.id,{delegate:p.delegate,targets:p.targets,circles:p.circles,create:p.create});return g;
    }
    case 'grant.revoke': {
      const p=ref.strict().parse(raw);const g=await required<Grant>(u,p.id,'grant');ensure(g.owner===actor,'not_found','找不到授權。',404);version(g,p.version);u.put({...change(g),revoked:true});u.event(actor,g.id,{revoked:true});return {ok:true};
    }
    case 'listing.save': {
      const p=z.object({id:str.optional(),version:positive.optional(),owner:str.optional(),grant:str.optional(),data:listingInput}).strict().parse(raw);
      let before:Listing|null=null;let grant:Grant|null=null;let owner=actor;
      if(p.id){before=await required<Listing>(u,p.id,'listing');grant=await writable(u,before,actor);owner=before.owner;version(before,p.version??0);ensure(!before.deletedAt,'deleted','請先從垃圾桶還原。');ensure(before.intent===p.data.intent,'intent','請另建一筆不同用途的清單。',400);}
      else if(p.owner&&p.owner!==actor){grant=await required<Grant>(u,p.grant??'','grant');ensure(grant.owner===p.owner&&grant.delegate===actor&&grant.create&&!grant.revoked,'not_found','無法代為建立。',404);owner=p.owner;}
      if(grant)ensure(p.data.shares.every(c=>grant!.circles.includes(c))&&(!before||p.data.shares.every(c=>before!.shares.includes(c))),'sharing','代管不可擴大分享範圍。',403);
      await checkListing(u,p.data,owner);
      if(before&&(before.historyBound||before.fulfilled>0))ensure(before.species===p.data.species&&before.family===p.data.family&&canonical(before.traits)===canonical(p.data.traits),'history_identity','已有完成紀錄，不能改成不同物種或條件；請另建一筆清單。');
      if(before?.reserved)ensure(canonical({...p.data,quantity:0,note:''})===canonical({...listingInput.parse(pickInput(before)),quantity:0,note:''}),'reserved','預留中不可修改條件／範圍；請先處理計畫。');
      const l={...(before?change(before):make('listing',owner)),...p.data,shares:[...new Set(p.data.shares)],reserved:before?.reserved??0,fulfilled:before?.fulfilled??0,deletedAt:null} as Listing;
      if(grant&&!before){grant.targets.push(l.id);u.put(change(grant));}
      return saveListing(u,l,before,actor,before?'edit':'create');
    }
    case 'listing.append': {
      const p=ref.extend({quantity:positive,comparison:z.string().max(10000)}).strict().parse(raw);const l=await required<Listing>(u,p.id,'listing');await writable(u,l,actor);version(l,p.version);ensure(!l.deletedAt&&l.quantity!==null,'append','持續需求或已刪除資料不能追加目標。');ensure(fingerprint(l)!==null&&fingerprint(l)===p.comparison,'comparison','條件已變更或包含未知值，不能合併。');
      return saveListing(u,{...change(l),quantity:l.quantity+p.quantity} as Listing,l,actor,'confirmed quantity append');
    }
    case 'listing.delete': case 'listing.restore': {
      const p=ref.strict().parse(raw);const l=await required<Listing>(u,p.id,'listing');await writable(u,l,actor);version(l,p.version);ensure(l.reserved===0,'reserved','請先處理仍有預留或待確認的計畫。');
      if(op==='listing.restore'){
        await checkListing(u,pickInput(l),l.owner);const f=fingerprint(l);ensure(!f||!(await u.list<Listing>('listing',{owner:l.owner})).some(x=>x.id!==l.id&&!x.deletedAt&&fingerprint(x)===f),'duplicate','已有相同條件記錄；請先比較數量，避免重複庫存。');
      }
      return saveListing(u,{...change(l),deletedAt:op==='listing.delete'?now():null},l,actor,op);
    }
    case 'plan.propose': return propose(u,actor,raw);
    case 'plan.accept': {
      const p=ref.extend({fast:z.boolean()}).strict().parse(raw);const plan=await planFor(u,p.id,actor);version(plan,p.version);ensure(plan.status==='proposed','state','計畫已接受或結束。');const c=await circleFor(u,plan.circle!,actor);
      for(const party of plan.parties)await circleFor(u,c.id,party);
      ensure(!p.fast||c.fast,'fast_disabled','此圈尚未啟用快速確認。');
      plan.consents=[...new Set([...plan.consents,actor])];plan.fastConsents=p.fast?[...new Set([...plan.fastConsents,actor])]:plan.fastConsents.filter(x=>x!==actor);
      if(plan.parties.every(x=>plan.consents.includes(x))){for(const item of plan.items)await reserve(u,plan,item);plan.status='reserved';}
      u.put(change(plan));u.event(actor,plan.id,{status:plan.status,revision:plan.revision});return plan;
    }
    case 'plan.cancel': case 'plan.decline': {
      const p=ref.strict().parse(raw);const plan=await planFor(u,p.id,actor);version(plan,p.version);
      if(plan.status==='proposed'){plan.status=op==='plan.decline'?'declined':'cancelled';u.put(change(plan));}
      else {ensure(['reserved','in_progress'].includes(plan.status));ensure(!plan.items.some(i=>i.pending),'pending','已有實際交付回報；須先確認或雙方釐清，不能重新列為可用。');await cancelRemainder(u,plan,false);}
      u.event(actor,plan.id,{cancelled:true});return {ok:true};
    }
    case 'completion.report': {
      const p=ref.extend({lines:z.record(z.string(),positive)}).strict().parse(raw);const plan=await planFor(u,p.id,actor);version(plan,p.version);ensure(['reserved','in_progress'].includes(plan.status),'state','請先完成雙方同意與預留。');
      ensure(Object.keys(p.lines).length>0&&Object.keys(p.lines).every(k=>plan.items.some(i=>i.id===k)),'lines','完成項目無效。',400);
      const totals=plan.parties.map(party=>plan.items.filter(i=>i.from===party).reduce((sum,i)=>sum+(p.lines[i.id]??0),0));ensure(totals[0]>0&&totals[0]===totals[1],'balance','雙方本次送出隻數必須相等。',400);
      for(const i of plan.items){const q=p.lines[i.id]??0;ensure(q<=i.quantity-i.completed-i.pending-i.cancelled,'pending','數量超過尚可回報的預留。');i.pending+=q;}
      const c=await required<Circle>(u,plan.circle!,'circle');
      const b:Completion={...make('completion',actor,plan.circle),plan:plan.id,lines:p.lines,consents:[actor],voidConsents:[],fast:c.fast&&plan.parties.every(x=>plan.fastConsents.includes(x)),status:'pending',revision:1};u.put(change(plan));u.put(b);
      if(b.fast)await post(u,plan,b);
      u.event(actor,b.id,{reported:p.lines,status:b.status});return b;
    }
    case 'completion.confirm': {
      const p=ref.strict().parse(raw);const b=await required<Completion>(u,p.id,'completion');const plan=await planFor(u,b.plan,actor);version(b,p.version);ensure(b.status==='pending','posted','此批已入帳或作廢。');
      b.consents=[...new Set([...b.consents,actor])];const c=await required<Circle>(u,plan.circle!,'circle');
      ensure(!b.voidConsents.length,'disputed','此批有作廢申請，請先由雙方釐清。');
      if(plan.parties.every(x=>b.consents.includes(x))||(b.fast&&c.fast&&plan.parties.every(x=>plan.fastConsents.includes(x))))await post(u,plan,b);else u.put(change(b));return b;
    }
    case 'completion.void': {
      const p=ref.extend({reason:z.string().trim().min(5).max(1000)}).strict().parse(raw);const b=await required<Completion>(u,p.id,'completion');const plan=await planFor(u,b.plan,actor);version(b,p.version);ensure(b.status==='pending');
      b.fast=false;b.consents=[];b.voidConsents=[...new Set([...b.voidConsents,actor])];
      if(plan.parties.every(p=>b.voidConsents.includes(p))){for(const item of plan.items)item.pending-=b.lines[item.id]??0;b.status='void';u.put(change(plan));}
      u.put(change(b));for(const party of plan.parties)u.event(party,b.id,{voidRequested:actor,reason:p.reason,status:b.status});return b;
    }
    case 'correction.propose': {
      const p=z.object({completion:str,reason:z.string().trim().min(5).max(1000),restoreInventory:z.boolean()}).strict().parse(raw);const b=await required<Completion>(u,p.completion,'completion');const plan=await planFor(u,b.plan,actor);ensure(b.status==='posted','state','只能更正已入帳批次。');
      ensure(!(await u.list<Correction>('correction',{circle:plan.circle})).some(c=>c.completion===b.id&&c.status!=='rejected'),'correction','此批已有更正申請。');
      const c:Correction={...make('correction',actor,plan.circle),...p,plan:plan.id,consents:[actor],status:'pending'};u.put(c);for(const party of plan.parties)u.event(party,c.id,{correctionProposed:actor,completion:b.id,reason:p.reason,restoreInventory:p.restoreInventory});return c;
    }
    case 'correction.reject': {
      const p=ref.extend({reason:z.string().trim().min(5).max(1000)}).strict().parse(raw);const c=await required<Correction>(u,p.id,'correction');const plan=await planFor(u,c.plan,actor);version(c,p.version);ensure(c.status==='pending');const next={...change(c),status:'rejected' as const,rejectionReason:p.reason};u.put(next);for(const party of plan.parties)u.event(party,c.id,{rejectedBy:actor,reason:p.reason});return next;
    }
    case 'correction.confirm': {
      const p=ref.strict().parse(raw);const c=await required<Correction>(u,p.id,'correction');const plan=await planFor(u,c.plan,actor);version(c,p.version);ensure(c.status==='pending');c.consents=[...new Set([...c.consents,actor])];
      if(plan.parties.every(x=>c.consents.includes(x))){const b=await required<Completion>(u,c.completion,'completion');for(const item of plan.items){const q=b.lines[item.id]??0;if(!q)continue;
        if(item.supply&&c.restoreInventory){const l=await required<Listing>(u,item.supply,'listing');await saveListing(u,{...change(l),quantity:l.quantity!+q} as Listing,l,actor,'correction: explicitly confirmed no real delivery');}
        if(item.request){const l=await required<Listing>(u,item.request,'listing');await saveListing(u,{...change(l),fulfilled:l.fulfilled-q},l,actor,'fulfillment correction');}
      }c.status='posted';u.event(plan.parties[0],c.id,{reason:c.reason,restoreInventory:c.restoreInventory,completion:b.id});u.event(plan.parties[1],c.id,{reason:c.reason,restoreInventory:c.restoreInventory,completion:b.id});}
      u.put(change(c));return c;
    }
    default: ensure(false,'operation','尚未支援此操作。',400);
  }
}
export function pickInput(l:Listing){return {intent:l.intent,species:l.species,family:l.family,traits:l.traits,quantity:l.quantity,shares:l.shares,purpose:l.purpose,note:l.note,protected:l.protected,status:l.status,priority:l.priority} as z.infer<typeof listingInput>;}
export async function planFor(u:Unit,id:string,actor:string){const p=await required<Plan>(u,id,'plan');ensure(p.parties.includes(actor),'not_found','找不到計畫。',404);return p;}
async function propose(u:Unit,actor:string,raw:unknown){
  const input=z.object({id:str.optional(),version:positive.optional(),circle:str,other:str,fast:z.boolean(),items:z.array(z.object({from:str,supply:str.nullable(),request:str.nullable(),quantity:positive}).strict()).min(2).max(30)}).strict().parse(raw);
  const c=await circleFor(u,input.circle,actor);await circleFor(u,c.id,input.other);ensure(actor!==input.other,'parties','需要另一位交換對象。',400);
  ensure(!input.fast||c.fast,'fast_disabled','此圈尚未啟用快速確認。');
  let before:Plan|null=null;if(input.id){before=await planFor(u,input.id,actor);version(before,input.version??0);ensure(before.status==='proposed'&&before.circle===c.id&&before.parties.includes(input.other),'state','預留後請取消未完成部分並另建計畫。');}
  const parties=[actor,input.other];const items:TradeItem[]=[];
  for(const x of input.items){ensure(parties.includes(x.from),'owner','供給者不在計畫中。',400);let snapshot:Listing|null=null;
    if(x.supply){snapshot=await required<Listing>(u,x.supply,'listing');ensure(snapshot.owner===x.from&&snapshot.intent==='provide'&&snapshot.shares.includes(c.id)&&snapshot.status==='active'&&!snapshot.deletedAt,'not_found','供給不可用。',404);ensure(!Object.values(snapshot.traits).includes('UNKNOWN')&&tradeStatus(snapshot)!==false,'trade','此供給條件不完整或資料標記不可交換。');}
    else ensure(!x.request,'placeholder','未登錄回換不可完成需求。',400);
    if(x.request){const r=await required<Listing>(u,x.request,'listing');ensure(parties.includes(r.owner)&&r.owner!==x.from&&r.shares.includes(c.id)&&snapshot&&match(snapshot,r),'match','需求與供給不符合。');}
    items.push({...x,id:make('item',actor).id,snapshot,completed:0,pending:0,cancelled:0});
  }
  ensure(parties.every(p=>items.some(i=>i.from===p)),'bilateral','雙方都需有供給或未指定回換。',400);
  const plan:Plan={...(before?change(before):make('plan',actor,c.id)),parties:before?.parties??parties,revision:(before?.revision??0)+1,status:'proposed',items,consents:[actor],fastConsents:input.fast?[actor]:[]};u.put(plan);u.event(actor,plan.id,{revision:plan.revision,proposed:true});return plan;
}
async function reserve(u:Unit,plan:Plan,item:TradeItem){
  if(item.supply){const s=await required<Listing>(u,item.supply,'listing');ensure(s.owner===item.from&&s.shares.includes(plan.circle!)&&s.status==='active'&&!s.deletedAt&&fingerprint(s)===fingerprint(item.snapshot!),'changed','供給條件已變更，請重建提案。');ensure(tradeStatus(s)!==false,'trade','此供給目前的規則已標記不可交換。');ensure(available(s)!>=item.quantity,'stock','供給可用量不足，整份計畫未預留。');s.reserved+=item.quantity;invariant(s);u.put(change(s));}
  if(item.request){const r=await required<Listing>(u,item.request,'listing');ensure(r.intent==='request'&&r.shares.includes(plan.circle!)&&r.status==='active'&&!r.deletedAt&&match(item.snapshot!,r),'request','需求已變更。');r.reserved+=item.quantity;invariant(r);u.put(change(r));}
}
async function cancelRemainder(u:Unit,plan:Plan,preservePending:boolean){
  for(const i of plan.items){const q=i.quantity-i.completed-i.cancelled-(preservePending?i.pending:0);if(q<=0)continue;
    for(const id of [i.supply,i.request])if(id){const l=await required<Listing>(u,id,'listing');l.reserved-=q;invariant(l);u.put(change(l));}i.cancelled+=q;
  }
  plan.status=plan.items.some(i=>i.pending)?'in_progress':'cancelled';u.put(change(plan));
}
async function post(u:Unit,plan:Plan,b:Completion){
  ensure(b.status==='pending');for(const i of plan.items){const q=b.lines[i.id]??0;if(!q)continue;ensure(i.pending>=q);
    if(i.supply){const s=await required<Listing>(u,i.supply,'listing');await saveListing(u,{...change(s),quantity:s.quantity!-q,reserved:s.reserved-q,fulfilled:s.fulfilled+q,historyBound:true} as Listing,s,b.owner,'delivery');}
    if(i.request){const r=await required<Listing>(u,i.request,'listing');await saveListing(u,{...change(r),fulfilled:r.fulfilled+q,reserved:r.reserved-q,historyBound:true},r,b.owner,'fulfillment');}
    i.pending-=q;i.completed+=q;
  }
  plan.status=plan.items.every(i=>i.completed+i.cancelled===i.quantity)?(plan.items.some(i=>i.cancelled)?'cancelled':'completed'):'in_progress';b.status='posted';u.put(change(plan));u.put(change(b));
  for(const party of plan.parties)u.event(party,b.id,{plan:plan.id,lines:b.lines,posted:true});
}
