import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
export class SqliteD1 {
  sql:DatabaseSync;
  failAt=-1;
  constructor(path=':memory:'){
    this.sql=new DatabaseSync(path);this.sql.exec('PRAGMA foreign_keys=ON');
    for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())this.sql.exec(readFileSync('drizzle/'+f,'utf8'));
  }
  prepare(query:string){return new Statement(this,query);}
  withSession(){return this;}
  async batch(statements:Statement[]){
    this.sql.exec('BEGIN IMMEDIATE');try{const output=[];for(let n=0;n<statements.length;n++){if(n===this.failAt)throw new Error('INJECTED_SQL_FAILURE');output.push(statements[n].execute());}this.sql.exec('COMMIT');return output;}catch(e){this.sql.exec('ROLLBACK');throw e;}
  }
  db(){return this as unknown as D1Database;}
}
class Statement {
  args: (string|number|null)[]=[];
  constructor(public db:SqliteD1,public query:string){}
  bind(...args:unknown[]){const s=new Statement(this.db,this.query);s.args=args as (string|number|null)[];return s;}
  async first<T>(){return (this.db.sql.prepare(this.query).get(...this.args)??null) as T|null;}
  async all<T>(){return {results:this.db.sql.prepare(this.query).all(...this.args) as T[]};}
  execute(){if(/^SELECT\b/i.test(this.query.trim()))return {success:true,results:this.db.sql.prepare(this.query).all(...this.args),meta:{changes:0}};const info=this.db.sql.prepare(this.query).run(...this.args);return {success:true,results:[],meta:{changes:Number(info.changes)}};}
  async run(){return this.execute();}
}
