/** Separate model-only custody. Never market evidence or independently attested time. */
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {gameScope} from './on-demand-game.mjs';
import {officialWeeklyUrl} from './nfl-official-finality.mjs';
import {NFL_TEAMS,predictNflEvent} from './nfl-elo.mjs';
import {compareModelDelivery,describeModelDelivery} from './model-delivery.mjs';
import {challengerResearchForEvent} from './nfl-efficiency.mjs';
export const MODEL_ONLY_POLICY='BETQ_MODEL_ONLY_CAPTURE_V2';
export const GAME_CARD_ORIGIN='https://betq-ai.onrender.com';
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
export const receiptDigest=v=>createHash('sha256').update(canonical(v)).digest('hex');
const instant=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const reject=()=>{throw Error('MODEL_ONLY_CAPTURE_INVALID');};
const exactKeys=(v,keys)=>v&&isDeepStrictEqual(Object.keys(v).sort(),keys.split(' ').sort());
export function freezeModelOnlyReceipt(response,{artifact,challengerArtifact,requestStartedAt,receivedAt}={}){
 if(!instant(requestStartedAt)||!instant(receivedAt)||Date.parse(requestStartedAt)>Date.parse(receivedAt))reject();
 const r=structuredClone(response),now=Date.parse(receivedAt),{season,week}=gameScope(r?.gameId);
 if(r.schema!==1||r.available!==true||r.use!=='RESEARCH_ONLY'||r.durablyArchived!==false||r.gradeBaselineChanged!==false||
   r.injuryAdjusted!==false||r.weatherAdjusted!==false||r.verifiedStarters!==false||r.verifiedBettingEdge!==false||
   r.spreadProbability!==null||r.totalProbability!==null||
   !isDeepStrictEqual(r.market,{available:false,reason:'NO_QUOTE_REQUESTED',providerCreditsUsed:0}))reject();
 if(!exactKeys(r,'schema gameId evaluatedAt use market injuryAdjusted weatherAdjusted verifiedStarters verifiedBettingEdge durablyArchived gradeBaselineChanged spreadProbability totalProbability validUntil available reason fixture baseline challenger modelIdentity limitations')||r.reason!==null)reject();
 const f=r.fixture;
 if(typeof f?.providerGameId!=='string'||!f.providerGameId||f.providerGameId.length>100)reject();
 if(!exactKeys(f,'providerGameId home away kickoff neutralSite sourceUrl observedAt sourcePublishedAt sourceBodySha256')||
   !isDeepStrictEqual(r.modelIdentity,describeModelDelivery(artifact,now))||
   !isDeepStrictEqual(r.limitations,['Outcome-only baseline: no quarterback, injury or weather adjustment.','No current odds or spread/total probabilities.','Newly evaluated response, not an archived forecast or proven betting edge.']))reject();
 if(!instant(r.evaluatedAt)||!instant(r.validUntil)||!instant(f?.observedAt)||!instant(f?.kickoff)||
   Date.parse(r.evaluatedAt)<Date.parse(requestStartedAt)||Date.parse(r.evaluatedAt)>now||now-Date.parse(r.evaluatedAt)>60000||
   Date.parse(f.observedAt)>Date.parse(r.evaluatedAt)||Date.parse(r.validUntil)!==Math.min(Date.parse(f.observedAt)+300000,Date.parse(f.kickoff))||
   now>=Date.parse(r.validUntil)||f.sourceUrl!==officialWeeklyUrl(season,week)||f.sourcePublishedAt!==null||
   !/^[a-f0-9]{64}$/.test(f.sourceBodySha256)||typeof f.neutralSite!=='boolean'||
   r.gameId!==`${season}_${String(week).padStart(2,'0')}_${NFL_TEAMS[f.away]}_${NFL_TEAMS[f.home]}`)reject();
 if(!compareModelDelivery(artifact,r.modelIdentity,now).compatible)reject();
 const event={home_team:f.home,away_team:f.away,commence_time:f.kickoff,neutralSite:f.neutralSite};
 const baseline=predictNflEvent(event,artifact,Date.parse(r.evaluatedAt));
 const challenger=challengerResearchForEvent(event,baseline.homeWinProbability,challengerArtifact,Date.parse(r.evaluatedAt));
 if(!baseline.available||!isDeepStrictEqual(r.baseline,baseline)||!isDeepStrictEqual(r.challenger,challenger))reject();
 const body={schema:1,policy:MODEL_ONLY_POLICY,gameId:r.gameId,
  sourceUrl:GAME_CARD_ORIGIN+'/api/game-evaluation?gameId='+encodeURIComponent(r.gameId),
  requestStartedAt,receivedAt,forecastEvaluatedAt:r.evaluatedAt,kickoff:f.kickoff,
  responseSha256:receiptDigest(r),artifactSha256:r.modelIdentity.artifactCanonicalSha256,
  challengerArtifactSha256:challengerArtifact?receiptDigest(challengerArtifact):null,response:r,
  cohort:'MODEL_ONLY_UNQUALIFIED',marketEvidenceEligible:false,independentlyAttestedCaptureTime:false,
  remoteDurableArchiveConfirmed:false,qualifiedScoringEligible:false,verifiedCLV:null,verifiedROI:null,
  limitations:['Local receipt time and digest are not independent timestamp attestation.','Publication before kickoff requires separate remote commit verification.','No market quote, trade, injury adjustment or retrospective replacement of frozen forecasts.']};
 return {...body,id:receiptDigest(body)};
}
export function assertModelOnlyReceipt(record,options){
 const rebuilt=freezeModelOnlyReceipt(record?.response,{...options,requestStartedAt:record?.requestStartedAt,receivedAt:record?.receivedAt});
 if(!isDeepStrictEqual(rebuilt,record))reject();return true;
}
export function assertModelOnlyAppend(previous,next){
 if(!Array.isArray(previous)||!Array.isArray(next))reject();
 const ids=new Set();for(const r of next){if(ids.has(r.id))reject();ids.add(r.id);}
 for(const old of previous)if(!next.some(r=>isDeepStrictEqual(old,r)))throw Error('MODEL_ONLY_HISTORY_CHANGED');
 return true;
}
