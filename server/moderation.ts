import {canonical,type Audit,type Circle,type Listing} from '../core/model';
import {removalSnapshot} from '../core/visibility';
import type {D1Unit} from '../core/store';

export async function removalPage(u:D1Unit,circle:Circle,after:string){
  const owners=Object.keys(circle.members).filter(id=>circle.members[id].status==='active');
  const rows=await u.db.prepare(`SELECT a.id,a.actor,a.operation,a.entity_id AS entityId,a.owner_id AS owner,a.data,e.data AS current
    FROM audit_events a JOIN entities e ON e.id=a.entity_id AND e.kind='listing'
    WHERE a.operation='listing.hide' AND a.id>? AND e.version=json_extract(a.data,'$.after.version')
    AND json_extract(e.data,'$.deletedAt') IS NULL AND e.owner_id IN (SELECT value FROM json_each(?))
    AND EXISTS(SELECT 1 FROM json_each(a.data,'$.before.shares') WHERE value=?)
    AND NOT EXISTS(SELECT 1 FROM json_each(a.data,'$.after.shares') WHERE value=?)
    ORDER BY a.id LIMIT 51`).bind(after,JSON.stringify(owners),circle.id,circle.id).all<Omit<Audit,'data'>&{data:string;current:string}>();
  const items=rows.results.slice(0,50).flatMap(row=>{
    const snapshot=removalSnapshot({...row,data:JSON.parse(row.data)},circle.id),l=JSON.parse(row.current) as Listing;
    if(!snapshot||canonical(l)!==canonical(snapshot))return [];
    return [{event:row.id,id:l.id,version:l.version,owner:l.owner,intent:l.intent,species:l.species,family:l.family,traits:l.traits,variantLabels:l.variantLabels}];
  });
  return {items,next:rows.results.length>50?rows.results[49].id:null};
}
