import {assertDatasetBinding} from '../core/dataset-binding';
import { z } from 'zod';
import { D1Unit, command } from '../core/store';
import { circleFor, execute } from '../core/service';
import { catalog, catalogVersion, catalogDataset, catalogSummary } from '../core/catalog';
import {matchingPage} from './matching';
import {decodeCursor,planHistoryPage} from './pages';
import {deploymentBackup} from '../core/backup';
import { ensure, Problem, type Circle, type Entity, type Listing, type Plan } from '../core/model';
import { authRoute, cookie, currentUser, rateLimit, ready, verifyOrigin, type Runtime } from './auth';
import { projectResult } from './projection';
import { chatGPTReady, chatGPTSignInPath } from './sites-auth';
import { limitedBody } from './body';
import {removalPage} from './moderation';

export function secured(response:Response){
  const headers=new Headers(response.headers);headers.set('Cache-Control','private, no-store');headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');headers.set('X-Frame-Options','DENY');headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  return new Response(response.body,{status:response.status,headers});
}
function csvCell(value:unknown){let s=String(value??'');if(/^[\s]*[=+@\-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
export async function handle(req:Request,env:Runtime):Promise<Response>{
  try{
    const url=new URL(req.url);ensure(env.DB,'database_unavailable','雲端資料庫未就緒；請稍後再試。',503);
    if(url.pathname.startsWith('/auth/'))return secured(await authRoute(req,env));
    if(url.pathname==='/api/status')return secured(Response.json({google:ready(env),chatgpt:chatGPTReady(env),chatgptSignIn:chatGPTSignInPath,storage:'D1',catalogVersion,siteOrigin:env.APP_ORIGIN??null}));
    const user=await currentUser(req,env);ensure(user,'unauthenticated','請先登入，才能查看私人帳本。',401);const u=new D1Unit(env.DB.withSession('first-primary'));await assertDatasetBinding(u.db,catalogDataset,true);
    if(req.method==='POST'){
      verifyOrigin(req,env);await rateLimit(env,'user:'+user.id);ensure(req.headers.get('content-type')?.startsWith('application/json'),'content_type','請使用 JSON。',415);
      const body=await limitedBody(req);const data=JSON.parse(body);
      if(url.pathname==='/api/profile'){
        const p=z.object({displayName:z.string().trim().min(1).max(40)}).strict().parse(data);await env.DB.prepare('UPDATE users SET display_name=? WHERE id=?').bind(p.displayName,user.id).run();return secured(Response.json({ok:true}));
      }
      const operation=url.pathname.replace('/api/commands/','');ensure(url.pathname.startsWith('/api/commands/'),'not_found','找不到操作。',404);
      const result=await command(u.db,user.id,operation,req.headers.get('idempotency-key')??'',data,unit=>execute(unit,user.id,operation,data));
      // Legacy hide receipts stored full snapshots. Do not replay that data after revocation.
      if(operation==='listing.hide'||operation==='listing.unhide')return secured(Response.json({id:(result as {id:string}).id,circle:data.circle,ok:true}));
      return secured(Response.json(await projectResult(u.db,user.id,result)));
    }
    ensure(req.method==='GET','method','不支援此方法。',405);
    if(url.pathname==='/api/me')return secured(Response.json({...user,maintenance:(env.MAINTENANCE_USER_IDS??'').split(',').map(s=>s.trim()).filter(Boolean).includes(user.id)}));
    if(url.pathname==='/api/deployment-backup'){
      ensure((env.MAINTENANCE_USER_IDS??'').split(',').map(s=>s.trim()).filter(Boolean).includes(user.id),'not_found','找不到此功能。',404);
      return secured(Response.json(await deploymentBackup(u.db),{headers:{'Content-Disposition':'attachment; filename="deployment-backup.json"'}}));
    }
    if(url.pathname==='/api/import-backup'){
      const job=await u.get<Entity&{backup:Listing[]}>(url.searchParams.get('id')??'');ensure(job?.kind==='import'&&job.owner===user.id,'not_found','找不到備份。',404);
      return secured(Response.json({schema_version:2,dataset:{datasetId:catalogDataset.datasetId,version:catalogDataset.version,contentHash:catalogDataset.contentHash},listings:job.backup,exported_at:new Date().toISOString()},{headers:{'Content-Disposition':'attachment; filename="before-import.json"'}}));
    }
    if(url.pathname==='/api/pending-invite'){
      const value=cookie(req,'__Host-trade_invitation')?.split('.');return secured(Response.json(value?.length===2?{id:value[0],token:value[1]}:null,{headers:{'Set-Cookie':'__Host-trade_invitation=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'}}));
    }
    if(url.pathname==='/api/catalog')return secured(Response.json({version:catalogVersion,items:catalog,coverage:catalogSummary.description,dataset:catalogDataset}));
    const circleRows=await u.db.prepare("SELECT data FROM entities WHERE kind='circle' AND json_extract(data,?)='active' ORDER BY id").bind('$.members."'+user.id+'".status').all<{data:string}>();
    const circles=circleRows.results.map(r=>JSON.parse(r.data) as Circle);
    const visibleCircles=new Set(circles.map(c=>c.id));
    const sanitize=(l:Listing)=>({...l,shares:l.owner===user.id?l.shares:l.shares.filter(c=>visibleCircles.has(c))});
    const sanitizePlan=(p:Plan)=>({...p,items:p.items.map(i=>({...i,snapshot:i.snapshot?{...sanitize(i.snapshot),note:i.snapshot.owner===user.id?i.snapshot.note:''}:null}))});
    if(url.pathname==='/api/circles'){
      const visible=circles.filter(c=>c.id>(url.searchParams.get('after')??''));const items=visible.slice(0,100).map(c=>({...c,members:Object.fromEntries(Object.entries(c.members).filter(([,m])=>m.status==='active'||['owner','admin'].includes(c.members[user.id].role)))}));
      return secured(Response.json(url.searchParams.has('paged')?{items,next:visible.length>100?items.at(-1)!.id:null}:items));
    }
    if(url.pathname==='/api/variants'){
      const circle=url.searchParams.get('circle')??'';const c=await circleFor(u,circle,user.id);
      const rows=await u.list<import('../core/model').Variant>('variant',{circle});const own=rows.filter(v=>v.status==='approved'||v.owner===user.id||['owner','admin'].includes(c.members[user.id].role));
      const shared=await u.db.prepare("SELECT e.data FROM entities e JOIN shares s ON s.entity_id=e.id WHERE s.circle_id=? AND e.kind='listing'").bind(circle).all<{data:string}>();
      const ids=new Set<string>();for(const row of shared.results){const l=JSON.parse(row.data) as Listing;for(const v of Object.keys(l.variantLabels??{}))ids.add(v);}
      const minimal=[];for(const id of ids)if(!own.some(v=>v.id===id)){const v=await u.get<import('../core/model').Variant>(id);if(v?.status==='approved')minimal.push({id:v.id,species:v.species,trait:v.trait,label:v.label,status:v.status});}
      return secured(Response.json([...own,...minimal]));
    }
    if(url.pathname==='/api/invitations'){
      const circle=url.searchParams.get('circle')??'';await circleFor(u,circle,user.id,true);
      const rows=await u.list<import('../core/model').Invitation>('invitation',{circle});return secured(Response.json(rows.map(i=>({id:i.id,version:i.version,expires:i.expires,expired:i.expires<Date.now(),used:i.used,revoked:i.revoked,createdAt:i.createdAt}))));
    }
    if(url.pathname==='/api/listing'){
      const l=await u.get<Listing>(url.searchParams.get('id')??'');ensure(l?.kind==='listing','not_found','找不到清單。',404);
      const granted=l.owner===user.id||(await u.list<import('../core/model').Grant>('grant',{owner:l.owner})).some(g=>g.delegate===user.id&&!g.revoked&&g.targets.includes(l.id));
      ensure(granted||(!l.deletedAt&&l.shares.some(c=>visibleCircles.has(c))),'not_found','找不到清單。',404);return secured(Response.json(sanitize(l)));
    }
    if(url.pathname==='/api/members'){
      const c=await circleFor(u,url.searchParams.get('circle')??'',user.id);const ids=Object.keys(c.members).filter(id=>c.members[id].status==='active'||['owner','admin'].includes(c.members[user.id].role));
      const people=await env.DB.prepare(`SELECT id,display_name AS displayName FROM users WHERE id IN (${ids.map(()=>'?').join(',')})`).bind(...ids).all();return secured(Response.json(people.results));
    }
    if(url.pathname==='/api/moderation'){
      const c=await circleFor(u,url.searchParams.get('circle')??'',user.id,true);
      return secured(Response.json(await removalPage(u,c,url.searchParams.get('after')??'')));
    }
    if(url.pathname==='/api/listings'){
      const circle=url.searchParams.get('circle');const owner=url.searchParams.get('owner')??user.id;const after=url.searchParams.get('after')??'';const limit=50;
      let sql="SELECT e.data,coalesce(json_extract(v.data,'$.hidden'),0) AS personalHidden,coalesce(v.version,0) AS visibilityVersion FROM entities e LEFT JOIN entities v ON v.id=('visibility:'||?||':'||e.id) AND v.kind='visibility' WHERE e.kind=? AND e.id>?";const binds:unknown[]=[user.id,'listing',after];
      if(url.searchParams.get('delegated')==='true'){
        sql+=" AND EXISTS(SELECT 1 FROM entities g,json_each(g.data,'$.targets') target WHERE g.kind='grant' AND json_extract(g.data,'$.delegate')=? AND json_extract(g.data,'$.revoked')=0 AND target.value=e.id)";binds.push(user.id);
      }else if(circle){await circleFor(u,circle,user.id);sql+=' AND EXISTS(SELECT 1 FROM shares s WHERE s.entity_id=e.id AND s.circle_id=?)';binds.push(circle);}
      else {ensure(owner===user.id,'scope','只能檢視自己的全部資料。',403);sql+=' AND e.owner_id=?';binds.push(user.id);}
      const visibility=url.searchParams.get('visibility')??'visible';ensure(['visible','hidden','all'].includes(visibility),'visibility','無效的顯示範圍。',400);
      if(circle&&visibility!=='all')sql+=visibility==='hidden'?" AND json_extract(v.data,'$.hidden')=1":" AND coalesce(json_extract(v.data,'$.hidden'),0)=0";
      for(const key of ['intent','purpose','priority'] as const){const value=url.searchParams.get(key);if(value){sql+=' AND json_extract(e.data,?)=?';binds.push('$.'+key,key==='priority'?Number(value):value);}}
      if(url.searchParams.get('friend')){sql+=' AND e.owner_id=?';binds.push(url.searchParams.get('friend'));}
      if(url.searchParams.has('trash')){sql+=url.searchParams.get('trash')==='true'?" AND json_extract(e.data,'$.deletedAt') IS NOT NULL":" AND json_extract(e.data,'$.deletedAt') IS NULL";}
      const query=url.searchParams.get('q')?.trim().toLowerCase();if(query){const ids=catalog.filter(c=>`${c.id} ${c.zh} ${c.en} ${c.alias}`.toLowerCase().includes(query)).flatMap(c=>[c.id,c.family]);sql+=" AND (json_extract(e.data,'$.species') IN (SELECT value FROM json_each(?)) OR instr(lower(coalesce(json_extract(e.data,'$.note'),'')),?)>0 OR instr(lower(json_extract(e.data,'$.traits')),?)>0)";binds.push(JSON.stringify([...new Set(ids)]),query,query);}
      sql+=' ORDER BY e.id LIMIT ?';binds.push(limit+1);const rows=await env.DB.prepare(sql).bind(...binds).all<{data:string;personalHidden:number;visibilityVersion:number}>();const list=rows.results.map(r=>({...JSON.parse(r.data),personalHidden:!!r.personalHidden,visibilityVersion:r.visibilityVersion}) as Listing);
      const epoch=await env.DB.prepare('SELECT version FROM epochs WHERE id=1').first<{version:number}>();
      return secured(Response.json({items:list.slice(0,limit).map(sanitize),next:list.length>limit?list[limit-1].id:null,revision:epoch?.version??0}));
    }
    if(url.pathname==='/api/revision'){const epoch=await env.DB.prepare('SELECT version FROM epochs WHERE id=1').first<{version:number}>();return secured(Response.json({revision:epoch?.version??0,actor:user.id}));}
    if(url.pathname==='/api/plan-history'){
      const plan=await u.get<Plan>(url.searchParams.get('id')??'');ensure(plan?.kind==='plan'&&plan.parties.includes(user.id),'not_found','找不到計畫。',404);
      return secured(Response.json(await planHistoryPage(u.db,plan,url.searchParams.get('cursor'))));
    }
    if(url.pathname==='/api/plans'){
      const [date,id]=decodeCursor(url.searchParams.get('cursor'));
      const rows=await u.db.prepare("SELECT data FROM entities WHERE kind='plan' AND EXISTS(SELECT 1 FROM json_each(data,'$.parties') WHERE value=?) AND (updated_at<? OR (updated_at=? AND id<?)) ORDER BY updated_at DESC,id DESC LIMIT 51").bind(user.id,date,date,id).all<{data:string}>();
      const all=rows.results.map(r=>JSON.parse(r.data) as Plan),plans=all.slice(0,50),last=plans.at(-1);
      const histories=await Promise.all(plans.map(p=>planHistoryPage(u.db,p,null)));
      return secured(Response.json({plans:plans.map(sanitizePlan),batches:histories.flatMap(h=>h.batches),corrections:histories.flatMap(h=>h.corrections),historyNext:Object.fromEntries(plans.map((p,i)=>[p.id,histories[i].next])),next:all.length>50&&last?JSON.stringify([last.updatedAt,last.id]):null}));
    }
    if(url.pathname==='/api/grants'){
      const rows=await u.db.prepare("SELECT data FROM entities WHERE kind='grant' AND (owner_id=? OR json_extract(data,'$.delegate')=?) AND id>? ORDER BY id LIMIT 101").bind(user.id,user.id,url.searchParams.get('after')??'').all<{data:string}>();const all=rows.results.map(r=>JSON.parse(r.data)),items=all.slice(0,100);
      return secured(Response.json(url.searchParams.has('paged')?{items,next:all.length>100?items.at(-1).id:null}:items));
    }
    if(url.pathname==='/api/matches'){
      const circle=url.searchParams.get('circle')??'';if(circle!=='all')await circleFor(u,circle,user.id);
      const result=await matchingPage(u.db,user.id,circle==='all'?[...visibleCircles]:[circle],url.searchParams);
      return secured(Response.json({...result,items:result.items.map(m=>({...m,supply:sanitize(m.supply),request:sanitize(m.request)}))}));
    }    if(url.pathname==='/api/history'){
      const rows=await env.DB.prepare('SELECT a.id,a.operation,a.actor,u.display_name AS actorName,a.entity_id AS entityId,a.data,a.created_at AS createdAt FROM audit_events a JOIN users u ON u.id=a.actor WHERE a.owner_id=? AND (a.created_at<? OR (a.created_at=? AND a.id<?)) ORDER BY a.created_at DESC,a.id DESC LIMIT 50').bind(user.id,url.searchParams.get('before')??'9999',url.searchParams.get('before')??'9999',url.searchParams.get('afterId')??'').all();return secured(Response.json(rows.results));
    }
    if(url.pathname==='/api/export'){
      const scope=url.searchParams.get('circle');let circleView:Circle|null=null;
      if(scope)circleView=await circleFor(u,scope,user.id,true);
      const listings=scope?(await u.db.prepare("SELECT e.data FROM entities e JOIN shares s ON s.entity_id=e.id WHERE e.kind='listing' AND s.circle_id=? ORDER BY e.id").bind(scope).all<{data:string}>()).results.map(r=>JSON.parse(r.data) as Listing):await u.list<Listing>('listing',{owner:user.id});
      const records=listings.map(l=>scope?{...l,shares:[scope]}:sanitize(l));
      const history=scope?{results:[]}:await env.DB.prepare('SELECT id,operation,entity_id,data,created_at FROM audit_events WHERE owner_id=? ORDER BY created_at').bind(user.id).all();
      if(url.searchParams.get('format')==='csv'){
        const cols=['id','owner','intent','species','family','traits','quantity','reserved','fulfilled','purpose','protected','status','shares','note'] as const;const text=[cols.map(csvCell).join(','),...records.map(l=>cols.map(c=>csvCell(typeof l[c]==='object'?JSON.stringify(l[c]):l[c])).join(','))].join('\r\n');
        return secured(new Response('\uFEFF'+text,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="trade-ledger.csv"'}}));
      }
      return secured(Response.json({schema_version:2,dataset:{datasetId:catalogDataset.datasetId,version:catalogDataset.version,contentHash:catalogDataset.contentHash},exported_at:new Date().toISOString(),...(circleView?{kind:'circle-view',circle:{id:circleView.id,name:circleView.name}}:{}),listings:records,history:scope?[]:history.results},{headers:{'Content-Disposition':'attachment; filename="trade-ledger.json"'}}));
    }
    throw new Problem(404,'not_found','找不到資料。');
  }catch(error){
    if(error instanceof Problem)return secured(Response.json({code:error.code,message:error.message},{status:error.status}));
    if(error instanceof z.ZodError||error instanceof SyntaxError)return secured(Response.json({code:'validation',message:'欄位格式不正確，請檢查數量與條件；輸入已保留。'},{status:400}));
    // Do not log tokens, request bodies, identity claims, or database row content.
    console.error('request_failed',error instanceof Error?error.name:'UnknownError');
    return secured(Response.json({code:'unavailable',message:'儲存服務暫時無法使用。請保留輸入，稍後以相同操作重試。'},{status:503}));
  }
}
