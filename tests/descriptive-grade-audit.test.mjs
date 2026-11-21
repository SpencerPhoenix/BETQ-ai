import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {auditDescriptiveGrades} from '../src/descriptive-grade-audit.mjs';
import {emptyJournal} from '../src/evidence.mjs';
import {emptyOfficialResultLedger,appendOfficialResultObservations} from '../src/official-result-ledger.mjs';
import {OFFICIAL_FINALITY_POLICY} from '../src/nfl-official-finality.mjs';
import {syntheticScoringJournal} from './fixtures/source-corroborated.mjs';

const now=Date.parse('2026-11-17T18:00:00.000Z');
function fixture(n=1,qualified=n){
 const journal={...syntheticScoringJournal(n,qualified),provenance:emptyJournal(2026).provenance};
 for(let i=0;i<n;i++){
  const id='2026_09_LV_KC'+(i?'-fixture'+i:'');
  journal.snapshots[i].gameId=journal.settlements[i].gameId=id;
  for(const key of ['terminalStatusReceipt','communitySourceVintage','finalityAttestation']){
   if(journal.settlements[i][key])journal.settlements[i][key].gameId=id;
  }
 }
 return journal;
}
const run=j=>auditDescriptiveGrades(j,{now});
test('misses use only the first frozen baseline, not a later correct pick',async()=>{
 const j=fixture();
 const s=j.snapshots[0];s.modelHomeProbability=.4;
 j.snapshots.push({...s,id:'later',capturedAt:'2026-11-07T12:00:01.000Z',modelHomeProbability:.75});
 const before=structuredClone(j),r=await run(j);
 assert.equal(r.misses.length,1);assert.equal(r.misses[0].baselineSnapshotId,s.id);
 assert.equal(r.misses[0].pick,'LV');assert.equal(r.misses[0].winner,'KC');
 assert.equal(r.misses[0].originalPickProbability,.6);assert.equal(r.misses[0].captureLeadHours,30);
 assert.equal(r.captureLeadTime.graded.medianHours,30);assert.equal(r.captureLeadTime.misses.bins['24_to_under_72h'],1);
 assert.equal(r.weeks['2026-W09'].incorrect,1);assert.equal(r.cohorts.V2_CORROBORATED.confidenceBins['60_to_under_70'].incorrect,1);
 assert.equal(r.marketEvidence.firstSnapshotEligible,1);assert.equal(r.marketEvidence.marketPerformanceReported,false);
 assert.equal(r.limitations.causalDiagnosisPerformed,false);assert.deepEqual(j,before);
});
test('past missing result and 50/50 forecasts never inflate miss counts',async()=>{
 const j=fixture();j.settlements=[];let r=await run(j);
 assert.equal(r.overall.finalMissingAfterKickoff,1);assert.equal(r.overall.incorrect,0);
 assert.equal(r.captureLeadTime.graded.medianHours,null);assert.equal(r.misses.length,0);
 const z=fixture();z.snapshots[0].modelHomeProbability=.5;r=await run(z);
 assert.equal(r.overall.noModelLean,1);assert.equal(r.cohorts.V2_CORROBORATED.confidenceBins['50_to_under_60'].noModelLean,1);
 assert.equal(r.misses.length,0);
});
test('offline saved official final stays distinct from V2, invalid supplied ledger fails closed',async()=>{
 const j=fixture(1,0),s=j.snapshots[0];
 const receipt={schema:1,policy:OFFICIAL_FINALITY_POLICY,season:2026,week:9,
  sourceUrl:'https://www.nfl.com/scores/2026/week-9',observedAt:new Date(now).toISOString(),sourceBodySha256:'a'.repeat(64),sourcePublishedAt:null,sourceUpstreamIndependenceVerified:false,sourceAuthenticityIndependentlyAttested:false,completeLeagueCoverageVerified:false,historicalAvailabilityProven:false,aggregateScoringEligible:false,
  games:[{gameId:s.gameId,providerGameId:'fixture-provider',season:2026,week:9,home:s.home,away:s.away,kickoff:s.commenceTime,gameDate:s.gameDate,neutralSite:false,
   final:true,scheduleStatus:'SCHEDULED',summaryState:'PRESENT',summaryPhase:'FINAL',summaryQuarter:'END_OF_GAME',homeScore:27,awayScore:17}]};
 const officialLedger=appendOfficialResultObservations(emptyOfficialResultLedger(),j,[receipt],{now});
 assert.equal((await run(j)).overall.finalUngraded,1);
 const r=await auditDescriptiveGrades(j,{officialLedger,now});
 assert.equal(r.cohorts.SAVED_OFFICIAL_DESCRIPTIVE.graded,1);assert.equal(r.cohorts.V2_CORROBORATED.graded,0);
 assert.equal(r.officialLedgerSupplied,true);assert.equal(r.limitations.providerRequests,0);
 await assert.rejects(auditDescriptiveGrades(j,{officialLedger:{bad:true},now}),/DURABLE_RESULT_HISTORY_UNAVAILABLE_OR_INVALID/);
});
test('CLI prints input digest and leaves directory and evidence unchanged; remote or invalid input fails closed',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'betq-descriptive-grade-'));
 try{
  const path=join(dir,'journal.json'),bytes=JSON.stringify(fixture());await writeFile(path,bytes);
  const script=new URL('../scripts/audit-descriptive-grades.mjs',import.meta.url).pathname;
  const call=(...args)=>spawnSync(process.execPath,[script,...args],{encoding:'utf8',cwd:dir});
  const success=call('--journal',path);assert.equal(success.status,0,success.stderr);
  assert.equal(JSON.parse(success.stdout).sources.journalSha256,createHash('sha256').update(bytes).digest('hex'));
  assert.equal(await readFile(path,'utf8'),bytes);
  for(const args of [['--journal','https://example.invalid/a'],['--journal',dir],['--bogus',path],['--journal',path,'--official-ledger',path]]){
   const bad=call(...args);assert.equal(bad.status,1);assert.equal(bad.stdout,'');
  }
 }finally{await rm(dir,{force:true,recursive:true});}
});


