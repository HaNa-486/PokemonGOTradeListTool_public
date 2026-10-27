import { canonical, digest, ensure, id, now, Problem, type Audit, type Entity, type Listing, type Unit } from './model';
import { authorizeReplay } from './replay';
import { catalogDataset } from './catalog';
import { assertDatasetBinding, datasetBindingStatements } from './dataset-binding';

type Db = Pick<D1Database, 'prepare'|'batch'>;
export class D1Unit implements Unit {
  writes = new Map<string, Entity>();
  events: {owner:string;entityId:string;data:unknown}[] = [];
  constructor(public db: Db) {}
  async audit(id:string):Promise<Audit|null>{
    const row=await this.db.prepare('SELECT id,actor,operation,entity_id AS entityId,owner_id AS owner,data FROM audit_events WHERE id=?').bind(id).first<Omit<Audit,'data'>&{data:string}>();
    return row?{...row,data:JSON.parse(row.data)}:null;
  }
  async get<T extends Entity>(id: string): Promise<T|null> {
    if(this.writes.has(id))return structuredClone(this.writes.get(id)) as T;
    const row=await this.db.prepare('SELECT data FROM entities WHERE id = ?').bind(id).first<{data:string}>();
    return row ? JSON.parse(row.data) : null;
  }
  async list<T extends Entity>(kind:string, filter: {owner?:string;circle?:string}={}) {
    const binds: string[]=[kind]; let where='kind = ?';
    if(filter.owner){where+=' AND owner_id = ?';binds.push(filter.owner);}
    if(filter.circle){where+=' AND circle_id = ?';binds.push(filter.circle);}
    const r=await this.db.prepare(`SELECT data FROM entities WHERE ${where} ORDER BY id`).bind(...binds).all<{data:string}>();
    const items=new Map(r.results.map(row=>{const e=JSON.parse(row.data) as T;return [e.id,e];}));
    for(const e of this.writes.values())if(e.kind===kind&&(!filter.owner||e.owner===filter.owner)&&(!filter.circle||e.circle===filter.circle))items.set(e.id,structuredClone(e) as T);
    return [...items.values()];
  }
  put<T extends Entity>(e:T){this.writes.set(e.id,structuredClone(e));}
  event(owner:string,entityId:string,data:unknown){this.events.push({owner,entityId,data});}
}
// All business mutations use this gate, including permission revocations. A
// zero-row epoch UPDATE becomes a CHECK failure, rolling the ENTIRE D1 batch back.
// Nothing relies on an in-process lock or SELECT-then-unconditional-UPDATE.
export async function command<T>(db:Db, actor:string, operation:string, key:string, payload:unknown, run:(u:D1Unit)=>Promise<T>):Promise<T> {
  ensure(/^[A-Za-z0-9_-]{16,100}$/.test(key),'idempotency','缺少有效的重試識別碼。',400);
  const hash=await digest(canonical(payload));
  for(let attempt=0;attempt<4;attempt++) {
    await assertDatasetBinding(db,catalogDataset,true);
    const cached=await db.prepare('SELECT hash, result FROM idempotency_records WHERE actor=? AND operation=? AND key=?').bind(actor,operation,key).first<{hash:string;result:string}>();
    if(cached){ensure(cached.hash===hash,'idempotency_mismatch','同一重試識別碼不能送出不同內容。');const result=JSON.parse(cached.result);await authorizeReplay(new D1Unit(db),actor,operation,payload,result);return result;}
    // Initialization contains no business data and is safe under concurrent requests.
    await db.prepare('INSERT OR IGNORE INTO epochs(id,version) VALUES(1,0)').run();
    const epoch=await db.prepare('SELECT version FROM epochs WHERE id=1').first<{version:number}>();
    const u=new D1Unit(db);const result=await run(u);const guard=id();
    const batch=[...datasetBindingStatements(db,catalogDataset),db.prepare('UPDATE epochs SET version=version+1 WHERE id=1 AND version=?').bind(epoch!.version),
      db.prepare('INSERT INTO transaction_guards(id,ok) VALUES(?,changes())').bind(guard)];
    for(const e of u.writes.values()){
      batch.push(db.prepare('INSERT INTO entities(id,kind,owner_id,circle_id,version,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,data=excluded.data,updated_at=excluded.updated_at,circle_id=excluded.circle_id').bind(e.id,e.kind,e.owner,e.circle??null,e.version,JSON.stringify(e),e.createdAt,e.updatedAt));
      if(e.kind==='listing'){
        const listing=e as Listing;
        batch.push(db.prepare('DELETE FROM shares WHERE entity_id=?').bind(e.id));
        if(!listing.deletedAt)for(const circle of listing.shares)batch.push(db.prepare('INSERT INTO shares(entity_id,circle_id) VALUES(?,?)').bind(e.id,circle));
      }
    }
    for(const event of u.events)batch.push(db.prepare('INSERT INTO audit_events(id,actor,operation,entity_id,owner_id,data,created_at) VALUES(?,?,?,?,?,?,?)').bind(id(),actor,operation,event.entityId,event.owner,JSON.stringify(event.data),now()));
    batch.push(db.prepare('INSERT INTO idempotency_records(actor,operation,key,hash,result,created_at) VALUES(?,?,?,?,?,?)').bind(actor,operation,key,hash,JSON.stringify(result),now()));
    batch.push(db.prepare('DELETE FROM transaction_guards WHERE id=?').bind(guard));
    try { await db.batch(batch);return result; }
    catch(e){
      const message=String(e);
      if(!/transaction_precondition|UNIQUE constraint failed: idempotency_records/.test(message))throw e;
      // Retry against fresh state; explicit listing/plan version checks still fail closed.
    }
  }
  throw new Problem(409,'busy','同時操作較多，請保留輸入並重試。');
}
