/**
 * Prospective information-latency research, not a live betting signal.
 * Evaluate quote timestamps at collector FIRST RECEIPT, NOT the bookmaker's
 * asserted last_update or a retrospectively reconstructed closing quote.
 *
 * 'Control-adjusted' denotes an observational comparison, NEVER a causal
 * estimate and NEVER evidence of executable bookmaker price or CLV.
 */
import {makeQBCandidateNews,reviewQBCandidate} from './shadow-latency.mjs';
import {createHash} from 'node:crypto';

const round=(x,n=3)=>Number.isFinite(x)?Number(x.toFixed(n)):null;
const time=s=>typeof s==='string'&&s.trim()?Date.parse(s):NaN;
const median=nums=>{
  const a=nums.filter(Number.isFinite).sort((x,y)=>x-y);
  if(!a.length)return null;
  const m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
};
const MIN_MARKET_MOVE_POINTS=0.5;
const PRE_WINDOW_MS=30*60000;
const POST_WINDOW_MS=60*60000;
const pair=(rows,targetTime,{before=false,postMinutes=60}={})=>{
  const eligible=rows.filter(x=>{
    const at=time(x.firstObservedAt);
    return Number.isFinite(at)&&(before?
      at<=targetTime&&targetTime-at<=PRE_WINDOW_MS:
      at>=targetTime&&at-targetTime<=postMinutes*60000);
  }).sort((a,b)=>time(a.firstObservedAt)-time(b.firstObservedAt));
  return eligible.length?(before?eligible.at(-1):eligible[0]):null;
};

function bookSeries(quotes,eventId,book,t0){
  const series=quotes.filter(q=>q.eventId===eventId&&q.bookmakerKey===book&&
    q.market==='h2h'&&q.period==='FULL_GAME'&&
    Number.isFinite(q.fairHomeProbability)&&
    q.fairHomeProbability>0&&q.fairHomeProbability<1
  );
  const before=pair(series,t0,{before:true});
  if(!before)return null;
  const after=pair(series,t0,{postMinutes:60});
  if(!after||after.recordId===before.recordId)return null;
  const later=series.filter(q=>{
    const t=time(q.firstObservedAt);
    return t>=t0&&t<=t0+POST_WINDOW_MS;
  }).sort((a,b)=>time(a.firstObservedAt)-time(b.firstObservedAt));
  const last=later.at(-1);
  const firstMaterialMove=later.find(q=>Math.abs(
    (q.fairHomeProbability-before.fairHomeProbability)*100
  )>=MIN_MARKET_MOVE_POINTS);
  return {
    before,after,last,
    firstMaterialMove,
    firstPostObservedMinutes:round((time(after.firstObservedAt)-t0)/60000),
    materialMoveObservedMinutes:firstMaterialMove?
      round((time(firstMaterialMove.firstObservedAt)-t0)/60000):null,
    firstHomeMovementPoints:round((after.fairHomeProbability-before.fairHomeProbability)*100),
    lastHomeMovementPoints:round((last.fairHomeProbability-before.fairHomeProbability)*100)
  };
}