test('bundled schedule quarantine distinguishes recorded results from visible finals',async()=>{
 const journal=JSON.parse(await readFile(new URL('../data/evidence/nfl-2026.json',import.meta.url),'utf8'));
 const latest=Math.max(0,...journal.snapshots.map(s=>Date.parse(s.capturedAt)),...journal.settlements.map(s=>Date.parse(s.verifiedAt)));
 const r=await auditDescriptiveGrades(journal,{now:latest+86400000});
 assert.ok(r.overall.quarantined>0);
 assert.ok(r.overall.withheldRecordedFinal>0);
 assert.ok(r.overall.withoutVisibleFinal>=r.overall.withheldRecordedFinal);
 assert.equal(r.overall.withVisibleFinal+r.overall.withoutVisibleFinal,r.overall.tracked);
 assert.ok(r.misses.every(m=>m.gameId!=='2026_09_LV_SF'));
});

function recapture(s,id,leadMinutes,p,overrides={}){
 const at=Date.parse(s.commenceTime)-leadMinutes*60000;
 return {...s,id,capturedAt:new Date(at).toISOString(),sourceReceivedAt:new Date(at-1000).toISOString(),
  marketNewestQuoteAt:null,marketOldestQuoteAt:null,marketHomeProbability:null,marketBookCount:null,marketBasis:null,
  modelHomeProbability:p,...overrides};
}
test('timing comparison chooses latest eligible snapshot within inclusive 90–45 bounds, not a later pick',async()=>{
 const j=fixture(),s=j.snapshots[0];s.modelHomeProbability=.4;
 j.snapshots.push(recapture(s,'too-early',91,.05),recapture(s,'first-in-window',90,.6),
  recapture(s,'latest-in-window',45,.8),recapture(s,'too-late',44,.15));
 const r=await run(j),{overall,pairs}=r.pairedTiming;
 assert.equal(pairs.length,1);assert.equal(pairs[0].firstSnapshotId,s.id);assert.equal(pairs[0].lateSnapshotId,'latest-in-window');
 assert.equal(overall.firstCorrect,0);assert.equal(overall.lateCorrect,1);assert.equal(overall.sideFlips,1);
 assert.equal(overall.firstMeanBrier,.36);assert.equal(overall.lateMeanBrier,.04);
 assert.equal(r.misses[0].pick,'LV');assert.equal(r.pairedTiming.eligibleForPromotion,false);
 j.snapshots=j.snapshots.filter(s=>s.id!=='latest-in-window');
 assert.equal((await run(j)).pairedTiming.pairs[0].lateSnapshotId,'first-in-window');
});
test('ungraded, quarantined, and ineligible late snapshots never produce timing pairs',async()=>{
 const j=fixture(),s=j.snapshots[0];
 j.snapshots.push(recapture(s,'latest',60,.8,{modelLastResultDate:null}));
 let r=await run(j);assert.equal(r.pairedTiming.overall.unpaired,1);assert.equal(r.pairedTiming.overall.pairs,0);
 j.snapshots[1]=recapture(s,'wrong-kickoff',60,.8,{commenceTime:'2026-11-08T18:01:00.000Z'});
 r=await run(j);assert.equal(r.overall.quarantined,1);assert.equal(r.pairedTiming.overall.pairs,0);
 j.snapshots[1]=recapture(s,'usable',60,.8);j.settlements=[];
 r=await run(j);assert.equal(r.pairedTiming.overall.graded,0);assert.equal(r.pairedTiming.overall.pairs,0);
});

test('an original forecast inside or exactly at the late window cannot form an early-vs-window pair',async()=>{
 for(const originalLead of [90,89]){
  const j=fixture(),s=j.snapshots[0];
  j.snapshots=[recapture(s,s.id,originalLead,.6),recapture(s,'later',60,.7)];
  const r=await run(j);
  assert.equal(r.overall.graded,1);assert.equal(r.pairedTiming.overall.pairs,0);
  assert.equal(r.pairedTiming.overall.unpaired,1);
 }
});
