import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {emptyJournal} from '../src/evidence.mjs';
import {listGameDossiers,buildGameDossier} from '../src/game-dossier.mjs';
import {syntheticScoringJournal} from './fixtures/source-corroborated.mjs';
const now=Date.parse('2026-11-16T12:00:00.000Z');
function fixture(){const j=syntheticScoringJournal(1);j.provenance=emptyJournal(2026).provenance;j.snapshots[0].providerEventId='provider-one';return j;}
const detail=j=>buildGameDossier(j,{gameId:j.snapshots[0].gameId,now});
test('bundled index works without odds cache and declares actual retained vintage',()=>{
 const j=JSON.parse(readFileSync(new URL('../data/evidence/nfl-2026.json',import.meta.url)));
 const index=listGameDossiers(j,{now});assert.equal(index.available,true);assert.ok(index.games.length>0);
 assert.equal(index.generatedAt,new Date(now).toISOString());assert.notEqual(index.generatedAt,index.bundledLatestCaptureAt);
 assert.equal(index.latestSnapshotAt,index.bundledLatestCaptureAt);
 const d=buildGameDossier(j,{providerEventId:index.games[0].providerEventIds[0],now});assert.equal(d.available,true);
 assert.equal(d.game.gameId,index.games[0].gameId);assert.equal(d.comparableGames.available,false);
 assert.equal(d.limitations.verifiedEdge,false);assert.equal(d.limitations.wagerRecommendation,false);
});
test('projection is immutable, raw retained and qualified by existing gates',()=>{
 const j=fixture(),before=JSON.stringify(j),d=detail(j);
 assert.equal(d.firstFrozenBaseline.modelHomeProbability,j.snapshots[0].modelHomeProbability);
 assert.deepEqual(d.firstFrozenBaseline.eligibility,{model:true,market:true,challenger:true});
 assert.equal(d.firstFrozenBaseline.modelVersion,null);assert.ok(d.firstFrozenBaseline.missingness.includes('modelVersion'));
 assert.equal(d.result.sourceCorroborated,true);assert.equal(d.result.modelQualified,true);assert.equal(d.result.scoringEligible,true);
 d.result.finalityAttestation.homeScore=99;d.history.snapshots[0].modelHomeProbability=.9;
 assert.equal(JSON.stringify(j),before);
});
test('baseline stays earliest original even if later snapshot is eligible',()=>{
 const j=fixture(),first=j.snapshots[0];delete first.modelLastResultDate;
 j.snapshots.unshift({...first,id:'later',capturedAt:'2026-11-07T12:01:00.000Z',modelLastResultDate:'2026-11-06'});
 const d=detail(j);assert.equal(d.firstFrozenBaseline.id,first.id);assert.equal(d.firstFrozenBaseline.eligibility.model,false);
 assert.equal(d.latestSnapshot.eligibility.model,true);assert.equal(d.result.sourceCorroborated,true);
 assert.equal(d.result.modelQualified,false);assert.equal(d.result.scoringEligible,false);
});
test('latest correction is selected before qualification, no older result cherry-pick',()=>{
 const j=fixture();j.settlements.unshift({...j.settlements[0],revision:2,finalityAttestation:null});
 const d=detail(j);assert.equal(d.result.revision,2);assert.equal(d.result.sourceCorroborated,false);assert.equal(d.result.scoringEligible,false);
});
test('missing result remains null and absent challenger remains explicitly unavailable',()=>{
 const j=fixture();j.settlements=[];delete j.snapshots[0].challengerHomeProbability;
 const d=detail(j);assert.equal(d.result,null);assert.equal(d.game.hasRecordedResult,false);
 assert.equal(d.firstFrozenBaseline.challengerHomeProbability,null);assert.equal(d.firstFrozenBaseline.eligibility.challenger,false);
});
test('detail selectors reject both, neither, empty, and unknown',()=>{
 const j=fixture();for(const options of [{},{gameId:''},{gameId:j.snapshots[0].gameId,providerEventId:'provider-one'}])assert.equal(buildGameDossier(j,{...options,now}).reason,'INVALID_SELECTOR');
 assert.equal(buildGameDossier(j,{gameId:'unknown',now}).reason,'GAME_NOT_FOUND');
});
test('provider id shared by two games is ambiguous',()=>{
 const j=fixture();j.snapshots.push({...j.snapshots[0],id:'other',gameId:'other-game'});
 assert.equal(buildGameDossier(j,{providerEventId:'provider-one',now}).reason,'AMBIGUOUS_PROVIDER_EVENT_ID');
});
for(const [label,mutate] of Object.entries({
 'duplicate snapshot':j=>j.snapshots.push({...j.snapshots[0]}),
 'conflicting identity':j=>j.snapshots.push({...j.snapshots[0],id:'conflicting',home:'BUF'}),
 'invalid chronology':j=>{j.snapshots[0].modelBuiltAt='2026-11-08T18:01:00.000Z';},
 'future source receipt':j=>{j.settlements[0].communitySourceVintage.collectorObservedAt='2026-11-17T12:00:00.000Z';},
 'future snapshot':j=>{j.snapshots[0].capturedAt='2026-11-17T12:00:00.000Z';},
 'invalid result':j=>{j.settlements[0].outcome='AWAY';},
 'contradictory revision':j=>j.settlements.push({...j.settlements[0],finalityAttestation:null}),
 'private data':j=>{j.apiKey='never-return';},
 'invalid frozen identity':j=>{delete j.snapshots[0].home;},
 'invalid provider id':j=>{j.snapshots[0].providerEventId={nested:'bad'};}
}))test('fail closed: '+label,()=>{
 const j=fixture();mutate(j);assert.equal(detail(j).reason,'INVALID_RETAINED_JOURNAL');assert.equal(listGameDossiers(j,{now}).available,false);
});
test('future timestamps are rejected even inside existing chronology tolerance',()=>{
 const j=fixture();j.settlements=[];const n=Date.parse(j.snapshots[0].capturedAt);j.snapshots[0].sourceReceivedAt=new Date(n+1000).toISOString();
 assert.equal(listGameDossiers(j,{now:n}).reason,'INVALID_RETAINED_JOURNAL');
});
test('bounded history is sorted deterministically and keeps original baseline separately',()=>{
 const j=fixture();j.settlements=[];const first=j.snapshots[0];
 j.snapshots=Array.from({length:105},(_,i)=>({...first,id:'snapshot-'+String(i).padStart(3,'0')})).reverse();
 const d=detail(j);assert.equal(d.history.snapshots.length,100);assert.equal(d.history.total,105);assert.equal(d.history.truncated,true);
 assert.equal(d.firstFrozenBaseline.id,'snapshot-000');assert.equal(d.history.snapshots[0].id,'snapshot-005');assert.equal(d.latestSnapshot.id,'snapshot-104');
});
test('unknown top-level and nested fields never leak through allowlisted projections',()=>{
 const j=fixture();j.snapshots[0].privateMemo='do-not-leak';j.settlements[0].privateMemo='do-not-leak';
 j.settlements[0].communitySourceVintage.privateMemo='do-not-leak';j.settlements[0].finalityAttestation.privateMemo='do-not-leak';
 const d=detail(j);assert.equal(d.available,true);assert.equal(JSON.stringify(d).includes('do-not-leak'),false);
});
test('source-corroborated ties remain visible but are excluded from scoring',()=>{
 const j=fixture(),r=j.settlements[0];r.awayScore=r.homeScore;r.outcome='TIE';r.finalityAttestation.awayScore=r.homeScore;
 const d=detail(j);assert.equal(d.available,true);assert.equal(d.result.outcome,'TIE');
 assert.equal(d.result.sourceCorroborated,true);assert.equal(d.result.modelQualified,true);assert.equal(d.result.scoringEligible,false);
});
test('legacy result without receipt cannot display before or at kickoff',()=>{
 const j=fixture();delete j.settlements[0].verifiedAt;delete j.settlements[0].communitySourceVintage;delete j.settlements[0].finalityAttestation;
 const kickoff=Date.parse(j.snapshots[0].commenceTime);
 for(const clock of [kickoff-1000,kickoff]){
  assert.equal(listGameDossiers(j,{now:clock}).reason,'INVALID_RETAINED_JOURNAL');
  assert.equal(buildGameDossier(j,{gameId:j.snapshots[0].gameId,now:clock}).reason,'INVALID_RETAINED_JOURNAL');
 }
 const d=detail(j);assert.equal(d.available,true);assert.equal(d.result.sourceCorroborated,false);assert.equal(d.result.verifiedAt,null);
});
test('known pre-kickoff result receipts remain impossible even when read later',()=>{
 for(const mutate of [
  r=>{r.verifiedAt='2026-11-08T17:59:59.000Z';},
  r=>{r.communitySourceVintage.collectorObservedAt='2026-11-08T18:00:00.000Z';},
  r=>{r.finalityAttestation.observedAt='2026-11-08T17:59:59.000Z';}
 ]){const j=fixture();mutate(j.settlements[0]);assert.equal(detail(j).reason,'INVALID_RETAINED_JOURNAL');}
});
