/** Private owner-only boundary. No environment, session creation, scheduler or provider client. */
import {timingSafeEqual} from 'node:crypto';
const markets=new Set(['h2h','spreads','totals']);
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const response=(status,code,extra={})=>({status,body:{code,...extra}});
const header=(req,name)=>typeof req.headers?.[name]==='string'?req.headers[name]:null;
const csrf=v=>typeof v==='string'&&/^[A-Za-z0-9._~-]{32,256}$/.test(v);
async function bounded(work,ms){let timer;try{return await Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('TIMEOUT')),ms);})]);}finally{clearTimeout(timer);}}
async function readBody(req){
  if(header(req,'content-encoding')&&!['identity'].includes(header(req,'content-encoding')))throw Error();
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(header(req,'content-type')||''))throw Error();
  const length=header(req,'content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>1024))throw Error();
  const chunks=[];let bytes=0;
  for await(const chunk of req){const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);bytes+=b.length;if(bytes>1024)throw Error();chunks.push(b);}
  if(length!==null&&Number(length)!==bytes)throw Error();
  const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
  const data=JSON.parse(text);
  if(!data||Array.isArray(data)||typeof data!=='object'||Object.keys(data).sort().join(',')!=='csrfToken,idempotencyKey,market'||!markets.has(data.market)||!uuid(data.idempotencyKey)||!csrf(data.csrfToken))throw Error();
  return data;
}
function usableStatus(status,{before=false}={}){
  const b=status?.budget,s=status?.snapshots;
  return status?.configured===true&&b?.persistent===true&&b.available===true&&b.unresolvedReservations===0&&b.baselineCurrent===true&&
    (!before||b.ready===true)&&s?.configured===true&&!s.configurationError&&!s.error&&!s.readError&&!s.writeError;
}
/** resolveSession must validate the server-side session, never trust body/header identity.
 * Returned session: {verified:true,userId:<configured owner>,csrfToken:<session-bound secret>}.
 * Request is a Node IncomingMessage-compatible async iterable. Result contains no raw prices/secrets.
 */
export function createOwnerRefreshHandler({enabled=false,origin,ownerId,resolveSession=null,store,source}={}){
  let validOrigin=false;try{const u=new URL(origin);validOrigin=u.protocol==='https:'&&u.origin===origin&&!u.username&&!u.password;}catch{}
  const configured=validOrigin&&typeof ownerId==='string'&&ownerId.length>0&&ownerId.length<=128&&typeof resolveSession==='function'&&
    ['claim','complete','failUnknown'].every(k=>typeof store?.[k]==='function')&&typeof source?.getOdds==='function'&&typeof source?.status==='function';
  let stopped=false;
  return async req=>{
    if(enabled!==true)return response(404,'NOT_FOUND');
    if(!configured)return response(503,'OWNER_REFRESH_UNAVAILABLE');
    if(req.method!=='POST')return response(405,'METHOD_NOT_ALLOWED');
    if(req.url!=='/api/owner/refresh')return response(404,'NOT_FOUND');
    if(header(req,'origin')!==origin||header(req,'sec-fetch-site')!=='same-origin')return response(403,'OWNER_ORIGIN_REQUIRED');
    let session;
    try{session=await bounded(()=>resolveSession(req),5000);}catch{return response(401,'OWNER_SESSION_REQUIRED');}
    if(session?.verified!==true||session.userId!==ownerId||!csrf(session.csrfToken))return response(401,'OWNER_SESSION_REQUIRED');
    let data;
    try{data=await bounded(()=>readBody(req),5000);}catch{return response(400,'INVALID_OWNER_REFRESH');}
    const a=Buffer.from(session.csrfToken),b=Buffer.from(data.csrfToken);
    if(a.length!==b.length||!timingSafeEqual(a,b))return response(403,'OWNER_CSRF_REQUIRED');
    if(stopped)return response(409,'OWNER_REFRESH_STOPPED');
    try{if(!usableStatus(await bounded(()=>source.status(),7000),{before:true}))return response(503,'OWNER_REFRESH_NOT_READY');}
    catch{return response(503,'OWNER_REFRESH_NOT_READY');}
    if(stopped)return response(409,'OWNER_REFRESH_STOPPED');
    const operation={operationId:data.idempotencyKey.toLowerCase(),market:data.market};
    let claim;
    try{claim=await bounded(()=>store.claim(operation),7000);}
    catch{return response(409,'OWNER_REFRESH_NOT_CLAIMED');}
    try{
      if(claim?.operationId!==operation.operationId||claim.market!==operation.market||claim.reservedCredits!==1)throw Error();
      const result=await bounded(()=>source.getOdds('americanfootball_nfl',data.market,{allowPaid:true}),25000);
      const cached=result?.cacheHit===true;
      if(!result||!Array.isArray(result.events)||typeof result.receivedAt!=='string'||!Number.isFinite(Date.parse(result.receivedAt)))throw Error();
      let actualChargedCredits=0;
      if(!cached){
        if(result.cacheHit!==false||!['remaining','used','last'].every(k=>integer(result.quota?.[k]))||
          result.refreshReceipt?.reconciled!==true||result.refreshReceipt.snapshotStored!==true||!uuid(result.refreshReceipt.reservationId))throw Error();
        actualChargedCredits=result.quota.last;
      }
      if(!usableStatus(await bounded(()=>source.status(),7000)))throw Error();
      // Even an unexpected charge is retained before stopping; never refund from a guess.
      const completion=await bounded(()=>store.complete({...operation,chargedCredits:actualChargedCredits}),7000);
      if(completion?.completed!==true||!integer(completion.chargedCredits)||completion.chargedCredits<Math.max(1,actualChargedCredits))throw Error();
      if(actualChargedCredits>1)throw Error();
      return response(200,'OWNER_REFRESH_COMPLETE',{market:data.market,operationId:operation.operationId,
        cacheHit:cached,actualChargedCredits,reservedCredits:1,receivedAt:result.receivedAt,eventCount:result.events.length});
    }catch{
      stopped=true;
      try{await bounded(()=>store.failUnknown(operation),7000);}catch{}
      return response(503,'OWNER_REFRESH_STOPPED',{operationId:operation.operationId,retryAllowed:false});
    }
  };
}
