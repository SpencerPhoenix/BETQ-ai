import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { foldPbpCsvChunks, collectPbpGames } from '../src/pbp.mjs';
import {
  chronologicalFeatures, fitEfficiencyChallenger,
  challengerResearchForEvent
} from '../src/nfl-efficiency.mjs';

const TARGET='2026_09_LV_KC';
test('Gzipped CSV streamed across awkward chunk boundaries, with quoted multiline field',async()=>{
  const rows=['game_id,posteam,defteam,epa,success,play_type,qb_dropback,rush_attempt,season_type,desc'];
  for(let i=0;i<35;i++){
    rows.push(TARGET+',KC,LV,0.3,1,pass,1,0,REG,"Deep pass, gain '+i+'"');
    rows.push(TARGET+',LV,KC,-0.1,0,run,0,1,REG,"Rush play '+i+'"');
  }
  rows.push(TARGET+',KC,LV,0.5,1,pass,1,0,REG,"Multiline quoted\npass, with ""quoted"" phrase"');
  const csv=rows.join('\n')+'\n';
  const gz=gzipSync(Buffer.from(csv));
  const stream=Readable.from([gz]).pipe(createGunzip());
  const collector=collectPbpGames(
    [{id:TARGET,season:2026,week:9,date:'2026-11-01',home:'KC',away:'LV'}],
    [TARGET],2026
  );
  const stat=await foldPbpCsvChunks(stream,collector.collect);
  const result=collector.finish();
  assert.equal(stat.seen,71);
  assert.equal(result.completeGames,1);
  assert.equal(result.acceptedPlays,71);
  assert.ok(Math.abs(result.games[TARGET].homeStats.offEPA-0.30556)<0.0001);
  assert.equal(result.games[TARGET].awayStats.offSuccess,0);
  assert.equal(result.games[TARGET].homeStats.defPlays,35);
});

test('Malformed schema, oversized data and unmatched games fail closed',async()=>{
  await assert.rejects(foldPbpCsvChunks(['name,number\nKC,1\n'],()=>{}),/PBP column missing/);
  await assert.rejects(foldPbpCsvChunks(['game_id,posteam,defteam,epa,play_type,season_type\nfoo,KC,LV,.2,pass,REG\n'],()=>{},{maxBytes:10}),/size bound/);
  const collector=collectPbpGames([{id:TARGET,season:2026,week:9,date:'2026-11-01',home:'KC',away:'LV'}],[TARGET],2026);
  collector.collect({game_id:'unknown',posteam:'KC',defteam:'LV',epa:'.3',success:'1',play_type:'pass',season_type:'REG'});
  assert.equal(collector.finish().completeGames,0);
});

function syntheticSeasonData(){
  const teams=['ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU','IND','JAX','KC',
    'LV','LAC','LA','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SF','SEA','TB','TEN','WAS'];
  const games=[],pbp={};
  let seed=883812;
  const rnd=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  for(let season=2018;season<=2026;season++){
    for(let week=1;week<=18;week++){
      const date=new Date(Date.UTC(season,8,1+(week-1)*7)).toISOString().slice(0,10);
      for(let i=0;i<16;i++){
        const h=teams[i],a=teams[i+16],id=season+'_'+String(week).padStart(2,'0')+'_'+a+'_'+h;
        const hSkill=(i%5-2)/10,aSkill=((i+16)%5-2)/10;
        const score=rnd()<0.5+0.09*(hSkill-aSkill)?1:0;
        games.push({id,date,season,week,home:h,away:a,homeScore:score?27:17,awayScore:score?17:27});
        const stats=net=>({
          offPlays:60,defPlays:60,offEPA:0.06+net+rnd()*0.08,
          defEPA:0.05-net+rnd()*0.05,offSuccess:0.46+net*0.2,
          defSuccess:0.46-net*0.2
        });
        pbp[id]={gameId:id,home:h,away:a,homeStats:stats(hSkill),awayStats:stats(aSkill)};
      }
    }
  }
  return {games,pbp};
}
test('Lagged features never read the current game PBP before prediction',()=>{
  const {games,pbp}=syntheticSeasonData();
  const eloParams={k:30,homeAdv:50,regression:0.35,scale:1};
  const first=chronologicalFeatures(games,pbp,eloParams);
  assert.ok(first.records.length>1500);
  assert.ok(!first.records.some(r=>r.id===games[0].id)); // no pregame history in first week
  const firstKnown=first.records.find(r=>r.season===2018);
  const altered=structuredClone(pbp);
  altered[firstKnown.id].homeStats.offEPA=9;
  altered[firstKnown.id].awayStats.offEPA=-9;
  const second=chronologicalFeatures(games,altered,eloParams);
  const same=second.records.find(r=>r.id===firstKnown.id);
  assert.equal(same.epaDiff,firstKnown.epaDiff);
  assert.equal(same.successDiff,firstKnown.successDiff);
  assert.equal(same.restDiff,firstKnown.restDiff);
});
test('Challenger tuning, calibration and untouched holdout remain disjoint',()=>{
  const {games,pbp}=syntheticSeasonData();
  const model=fitEfficiencyChallenger(games,pbp,{k:30,homeAdv:50,regression:0.35,scale:1});
  assert.equal(model.version,'nfl-efficiency-1');
  assert.ok(model.tuning.n>850);
  assert.ok(model.calibration.n>=400);
  assert.ok(model.holdout.challenger.n>=230);
  assert.equal(model.holdout.elo.n,model.holdout.challenger.n);
  assert.equal(model.training.untouchedHoldout,'2025');
  assert.equal(model.independentOfOdds,undefined);
  if(model.promotable){
    assert.ok(model.holdout.confidence95.lower>0);
    assert.ok(model.holdout.deltaBrier>0.002);
  }
});
test('Stale challenger is not exposed; healthy challenger remains research only',()=>{
  const model={version:'nfl-efficiency-1',readyForResearch:true,promotable:false,
    generatedAt:'2026-11-01T11:00:00Z',teamFeatures:{
      KC:{n:8,netEPA:0.3,netSuccess:0.13,offEPA:0.2,defEPA:-0.1,
        latestGameDate:'2026-10-25'},
      LV:{n:8,netEPA:-0.08,netSuccess:-0.06,offEPA:-0.03,defEPA:0.05,
        latestGameDate:'2026-10-25'}
    },
    coefficients:{epa:1.2,success:1.0,rest:0.02},
    source:'NFLVERSE_PBP_CC_BY_4_0',holdout:{elo:{brier:0.23},challenger:{brier:0.228}}};
  const game={home_team:'Kansas City Chiefs',away_team:'Las Vegas Raiders',
    commence_time:'2026-11-04T18:00:00Z'};
  const p=challengerResearchForEvent(game,0.64,model,Date.parse('2026-11-02T12:00:00Z'));
  assert.equal(p.available,true);
  assert.equal(p.status,'UNPROMOTED_CHALLENGER');
  assert.equal(p.automaticSelection,false);
  assert.equal(p.startingQuarterbackVerified,false);
  assert.ok(p.homeWinProbability>0&&p.homeWinProbability<1);
  assert.equal(challengerResearchForEvent(game,0.64,model,Date.parse('2026-11-12T12:00:00Z')).available,false);
});
