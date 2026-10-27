import type { Circle,Entity,Listing,Plan } from '../core/model';
import { D1Unit } from '../core/store';
export async function projectResult(db:D1Unit['db'],actor:string,value:unknown):Promise<unknown>{
  const rows=await db.prepare("SELECT data FROM entities WHERE kind='circle' AND json_extract(data,?)='active'").bind('$.members."'+actor+'".status').all<{data:string}>();
  const allowed=new Set(rows.results.map(r=>(JSON.parse(r.data) as Circle).id));
  function project(x:unknown):unknown{
    if(Array.isArray(x))return x.map(project);
    if(!x||typeof x!=='object')return x;
    const e=x as Entity;
    if(e.kind==='listing'){const l=x as Listing;return {...l,shares:l.owner===actor?l.shares:l.shares.filter(c=>allowed.has(c))};}
    if(e.kind==='plan'){const p=x as Plan;return {...p,items:p.items.map(i=>({...i,snapshot:project(i.snapshot)}))};}
    return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,project(v)]));
  }
  return project(value);
}
