import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {emptyJournal} from '../src/evidence.mjs';
import {calculateSequentialEvidence} from '../src/market-sequential.mjs';
import {summarizeSelectedCalibration,SELECTED_CALIBRATION_PROTOCOL} from '../src/selected-calibration.mjs';
import {sourceProvenance} from './fixtures/source-provenance.mjs';

const DAY=86400000,START=Date.parse('2026-09-13T17:00:00Z');
const iso=x=>new Date(x).toISOString();
function pair(i,{p=.8,market=.6,y=1,week=0,revision=1}={}){
  const gameId='synthetic-calibration-'+i,kick=START+week*7*DAY;
  const captured=kick-DAY,verifiedAt=iso(kick+2*DAY),gameDate=iso(kick).slice(0,10);
  const s={id:'snapshot-'+gameId,gameId,season:2026,
    home:'KC',away:'LV',gameDate,commenceTime:iso(kick),capturedAt:iso(captured),
    sourceReceivedAt:iso(captured-1000),marketNewestQuoteAt:iso(captured-2000),
    marketBasis:'NO_VIG_MULTI_BOOK_MEDIAN',marketBookCount:4,
    modelBuiltAt:iso(captured-DAY),modelLastResultDate:iso(captured-2*DAY).slice(0,10),
    modelVersion:'synthetic-elo-1',independentModel:true,researchOnly:true,
    modelHomeProbability:p,marketHomeProbability:market};
  const homeScore=y===0?10:24,awayScore=y===1?10:24;
  const r={gameId,gameDate,homeScore,awayScore,outcome:y===null?'TIE':y?'HOME':'AWAY',
    revision,source:'NFLVERSE_SCHEDULES',resultHash:'synthetic-'+i+'-'+revision,
    finalityBasis:'TWO_SOURCE_FINAL_STATUS_NOT_LEAGUE_CERTIFIED',
    ...sourceProvenance(verifiedAt),
    finalityAttestation:{status:'CROSS_SOURCE_FINAL',
      corroborator:'ESPN_SITE_SCOREBOARD_UNOFFICIAL',gameId,gameDate,homeScore,awayScore,
      eventId:'401123456',sourceSha256:'f'.repeat(64),observedAt:verifiedAt,
      officialLeagueCertification:false}};
  return {s,r};
}
function journal(n,options=()=>({})){
  const j=emptyJournal(2026);
  for(let i=0;i<n;i++){const {s,r}=pair(i,options(i));j.snapshots.push(s);j.settlements.push(r);}
  return j;
}
function shifted(s,minutes,p){
  const at=Date.parse(s.capturedAt)+minutes*60000;
  return {...s,id:s.id+'-later-'+minutes,capturedAt:iso(at),sourceReceivedAt:iso(at-1000),
    marketNewestQuoteAt:iso(at-2000),modelHomeProbability:p};
}

test('fixed protocol, empty report and every sub-30 cohort suppress performance',()=>{
  assert.ok(Object.isFrozen(SELECTED_CALIBRATION_PROTOCOL));
  assert.ok(Object.isFrozen(SELECTED_CALIBRATION_PROTOCOL.probabilityBoundaries));
  for(const n of [0,1,29]){
    const out=summarizeSelectedCalibration(journal(n));
    assert.equal(out.selectedSideGames,n);
    assert.equal(out.status,'INSUFFICIENT_QUALIFIED_DATA');
    for(const c of [out.overall,...out.bands]){
      assert.equal(c.metrics,null);assert.equal(c.insufficientData,true);
      assert.equal(c.weekSensitivity.available,false);
      assert.equal(c.weekSensitivity.observedRate,null);
      assert.equal(c.weekSensitivity.observedMinusPredicted,null);
    }
  }
});

test('30 games disclose descriptive counts and Wilson reference, never a confidence or profit approval',()=>{
  const out=summarizeSelectedCalibration(journal(30,i=>({y:i<24?1:0})));
  const m=out.overall.metrics;
  assert.equal(out.overall.n,30);assert.equal(m.wins,24);
  assert.equal(m.meanPredictedProbability,.8);assert.equal(m.observedWinRate,.8);
  assert.equal(m.observedMinusPredicted,0);
  assert.equal(m.sameSideMarketMeanProbability,.6);
  assert.deepEqual(m.observedRateInterval95,{method:'WILSON_BINOMIAL_REFERENCE',
    level:.95,lower:.626943,upper:.904949,pointwise:true,correlationAdjusted:false});
  assert.equal(out.overall.weekSensitivity.available,false);
  assert.equal(out.status,'DESCRIPTIVE_RESEARCH_ONLY');
  for(const key of ['calibrationEstablished','marketBeatingEdgeEstablished',
    'independentProfitabilityProven','modelPromoted','bettingAuthorized'])assert.equal(out[key],false);
  assert.equal(out.verifiedROI,null);assert.equal(out.verifiedCLV,null);
});