export function evaluateQBLatency({
  quoteRecords=[],newsCandidates=[],reviews=[],controlGameIds=[],
  requireControl=true,minimumBooks=3,synthetic=false
}={}){
  if(!Array.isArray(quoteRecords)||quoteRecords.length>50000||
     !Array.isArray(newsCandidates)||newsCandidates.length>250||
     !Array.isArray(reviews)||reviews.length>250||
     !Array.isArray(controlGameIds)||controlGameIds.length>250||
     !Number.isInteger(minimumBooks)||minimumBooks<2||minimumBooks>20)
    throw Error('Invalid bounded shadow evaluation data');
  const reviewById=new Map(reviews.filter(r=>r?.reviewStatus==='OFFICIAL_SOURCE_REVIEWED'
      &&typeof r.recordId==='string').map(r=>[r.recordId,r]));
  const rows=[],rejected=[];
  for(const news of newsCandidates){
    const review=reviewById.get(news?.recordId);
    if(!review){rejected.push('UNREVIEWED_QB_NEWS');continue;}
    if(!['OUT','INACTIVE','STARTER_CHANGE','STARTER_CONFIRMED'].includes(news.status)){
      rejected.push('STATUS_NOT_VERIFIED_CHANGE');continue;
    }
    const firstSeen=time(news.firstObservedAt),reviewed=time(review.reviewedAt);
    const kickoff=time(news.kickoffAt);
    if(!Number.isFinite(firstSeen)||!Number.isFinite(reviewed)||
       !Number.isFinite(kickoff)||reviewed<firstSeen||reviewed>=kickoff){
      rejected.push('INVALID_EVENT_TIMING');continue;
    }
    // Deliberately delay event eligibility until human source review.
    const asOf=reviewed;
    const books=[...new Set(quoteRecords
      .filter(q=>q.eventId===news.eventId).map(q=>q.bookmakerKey))].filter(Boolean);
    const samples=[];
    for(const book of books){
      const measurement=bookSeries(quoteRecords,news.eventId,book,asOf);
      if(!measurement)continue;
      const sameHome=new Set(quoteRecords.filter(q=>q.eventId===news.eventId)
        .map(q=>q.homeTeam)).size===1;
      if(!sameHome)continue;
      const home=measurement.before.homeTeam;
      if(news.team!==home&&news.team!==measurement.before.awayTeam)continue;
      const sideSign=news.team===home?1:-1;
      const controlMoves=[];
      for(const control of controlGameIds.filter(x=>x!==news.eventId)){
        const sample=bookSeries(quoteRecords,control,book,asOf);
        if(!sample)continue;
        controlMoves.push(sample.lastHomeMovementPoints);
      }
      const controlMedian=median(controlMoves);
      if(requireControl&&controlMoves.length<2)continue;
      samples.push({
        bookKey:book,
        qbTeamFirstMovePoints:round(sideSign*measurement.firstHomeMovementPoints),
        qbTeam60mMovePoints:round(sideSign*measurement.lastHomeMovementPoints),
        latencyToMaterialMoveMinutes:measurement.materialMoveObservedMinutes,
        controlMedianAbsoluteMovementPoints:controlMedian===null?null:round(Math.abs(controlMedian)),
        controls:controlMoves.length
      });
    }
    if(samples.length<minimumBooks){
      rejected.push('INSUFFICIENT_MATCHED_BOOKS_OR_CONTROLS');continue;
    }
    const aggregate={
      qbTeamMovementFirstSeenPoints:round(median(samples.map(s=>s.qbTeamFirstMovePoints))),
      qbTeamMovementWithin60mPoints:round(median(samples.map(s=>s.qbTeam60mMovePoints))),
      firstMaterialMoveLatencyMinutes:round(median(samples.map(s=>s.latencyToMaterialMoveMinutes))),
      comparisonControlMedianAbsoluteMovementPoints:round(median(samples.map(s=>s.controlMedianAbsoluteMovementPoints)))
    };
    rows.push({
      eventRef:news.recordId,
      gameId:news.eventId,
      qbEventType:news.status,
      observedNewsAt:news.firstObservedAt,
      reviewCompletedAt:review.reviewedAt,
      effectiveStudyAsOf:new Date(asOf).toISOString(),
      bookCount:samples.length,
      comparisonControlGames:controlGameIds.length,
      matchedControlDesign:requireControl?'SAME_BOOK_SAME_WINDOW_CONTROLS':'NO_CONTROL_UNSUITABLE_FOR_CAUSAL_CLAIMS',
      aggregate,
      sourceCategory:news.sourceKind,
      historicalAvailabilityVerified:false,
      executableEntryVerified:false,
      sourceOfGroundTruth:'PROSPECTIVE_COLLECTOR_FIRST_OBSERVED',
      causalEffectEstablished:false
    });
  }
  const n=rows.length;
  return {
    schema:1,version:'betq-qb-latency-study-v1',
    synthetic,
    available:n>=1,
    nQBEventsEligible:n,newsCandidatesSubmitted:newsCandidates.length,
    rejectedEvents:rejected.length,
    rejectedReasons:[...new Set(rejected)],
    studyWindow:{
      preEventMinutes:30,afterEventMinutes:60,
      materialMoveThresholdPoints:MIN_MARKET_MOVE_POINTS,
      minimumIndependentBooks:minimumBooks,
      requiresMatchedNoNewsControls:requireControl
    },
    outcome:{
      medianFirstQBTeamMovementPoints:round(median(rows.map(r=>r.aggregate.qbTeamMovementFirstSeenPoints))),
      median60mQBTeamMovementPoints:round(median(rows.map(r=>r.aggregate.qbTeamMovementWithin60mPoints))),
      medianObservedMaterialMoveLatencyMinutes:round(median(rows.map(r=>r.aggregate.firstMaterialMoveLatencyMinutes)))
    },
    researchOnly:true,wageringAuthorized:false,
    verifiedCLV:null,realMoneyROI:null,
    realWorldExecutionVerified:false,
    timingInterpretation:'COLLECTOR_FIRST_SEEN_AFTER_HUMAN_REVIEW_NOT_PUBLICATION_TIME',
    warning:'Matched quote changes are descriptive, not causal; no price was proven bettable or profitable.',
    // Never expose private individual-book quotes in HTTP response.
    privateBookmakerQuotesIncluded:false,
    privateSourceUrlsIncluded:false,
    events:n>=10&&synthetic!==true?rows.map(r=>({
      qbEventType:r.qbEventType,bookCount:r.bookCount,
      aggregate:r.aggregate,causalEffectEstablished:false
    })):[],
    sampleSizeGate:n>=10?'DESCRIPTIVE_ONLY_NOT_CAUSAL':'TOO_FEW_EVENTS_TO_REPORT_REAL_EFFECT'
  };
}

