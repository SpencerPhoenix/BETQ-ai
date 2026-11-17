import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POWER_PROTOCOL,POWER_CELLS,simulatePowerWorld,runPromotionPowerStudy
} from '../src/promotion-power.mjs';
import {
  buildMarginRows,assertSpreadDirection,fitMarginCorrection,
  scoreMargins,evaluateMarginResearch
} from '../src/margin-research.mjs';

function framesForPower(){
  const frames=new Map();
  let seed=919307;
  const rnd=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  for(let year=2020;year<=2025;year++){
    const rows=Array.from({length:240},(_,i)=>({
      gameId:year+'_'+i,year,week:1+Math.floor(i/15),
      date:year+'-10-'+String(1+i%28).padStart(2,'0'),
      market:.20+randFloat(i,rnd)*.60
    }));
    frames.set(year,rows);
  }
  return frames;
}
function randFloat(i,rnd){return Math.max(.00001,Math.min(.99999,(rnd()+i*0.000001)%1));}
function fakeMargin(){
  const source=[],replays=[];
  for(let season=2020;season<=2025;season++){
    const decisions=[];
    for(let i=0;i<250;i++){
      const spread=2.5+(i%25-12)*.8;
      const err=(i%7-3)*2.1+0.4;
      const margin=Math.round(spread+err);
      const away=17+Math.max(0,Math.round(-margin/2));
      const home=away+margin;
      const id=season+'_'+i;
      source.push({
        game_id:id,season:String(season),spread_line:String(spread),
        gameday:season+'-10-'+String(i%28+1).padStart(2,'0'),home_team:'PHI',away_team:'DAL',
        home_score:String(home),away_score:String(away)
      });
      const market=.5+.25*Math.tanh(spread/12);
      decisions.push({
        gameId:id,home:'PHI',away:'DAL',week:1+Math.floor(i/15),date:season+'-10-'+String(i%28+1).padStart(2,'0'),
        modelHomeProbability:Math.max(.02,Math.min(.98,market+.05*Math.sin(i))),
        closeMarketHomeProbability:market
      });
    }
    replays.push({season,decisions});
  }
  return {source,replays};
}

test('Power study has preregistered 7 cells, 2000 paths each and fixed original decision rule',()=>{
  assert.equal(POWER_CELLS.length,7);
  assert.equal(POWER_PROTOCOL.worldsPerCell,2000);
  assert.equal(POWER_PROTOCOL.pairedBootstrapDraws,300);
  assert.deepEqual(POWER_PROTOCOL.testSeasons,[2022,2023,2024,2025]);
  assert.match(POWER_PROTOCOL.gate,/3_OF_4/);
});
test('Synthetic world is reproducible and has no access to historical final scores',()=>{
  const frame=framesForPower();
  const cell=POWER_CELLS[3];
  const a=simulatePowerWorld(frame,cell,{seed:8921,bootstrapDraws:60});
  const b=simulatePowerWorld(frame,cell,{seed:8921,bootstrapDraws:60});
  assert.deepEqual(a,b);
  assert.ok(a.meanExpectedOracleLogLossGain>0);
  assert.ok(Number.isFinite(a.residualPooledLogLossGain));
  const nullWorld=simulatePowerWorld(frame,POWER_CELLS[0],{seed:8921,bootstrapDraws:60});
  assert.ok(Math.abs(nullWorld.meanExpectedOracleLogLossGain)<1e-12);
});
test('Power scenario report is bounded, fail-closed and never makes production profit claims',()=>{
  const rows=framesForPower(),report=runPromotionPowerStudy(rows,{
    cells:POWER_CELLS.slice(0,2),worldsPerCell:12,bootstrapDraws:70,seed:422
  });
  assert.equal(report.results.length,2);
  assert.equal(report.bettingAuthorized,false);
  assert.equal(report.modelPromoted,false);
  assert.equal(report.realWorldFalsePositiveRateKnown,false);
  assert.equal(report.verifiedROI,null);
  assert.equal(report.verifiedCLV,null);
  for(const r of report.results){
    assert.equal(r.worlds,12);
    assert.ok(r.originalStrictGate.approved>=0&&r.originalStrictGate.approved<=12);
    assert.ok(r.originalStrictGate.wilson95Percent[0]>=0);
    assert.ok(r.originalStrictGate.wilson95Percent[1]<=100);
  }
  const invalid=framesForPower();invalid.delete(2020);
  assert.throws(()=>runPromotionPowerStudy(invalid,{worldsPerCell:1,bootstrapDraws:20}),/Invalid season/);
});
test('Margin sign is verified using prior seasons; opposite convention is rejected',()=>{
  const {source,replays}=fakeMargin(),rows=buildMarginRows(source,replays);
  const pre=[...rows.get(2020),...rows.get(2021)];
  const valid=assertSpreadDirection(pre);
  assert.equal(valid.convention,'POSITIVE_IS_EXPECTED_HOME_MARGIN');
  assert.deepEqual(valid.validatedOnYears,[2020,2021]);
  assert.ok(valid.empiricalPretestCorrelation>.2);
  assert.throws(()=>assertSpreadDirection(pre.map(r=>({...r,marketHomeMargin:-r.marketHomeMargin}))),
    /sign or source integrity/);
  assert.throws(()=>fitMarginCorrection(pre.slice(0,8)),/Insufficient margin/);
});
test('Margin research uses prior-year fit, never stakes, and scores outcome as continuous',()=>{
  const {source,replays}=fakeMargin();
  const rows=buildMarginRows(source,replays);
  const prior=[...rows.get(2022),...rows.get(2023)];
  const fit=fitMarginCorrection(prior);
  const scored=scoreMargins(rows.get(2024),fit);
  assert.equal(scored.n,250);
  assert.ok(Number.isFinite(scored.mse)&&Number.isFinite(scored.mae));
  const report=evaluateMarginResearch(rows);
  assert.deepEqual(report.testYears,[2022,2023,2024,2025]);
  assert.equal(report.years.length,4);
  assert.deepEqual(report.years[0].trainedYears,[2020,2021]);
  assert.equal(report.pooled.closingSpreadBaseline.n,1000);
  assert.equal(report.pooled.eloMarginResidual.n,1000);
  assert.equal(report.bettingAuthorized,false);
  assert.equal(report.automaticPromotion,false);
  assert.equal(report.verifiedROI,null);
  assert.equal(report.verifiedCLV,null);
  assert.ok(report.pooled.paired95.lower95<=report.pooled.paired95.upper95);
});

