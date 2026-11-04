/** Opt-in read-only transport. No account setup, key persistence, retries or publication. */
import {assessBallDontLieSourceBytes,prepareBallDontLieCrossCheck} from './balldontlie-crosscheck.mjs';

const ENDPOINT='https://api.balldontlie.io/nfl/v1/games';
const MAX_BODY_BYTES=262144,MAX_TIMEOUT_MS=8000,MAX_CHUNKS=8192;
const base=(status,requests=0)=>({status,mode:'LIVE_READ_ONLY',readOnly:true,
  sourceIndependenceVerified:false,qualifiesForExistingCorroborationGate:false,
  officialLeagueCertification:false,publicationAuthorized:false,qualifiedOutcomes:0,
  providerRequests:requests,retries:0,filesWritten:0});

/**
 * Caller must already have authorization to use the supplied credential and
 * source. This function neither obtains that authorization nor configures keys.
 * One eligible frozen game, one fixed-endpoint request, no pagination follow-up.
 */
export async function readLiveBallDontLieFinal({enabled=false,apiKey,gameId,journal,
  nflverseCsv,nflverseObservedAt,fetchImpl=globalThis.fetch,clock=Date.now,timeoutMs=MAX_TIMEOUT_MS}={}){
  if(enabled===false)return base('DISABLED');
  if(enabled!==true||typeof fetchImpl!=='function'||typeof clock!=='function'||
    !Number.isInteger(timeoutMs)||timeoutMs<10||timeoutMs>MAX_TIMEOUT_MS)return base('INVALID_CONFIGURATION');
  if(typeof apiKey!=='string'||!apiKey)return base('CREDENTIAL_REQUIRED');
  if(!/^[\x21-\x7e]{1,512}$/.test(apiKey))return base('INVALID_CREDENTIAL_FORMAT');
  let input,game,start,endpoint;
  try{
    if(typeof gameId!=='string'||!gameId||gameId.length>200)throw Error('INVALID_GAME_ID');
    // Copy before the first await. Caller mutation cannot rewrite the frozen
    // matchup, kickoff, scores or receipts during a request.
    start=clock();
    input={journal:structuredClone(journal),nflverseCsv,nflverseObservedAt,
      evaluatedAt:new Date(start).toISOString()};
    const prepared=prepareBallDontLieCrossCheck(input);
    game=prepared.tracked.get(gameId);
    if(!game)throw Error('UNTRACKED_GAME');
    if(prepared.rows.filter(r=>r.game_id===gameId).length!==1)throw Error('AMBIGUOUS_LOCAL_GAME');
    if(!prepared.candidates.has(gameId))return base('NO_ELIGIBLE_FINAL_CANDIDATE');
    input.journal={...input.journal,
      snapshots:input.journal.snapshots.filter(s=>s.gameId===gameId),
      settlements:input.journal.settlements.filter(s=>s.gameId===gameId)};
    endpoint=new URL(ENDPOINT);endpoint.searchParams.set('per_page','100');
    endpoint.searchParams.append('seasons[]',String(game.season));
    endpoint.searchParams.append('season_types[]',prepared.rows.find(r=>r.game_id===gameId).game_type==='REG'?'2':'3');
    for(const day of [...new Set([game.gameDate,game.commenceTime.slice(0,10)])].sort())
      endpoint.searchParams.append('dates[]',day);
  }catch{return base('INVALID_LOCAL_INPUT');}

  const controller=new AbortController();let reader,timer;
  const cancel=()=>{
    controller.abort();
    try{Promise.resolve(reader?.cancel()).catch(()=>{});}catch{}
  };
  const deadlineAt=performance.now()+timeoutMs;
  const checkDeadline=()=>{
    if(controller.signal.aborted||performance.now()>=deadlineAt){cancel();throw Error('DEADLINE');}
  };
  let phase='request';
  try{
    const deadline=new Promise((resolve,reject)=>{
      timer=setTimeout(()=>{cancel();reject(Error('DEADLINE'));},timeoutMs);
    });
    const operation=(async()=>{
      const response=await fetchImpl(endpoint.href,{method:'GET',redirect:'error',
        headers:{Accept:'application/json',Authorization:apiKey},signal:controller.signal});
      checkDeadline();
      if(response?.redirected===true||(response?.url&&response.url!==endpoint.href))
        return base('UNEXPECTED_RESPONSE_ORIGIN',1);
      if(response?.status===401||response?.status===403)return base('AUTHENTICATION_OR_ENTITLEMENT_REQUIRED',1);
      if(response?.status===429)return base('RATE_LIMITED',1);
      if(response?.status!==200)return base('PROVIDER_UNAVAILABLE',1);
      phase='body';
      if(!/^application\/json(?:;|$)/i.test(response.headers?.get('content-type')??''))throw Error('JSON_REQUIRED');
      if(!response.body?.getReader)throw Error('STREAM_REQUIRED');
      const length=Number(response.headers?.get('content-length'));
      if(Number.isFinite(length)&&length>MAX_BODY_BYTES)throw Error('BODY_LIMIT');
      reader=response.body.getReader();const chunks=[];let bytes=0;
      while(true){
        const {done,value}=await reader.read();checkDeadline();if(done)break;
        if(!(value instanceof Uint8Array)||value.byteLength===0||chunks.length>=MAX_CHUNKS)throw Error('INVALID_CHUNK');
        bytes+=value.byteLength;if(bytes>MAX_BODY_BYTES)throw Error('BODY_LIMIT');
        chunks.push(Buffer.from(value));
      }
      // Preserve BOM bytes rather than silently changing the hashed source.
      // A BOM or malformed JSON then fails closed in the parser.
      const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.concat(chunks,bytes));
      const received=clock();
      if(!Number.isFinite(received)||received<start||received>start+MAX_TIMEOUT_MS+2000)
        throw Error('RECEIPT_CLOCK_INVALID');
      const observedAt=new Date(received).toISOString();
      const report=assessBallDontLieSourceBytes({...input,evaluatedAt:observedAt,
        balldontlieObservedAt:observedAt,balldontlieJson:text});
      checkDeadline();
      return {...base(report.crossCheckedGames?'CROSS_CHECKED_INDEPENDENCE_UNVERIFIED':'NO_CROSS_CHECK_MATCH',1),
        ...report,requestedGameId:gameId,observedAt,provider:'BALLDONTLIE_NFL_GAMES'};
    })();
    return await Promise.race([operation,deadline]);
  }catch{
    // Neither provider bodies/exceptions nor supplied credentials are echoed.
    return base(controller.signal.aborted?'REQUEST_TIMEOUT':phase==='body'?'INVALID_PROVIDER_RESPONSE':'REQUEST_FAILED',1);
  }finally{
    clearTimeout(timer);cancel();
    try{reader?.releaseLock();}catch{}
  }
}
