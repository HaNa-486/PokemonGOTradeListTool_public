import { createRemoteJWKSet, jwtVerify } from 'jose';
import { digest, ensure, id, now, opaque, Problem } from '../core/model';
import { chatGPTReady, chatGPTSubject, chatGPTSignInPath, chatGPTSignOutPath } from './sites-auth';
import { limitedBody } from './body';

export type Runtime = { DB: D1Database; APP_ORIGIN?: string; GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string; SITES_CHATGPT_AUTH?: string; MAINTENANCE_USER_IDS?:string };
export type AuthenticatedUser = { id: string; displayName: string; provider: 'google' | 'chatgpt' };
const keys=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
export function origin(env:Runtime){ensure(env.APP_ORIGIN&&new URL(env.APP_ORIGIN).protocol==='https:','configuration','網站登入尚未設定完成。',503);return new URL(env.APP_ORIGIN).origin;}
export function ready(env:Runtime){return !!(env.APP_ORIGIN&&env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET);}
export function cookie(req:Request,name:string){return req.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);}
function setCookie(name:string,value:string,maxAge:number){return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;}
export async function currentUser(req:Request,env:Runtime){
  const token=cookie(req,'__Host-trade_session');
  const session=token&&/^[a-f0-9]{64}$/.test(token)
    ? await env.DB.prepare('SELECT users.id,users.display_name AS displayName FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.hash=? AND sessions.expires_at>?').bind(await digest(token),Date.now()).first<{id:string;displayName:string}>()
    : null;
  const subject=chatGPTSubject(req,env);
  if(subject){
    const user=await resolveIdentity(env,'chatgpt',subject);
    // Never silently choose or merge two different signed-in accounts.
    ensure(!session||session.id===user.id,'identity_conflict','偵測到兩個不同的登入帳號，請先登出，再選擇一種方式登入。',409);
    return {...user,provider:'chatgpt'} satisfies AuthenticatedUser;
  }
  return session ? {...session,provider:'google'} satisfies AuthenticatedUser : null;
}

