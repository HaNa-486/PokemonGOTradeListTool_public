'use client';
import { ArrowLeftRight, ShieldCheck } from 'lucide-react';
import { ThemeSelect } from './theme-select';

export function SignIn({chatgpt,google,error,join,reset,prepareGoogle,disabled}:{
  chatgpt:boolean;google:boolean;error:string;join:{id:string;token:string}|null;
  reset:()=>void;prepareGoogle:()=>Promise<void>;disabled:boolean;
}){
  return <main className="login">
    <div className="login-tools"><ThemeSelect/></div>
    <div className="brand"><ArrowLeftRight size={30}/><strong>交換帳本</strong></div>
    <section className="login-card">
      <span className="eyebrow">TRADE LEDGER · 私人交換帳本</span>
      <h1>把想交換的，<br/>好好記下來。</h1>
      <p>在自己的交換圈整理「我可提供」與「我想要」，和朋友一起確認交換進度。</p>
      <div className="privacy-line"><ShieldCheck/>供需與交換紀錄僅向授權成員開放</div>
      {chatgpt&&<>
        {join?<form method="post" action="/auth/chatgpt" target="_top">
          <input type="hidden" name="id" value={join.id}/><input type="hidden" name="token" value={join.token}/>
          <button className="primary" disabled={disabled}>使用 ChatGPT 登入</button>
        </form>:<a className="button primary" href="/signin-with-chatgpt?return_to=%2F" target="_top">使用 ChatGPT 登入</a>}
        <p className="muted">每位使用者使用自己的帳號；登入選項由部署者設定。</p>
      </>}
      {google&&<a className={'button '+(chatgpt?'':'primary')} href="/auth/google" target="_top" onClick={async e=>{
        if(join){e.preventDefault();await prepareGoogle();}
      }}>使用 Google 登入</a>}
      {!chatgpt&&!google&&<div className="alert"><strong>登入尚未開放</strong><p>此環境尚未啟用登入。此時無法建立帳本或儲存資料。</p></div>}
      {error&&<p role="alert">{error}</p>}
      {(chatgpt||google||error)&&<button disabled={disabled} onClick={reset}>清除登入並重新登入</button>}
      <a href="/privacy">隱私與資料說明</a>
    </section>
    <footer>預設採自製示範物種，不含遊戲圖鑑。<br/>帳本操作會寫入目前環境；實際交換需由雙方自行完成。</footer>
  </main>;
}
