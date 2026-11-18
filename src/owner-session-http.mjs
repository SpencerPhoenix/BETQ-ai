/** Explicitly injected, disabled-by-default HTTP boundary. No provider, environment or login implementation. */
export const OWNER_SESSION_PATHS=Object.freeze(['/api/owner/session','/api/owner/session-info','/api/owner/logout']);
const headers=()=>({'Cache-Control':'no-store','Pragma':'no-cache','Vary':'Cookie, Origin','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
const reply=(status,code,extra={})=>({status,body:{code,...extra},headers:headers()});
const token=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
async function body(req){
 const h=req.headers||{};
 if(typeof h['content-type']!=='string'||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(h['content-type'])||
  (h['content-encoding']!==undefined&&h['content-encoding']!=='identity'))throw Error();
 const len=h['content-length'];if(len!==undefined&&(typeof len!=='string'||!/^\d+$/.test(len)||Number(len)>4096))throw Error();
 let size=0;const chunks=[];for await(const chunk of req){const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=b.length;if(size>4096)throw Error();chunks.push(b);}
 if(len!==undefined&&Number(len)!==size)throw Error();
 const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;
}
async function bounded(work,ms){let timer;try{return await Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('TIMEOUT')),ms);})]);}finally{clearTimeout(timer);}}
function cookie(value,{logout=false}={}){
 const suffix='; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=';
 return typeof value==='string'&&(logout?value==='__Host-betq_owner='+suffix+'0':new RegExp('^__Host-betq_owner=[A-Za-z0-9_-]{43}'+suffix+'900$').test(value));
}
/** Returns {status,body,headers}. Never forward arbitrary adapter headers or errors. */
export function createOwnerSessionHttpHandler({enabled=false,origin,adapter}={}){
 let valid=false;try{const u=new URL(origin);valid=u.protocol==='https:'&&u.origin===origin&&!u.username&&!u.password;}catch{}
 return async req=>{
  if(enabled!==true)return reply(404,'NOT_FOUND');
  if(!valid||!['resolveSession','establishSession','logout'].every(k=>typeof adapter?.[k]==='function'))return reply(503,'OWNER_SESSION_UNAVAILABLE');
  if(!OWNER_SESSION_PATHS.includes(req.url))return reply(404,'NOT_FOUND');
  if(req.method!=='POST')return reply(405,'METHOD_NOT_ALLOWED');
  if(req.headers?.origin!==origin||req.headers?.['sec-fetch-site']!=='same-origin')return reply(403,'OWNER_ORIGIN_REQUIRED');
  let data;try{data=await bounded(()=>body(req),5000);}catch{return reply(400,'INVALID_OWNER_SESSION_REQUEST');}
  const keys=Object.keys(data).sort().join(',');
  try{
   if(req.url==='/api/owner/session-info'){
    if(keys!=='')return reply(400,'INVALID_OWNER_SESSION_REQUEST');
    const s=await bounded(()=>adapter.resolveSession(req),10000);
    if(s?.verified!==true||!token(s.csrfToken))return reply(401,'OWNER_SESSION_REQUIRED');
    return reply(200,'OWNER_SESSION_ACTIVE',{csrfToken:s.csrfToken});
   }
   const logout=req.url==='/api/owner/logout';
   if(logout?(keys!=='csrfToken'||!token(data.csrfToken)):
    (keys!=='proof'||typeof data.proof!=='string'||data.proof.length<1||data.proof.length>2048||/[^\x21-\x7e]/.test(data.proof)))return reply(400,'INVALID_OWNER_SESSION_REQUEST');
   const result=await bounded(()=>logout?adapter.logout(req,{csrfToken:data.csrfToken}):adapter.establishSession(req,{proof:data.proof}),12000);
   if(result?.status!==200){
    const status=[401,403,404,429,503].includes(result?.status)?result.status:503;
    return reply(status,status===429?'OWNER_AUTH_RATE_LIMITED':'OWNER_SESSION_REJECTED');
   }
   const setCookie=result.headers?.['Set-Cookie'];
   if(!cookie(setCookie,{logout})||(!logout&&(!token(result.body?.csrfToken)||!Number.isSafeInteger(result.body?.expiresAt))))return reply(503,'OWNER_SESSION_UNAVAILABLE');
   const r=reply(200,logout?'OWNER_SESSION_REVOKED':'OWNER_SESSION_ESTABLISHED',logout?{}:{csrfToken:result.body.csrfToken,expiresAt:result.body.expiresAt});
   r.headers['Set-Cookie']=setCookie;return r;
  }catch{return reply(503,'OWNER_SESSION_UNAVAILABLE');}
 };
}