export async function resolveIdentity(env:Runtime,provider:'google'|'chatgpt',subject:string){
  const find=()=>env.DB.prepare('SELECT users.id,users.display_name AS displayName FROM identities JOIN users ON users.id=identities.user_id WHERE provider=? AND subject=?').bind(provider,subject).first<{id:string;displayName:string}>();
  let user=await find();
  if(!user){
    const userId=id(),displayName='訓練家 '+userId.slice(0,4);
    try{
      await env.DB.batch([
        env.DB.prepare('INSERT INTO users(id,display_name,created_at) VALUES(?,?,?)').bind(userId,displayName,now()),
        env.DB.prepare('INSERT INTO identities(provider,subject,user_id) VALUES(?,?,?)').bind(provider,subject,userId),
      ]);
      user={id:userId,displayName};
    }catch{
      // Concurrent first visits use the winner's identity. The losing batch
      // rolls back its user insert; unrelated DB failures are not swallowed.
      user=await find();if(!user)throw new Problem(503,'database','帳號建立失敗，請稍後重試。');
    }
  }
  return user;
}
export async function rateLimit(env:Runtime,key:string,max=90){
  const window=Math.floor(Date.now()/60000);
  const row=await env.DB.prepare('INSERT INTO rate_limits(key,window,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window RETURNING count').bind(key,window).first<{count:number}>();
  ensure(row&&row.count<=max,'rate_limit','操作太頻繁，請一分鐘後再試。',429);
}
export function verifyOrigin(req:Request,env:Runtime){
  ensure(req.headers.get('origin')===origin(env),'origin','請從網站內重新操作。',403);ensure(req.headers.get('sec-fetch-site')!=='cross-site','csrf','跨站操作已拒絕。',403);
}
export async function authRoute(req:Request,env:Runtime){
  const url=new URL(req.url);
  if(url.pathname==='/auth/chatgpt'&&req.method==='POST'){
    verifyOrigin(req,env);ensure(chatGPTReady(env),'configuration','此環境未啟用 ChatGPT 登入。',503);
    ensure(req.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'),'content_type','登入表單格式不正確。',415);
    // Invitation travels in a short-lived cookie, never a redirect query or log.
    const text=await limitedBody(req,400);
    const form=new URLSearchParams(text),inviteId=form.get('id'),token=form.get('token');
    ensure(inviteId&&token&&/^[a-f0-9-]{36}$/.test(inviteId)&&/^[a-f0-9]{64}$/.test(token),'invite','邀請格式無效。',400);
    return new Response(null,{status:303,headers:{Location:chatGPTSignInPath,'Set-Cookie':setCookie('__Host-trade_invitation',inviteId+'.'+token,600)}});
  }
  if(url.pathname==='/auth/invitation-context'&&req.method==='POST'){
    verifyOrigin(req,env);const text=await limitedBody(req,400);const data=JSON.parse(text) as {id:string;token:string};
    ensure(/^[a-f0-9-]{36}$/.test(data.id)&&/^[a-f0-9]{64}$/.test(data.token),'invite','邀請格式無效。',400);
    return Response.json({ok:true},{headers:{'Set-Cookie':setCookie('__Host-trade_invitation',data.id+'.'+data.token,600)}});
  }
  if(url.pathname==='/auth/logout'&&req.method==='POST'){
    verifyOrigin(req,env);const token=cookie(req,'__Host-trade_session');if(token)await env.DB.prepare('DELETE FROM sessions WHERE hash=?').bind(await digest(token)).run();
    const headers=new Headers({'Clear-Site-Data':'"cache", "storage"'});
    for(const name of ['__Host-trade_session','__Host-trade_oauth','__Host-trade_invitation'])headers.append('Set-Cookie',setCookie(name,'',0));
    return Response.json({ok:true,next:chatGPTReady(env)?chatGPTSignOutPath:'/'},{headers});
  }
  ensure(req.method==='GET','method','不支援此方法。',405);
  ensure(ready(env),'oauth_unconfigured','Google 登入尚未設定；沒有建立任何登入或儲存測試資料。',503);
  if(url.pathname==='/auth/google'){
    await rateLimit(env,'oauth:'+await digest(req.headers.get('cf-connecting-ip')??'unknown'),15);
    const state=opaque(), verifier=opaque(), nonce=opaque();
    await env.DB.prepare('DELETE FROM oauth_flows WHERE expires_at<?').bind(Date.now()).run();
    await env.DB.prepare('INSERT INTO oauth_flows(hash,verifier,nonce,expires_at) VALUES(?,?,?,?)').bind(await digest(state),verifier,nonce,Date.now()+600000).run();
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));const challenge=btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
    const dest=new URL('https://accounts.google.com/o/oauth2/v2/auth');dest.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID!,redirect_uri:origin(env)+'/auth/google/callback',response_type:'code',scope:'openid',state,nonce,code_challenge:challenge,code_challenge_method:'S256',prompt:'select_account'}).toString();
    return new Response(null,{status:302,headers:{Location:dest.href,'Set-Cookie':setCookie('__Host-trade_oauth',state,600)}});
  }
  if(url.pathname==='/auth/google/callback'){
    const state=url.searchParams.get('state');ensure(state&&/^[a-f0-9]{64}$/.test(state)&&state===cookie(req,'__Host-trade_oauth'),'oauth_state','登入驗證已失效，請重新登入。',400);
    const flow=await env.DB.prepare('DELETE FROM oauth_flows WHERE hash=? AND expires_at>? RETURNING verifier,nonce').bind(await digest(state),Date.now()).first<{verifier:string;nonce:string}>();ensure(flow,'oauth_state','登入已過期或已使用。',400);
    const code=url.searchParams.get('code');ensure(code&&!url.searchParams.has('error'),'oauth_cancelled','Google 登入未完成。',400);
    const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:env.GOOGLE_CLIENT_ID!,client_secret:env.GOOGLE_CLIENT_SECRET!,redirect_uri:origin(env)+'/auth/google/callback',grant_type:'authorization_code',code_verifier:flow.verifier}),signal:AbortSignal.timeout(15000)});
    ensure(tokenResponse.ok,'oauth_token','無法完成 Google 驗證，請重新登入。',502);
    const tokens=await tokenResponse.json() as {id_token?:string};ensure(typeof tokens.id_token==='string','oauth_token','缺少有效身分。',401);
    const {payload}=await jwtVerify(tokens.id_token,keys,{issuer:['https://accounts.google.com','accounts.google.com'],audience:env.GOOGLE_CLIENT_ID,algorithms:['RS256'],requiredClaims:['sub','exp','iat','nonce']});
    ensure(payload.nonce===flow.nonce&&typeof payload.sub==='string'&&payload.sub.length>0&&(!payload.azp||payload.azp===env.GOOGLE_CLIENT_ID),'oauth_identity','身分驗證失敗。',401);
    // Never associate identities by email. No email/profile scopes are needed.
    const user=await resolveIdentity(env,'google',payload.sub);
    const session=opaque();const old=cookie(req,'__Host-trade_session');const statements=[env.DB.prepare('INSERT INTO sessions(hash,user_id,expires_at) VALUES(?,?,?)').bind(await digest(session),user.id,Date.now()+7*86400000)];
    if(old)statements.push(env.DB.prepare('DELETE FROM sessions WHERE hash=?').bind(await digest(old)));await env.DB.batch(statements);
    const headers=new Headers({Location:origin(env)+'/','Clear-Site-Data':'"cache", "storage"'});headers.append('Set-Cookie',setCookie('__Host-trade_session',session,7*86400));headers.append('Set-Cookie',setCookie('__Host-trade_oauth','',0));return new Response(null,{status:302,headers});
  }
  throw new Problem(404,'not_found','找不到登入頁。');
}
