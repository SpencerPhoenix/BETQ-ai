import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {assessBdlOutcomeCandidate,BDL_CANDIDATE_POLICY} from '../src/bdl-outcome-candidate.mjs';
import {isSourceCorroboratedSettlement,OUTCOME_SCORING_POLICY} from '../src/settlement-qualification.mjs';
import {updateJournal,summarizeEvidence} from '../src/evidence.mjs';
import {syntheticBdlOutcomeInput,mutateSyntheticBdl,mutateSyntheticSchedule} from './fixtures/bdl-outcome-candidate.mjs';
const bytes=x=>new TextEncoder().encode(x);
const sha=x=>createHash('sha256').update(x).digest('hex');
const run=change=>{const input=syntheticBdlOutcomeInput();change?.(input);return assessBdlOutcomeCandidate(input);};
const blocked=out=>{assert.equal(out.status,'REJECTED');assert.equal(out.candidate,null);assert.equal(out.activationStatus,'DISABLED');assert.equal(out.qualifiedOutcomes,0);};

test('Matched fabricated records produce only a separate disabled policy candidate',()=>{
  const input=syntheticBdlOutcomeInput(),before=structuredClone(input),out=assessBdlOutcomeCandidate(input);
  assert.equal(out.status,'MATCHED_NONQUALIFYING_CANDIDATE');assert.equal(out.policyId,BDL_CANDIDATE_POLICY);
  assert.notEqual(out.policyId,OUTCOME_SCORING_POLICY);assert.equal(out.activationStatus,'DISABLED');assert.equal(out.qualifiedOutcomes,0);
  for(const key of ['qualifiesForCurrentScoring','sourceIndependenceVerified','officialLeagueCertification',
    'historicalAsOfVerified','sourceFreshnessVerified','providerPublicationTimeVerified','archiveVerified'])assert.equal(out[key],false);
  assert.deepEqual(input,before);
});
test('Each source keeps native observation identity without inventing nflverse finality or kickoff',()=>{
  const input=syntheticBdlOutcomeInput(),{candidate}=assessBdlOutcomeCandidate(input),bdl=candidate.nativeFinalObservation,nfl=candidate.communityScoreObservation;
  assert.equal(bdl.source,'BALLDONTLIE_NFL_GAMES');assert.equal(bdl.providerGameId,9999001);
  assert.equal(bdl.providerHomeTeamId,99901);assert.equal(bdl.providerAwayTeamId,99902);
  assert.equal(bdl.statusState,'final');assert.equal(bdl.providerScheduledKickoff,input.journal.snapshots[0].commenceTime);
  assert.equal(nfl.source,'NFLVERSE_SCHEDULES');assert.equal(nfl.explicitFinalStatusObserved,false);assert.equal(nfl.exactKickoffObserved,false);
  assert.equal(nfl.commenceTime,undefined);assert.equal(nfl.statusState,undefined);
  assert.equal(bdl.bodySha256,sha(input.bdlBytes));assert.equal(nfl.bodySha256,sha(input.nflverseBytes));
});
test('Provider record-written time remains separate from retrieval and cannot imply freshness or historical-as-of',()=>{
  const out=run(),bdl=out.candidate.nativeFinalObservation;
  assert.equal(bdl.providerRecordUpdatedAt,'2026-11-08T22:00:00.000Z');assert.equal(bdl.collectorRetrievedAt,'2026-11-09T18:01:00.000Z');
  assert.equal(bdl.providerStatusChangedAt,null);assert.equal(bdl.sourceFreshnessVerified,false);
  assert.equal(out.historicalAsOfVerified,false);
});
test('Candidate cannot enter existing writer/scoring even if a caller adds a revision and verification time',()=>{
  const input=syntheticBdlOutcomeInput(),out=assessBdlOutcomeCandidate(input),record={...out.candidate,revision:1,verifiedAt:input.evaluatedAt};
  assert.equal(isSourceCorroboratedSettlement(record,input.journal.snapshots[0]),false);
  assert.throws(()=>updateJournal(input.journal,[],[record],Date.parse(input.evaluatedAt)),/identity or finality/);
  const injected={...input.journal,settlements:[record]},summary=summarizeEvidence(injected,Date.parse(input.evaluatedAt));
  assert.equal(summary.sourceCorroboratedSettledGames,0);assert.equal(summary.forwardMetrics,null);
});
test('Caller flags cannot activate or qualify the candidate',()=>{
  const out=run(input=>Object.assign(input,{enabled:true,activate:true,qualifiesForCurrentScoring:true,sourceIndependenceVerified:true}));
  assert.equal(out.activationStatus,'DISABLED');assert.equal(out.qualifiesForCurrentScoring,false);assert.equal(out.sourceIndependenceVerified,false);
});
for(const [name,mutate] of Object.entries({
  wrongGame:e=>e.id++,stringGame:e=>e.id='9999001',unsafeGame:e=>e.id=Number.MAX_SAFE_INTEGER+1,
  missingNativeID:e=>delete e.id,wrongHome:e=>e.home_team.abbreviation='BUF',wrongAway:e=>e.visitor_team.abbreviation='BAL',
  sameTeamID:e=>e.visitor_team.id=e.home_team.id,missingTeamID:e=>delete e.home_team.id,
  stringTeamID:e=>e.home_team.id='99901',wrongSeason:e=>e.season=2025,stringSeason:e=>e.season='2026',
  wrongKickoff:e=>e.date='2026-11-08T19:00:00.000Z',missingKickoff:e=>delete e.date,
  wrongPhase:e=>e.postseason=true,unknownPhase:e=>delete e.postseason,
  nonFinal:e=>e.status_state='in_progress',missingFinal:e=>delete e.status_state,
  contradictoryStatus:e=>e.status='Halftime',missingStatus:e=>delete e.status,
  wrongScore:e=>e.home_team_score=28,stringScore:e=>e.home_team_score='27',missingScore:e=>delete e.visitor_team_score,
  hugeScore:e=>e.home_team_score=101,negativeScore:e=>e.home_team_score=-1,
  missingRecordTime:e=>delete e.updated_at,futureRecordTime:e=>e.updated_at='2026-11-09T18:01:00.001Z',
  preKickoffRecord:e=>e.updated_at='2026-11-08T17:59:59.999Z',noncanonicalTime:e=>e.updated_at='2026-11-08T22:00:00Z'
}))test('Reject native source contradiction: '+name,()=>blocked(run(input=>mutateSyntheticBdl(input,mutate))));
for(const status of ['scheduled','postponed','canceled','delayed','suspended','abandoned','unknown'])
  test('Reject nonterminal lifecycle '+status,()=>blocked(run(input=>mutateSyntheticBdl(input,e=>e.status_state=status))));
