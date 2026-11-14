/** Pure retained research view. No model execution, provider reads or journal writes. */
import {validatePublicJournal} from './evidence-journal-feed.mjs';
import {canonicalTimestamp,validFrozenIdentity,sameFrozenIdentity,isEligibleModelSnapshot,isEligibleMarketSnapshot,isEligibleChallengerSnapshot} from './evidence-integrity.mjs';
import {latestSettlementsByRevision,unambiguousFrozenGameIds,isSourceCorroboratedSettlement} from './settlement-qualification.mjs';

export const GAME_DOSSIER_HISTORY_LIMIT=100;
const fail=(code)=>{const error=new Error(code);error.code=code;throw error;};
// All selected leaf fields are scalars; nested provenance is projected separately.
const copyFields=(record,fields)=>Object.fromEntries(fields.map(key=>[key,
  ['string','number','boolean'].includes(typeof record[key])?record[key]:null]));
const snapshotFields=['id','gameId','providerEventId','season','home','away','gameDate','commenceTime','capturedAt','sourceReceivedAt','window','hoursBeforeKickoff','modelVersion','modelBuiltAt','modelLastResultDate','modelHomeProbability','independentModel','researchOnly','marketHomeProbability','marketBookCount','marketDisagreementPoints','marketNewestQuoteAt','marketBasis','challengerHomeProbability','challengerModelVersion','challengerBuiltAt','challengerResearchOnly','verifiedInjuryAdjustment'];
const limits=()=>({verifiedEdge:false,verifiedCLV:false,verifiedROI:false,wagerRecommendation:false,verifiedInjuryAdjustment:false,verifiedQuarterbackAdjustment:false,verifiedWeatherAdjustment:false,currentModelRecomputation:false,currentMarketRefresh:false,notice:'Retained research observations only. No verified edge, CLV, ROI or wager recommendation. No verified injury, quarterback or weather adjustments.'});
const chronological=(a,b)=>Date.parse(a.capturedAt)-Date.parse(b.capturedAt)||(a.id<b.id?-1:a.id>b.id?1:0);
function checked(journal,now){
  try{
    if(!Number.isFinite(now))throw Error('Invalid clock');
    // Public-derived validation also rejects private credentials/raw bookmaker data.
    validatePublicJournal(journal);
    const identities=unambiguousFrozenGameIds(journal.snapshots);
    for(const s of journal.snapshots){
      if(!validFrozenIdentity(s)||!identities.has(s.gameId)||!s.id||s.id.length>200)throw Error('Ambiguous identity');
      if(s.providerEventId!=null&&(typeof s.providerEventId!=='string'||!s.providerEventId||s.providerEventId.length>200))throw Error('Invalid provider id');
      for(const key of ['capturedAt','sourceReceivedAt','modelBuiltAt','challengerBuiltAt','marketNewestQuoteAt']){
        if(s[key]!=null&&(!Number.isFinite(canonicalTimestamp(s[key]))||canonicalTimestamp(s[key])>now))throw Error('Future observation');
      }
    }
    const latest=latestSettlementsByRevision(journal.settlements);
    for(const r of journal.settlements){
      const shot=journal.snapshots.find(s=>s.gameId===r.gameId);
      if(!shot)throw Error('Orphan result');
      const kickoff=canonicalTimestamp(shot.commenceTime);
      if(now<=kickoff)throw Error('Result before kickoff');
      for(const key of ['season','home','away','gameDate','commenceTime'])if(r[key]!=null&&r[key]!==shot[key])throw Error('Conflicting result identity');
      for(const value of [r.verifiedAt,r.communitySourceVintage?.collectorObservedAt,r.finalityAttestation?.observedAt]){
        if(value!=null&&(!Number.isFinite(canonicalTimestamp(value))||canonicalTimestamp(value)>now||canonicalTimestamp(value)<=kickoff))throw Error('Impossible result receipt chronology');
      }
    }
    return latest;
  }catch{fail('INVALID_RETAINED_JOURNAL');}
}
function envelope(journal,now){
  return {schema:1,available:true,generatedAt:new Date(now).toISOString(),source:'BUNDLED_RETAINED_JOURNAL',
    bundledLatestCaptureAt:journal.snapshots.length?journal.snapshots.reduce((a,s)=>a>s.capturedAt?a:s.capturedAt,''):null,
    sourcePublicationTimeVerified:false,latestSnapshotAt:journal.snapshots.length?journal.snapshots.reduce((a,s)=>a>s.capturedAt?a:s.capturedAt,''):null,
    season:journal.season,researchOnly:true};
}
function grouped(journal){
  const games=new Map();
  for(const s of journal.snapshots){if(!games.has(s.gameId))games.set(s.gameId,[]);games.get(s.gameId).push(s);}
  for(const shots of games.values())shots.sort(chronological);
  return games;
}
function gameEntry(shots,latest){
  const first=shots[0];
  return {...copyFields(first,['gameId','season','home','away','gameDate','commenceTime']),
    providerEventIds:[...new Set(shots.map(s=>s.providerEventId).filter(Boolean))].sort(),
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

function listChecked(journal,{now=Date.now()}={}){
  const latest=checked(journal,now);
  const games=[...grouped(journal).values()].map(shots=>gameEntry(shots,latest))
    .sort((a,b)=>a.commenceTime.localeCompare(b.commenceTime)||a.gameId.localeCompare(b.gameId));
  return {...envelope(journal,now),total:games.length,limit:1000,truncated:games.length>1000,games:games.slice(0,1000)};
}

function buildChecked(journal,{gameId,providerEventId,now=Date.now()}={}){
  if((gameId===undefined)===(providerEventId===undefined)||
    (gameId!==undefined&&(typeof gameId!=='string'||!gameId||gameId.length>140))||
    (providerEventId!==undefined&&(typeof providerEventId!=='string'||!providerEventId||providerEventId.length>200)))fail('INVALID_SELECTOR');
  const latest=checked(journal,now),groups=grouped(journal);
  if(providerEventId!==undefined){
    const matches=[...groups.entries()].filter(([,shots])=>shots.some(s=>s.providerEventId===providerEventId));
    if(matches.length>1)fail('AMBIGUOUS_PROVIDER_EVENT_ID');
    gameId=matches[0]?.[0];
  }
  const shots=groups.get(gameId);
  if(!shots)fail('GAME_NOT_FOUND');
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
  return {...envelope(journal,now),game:gameEntry(shots,latest),firstFrozenBaseline:projection(first),
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
