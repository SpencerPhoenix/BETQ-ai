import {scheduleReviewFor} from './schedule-review.mjs';
/** Pure retained research view. No model execution, provider reads or journal writes. */
import {retainedJournalProjection} from './evidence-journal-feed.mjs';
import {sameFrozenIdentity,isEligibleModelSnapshot,isEligibleMarketSnapshot,isEligibleChallengerSnapshot} from './evidence-integrity.mjs';
import {isSourceCorroboratedSettlement} from './settlement-qualification.mjs';

export const GAME_DOSSIER_HISTORY_LIMIT=100;
const fail=(code)=>{const error=new Error(code);error.code=code;throw error;};
// All selected leaf fields are scalars; nested provenance is projected separately.
const copyFields=(record,fields)=>Object.fromEntries(fields.map(key=>[key,
  ['string','number','boolean'].includes(typeof record[key])?record[key]:null]));
const snapshotFields=['id','gameId','providerEventId','season','home','away','gameDate','commenceTime','capturedAt','sourceReceivedAt','window','hoursBeforeKickoff','modelVersion','modelBuiltAt','modelLastResultDate','modelHomeProbability','independentModel','researchOnly','marketHomeProbability','marketBookCount','marketDisagreementPoints','marketNewestQuoteAt','marketOldestQuoteAt','marketBasis','challengerHomeProbability','challengerModelVersion','challengerBuiltAt','challengerResearchOnly','verifiedInjuryAdjustment'];
const limits=()=>({verifiedEdge:false,verifiedCLV:false,verifiedROI:false,wagerRecommendation:false,verifiedInjuryAdjustment:false,verifiedQuarterbackAdjustment:false,verifiedWeatherAdjustment:false,currentModelRecomputation:false,currentMarketRefresh:false,notice:'Retained research observations only. No verified edge, CLV, ROI or wager recommendation. No verified injury, quarterback or weather adjustments.'});
const chronological=(a,b)=>Date.parse(a.capturedAt)-Date.parse(b.capturedAt)||(a.id<b.id?-1:a.id>b.id?1:0);
function checked(journal,now){
  try{return retainedJournalProjection(journal,now);}catch{fail('INVALID_RETAINED_JOURNAL');}
}
function envelope(journal,now,publication=null){
  const remote=publication?.source==='PUBLIC_JOURNAL';
  return {schema:1,available:true,generatedAt:new Date(now).toISOString(),source:remote?'PUBLIC_RETAINED_JOURNAL':'BUNDLED_RETAINED_JOURNAL',
    publication:publication?copyFields(publication,['source','status','lastAttemptAt','lastSuccessfulFetchAt','latestSnapshotAt','journalSha256','lastError']):null,
    bundledLatestCaptureAt:!remote&&journal.snapshots.length?journal.snapshots.reduce((a,s)=>a>s.capturedAt?a:s.capturedAt,''):null,
    sourcePublicationTimeVerified:false,latestSnapshotAt:journal.snapshots.length?journal.snapshots.reduce((a,s)=>a>s.capturedAt?a:s.capturedAt,''):null,
    season:journal.season,researchOnly:true};
}
function grouped(journal){
  const games=new Map();
  for(const s of journal.snapshots){if(!games.has(s.gameId))games.set(s.gameId,[]);games.get(s.gameId).push(s);}
  for(const shots of games.values())shots.sort(chronological);
  return games;
}
function gameEntry(shots,latest,now){
  const first=shots[0];
  const providerEventIds=[...new Set(shots.map(s=>s.providerEventId).filter(Boolean))].sort();
  return {scheduleReview:scheduleReviewFor({...first,providerEventIds},now),...copyFields(first,['gameId','season','home','away','gameDate','commenceTime']),
    providerEventIds,
    snapshotCount:shots.length,firstSnapshotAt:first.capturedAt,latestSnapshotAt:shots.at(-1).capturedAt,
    hasRecordedResult:latest.has(first.gameId)};
}
function projection(s){
  const eligibility={model:isEligibleModelSnapshot(s),market:isEligibleMarketSnapshot(s),challenger:isEligibleChallengerSnapshot(s)};
  const missingness=snapshotFields.filter(key=>s[key]==null);
  return {...copyFields(s,snapshotFields),eligibility,missingness,
    labels:{model:'INDEPENDENT_RESEARCH_MODEL',market:'MARKET_DERIVED_NO_VIG_CONSENSUS',challenger:'INDEPENDENT_RESEARCH_CHALLENGER'},
    qualification:{model:eligibility.model?'ELIGIBLE_RETAINED_FORECAST':'MISSING_REQUIRED_MODEL_PROVENANCE',
      market:eligibility.market?'ELIGIBLE_RETAINED_MARKET_PAIR':'MISSING_REQUIRED_MARKET_OR_MODEL_PROVENANCE',
      challenger:eligibility.challenger?'ELIGIBLE_RETAINED_CHALLENGER':'MISSING_REQUIRED_CHALLENGER_OR_MODEL_PROVENANCE'}};
}

function listChecked(journal,{now=Date.now(),publication=null}={}){
  const retained=checked(journal,now),latest=retained.latest;
  const games=[...grouped(retained.journal).values()].map(shots=>gameEntry(shots,latest,now))
    .sort((a,b)=>a.commenceTime.localeCompare(b.commenceTime)||a.gameId.localeCompare(b.gameId));
  return {...envelope(journal,now,publication),quarantine:retained.quarantine,total:games.length,limit:1000,truncated:games.length>1000,games:games.slice(0,1000)};
}