const iso=ms=>new Date(ms).toISOString();
/**
 * Entirely fabricated NFL-style event. Never represent as a recorded 2026
 * announcement or observed sportsbook quote.
 */
export function syntheticQBStudyFixture(){
  const t0=Date.parse('2026-11-04T18:00:00Z');
  const kickoff=t0+6*3600000;
  const quotes=[];
  const teams=[
    {id:'synthetic-main-game',home:'DEMO HOME',away:'DEMO AWAY'},
    {id:'synthetic-control-1',home:'CONTROL HOME 1',away:'CONTROL AWAY 1'},
    {id:'synthetic-control-2',home:'CONTROL HOME 2',away:'CONTROL AWAY 2'}
  ];
  for(const [t,match]of teams.entries())for(let b=0;b<4;b++){
    const book='demo-book-'+b;
    for(const [step,offset]of [[0,-12],[1,5],[2,18],[3,40]]){
      const p=.55+0.004*b+(
        t===0&&step>=1?(.016+Math.min(step,2)*.005):
        t!==0&&step>=1?.0015:0
      );
      quotes.push({
        recordId:createHash('sha256').update([match.id,book,step].join(':')).digest('hex'),
        eventId:match.id,homeTeam:match.home,awayTeam:match.away,
        market:'h2h',period:'FULL_GAME',bookmakerKey:book,
        kickoffAt:iso(kickoff),
        firstObservedAt:iso(t0+offset*60000),
        sourceMarketUpdatedAt:iso(t0+offset*60000-15000),
        fairHomeProbability:Number(p.toFixed(7)),
        fairAwayProbability:Number((1-p).toFixed(7)),
        quoteProvenance:'SYNTHETIC_ONLY_NO_PROVIDER',
        realWagerFillVerified:false
      });
    }
  }
  const news=makeQBCandidateNews({
    eventId:'synthetic-main-game',team:'DEMO HOME',qbName:'FICTIONAL QB',
    status:'STARTER_CHANGE',sourceKind:'NFL_OFFICIAL',
    sourceUrl:'https://www.nfl.com/news/betq-synthetic-fixture',
    kickoffAt:iso(kickoff),sourcePublishedAt:iso(t0-60000)
  },{observedAt:t0});
  const review=reviewQBCandidate(news,{
    reviewerId:'DEMO_REVIEWER_NOT_REAL',
    reviewedAt:t0+120000,
    sourceEvidenceDigest:'a'.repeat(64)
  });
  return {quoteRecords:quotes,newsCandidates:[news],reviews:[review],
    controlGameIds:teams.slice(1).map(t=>t.id),minimumBooks:3,
    requireControl:true,synthetic:true};
}