test('overall disclosure cannot unlock sparse bands',()=>{
  const out=summarizeSelectedCalibration(journal(58,i=>({p:i<29?.65:.85})));
  assert.ok(out.overall.metrics);
  assert.equal(out.bands[1].n,29);assert.equal(out.bands[3].n,29);
  for(const band of out.bands)assert.equal(band.metrics,null);
});

test('away-side orientation reverses outcome and market probability consistently',()=>{
  const out=summarizeSelectedCalibration(journal(30,i=>({p:.2,market:.7,y:i<6?1:0})));
  assert.equal(out.overall.metrics.wins,24);
  assert.equal(out.overall.metrics.meanPredictedProbability,.8);
  assert.equal(out.overall.metrics.sameSideMarketMeanProbability,.3);
  assert.equal(out.bands[3].n,30);
});

test('fixed bins are disjoint, exhaustive, unrounded; exactly even forecasts have no selected side',()=>{
  const ps=[.5,.500000001,.599999999,.6,.699999999,.7,.799999999,.8,.899999999,.9,.999999999];
  const j=journal(ps.length,i=>({p:ps[i]})),out=summarizeSelectedCalibration(j);
  assert.equal(out.exclusions.exactlyEvenModel,1);
  assert.equal(out.selectedSideGames,10);
  assert.deepEqual(out.bands.map(b=>b.n),[2,2,2,2,2]);
  assert.equal(out.bands.reduce((sum,b)=>sum+b.n,0),out.selectedSideGames);
});

test('mean prediction is computed from observations, not a band midpoint',()=>{
  const out=summarizeSelectedCalibration(journal(30,i=>({p:i<15?.71:.73})));
  assert.equal(out.bands[2].metrics.meanPredictedProbability,.72);
});

test('floating-point away complement at one still belongs to the final band',()=>{
  const out=summarizeSelectedCalibration(journal(30,()=>({p:1e-20})));
  assert.equal(out.selectedSideGames,30);
  assert.equal(out.bands.reduce((sum,b)=>sum+b.n,0),30);
  assert.equal(out.bands[4].n,30);assert.equal(out.bands[4].upperInclusive,true);
  assert.equal(out.calibrationEstablished,false);
});

test('later stronger/opposite forecasts or challenger fields cannot change the selected side',()=>{
  const j=journal(30,i=>({p:.6,y:i%2})),baseline=summarizeSelectedCalibration(j);
  j.snapshots.push(...j.snapshots.map(s=>({...shifted(s,30,.1),
    challengerHomeProbability:.99,challengerBuiltAt:s.modelBuiltAt,challengerResearchOnly:true})));
  j.snapshots.reverse();j.settlements.reverse();
  assert.deepEqual(summarizeSelectedCalibration(j),baseline);
  assert.equal(calculateSequentialEvidence(j).eligibleSettledNonTieGames,30);
});

test('changing outcomes changes scores, never band assignments',()=>{
  const a=summarizeSelectedCalibration(journal(40,i=>({p:i%2?.65:.85,y:1})));
  const b=summarizeSelectedCalibration(journal(40,i=>({p:i%2?.65:.85,y:0})));
  assert.deepEqual(a.bands.map(x=>x.n),b.bands.map(x=>x.n));
  assert.equal(a.overall.metrics.wins,40);assert.equal(b.overall.metrics.wins,0);
});

test('highest settlement revision wins regardless of order, including ties and lost provenance',()=>{
  const j=journal(30),original=j.settlements[0];
  const corrected=pair(0,{y:0,revision:2}).r;
  j.settlements.push(corrected);
  assert.equal(summarizeSelectedCalibration(j).overall.metrics.wins,29);
  j.settlements.reverse();assert.equal(summarizeSelectedCalibration(j).overall.metrics.wins,29);
  j.settlements[j.settlements.indexOf(corrected)]=pair(0,{y:null,revision:2}).r;
  let out=summarizeSelectedCalibration(j);
  assert.equal(out.exclusions.tie,1);assert.equal(out.overall.metrics,null);
  const latest=pair(0,{revision:3}).r;delete latest.communitySourceVintage;
  j.settlements.push(latest);
  out=summarizeSelectedCalibration(j);
  assert.equal(out.exclusions.uncorroboratedSettlement,1);assert.equal(out.exclusions.tie,0);
  assert.ok(j.settlements.includes(original));
});

test('source, chronology, non-tie and missing-result exclusions retain existing strict qualification',()=>{
  const j=journal(5);
  delete j.settlements[0].finalityAttestation;
  j.settlements[1]=pair(1,{y:null}).r;
  j.snapshots[2].marketNewestQuoteAt='2020-01-01T00:00:00.000Z';
  j.settlements.splice(3,1);
  const out=summarizeSelectedCalibration(j);
  assert.equal(out.selectedSideGames,1);
  assert.deepEqual(out.exclusions,{noEligiblePregameQuote:1,noSettlement:1,
    uncorroboratedSettlement:1,tie:1,exactlyEvenModel:0});
  j.snapshots[4].modelLastResultDate='2027-01-01';
  assert.throws(()=>summarizeSelectedCalibration(j),/Invalid journal observation/);
});