for(const [name,change] of Object.entries({wrongTeam:s=>s.replace(',KC,LV,',',BUF,LV,'),wrongDate:s=>s.replace('2026-11-08','2026-11-09'),
  wrongSeason:s=>s.replace(',2026,REG,',',2025,REG,'),preseason:s=>s.replace(',REG,',',PRE,'),wrongScore:s=>s.replace(',27,17,',',27,18,'),
  emptyScore:s=>s.replace(',27,17,',',,17,'),duplicates:s=>s+s.split('\n')[1]+'\n',wrongID:s=>s.replace('2026_10_LV_KC','2026_11_LV_KC'),
  malformedCsv:s=>s.replace('Home','Ho"me"')}))test('Reject community source mismatch: '+name,()=>blocked(run(input=>mutateSyntheticSchedule(input,change))));
test('Both receipts must meet exact24-hour floor and one-hour review window',()=>{
  const input=syntheticBdlOutcomeInput();input.bdlRetrievedAt=input.nflverseRetrievedAt=input.evaluatedAt='2026-11-09T18:00:00.000Z';
  assert.equal(assessBdlOutcomeCandidate(input).status,'MATCHED_NONQUALIFYING_CANDIDATE');
  for(const field of ['bdlRetrievedAt','nflverseRetrievedAt']){
    const early={...input,[field]:'2026-11-09T17:59:59.999Z'};blocked(assessBdlOutcomeCandidate(early));
    const old={...input,evaluatedAt:'2026-11-09T19:00:00.001Z'};blocked(assessBdlOutcomeCandidate(old));
    const future={...input,[field]:'2026-11-09T18:00:00.001Z'};blocked(assessBdlOutcomeCandidate(future));
  }
  assert.equal(assessBdlOutcomeCandidate({...input,evaluatedAt:'2026-11-09T19:00:00.000Z'}).status,'MATCHED_NONQUALIFYING_CANDIDATE');
});
test('Frozen identity conflicts, missing targets and impossible season identity reject',()=>{
  blocked(run(input=>input.journal.snapshots.push({...input.journal.snapshots[0],id:'other',home:'BUF'})));
  blocked(run(input=>input.gameId='2026_11_LV_KC'));
  blocked(run(input=>{input.journal.season=2025;input.journal.snapshots[0].season=2025;}));
  blocked(run(input=>input.journal.snapshots[0].gameDate='2026-11-09'));
});
test('Ties and overtime remain literal outcomes, not wagering settlements',()=>{
  for(const status of ['Final','Final/OT','Final/2OT']){
    const out=run(input=>{mutateSyntheticBdl(input,e=>{e.visitor_team_score=27;e.status=status;});mutateSyntheticSchedule(input,s=>s.replace(',27,17,',',27,27,'));});
    assert.equal(out.status,'MATCHED_NONQUALIFYING_CANDIDATE');assert.equal(out.candidate.outcome,'TIE');assert.equal(out.qualifiedOutcomes,0);
  }
});
test('Single-game contract rejects arrays, pagination metadata and duplicate decoded keys',()=>{
  for(const transform of [s=>s.replace('{"data":','{"meta":{},"data":'),s=>s.replace('"status_state":"final"','"status_state":"in_progress","status_state":"final"'),
    s=>s.replace('"status_state":"final"','"status_state":"final","status_\\u0073tate":"final"'),
    s=>JSON.stringify({data:[JSON.parse(s).data]})]){
    blocked(run(input=>input.bdlBytes=bytes(transform(new TextDecoder().decode(input.bdlBytes)))));
  }
});
test('Oversized, invalidUTF8, malformedJSON and excessive depth return sanitized failure only',()=>{
  for(const bad of [new Uint8Array(),new Uint8Array(262145),new Uint8Array([0xff]),bytes('SECRET_BEARER_NOT_JSON'),
    bytes('{"data":'+ '['.repeat(34)+'0'+']'.repeat(34)+'}')]){
    const out=run(input=>input.bdlBytes=bad);blocked(out);assert.doesNotMatch(JSON.stringify(out),/SECRET|BEARER|stack|SyntaxError/);
  }
});
test('Unknown provider fields and arbitrary text never leak into the derived candidate',()=>{
  const out=run(input=>mutateSyntheticBdl(input,(e,p)=>{e.summary='<script>PRIVATE</script>';e.api_key='DO_NOT_EXPOSE';p.debug='PRIVATE';}));
  assert.equal(out.status,'MATCHED_NONQUALIFYING_CANDIDATE');assert.doesNotMatch(JSON.stringify(out),/PRIVATE|DO_NOT_EXPOSE|api_key|script/);
});
test('Schema-valid unknown JSON content is ignored while byte hashes preserve every input byte',()=>{
  const base=run(),extended=run(input=>mutateSyntheticBdl(input,e=>{e.extra={a:[true,false,null,1.2e3,'escaped\\quote"']};}));
  assert.equal(extended.status,'MATCHED_NONQUALIFYING_CANDIDATE');
  assert.notEqual(base.candidate.nativeFinalObservation.bodySha256,extended.candidate.nativeFinalObservation.bodySha256);
  assert.equal(base.candidate.homeScore,extended.candidate.homeScore);
});
test('No production import, network, secret, environment switch or persistence path is added',async()=>{
  const source=await readFile(new URL('../src/bdl-outcome-candidate.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\bfetch\s*\(|process\.env|writeFile|readFile|https?:\/\//);
  for(const path of ['../src/server.mjs','../scripts/capture-evidence.mjs'])
    assert.doesNotMatch(await readFile(new URL(path,import.meta.url),'utf8'),/bdl-outcome-candidate/);
});
test('Real journal remains untouched and unqualified after offline candidate evaluation',async()=>{
  const path=new URL('./fixtures/retained-20261114/nfl-2026.json',import.meta.url),before=await readFile(path,'utf8');run();
  assert.equal(await readFile(path,'utf8'),before);const summary=summarizeEvidence(JSON.parse(before));
  assert.equal(summary.totalSnapshots,323);assert.equal(summary.settledGames,18);assert.equal(summary.sourceCorroboratedSettledGames,0);
});

test('Duplicate frozen event under another gameID cannot become a second outcome',()=>{
  const out=run(input=>input.journal.snapshots.push({...input.journal.snapshots[0],id:'collision',gameId:'2026_11_LV_KC'}));
  blocked(out);assert.equal(out.reason,'FROZEN_EVENT_IDENTITY_COLLISION');
});
test('Consistent repeated but calendar-impossible season labels fail closed',()=>{
  const out=run(input=>{
    input.journal.season=2024;input.journal.snapshots[0].season=2024;
    input.gameId=input.journal.snapshots[0].gameId='2024_10_LV_KC';
    mutateSyntheticSchedule(input,s=>s.replace('2026_10_LV_KC,2026','2024_10_LV_KC,2024'));
    mutateSyntheticBdl(input,e=>e.season=2024);
  });blocked(out);assert.equal(out.reason,'INVALID_FROZEN_GAME_IDENTITY');
});
test('Known LAR/LA alias matches without changing native numeric team IDs',()=>{
  const out=run(input=>{
    input.gameId=input.journal.snapshots[0].gameId='2026_10_LV_LA';input.journal.snapshots[0].home='LA';
    mutateSyntheticSchedule(input,s=>s.replaceAll('_LV_KC','_LV_LA').replace(',KC,LV,',',LA,LV,'));
    mutateSyntheticBdl(input,e=>e.home_team.abbreviation='LAR');
  });assert.equal(out.status,'MATCHED_NONQUALIFYING_CANDIDATE');
  assert.equal(out.candidate.nativeFinalObservation.home,'LA');assert.equal(out.candidate.nativeFinalObservation.providerHomeTeamId,99901);
});

test('Postseason identity is explicit and a tied playoff final requires review',()=>{
  const input=syntheticBdlOutcomeInput();
  mutateSyntheticSchedule(input,s=>s.replace(',REG,',',WC,'));mutateSyntheticBdl(input,e=>e.postseason=true);
  assert.equal(assessBdlOutcomeCandidate(input).status,'MATCHED_NONQUALIFYING_CANDIDATE');
  mutateSyntheticBdl(input,e=>e.visitor_team_score=e.home_team_score);
  mutateSyntheticSchedule(input,s=>s.replace(',27,17,',',27,27,'));
  const out=assessBdlOutcomeCandidate(input);blocked(out);assert.equal(out.reason,'POSTSEASON_TIE_REQUIRES_REVIEW');
});
