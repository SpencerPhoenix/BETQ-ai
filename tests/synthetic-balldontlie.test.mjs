import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {crossCheckSyntheticBallDontLieFixture} from '../src/synthetic-balldontlie.mjs';
import {parseCsv} from '../src/nfl-elo.mjs';
import {summarizeEvidence} from '../src/evidence.mjs';
import {selectFinalizedResults,isAttestedFinal,isCorroboratedSettlement,reconcileSettlements} from '../src/settlement-only.mjs';
import {verifyAppendOnlyEvidence} from '../src/evidence-transition.mjs';

const raw=await readFile(new URL('./fixtures/balldontlie/synthetic-nfl-v1.json',import.meta.url),'utf8');
const fixture=()=>JSON.parse(raw);
const run=f=>crossCheckSyntheticBallDontLieFixture(f,{enabled:true});
const edit=(f,fn)=>{const p=JSON.parse(f.balldontlieJson);fn(p.data[0],p);f.balldontlieJson=JSON.stringify(p);return f;};
const hash=text=>createHash('sha256').update(text).digest('hex');

test('adapter is disabled by default and requires an explicit fabricated-fixture opt-in',()=>{
  const trap=new Proxy({},{get(){throw Error('MUST_NOT_READ');}});
  assert.equal(crossCheckSyntheticBallDontLieFixture(trap).enabled,false);
  assert.equal(crossCheckSyntheticBallDontLieFixture().providerRequests,0);
  assert.throws(()=>crossCheckSyntheticBallDontLieFixture(fixture(),{enabled:'true'}),/BOOLEAN/);
  for(const change of [{schema:'live'},{fixtureOrigin:'REAL_API_RESPONSE'},{fixtureOrigin:undefined}])
    assert.throws(()=>run({...fixture(),...change}),/FABRICATED_FIXTURE_REQUIRED/);
});
test('fabricated matching finals remain cross-checked only, with separate raw-byte hashes and no mutation',()=>{
  const f=fixture(),before=JSON.stringify(f),report=run(f),row=report.crossChecks[0];
  assert.equal(report.crossCheckedSyntheticGames,1);assert.equal(report.qualifiedOutcomes,0);
  assert.equal(row.status,'CROSS_CHECKED_FINAL_INDEPENDENCE_UNVERIFIED');
  for(const key of ['sourceIndependenceVerified','qualifiesForExistingCorroborationGate',
    'officialLeagueCertification','publicationAuthorized','liveCaptureEnabled'])assert.equal(row[key],false,key);
  assert.equal(row.syntheticOnly,true);assert.equal(row.gameDate,'2026-11-02');
  assert.equal(row.commenceTime,'2026-11-03T01:20:00.000Z');
  assert.equal(row.sourceReceipts.nflverse.sha256,hash(f.nflverseCsv));
  assert.equal(row.sourceReceipts.balldontlie.sha256,hash(f.balldontlieJson));
  assert.equal(row.sourceReceipts.balldontlie.sourceFreshnessVerified,false);
  assert.equal(row.sourceReceipts.balldontlie.providerPublicationTimeVerified,false);
  assert.equal(JSON.stringify(f),before);assert.deepEqual(run(f),report);
});
test('explicit final lifecycle is required and contradicting legacy status cannot pass',()=>{
  for(const state of ['scheduled','in_progress','postponed','canceled','delayed','suspended','abandoned','unknown','FINAL',null,undefined]){
    const report=run(edit(fixture(),e=>{e.status_state=state;}));
    assert.equal(report.crossCheckedSyntheticGames,0);
    assert.equal(report.rejected[0].reason,'EXPLICIT_CONSISTENT_FINAL_REQUIRED');
  }
  for(const status of ['In Progress','Canceled','Final - unofficial',null,undefined])
    assert.equal(run(edit(fixture(),e=>{e.status=status;})).crossCheckedSyntheticGames,0);
  assert.equal(run(edit(fixture(),e=>{e.status='Final/OT';})).crossCheckedSyntheticGames,1);
});
test('both scores must be bounded integers matching the community candidate exactly',()=>{
  for(const value of [null,undefined,'17',17.5,-1,101,18])
    assert.equal(run(edit(fixture(),e=>{e.home_team_score=value;})).rejected[0].reason,'FINAL_SCORE_MISMATCH');
  assert.equal(run(edit(fixture(),e=>{e.visitor_team_score=33;})).crossCheckedSyntheticGames,0);
});
test('season, home/visitor orientation, known teams and distinct positive IDs fail closed',()=>{
  for(const change of [e=>{e.season=2025;},e=>{[e.home_team,e.visitor_team]=[e.visitor_team,e.home_team];},
    e=>{e.home_team.abbreviation='NYG';}])assert.equal(run(edit(fixture(),change)).crossCheckedSyntheticGames,0);
  for(const change of [e=>{e.season='2026';},e=>{e.id=0;},e=>{e.id=1.5;},
    e=>{e.id='990000001';},e=>{e.home_team.id=e.visitor_team.id;},e=>{e.home_team.abbreviation='XYZ';},
    e=>{e.home_team.abbreviation=e.visitor_team.abbreviation;},e=>{e.visitor_team=null;}])
    assert.throws(()=>run(edit(fixture(),change)),/INVALID/);
});
test('kickoff, phase and canonical provider record times must match, without inferring source freshness',()=>{
  for(const date of ['2026-11-03T02:20:00.000Z','2026-11-03','2026-02-30T01:20:00.000Z'])
    assert.equal(run(edit(fixture(),e=>{e.date=date;})).rejected[0].reason,'KICKOFF_OR_RECEIPT_MISMATCH');
  for(const phase of [true,null,undefined])assert.equal(run(edit(fixture(),e=>{e.postseason=phase;})).rejected[0].reason,'SEASON_PHASE_MISMATCH');
  for(const when of ['2026-11-03','2026-11-03T00:00:00.000Z','2026-11-04T12:29:30.001Z',null])
    assert.equal(run(edit(fixture(),e=>{e.updated_at=when;})).rejected[0].reason,'INVALID_PROVIDER_RECORD_TIME');
  const row=run(fixture()).crossChecks[0];
  assert.equal(row.sourceReceipts.balldontlie.providerRecordUpdatedAt,'2026-11-03T04:45:00.000Z');
  assert.equal(row.sourceReceipts.balldontlie.sourceFreshnessVerified,false);
});
test('collector receipt chronology is validated separately for both source byte sets',()=>{
  for(const field of ['nflverseObservedAt','balldontlieObservedAt']){
    for(const value of [undefined,'2026-11-04','2026-02-30T12:00:00.000Z',
      '2026-11-04T12:30:00.001Z','2026-11-04T11:29:59.999Z']){
      const f=fixture();f[field]=value;assert.throws(()=>run(f),/RECEIPT_CHRONOLOGY/);
    }
  }
});
test('ambiguity is rejected before filtering by matching scores or final lifecycle',()=>{
  assert.throws(()=>run(edit(fixture(),(e,p)=>p.data.push({...e,home_team_score:99}))),/DUPLICATE_PROVIDER_GAME_ID/);
  for(const change of [e=>{e.status_state='in_progress';},e=>{e.home_team_score=99;},e=>{}]){
    const f=edit(fixture(),(e,p)=>{const second=structuredClone(e);second.id++;change(second);p.data.push(second);});
    const report=run(f);assert.equal(report.crossCheckedSyntheticGames,0);
    assert.equal(report.rejected[0].reason,'AMBIGUOUS_PROVIDER_GAME');
  }
  const f=fixture();f.nflverseCsv+=f.nflverseCsv.split('\n')[1]+'\n';
  assert.equal(run(f).rejected[0].reason,'AMBIGUOUS_NFLVERSE_GAME');
  const conflict=fixture();conflict.nflverseCsv+=conflict.nflverseCsv.split('\n')[1].replace(',34,17,',',35,17,')+'\n';
  assert.throws(()=>run(conflict),/CONTRADICTORY_SOURCE_SCORES/);
});
test('partial, malformed or unbounded provider pages cannot cross-check any game',()=>{
  for(const change of [(e,p)=>{p.meta.next_cursor=1;},(e,p)=>{delete p.meta.next_cursor;},
    (e,p)=>{p.meta.per_page=101;},(e,p)=>{p.meta.per_page=0;},(e,p)=>{p.data={};}])
    assert.throws(()=>run(edit(fixture(),change)),/COMPLETE_BOUNDED/);
  assert.throws(()=>run({...fixture(),balldontlieJson:'not json'}));
  assert.throws(()=>run({...fixture(),balldontlieJson:' '.repeat(1000001)}),/PAYLOAD_SIZE/);
  const noGame=edit(fixture(),(e,p)=>{p.data=[];});
  assert.equal(run(noGame).rejected[0].reason,'NO_PROVIDER_GAME_MATCH');
});
test('existing delayed-finality and frozen-game identity checks remain effective',()=>{
  const early=fixture();early.evaluatedAt='2026-11-03T12:30:00.000Z';
  early.nflverseObservedAt='2026-11-03T12:29:00.000Z';early.balldontlieObservedAt='2026-11-03T12:29:30.000Z';
  assert.equal(run(early).rejected[0].reason,'NFLVERSE_CANDIDATE_UNAVAILABLE_OR_TOO_EARLY');
  const conflict=fixture();conflict.journal.snapshots.push({...conflict.journal.snapshots[0],id:'conflict',home:'NYG'});
  assert.throws(()=>run(conflict),/CONTRADICTORY_TRACKED_GAME_ID/);
  for(const gameDate of ['2026-02-30','not-a-date',null,'2025-01-01','0000-00-00']){
    const invalid=fixture();invalid.journal.snapshots[0].gameDate=gameDate;
    assert.throws(()=>run(invalid),/INVALID_FROZEN_GAME_IDENTITY/);
  }
  for(const season of [-1,2025,2200]){
    const invalid=fixture();invalid.journal.season=season;invalid.journal.snapshots[0].season=season;
    assert.throws(()=>run(invalid),/INVALID_FROZEN_GAME_IDENTITY/);
  }
});
test('one physical event cannot be counted under multiple frozen game IDs',()=>{
  const f=fixture();f.journal.snapshots.push({...f.journal.snapshots[0],id:'other',gameId:'second-game-id'});
  f.nflverseCsv+=f.nflverseCsv.split('\n')[1].replace('synthetic-2026-SEA-CHI','second-game-id')+'\n';
  assert.throws(()=>run(f),/FROZEN_EVENT_IDENTITY_COLLISION/);
});
test('duplicate CSV headers, invalid quoting and extra or missing row fields are rejected',()=>{
  const f=fixture(),[header,row]=f.nflverseCsv.trim().split('\n');
  for(const nflverseCsv of [header+',home_score\n'+row+',17\n',header+'\n'+row+',hidden\n',
    header+'\n'+row.slice(0,row.lastIndexOf(','))+'\n',header+'\n'+row.replace('Home','"Home"extra')+'\n'])
    assert.throws(()=>run({...f,nflverseCsv}),/SCHEDULE_HEADER|ROW_WIDTH|CSV_QUOTING/);
  const quoted=header+'\n'+row.replace('Home','"Home"')+'\n';
  assert.equal(run({...f,nflverseCsv:quoted}).crossCheckedSyntheticGames,1);
});
test('provider team IDs cannot represent contradictory teams elsewhere in the same page',()=>{
  const f=edit(fixture(),(e,p)=>{const other=structuredClone(e);other.id++;
    other.home_team.abbreviation='NYG';p.data.push(other);});
  assert.throws(()=>run(f),/CONFLICTING_PROVIDER_TEAM_IDENTITY/);
});
test('documented team aliases and tied scores stay nonqualifying',()=>{
  const f=fixture();f.journal.snapshots[0].home='LA';f.nflverseCsv=f.nflverseCsv.replace(',CHI,SEA,',',CHI,LA,');
  edit(f,e=>{e.home_team.abbreviation='LAR';});assert.equal(run(f).crossChecks[0].home,'LA');
  const tied=fixture();tied.nflverseCsv=tied.nflverseCsv.replace(',34,17,',',17,17,');
  edit(tied,e=>{e.visitor_team_score=17;});const row=run(tied).crossChecks[0];
  assert.equal(row.outcome,'TIE');assert.equal(row.qualifiesForExistingCorroborationGate,false);
});
test('cross-check output cannot enter existing attestation, settlement or publication gates',()=>{
  const f=fixture(),report=run(f),crossCheck=report.crossChecks[0],now=Date.parse(f.evaluatedAt);
  const rows=parseCsv(f.nflverseCsv),result=selectFinalizedResults(f.journal,rows,{now})[0];
  assert.equal(isAttestedFinal(result,crossCheck,{now}),false);
  const record={...result,revision:1,verifiedAt:f.evaluatedAt,
    finalityBasis:'TWO_SOURCE_FINAL_STATUS_NOT_LEAGUE_CERTIFIED',finalityAttestation:crossCheck,
    communitySourceVintage:{sha256:hash(f.nflverseCsv),collectorObservedAt:f.nflverseObservedAt,publicationTimeVerified:false}};
  assert.equal(isCorroboratedSettlement(record),false);
  const candidate=structuredClone(f.journal);candidate.settlements.push(record);
  assert.throws(()=>verifyAppendOnlyEvidence(f.journal,candidate,{allowNewSnapshots:false}),/NOT_SOURCE_CORROBORATED/);
  const unchanged=reconcileSettlements(f.journal,rows,{now,attestations:{[result.gameId]:crossCheck},
    communitySourceSha256:hash(f.nflverseCsv),communitySourceObservedAt:f.nflverseObservedAt});
  assert.equal(unchanged.appended,0);assert.deepEqual(unchanged.journal,f.journal);
  const summary=summarizeEvidence(candidate,now);
  assert.equal(summary.sourceCorroboratedSettledGames,0);assert.equal(summary.forwardMetrics,null);
});
test('fixed CLI works with network forbidden, stays default-disabled and accepts no live/file options',()=>{
  const script=new URL('../scripts/check-synthetic-balldontlie.mjs',import.meta.url).pathname;
  const blocked='data:text/javascript,'+encodeURIComponent("globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN')};");
  const invoke=args=>spawnSync(process.execPath,['--import',blocked,script,...args],{encoding:'utf8'});
  const disabled=invoke([]);assert.equal(disabled.status,0,disabled.stderr);assert.equal(JSON.parse(disabled.stdout).enabled,false);
  const enabled=invoke(['--synthetic-fixture']);assert.equal(enabled.status,0,enabled.stderr);
  assert.equal(JSON.parse(enabled.stdout).crossCheckedSyntheticGames,1);
  for(const args of [['--live'],['--file','/tmp/input.json'],['--synthetic-fixture','--write']])assert.notEqual(invoke(args).status,0);
});
test('synthetic adapter has no production imports or workflow activation path',async()=>{
  for(const path of ['src/server.mjs','src/evidence.mjs','src/settlement-only.mjs','src/settlement-corroboration.mjs',
    'scripts/capture-evidence.mjs','scripts/reconcile-settlements.mjs',...((await readdir(new URL('../.github/workflows/',import.meta.url)))
      .map(name=>'.github/workflows/'+name))]){
    const text=await readFile(new URL('../'+path,import.meta.url),'utf8');
    assert.doesNotMatch(text,/synthetic-balldontlie|api\.balldontlie\.io|BALLDONTLIE_API_KEY/,path);
  }
});
