import {ensure,type Entity,type Plan} from '../core/model';

type Db=Pick<D1Database,'prepare'>;
export function decodeCursor(value:string|null):[string,string]{
  if(!value)return ['9999','\uffff'];
  try{const p=JSON.parse(value);ensure(Array.isArray(p)&&p.length===2&&p.every(x=>typeof x==='string'&&x.length<200),'cursor','分頁位置無效。',400);return p as [string,string];}catch{ensure(false,'cursor','分頁位置無效。',400);}
}
export async function planHistoryPage(db:Db,plan:Plan,cursor:string|null){
  const [date,id]=decodeCursor(cursor);
  const rows=await db.prepare("SELECT data FROM entities WHERE kind IN ('completion','correction') AND json_extract(data,'$.plan')=? AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT 51").bind(plan.id,date,date,id).all<{data:string}>();
  const all=rows.results.map(r=>JSON.parse(r.data) as Entity),items=all.slice(0,50),last=items.at(-1);
  return {batches:items.filter(x=>x.kind==='completion'),corrections:items.filter(x=>x.kind==='correction'),next:all.length>50&&last?JSON.stringify([last.createdAt,last.id]):null};
}
