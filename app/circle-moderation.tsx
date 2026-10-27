'use client';
import {useEffect,useRef,useState} from 'react';
import type {Circle,Listing} from '../core/model';
import {title,summarize} from './presentation';
type Removed=Pick<Listing,'id'|'version'|'owner'|'intent'|'species'|'family'|'traits'|'variantLabels'>&{event:string};
export function CircleModeration({circle,members,read,mutate}:{circle:Circle;members:{id:string;displayName:string}[];read:<T>(url:string)=>Promise<T>;mutate:(op:string,data:unknown)=>Promise<unknown>}){
  const [mode,setMode]=useState<'shared'|'removed'>('shared'),[rows,setRows]=useState<(Listing|Removed)[]>([]),[next,setNext]=useState<string|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const generation=useRef(0);
  const url=(kind:typeof mode,after='')=>`${kind==='shared'?'/api/listings?visibility=all&trash=false':'/api/moderation?'}&circle=${encodeURIComponent(circle.id)}&after=${encodeURIComponent(after)}`;
  async function load(kind:typeof mode,more=false){const gen=++generation.current;setBusy(true);setError('');try{const p=await read<{items:(Listing|Removed)[];next:string|null}>(url(kind,more?next??'':''));if(gen!==generation.current)return;setRows(old=>more?[...old,...p.items]:p.items);setNext(p.next);setMode(kind);}catch(e){if(gen===generation.current){setRows([]);setNext(null);setError((e as Error).message);}}finally{if(gen===generation.current)setBusy(false);}}
  useEffect(()=>{const gen=++generation.current;read<{items:Listing[];next:string|null}>(url('shared')).then(p=>{if(gen===generation.current){setRows(p.items);setNext(p.next);}}).catch(e=>{if(gen===generation.current)setError(e.message);}).finally(()=>{if(gen===generation.current)setBusy(false);});return()=>{generation.current++;};
    // Parent keys this component by authenticated user and circle; reads reject stale account generations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  async function change(row:Listing|Removed){
    if(mode==='shared'&&!confirm(`從「${circle.name}」撤下這筆${row.intent==='provide'?'提供':'需求'}？全圈成員都將看不到，其他圈與持有量不變。只想自己不看，請使用圈友清單的「對我隱藏」。`))return;
    const gen=generation.current;setBusy(true);setError('');try{await mutate(mode==='shared'?'listing.hide':'listing.unhide',{id:row.id,version:row.version,circle:circle.id,...('event' in row?{event:row.event}:{})});if(gen!==generation.current)return;setNotice(mode==='shared'?'已從全圈撤下，可在「可復原的撤下項目」撤銷。':'已恢復本圈分享。');await load(mode);}catch(e){if(gen===generation.current){setError((e as Error).message);setBusy(false);}}
  }
  return <section className="card moderation"><h2>管理員 · 本圈分享管理</h2><p>這裡的撤下與復原會影響全圈成員。個人不想看到的項目，請到圈友清單使用「對我隱藏」。</p><div className="actions"><button aria-pressed={mode==='shared'} disabled={busy} onClick={()=>load('shared')}>目前分享</button><button aria-pressed={mode==='removed'} disabled={busy} onClick={()=>load('removed')}>可復原的撤下項目</button><button disabled={busy} onClick={()=>load(mode)}>重新載入管理清單</button></div>{mode==='removed'&&<p className="muted">包含舊版「隱藏此圈分享」的紀錄。只列出撤下後未變更且擁有者仍在圈內的項目；若已修改、刪除或離圈，請由擁有者重新分享。</p>}{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}{busy&&<p role="status">正在載入或儲存…</p>}{!busy&&rows.length===0&&<p>{mode==='removed'?'目前沒有可安全復原的撤下項目。':'目前沒有分享項目。'}</p>}<div className="cards">{rows.map(l=><article className="card" key={l.id} data-moderation-id={l.id}><span className={'badge '+l.intent}>{l.intent==='provide'?'提供':'想要'}</span><h3>{title(l as Listing)}</h3><p>{members.find(m=>m.id===l.owner)?.displayName??'圈友'} · {summarize(l as Listing)}</p><button disabled={busy} onClick={()=>change(l)}>{mode==='shared'?'從本圈撤下（全圈）':'復原本圈分享'}</button></article>)}</div>{next&&<button disabled={busy} onClick={()=>load(mode,true)}>載入更多管理項目</button>}</section>;
}
