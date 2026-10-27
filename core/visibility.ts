import {canonical,ensure,type Audit,type Listing,type Unit} from './model';
import {circleFor,required} from './service';

export const visibilityId=(actor:string,listing:string)=>'visibility:'+actor+':'+listing;
export async function visibleListing(u:Unit,id:string,actor:string){
  const l=await required<Listing>(u,id,'listing');
  const circles=await u.list<import('./model').Circle>('circle');
  ensure(!l.deletedAt&&(l.owner===actor||circles.some(c=>c.members[actor]?.status==='active'&&l.shares.includes(c.id))),'not_found','找不到目前可見的項目。',404);
  return l;
}
// Only the exact single-circle removal recorded by the server is reversible.
// Never expose either raw audit snapshot to the administrator.
export function removalSnapshot(a:Audit|null,circle:string):Listing|null{
  if(a?.operation!=='listing.hide')return null;
  const d=a.data as {before?:Listing;after?:Listing};const b=d?.before,l=d?.after;
  if(!b||!l||b.kind!=='listing'||l.kind!=='listing'||b.id!==a.entityId||l.id!==b.id||b.owner!==a.owner||l.owner!==b.owner||l.version!==b.version+1||!Array.isArray(b.shares)||!Array.isArray(l.shares)||!b.shares.includes(circle)||l.shares.includes(circle))return null;
  if(canonical({...b,version:l.version,updatedAt:l.updatedAt,shares:b.shares.filter(c=>c!==circle),variantLabels:l.variantLabels})!==canonical(l))return null;
  return l;
}
export async function restorable(u:Unit,actor:string,circle:string,event:string){
  const c=await circleFor(u,circle,actor,true),a=await u.audit(event),snapshot=removalSnapshot(a,circle);
  ensure(snapshot,'not_found','找不到可復原的撤下紀錄。',404);
  const current=await required<Listing>(u,snapshot.id,'listing');
  ensure(!current.deletedAt&&c.members[current.owner]?.status==='active'&&canonical(current)===canonical(snapshot),'restore_changed','項目在撤下後已變更或擁有者已離圈，請由擁有者重新分享。');
  return current;
}
