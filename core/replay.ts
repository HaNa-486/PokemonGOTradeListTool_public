import { circleFor, planFor, required } from './service';
import { ensure, type Entity, type Grant, type Listing, type Unit } from './model';
import {visibilityId} from './visibility';
// Receipt access is a read and must still honor current revocation.
export async function authorizeReplay(u:Unit,actor:string,operation:string,payload:unknown,result:unknown){
  const p=payload as Record<string,unknown>,r=result as Record<string,unknown>;
  if(operation==='listing.hide'||operation==='listing.unhide'){await circleFor(u,String(p.circle),actor,true);return;}
  if(operation==='visibility.set'){const v=await required<Entity>(u,await visibilityId(actor,String(p.listing)),'visibility');ensure(v.owner===actor,'not_found','找不到自己的隱藏設定。',404);return;}
  if(operation==='listing.batch'){for(const item of (p.items as {id:string}[])){const l=await required<Listing>(u,item.id,'listing');if(l.owner!==actor)ensure((await u.list<Grant>('grant',{owner:l.owner})).some(g=>g.delegate===actor&&!g.revoked&&g.targets.includes(l.id)),'not_found','代管已撤銷。',404);}return;}
  if(operation.startsWith('variant.')){const e=await required<Entity>(u,String(p.id??r.id),'variant');await circleFor(u,e.circle!,actor,operation==='variant.review');return;}
  if(operation.startsWith('import.')){const job=await required<Entity>(u,String(r.id??p.id),'import');ensure(job.owner===actor,'not_found','找不到匯入紀錄。',404);return;}
  if(operation.startsWith('listing.')){
    const l=await required<Listing>(u,String(r.id??p.id),'listing');
    if(l.owner!==actor)ensure((await u.list<Grant>('grant',{owner:l.owner})).some(g=>g.delegate===actor&&!g.revoked&&g.targets.includes(l.id)),'not_found','代管已撤銷。',404);
  }else if(operation.startsWith('circle.')||operation==='invite.create')await circleFor(u,String(p.circle??p.id??r.id),actor,operation==='invite.create');
  else if(operation.startsWith('plan.'))await planFor(u,String(p.id??r.id),actor);
  else if(operation.startsWith('completion.')||operation.startsWith('correction.')){
    const e=await u.get<Entity&{plan:string}>(String(r.id??p.id));ensure(e,'not_found','找不到紀錄。',404);await planFor(u,e.plan,actor);
  }else if(operation==='invite.revoke'){const e=await u.get<Entity>(String(p.id));ensure(e);await circleFor(u,e.circle!,actor,true);}
  else if(operation.startsWith('grant.')){const g=await required<Grant>(u,String(p.id??r.id),'grant');ensure(g.owner===actor,'not_found','找不到授權。',404);}
}