test('Margin ingestion rejects contradictory source duplicates in either order',()=>{
  const {source,replays}=fakeMargin();
  for(const changed of [
    {...source[0],home_score:String(Number(source[0].home_score)+1)},
    {...source[0],spread_line:'not-a-number'},
    {...source[0],season:'2021'}
  ])for(const rows of [[...source,changed],[changed,...source]])
    assert.throws(()=>buildMarginRows(rows,replays),/Conflicting margin source rows|Margin source season mismatch/);
  assert.deepEqual(buildMarginRows([...source,{...source[0]}],replays),buildMarginRows(source,replays));
});
test('Margin replay rejects duplicated seasons, games, and cross-season joins',()=>{
  const {source,replays}=fakeMargin();
  assert.throws(()=>buildMarginRows(source,[...replays,replays[0]]),/duplicate margin replay season/);
  const duplicate=structuredClone(replays);
  duplicate[0].decisions.push({...duplicate[0].decisions[0]});
  assert.throws(()=>buildMarginRows(source,duplicate),/Duplicate margin replay game/);
  const wrongYear=structuredClone(replays);
  wrongYear[1].decisions.push({...wrongYear[0].decisions[0]});
  assert.throws(()=>buildMarginRows(source,wrongYear),/Margin replay season mismatch/);
});
test('Margin evaluation rejects direct frame tampering before claiming a prior-year fit',()=>{
  const {source,replays}=fakeMargin(),clean=buildMarginRows(source,replays);
  for(const mutation of [
    frames=>{frames.get(2022)[0].year=2021;},
    frames=>{frames.get(2022)[0].gameId='2021_other';},
    frames=>{frames.get(2022).push({...frames.get(2022)[0]});},
    frames=>{frames.get(2022)[0].date='2022-02-30';},
    frames=>{frames.get(2022)[0].date='2024-01-01';},
    frames=>{frames.get(2022)[0].feature=NaN;},
    frames=>{frames.get(2022)[0].week=0;},
    frames=>{frames.get(2021)[0].date='2022-12-01';}
  ]){
    const frames=structuredClone(clean);mutation(frames);
    assert.throws(()=>evaluateMarginResearch(frames),/Margin|margin/);
  }
});
test('Margin chronology allows next-calendar-year playoffs but not training/test overlap',()=>{
  const {source,replays}=fakeMargin();
  replays[1].decisions[0].date='2022-01-10';
  source.find(r=>r.game_id===replays[1].decisions[0].gameId).gameday='2022-01-10';
  const rows=buildMarginRows(source,replays);
  assert.equal(evaluateMarginResearch(rows).automaticPromotion,false);
  rows.get(2022)[0].date='2022-01-10';
  assert.throws(()=>evaluateMarginResearch(rows),/chronology overlap/);
});

test('Malformed replay dates fail with an intentional audit error before sorting',()=>{
  for(const date of [null,42,'2021-02-30','']){
    const {source,replays}=fakeMargin();replays[0].decisions[0].date=date;
    assert.throws(()=>buildMarginRows(source,replays),/Invalid margin game date/);
  }
});


test('Margin joins bind date and both teams, not only ID and season',()=>{
  for(const patch of [{date:'2020-10-02'},{home:'KC'},{away:'BUF'},
    {home:'DAL',away:'PHI'},{home:null},{away:''}]){
    const {source,replays}=fakeMargin();
    Object.assign(replays[0].decisions[0],patch);
    assert.throws(()=>buildMarginRows(source,replays),/Margin replay identity mismatch/);
  }
});
test('Margin duplicate conflicts include date and canonical team identity before filtering',()=>{
  const {source,replays}=fakeMargin();
  for(const patch of [{gameday:'2020-10-02'},{home_team:'KC'},{away_team:'BUF'},
    {home_team:'DAL',away_team:'PHI'}]){
    const changed={...source[0],...patch};
    for(const rows of [[...source,changed],[changed,...source]])
      assert.throws(()=>buildMarginRows(rows,replays),/Conflicting margin source rows/);
  }
  for(const patch of [{gameday:'2020-02-30'},{home_team:'UNKNOWN'},{away_team:'PHI'}])
    assert.throws(()=>buildMarginRows([{...source[0],...patch}],replays),/Invalid margin source identity/);
});
test('Margin team aliases preserve an otherwise identical historical join',()=>{
  const {source,replays}=fakeMargin();
  source[0].home_team='OAK';source[0].away_team='SD';
  replays[0].decisions[0].home='LV';replays[0].decisions[0].away='LAC';
  const expected=buildMarginRows(source,replays);
  assert.deepEqual(buildMarginRows([...source,{...source[0],home_team:'LV',away_team:'LAC'}],replays),expected);
  replays[0].decisions[0].home='OAK';replays[0].decisions[0].away='SD';
  assert.deepEqual(buildMarginRows(source,replays),expected);
});
