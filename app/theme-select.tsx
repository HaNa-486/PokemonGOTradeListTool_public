'use client';
import {useSyncExternalStore} from 'react';

function subscribe(callback:()=>void){
  window.addEventListener('trade-theme-updated',callback);
  return ()=>window.removeEventListener('trade-theme-updated',callback);
}
const snapshot=()=>document.documentElement.dataset.themePreference??'system';
const serverSnapshot=()=>'system';

export function ThemeSelect(){
  const preference=useSyncExternalStore(subscribe,snapshot,serverSnapshot);
  return <label className="theme-select"><span className="visually-hidden">顯示模式</span><select value={preference} onChange={event=>window.dispatchEvent(new CustomEvent('trade-theme-select',{detail:event.target.value}))}>
    <option value="system">跟隨系統</option><option value="light">淺色模式</option><option value="dark">深色模式</option>
  </select></label>;
}