function buildChecked(journal,{gameId,providerEventId,now=Date.now(),publication=null}={}){
  if((gameId===undefined)===(providerEventId===undefined)||
    (gameId!==undefined&&(typeof gameId!=='string'||!gameId||gameId.length>140))||
    (providerEventId!==undefined&&(typeof providerEventId!=='string'||!providerEventId||providerEventId.length>200)))fail('INVALID_SELECTOR');
  const retained=checked(journal,now),latest=retained.latest,groups=grouped(journal);
  if(providerEventId!==undefined){
    const matches=[...groups.entries()].filter(([,shots])=>shots.some(s=>s.providerEventId===providerEventId));
    if(matches.length>1)fail('AMBIGUOUS_PROVIDER_EVENT_ID');
    gameId=matches[0]?.[0];
  }
  const shots=groups.get(gameId);
  if(!shots)fail('GAME_NOT_FOUND');
  const conflict=retained.quarantine.games.find(g=>g.gameId===gameId);
  if(conflict)return {...envelope(journal,now,publication),available:false,reason:'SCHEDULE_CONFLICT_QUARANTINED',
    quarantine:retained.quarantine,conflict:{...conflict,history:{order:'CAPTURE_ASC_ID_ASC',total:shots.length,
      limit:GAME_DOSSIER_HISTORY_LIMIT,truncated:shots.length>GAME_DOSSIER_HISTORY_LIMIT,
      snapshots:shots.slice(-GAME_DOSSIER_HISTORY_LIMIT).map(s=>({...copyFields(s,snapshotFields),
        scoringEligible:false,collectionEligible:false}))}}};
  const first=shots[0],record=latest.get(gameId);
  let result=null;
  if(record){
    const sourceCorroborated=isSourceCorroboratedSettlement(record,first);
    const modelQualified=isEligibleModelSnapshot(first);
    result={...copyFields(record,['gameId','season','home','away','gameDate','commenceTime','homeScore','awayScore','outcome','revision','source','verifiedAt','finalityBasis']),
      communitySourceVintage:record.communitySourceVintage?copyFields(record.communitySourceVintage,['sha256','publicationTimeVerified','collectorObservedAt']):null,
      finalityAttestation:record.finalityAttestation?copyFields(record.finalityAttestation,['status','corroborator','officialLeagueCertification','gameId','season','home','away','gameDate','commenceTime','homeScore','awayScore','eventId','sourceSha256','observedAt']):null,
      sourceCorroborated,modelQualified,scoringEligible:sourceCorroborated&&modelQualified&&record.outcome!=='TIE'&&sameFrozenIdentity(record,first),
      baselineSnapshotId:first.id,officialLeagueCertification:false,
      qualification:sourceCorroborated?'SOURCE_CORROBORATED_NOT_LEAGUE_CERTIFIED':'RETAINED_RESULT_NOT_SOURCE_CORROBORATED'};
  }
  // Preserve the original first baseline even when the bounded latest history omits it.
  return {...envelope(journal,now,publication),quarantine:retained.quarantine,game:gameEntry(shots,latest,now),firstFrozenBaseline:projection(first),
    latestSnapshot:projection(shots.at(-1)),history:{order:'CAPTURE_ASC_ID_ASC',total:shots.length,
      limit:GAME_DOSSIER_HISTORY_LIMIT,truncated:shots.length>GAME_DOSSIER_HISTORY_LIMIT,
      snapshots:shots.slice(-GAME_DOSSIER_HISTORY_LIMIT).map(projection)},result,
    limitations:limits(),comparableGames:{available:false,reason:'NO_VALIDATED_COMPARABILITY_METHOD'}};
}

function safely(fn,journal,options){
  try{return fn(journal,options);}catch(error){
    const known=['INVALID_SELECTOR','GAME_NOT_FOUND','AMBIGUOUS_PROVIDER_EVENT_ID','INVALID_RETAINED_JOURNAL'];
    return {schema:1,available:false,researchOnly:true,reason:known.includes(error?.code)?error.code:'INVALID_RETAINED_JOURNAL'};
  }
}
export function listGameDossiers(journal,options={}){return safely(listChecked,journal,options);}
export function buildGameDossier(journal,options={}){return safely(buildChecked,journal,options);}

/** Latest retained values for display only; the first scoring baseline is never changed. */
export function listRetainedForecasts(journal,options={}){
  return safely((j,{now=Date.now(),publication=null}={})=>{
    const retained=checked(j,now),latest=retained.latest;
    const games=[...grouped(retained.journal).values()].map(shots=>({
      ...gameEntry(shots,latest,now),latestSnapshot:projection(shots.at(-1))
    })).sort((a,b)=>a.commenceTime.localeCompare(b.commenceTime)||a.gameId.localeCompare(b.gameId));
    return {...envelope(j,now,publication),quarantine:retained.quarantine,kind:'RETAINED_NFL_OUTRIGHT_FORECASTS',limitations:limits(),
      total:games.length,limit:1000,truncated:games.length>1000,games:games.slice(0,1000)};
  },journal,options);
}