test('same-revision conflicts in scores or qualifying provenance fail closed in either order',()=>{
  for(const mixedProvenance of [true,false]){
    const j=journal(1),duplicate=structuredClone(j.settlements[0]);
    if(mixedProvenance)delete duplicate.communitySourceVintage;
    else Object.assign(duplicate,pair(0,{y:0}).r);
    j.settlements.push(duplicate);
    for(let order=0;order<2;order++){
      assert.throws(()=>summarizeSelectedCalibration(j),/Ambiguous provenance|Contradictory finalized/);
      assert.throws(()=>calculateSequentialEvidence(j),/Ambiguous provenance|Contradictory finalized/);
      j.settlements.reverse();
    }
  }
});

test('epoch ordering chooses earlier forecast despite alternate timezone spelling',()=>{
  const j=journal(30,i=>({p:.6}));
  for(const s of [...j.snapshots]){
    const later=shifted(s,5,.9);
    // Synthetic fixtures capture at 17:00Z; 13:05-04:00 is later, not earlier.
    later.capturedAt=later.capturedAt.replace('17:05:00.000Z','13:05:00.000-04:00');
    j.snapshots.push(later);
  }
  const out=summarizeSelectedCalibration(j);
  assert.equal(out.bands[1].n,30);assert.equal(out.bands[4].n,0);
  assert.equal(calculateSequentialEvidence(j).properScores.eloBrier,.16);
});

test('superseded same-revision conflicts still fail closed in every ordering',()=>{
  const permutations=xs=>xs.length<=1?[xs]:xs.flatMap((x,i)=>
    permutations(xs.filter((_,j)=>i!==j)).map(rest=>[x,...rest]));
  for(const mixedProvenance of [true,false]){
    const j=journal(1),old=j.settlements[0],conflict=pair(0,{y:mixedProvenance?1:0}).r;
    if(mixedProvenance)delete conflict.communitySourceVintage;
    for(const rows of permutations([old,conflict,pair(0,{revision:2}).r])){
      j.settlements=rows;
      assert.throws(()=>summarizeSelectedCalibration(j),/Ambiguous provenance|Contradictory finalized/);
      assert.throws(()=>calculateSequentialEvidence(j),/Ambiguous provenance|Contradictory finalized/);
    }
  }
});

test('eight-week block sensitivity preserves within-week outcome shocks and is deterministic',()=>{
  const j=journal(40,i=>({p:.8,week:Math.floor(i/5),y:i<20?1:0}));
  const before=JSON.stringify(j),out=summarizeSelectedCalibration(j);
  assert.equal(out.overall.calendarWeeks,8);
  const sensitivity=out.overall.weekSensitivity;
  assert.equal(sensitivity.available,true);
  const width=x=>x.upper-x.lower;
  assert.ok(width(sensitivity.observedRate)>width(out.overall.metrics.observedRateInterval95));
  assert.ok(sensitivity.observedMinusPredicted.lower<-.3);
  assert.ok(sensitivity.observedMinusPredicted.upper>-.3);
  assert.deepEqual(summarizeSelectedCalibration(j),out);
  assert.equal(JSON.stringify(j),before);
  assert.equal(summarizeSelectedCalibration(journal(35,i=>({week:Math.floor(i/5)})))
    .overall.weekSensitivity.available,false);
});

test('Wilson remains bounded and non-degenerate for all wins or all losses',()=>{
  for(const y of [0,1]){
    const out=summarizeSelectedCalibration(journal(30,()=>({y})));
    const interval=out.overall.metrics.observedRateInterval95;
    assert.ok(interval.lower>=0&&interval.upper<=1&&interval.upper>interval.lower);
    assert.ok(interval.lower<=y&&interval.upper>=y);
  }
});

test('pooled model versions are disclosed without choosing a winner',()=>{
  const j=journal(30);j.snapshots[0].modelVersion='synthetic-elo-2';
  assert.deepEqual(summarizeSelectedCalibration(j).overall.modelVersions,
    [{version:'synthetic-elo-1',n:29},{version:'synthetic-elo-2',n:1}]);
});

test('offline CLI matches in-memory report, refuses arguments and leaves real journal unchanged',()=>{
  const url=new URL('../data/evidence/nfl-2026.json',import.meta.url);
  const before=readFileSync(url),j=JSON.parse(before);
  const output=JSON.parse(execFileSync(process.execPath,['scripts/audit-selected-calibration.mjs'],
    {cwd:new URL('..',import.meta.url),encoding:'utf8'}));
  assert.deepEqual(output.report,summarizeSelectedCalibration(j));
  assert.match(output.sourceSha256,/^[a-f0-9]{64}$/);
  assert.equal(output.privateRawBookmakerQuotesIncluded,false);
  assert.equal(spawnSync(process.execPath,['scripts/audit-selected-calibration.mjs','--live'],
    {cwd:new URL('..',import.meta.url)}).status,1);
  assert.deepEqual(readFileSync(url),before);
});
