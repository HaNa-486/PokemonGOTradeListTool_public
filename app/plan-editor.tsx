'use client';
import { useState } from 'react';
import { available,type Circle,type Listing,type Plan } from '../core/model';
import { match,tradeStatus } from '../core/catalog';
import { title,summarize } from './presentation';
type Line={from:string;supply:string|null;request:string|null;quantity:number};
export function PlanEditor({circle,me,members,listings,initial,seed,offer,disabled,submit}:{circle:Circle;me:string;members:{id:string;displayName:string}[];listings:Listing[];initial?:Plan;seed?:Line[];offer?:{other?:string;supply?:string};disabled:boolean;submit:(payload:unknown)=>void}){
  const [other,setOther]=useState(initial?.parties.find(p=>p!==me)??offer?.other??seed?.find(l=>l.from!==me)?.from??'');
  const [lines,setLines]=useState<Line[]>(initial?.items.map(i=>({from:i.from,supply:i.supply,request:i.request,quantity:i.quantity}))??seed??(offer?[{from:me,supply:offer.supply??null,request:null,quantity:1},...(offer.other?[{from:offer.other,supply:null,request:null,quantity:1}]:[])]:[]));
  const [fast,setFast]=useState(initial?.fastConsents.includes(me)??false);
  const [problem,setProblem]=useState('');const parties=[me,other];
  const patch=(n:number,update:Partial<Line>)=>setLines(lines.map((l,i)=>i===n?{...l,...update}:l));
  const add=(from:string)=>setLines([...lines,{from,supply:null,request:null,quantity:1}]);
  const changeOther=(id:string)=>{setOther(id);const own=lines.filter(l=>l.from===me).map(l=>({...l,request:null}));setLines([...(own.length?own:[{from:me,supply:offer?.supply??null,request:null,quantity:1}]),{from:id,supply:null,request:null,quantity:own.reduce((sum,l)=>sum+l.quantity,0)||1}]);};
  const selectable=(l:Listing|undefined,from:string):l is Listing=>!!l&&l.owner===from&&l.intent==='provide'&&!l.deletedAt&&l.status==='active'&&l.shares.includes(circle.id)&&tradeStatus(l)!==false&&!Object.values(l.traits).includes('UNKNOWN')&&available(l)!>0;
  const source=(line:Line)=>listings.find(l=>l.id===line.supply&&selectable(l,line.from));
  const stale=lines.some(l=>l.supply&&!source(l));
  const person=(id:string)=>id===me?'我':members.find(m=>m.id===id)?.displayName??'對方';
  return <form onSubmit={e=>{e.preventDefault();if(stale){setProblem('部分供給已不可用，請重新選擇或移除該項。');return;}if(!other||!parties.every(p=>lines.some(l=>l.from===p))||lines.some(l=>!Number.isSafeInteger(l.quantity)||l.quantity<1)){setProblem('請選擇交換對象、雙方內容及每行的正整數數量。');return;}if(offer&&!lines.some(l=>l.from===me&&l.supply)){setProblem('請先選擇一筆自己的供給，再向對方提出交換。');return;}submit({...(initial?{id:initial.id,version:initial.version}:{}),circle:circle.id,other,fast,items:lines});}}>
    <p className="offer-explainer">對方不需要先登記需求。選擇你願意提供的寶可夢，回換內容可先留待商量；對方可修改或婉拒。未指定回換只記隻數，不新增庫存或需求。</p><p>提案不占用庫存。雙方同意同一版本後才整批預留；修改內容會撤銷舊同意。</p>
    <label>交換對象<select required disabled={!!initial} value={other} onChange={e=>changeOther(e.target.value)}><option value="">選擇圈內朋友</option>{members.filter(m=>m.id!==me&&circle.members[m.id]?.status==='active').map(m=><option key={m.id} value={m.id}>{m.displayName}</option>)}</select></label>
    {other&&parties.map(p=><section className="trade-side" key={p}><h3>{p===me?'我給對方':'對方給我'}</h3>{lines.map((line,n)=>line.from!==p?null:<fieldset key={n}><legend>{person(p)} · 第 {n+1} 項</legend><label>供給<select value={line.supply??''} onChange={e=>patch(n,{supply:e.target.value||null,request:null})}><option value="">{p===me?'選擇供給／未指定內容':'待商量回換（僅記數量）'}</option>{listings.filter(l=>selectable(l,p)).map(l=><option key={l.id} value={l.id}>{title(l)} · {summarize(l)} · 可用 {available(l)}</option>)}</select></label>{line.supply&&!source(line)&&<p role="alert">這筆供給已不可用，請重新選擇或移除此項。</p>}<label>分配給需求（選填）<select aria-label="分配給需求" disabled={!source(line)} value={line.request??''} onChange={e=>patch(n,{request:e.target.value||null})}><option value="">不綁定需求（可直接提案）</option>{listings.filter(r=>r.owner!==p&&parties.includes(r.owner)&&!!source(line)&&!!match(source(line)!,r)).map(r=><option key={r.id} value={r.id}>{title(r)} · 可安排 {available(r)??'持續收集'}</option>)}</select></label><label>計畫數量<input type="number" min={1} max={1000000} required value={line.quantity} onChange={e=>patch(n,{quantity:Number(e.target.value)})}/></label><button type="button" onClick={()=>setLines(lines.filter((_,i)=>i!==n))}>移除此項</button></fieldset>)}<button type="button" onClick={()=>add(p)}>新增{p===me?'我方':'對方'}項目</button><p>此方合計 {lines.filter(l=>l.from===p).reduce((s,l)=>s+l.quantity,0)} 隻</p></section>)}
    {circle.fast&&<label className="check"><input type="checkbox" checked={fast} onChange={e=>setFast(e.target.checked)}/>我同意此計畫使用熟人快速確認（對方也須同意）</label>}
    {problem&&<p role="alert">{problem}</p>}<button className="primary" disabled={disabled||!other||stale}>{initial?'儲存新版本並重新提案':offer?'送出主動提案':'送出雙向提案'}</button>
  </form>;
}
