/** Disabled authentication adapter, not an identity provider or account-creation flow.
 * Stores and verified-login callback are trusted server-only dependencies. See docs/OWNER_SESSION_ADAPTER.md. */
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
const cookieName='__Host-betq_owner';
const secret=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
const digest=v=>createHash('sha256').update(v).digest('hex');
const safeTime=v=>Number.isSafeInteger(v)&&v>=0;
const same=(a,b)=>secret(a)&&secret(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const clearCookie=`${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`;
const output=(status,code,extra={})=>({status,body:{code,...extra},headers:{'Cache-Control':'no-store','Pragma':'no-cache'}});
async function bounded(work){let timer;try{return await Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('AUTH_TIMEOUT')),3000);})]);}finally{clearTimeout(timer);}}
function token(req){
 const raw=req.headers?.cookie;if(typeof raw!=='string'||raw.length>4096)return null;
 const values=raw.split(';').map(s=>s.trim()).filter(s=>s.startsWith(cookieName+'='));
 if(values.length!==1)return null;const value=values[0].slice(cookieName.length+1);return secret(value)?value:null;
}
export function createOwnerSessionAdapter({enabled=false,origin,ownerId,sessionStore,rateStore,verifyLogin=null,clock=Date.now}={}){
 let validOrigin=false;try{const u=new URL(origin);validOrigin=u.protocol==='https:'&&u.origin===origin&&!u.username&&!u.password;}catch{}
 const configured=validOrigin&&typeof ownerId==='string'&&ownerId.length>0&&ownerId.length<=128&&
  ['replaceOwner','readAndTouch','revoke'].every(k=>typeof sessionStore?.[k]==='function')&&typeof rateStore?.consume==='function';
 const absoluteMs=15*60*1000,idleMs=5*60*1000;let highWater=0;
 function now(){const value=clock();if(!safeTime(value)||value<highWater)throw Error();highWater=value;return value;}
 function sameOrigin(req){return req.headers?.origin===origin&&req.headers?.['sec-fetch-site']==='same-origin';}
 async function rate(scope,key,limit){const r=await bounded(()=>rateStore.consume({scope,key,limit,windowMs:60000}));return r?.allowed===true;}
 async function authenticate(req,{logout=false}={}){
  if(enabled!==true||!configured)return null;
  try{
   if(!sameOrigin(req))return null;
   // A fixed shared bucket cannot be multiplied by changing an untrusted forwarded IP.
   if(!await rate(logout?'owner-logout':'owner-auth','global',logout?10:30))return null;
   const raw=token(req);if(!raw)return null;
   const time=now(),sessionHash=digest(raw);
   // Atomic store MUST reject expired/revoked/future records before touching and
   // return the PRE-TOUCH record. Returning refreshed lastSeenAt is forbidden.
   const row=await bounded(()=>sessionStore.readAndTouch({sessionHash,now:time,idleMs}));
   if(!row||row.sessionHash!==sessionHash||row.userId!==ownerId||row.revoked!==false||!secret(row.csrfToken)||
    !safeTime(row.createdAt)||!safeTime(row.lastSeenAt)||!safeTime(row.expiresAt)||row.createdAt>row.lastSeenAt||
    row.lastSeenAt>time||time-row.lastSeenAt>=idleMs||time>=row.expiresAt||
    row.expiresAt<=row.createdAt||row.expiresAt-row.createdAt>absoluteMs)return null;
   if(!logout&&!await rate('owner-access',digest(ownerId),6))return null;
   return {sessionHash,verified:true,userId:ownerId,csrfToken:row.csrfToken};
  }catch{return null;}
 }
 return Object.freeze({
  /** Authentication for the existing refresh boundary. Never accepts bearer or identity headers. */
  async resolveSession(req){const s=await authenticate(req);return s?{verified:true,userId:s.userId,csrfToken:s.csrfToken}:null;},
  /** No route automatically calls this. verifyLogin must consume a genuine one-use
   * server-bound WebAuthn/OIDC challenge and return its verified subject. */
  async establishSession(req){
   if(enabled!==true)return output(404,'NOT_FOUND');
   if(!configured||typeof verifyLogin!=='function')return output(503,'OWNER_LOGIN_UNAVAILABLE');
   if(req.method!=='POST'||req.url!=='/api/owner/session'||!sameOrigin(req))return output(403,'OWNER_LOGIN_REJECTED');
   try{
    if(!await rate('owner-login','global',5))return output(429,'OWNER_LOGIN_RATE_LIMITED');
    const identity=await bounded(()=>verifyLogin(req));
    if(identity?.verified!==true||identity.subject!==ownerId||identity.challengeConsumed!==true)return output(401,'OWNER_LOGIN_REJECTED');
    const time=now(),raw=randomBytes(32).toString('base64url'),csrfToken=randomBytes(32).toString('base64url');
    const record={sessionHash:digest(raw),userId:ownerId,csrfToken,createdAt:time,lastSeenAt:time,expiresAt:time+absoluteMs,revoked:false};
    // Must atomically revoke ALL prior owner sessions before admitting the new one.
    const saved=await bounded(()=>sessionStore.replaceOwner(record));
    if(saved?.stored!==true)return output(503,'OWNER_LOGIN_UNAVAILABLE');
    const r=output(200,'OWNER_SESSION_ESTABLISHED',{csrfToken,expiresAt:record.expiresAt});
    r.headers['Set-Cookie']=`${cookieName}=${raw}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=900`;
    return r;
   }catch{return output(503,'OWNER_LOGIN_UNAVAILABLE');}
  },
  /** Parsed body must be bounded by the HTTP integration; no logout GET or bearer fallback. */
  async logout(req,{csrfToken}={}){
   if(enabled!==true)return output(404,'NOT_FOUND');
   if(req.method!=='POST'||req.url!=='/api/owner/logout'||!sameOrigin(req))return output(403,'OWNER_LOGOUT_REJECTED');
   const session=await authenticate(req,{logout:true});
   if(!session||!same(session.csrfToken,csrfToken))return output(403,'OWNER_LOGOUT_REJECTED');
   try{
    const result=await bounded(()=>sessionStore.revoke({sessionHash:session.sessionHash,userId:ownerId}));
    if(result?.revoked!==true)return output(503,'OWNER_LOGOUT_UNAVAILABLE');
    const r=output(200,'OWNER_SESSION_REVOKED');r.headers['Set-Cookie']=clearCookie;return r;
   }catch{return output(503,'OWNER_LOGOUT_UNAVAILABLE');}
  }
 });
}
