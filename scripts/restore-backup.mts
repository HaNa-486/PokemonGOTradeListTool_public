// Offline disaster-recovery rehearsal only. Never accepts a remote database.
import {readFileSync,readdirSync,existsSync,writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {backupTables,validateBackup} from '../core/backup';
const [input,output,confirmation]=process.argv.slice(2);
if(!input||input==='--help'){console.log('Usage: node --import tsx scripts/restore-backup.mts backup.json [new.sqlite --confirm-new-empty-database]');process.exit(input?0:1);}
const b=validateBackup(JSON.parse(readFileSync(input,'utf8')));
console.log(JSON.stringify({valid:true,schema:b.schema_version,counts:Object.fromEntries(Object.entries(b.tables).map(([k,v])=>[k,v.length])),dataset:b.tables.dataset_bindings[0].dataset_id,scope:'New isolated local database only; matching dataset required; existing or production databases are never overwritten'}));
if(output){
  if(confirmation!=='--confirm-new-empty-database'||existsSync(output))throw new Error('Explicit confirmation and a new non-existing local database path are required.');
  // Exclusive creation prevents replacing an existing file between the checks.
  writeFileSync(output,'',{flag:'wx'});const db=new DatabaseSync(output);db.exec('PRAGMA foreign_keys=ON');
  try{db.exec('BEGIN IMMEDIATE');for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+file,'utf8'));
    for(const [table,columns] of Object.entries(backupTables))for(const row of b.tables[table as keyof typeof backupTables])db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(c=>row[c] as string|number|null));
    const checks=db.prepare('PRAGMA foreign_key_check').all();if(checks.length)throw new Error('Foreign key check failed');db.exec('COMMIT');console.log('Restored to new isolated local database. Sessions and invitations are intentionally invalidated.');
  }catch(error){db.exec('ROLLBACK');throw error;}finally{db.close();}
}
