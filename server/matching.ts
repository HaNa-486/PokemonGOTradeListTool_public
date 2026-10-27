import {catalog,match,tradeStatus} from '../core/catalog';
import {ensure,traits,type Listing} from '../core/model';
import type {D1Unit} from '../core/store';
const families=JSON.stringify(Object.fromEntries(catalog.map(c=>[c.id,c.family])));
const blocked=JSON.stringify(catalog.filter(c=>c.tradable===false).map(c=>c.id));
export async function matchingPage(db:D1Unit['db'],actor:string,scopes:string[],query:URLSearchParams){
  if(!scopes.length)return {items:[],next:null};
  const binds:unknown[]=[families,JSON.stringify(scopes),actor,JSON.stringify(scopes),actor,actor,blocked];
  const get=(alias:string,path:string)=>alias+'.'+path.replaceAll('.','_');
  const filters=traits.map(t=>`(${get('r','traits.'+t+'.mode')}='ANY' OR EXISTS(SELECT 1 FROM json_each(r.traits_${t}_values) v WHERE v.value=${get('s','traits.'+t)})) AND ${get('s','traits.'+t)}<>'UNKNOWN'`);
  filters.push(`NOT (${get('s','protected')}=1 AND ${get('r','purpose')} IN ('CANDY','XL_CANDY') AND ((${get('s','traits.shiny')}='true' AND ${get('r','traits.shiny.mode')}='ANY') OR (${get('s','traits.costume')}<>'NONE' AND ${get('r','traits.costume.mode')}='ANY') OR (${get('s','traits.size')} IN ('XXS','XXL') AND ${get('r','traits.size.mode')}='ANY')))`);
  if(query.get('friend')){filters.push('(s.owner_id=? OR r.owner_id=?)');binds.push(query.get('friend'),query.get('friend'));}
  if(query.get('purpose')){filters.push(get('r','purpose')+'=?');binds.push(query.get('purpose'));}
  if(query.get('priority')){filters.push(get('r','priority')+'=?');binds.push(Number(query.get('priority')));}
  if(query.get('species')){filters.push(get('s','species')+'=?');binds.push(query.get('species'));}
  let cursor='';if(query.get('after')){let c:unknown;try{c=JSON.parse(query.get('after')!);}catch{ensure(false,'cursor','分頁位置無效。',400);}ensure(Array.isArray(c)&&c.length===5&&typeof c[0]==='number'&&typeof c[1]==='number'&&c.slice(2).every(x=>typeof x==='string'&&x.length<=100),'cursor','分頁位置無效。',400);cursor='AND (priority,quantity,updated,sid,rid)<(?,?,?,?,?)';binds.push(...c);}
  const columns=['intent','species','family','protected','purpose','priority','quantity','reserved','fulfilled','status','deletedAt',...traits.flatMap(t=>['traits.'+t,'traits.'+t+'.mode','traits.'+t+'.values'])];
  const projection=columns.map(p=>`json_extract(e.data,'$.${p}') AS ${p.replaceAll('.','_')}`).join(',');
  const sql=`WITH listings AS MATERIALIZED (
    SELECT e.data,e.id,e.owner_id,e.updated_at,${projection},json_extract(?,'$."'||json_extract(e.data,'$.species')||'"') AS candy_family
    FROM entities e WHERE e.kind='listing' AND EXISTS(SELECT 1 FROM shares x WHERE x.entity_id=e.id AND x.circle_id IN (SELECT value FROM json_each(?)))
    AND NOT EXISTS(SELECT 1 FROM entities v WHERE v.id=('visibility:'||?||':'||e.id) AND v.kind='visibility' AND json_extract(v.data,'$.hidden')=1)
  ), pairs AS (
    SELECT s.id AS sid,r.id AS rid,MIN(ss.circle_id) AS circle,
      ${get('r','priority')} AS priority,r.updated_at AS updated,
      MIN(${get('s','quantity')}-${get('s','reserved')},COALESCE(${get('r','quantity')}-${get('r','reserved')}-${get('r','fulfilled')},1000000)) AS quantity
    FROM listings s JOIN listings r ON s.owner_id<>r.owner_id JOIN shares ss ON ss.entity_id=s.id JOIN shares rs ON rs.entity_id=r.id AND rs.circle_id=ss.circle_id
    WHERE ss.circle_id IN (SELECT value FROM json_each(?))
      AND ${get('s','intent')}='provide' AND ${get('r','intent')}='request'
      AND s.owner_id<>r.owner_id AND (s.owner_id=? OR r.owner_id=?)
      AND ((${get('r','family')}=0 AND ${get('s','species')}=${get('r','species')}) OR (${get('r','family')}=1 AND s.candy_family=${get('r','species')}))
      AND ${get('s','species')} NOT IN (SELECT value FROM json_each(?))
      AND ${get('s','status')}='active' AND ${get('r','status')}='active' AND ${get('s','deletedAt')} IS NULL AND ${get('r','deletedAt')} IS NULL
      AND ${get('s','traits.state')}<>'SHADOW' AND ${filters.join(' AND ')}
    GROUP BY s.id,r.id
  ) , selected AS (SELECT * FROM pairs WHERE quantity>0 ${cursor} ORDER BY priority DESC,quantity DESC,updated DESC,sid DESC,rid DESC LIMIT 101) SELECT selected.*,s.data AS supply,r.data AS request FROM selected JOIN listings s ON s.id=selected.sid JOIN listings r ON r.id=selected.rid ORDER BY priority DESC,quantity DESC,updated DESC,sid DESC,rid DESC`;
  const rows=await db.prepare(sql).bind(...binds).all<{supply:string;request:string;circle:string;priority:number;quantity:number;updated:string;sid:string;rid:string}>();
  const selected=rows.results.slice(0,100),items=[];
  for(const row of selected){const s=JSON.parse(row.supply) as Listing,r=JSON.parse(row.request) as Listing;const m=match(s,r);if(m&&tradeStatus(s)!==false)items.push({supply:s,request:r,circle:row.circle,...m});}
  const last=selected.at(-1);return {items,next:rows.results.length>100&&last?JSON.stringify([last.priority,last.quantity,last.updated,last.sid,last.rid]):null};
}
