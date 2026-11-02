import test from 'node:test';
import assert from 'node:assert/strict';
import {
  indexedHistoricalClosing,walkForwardByDay,fitBeforeSeason,
  summarizeSelections,buildSeasonReplay
} from '../src/historical-replay.mjs';
const roster=['ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU','IND','JAX','KC',
'LV','LAC','LA','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SF','SEA','TB','TEN','WAS'];
function syntheticData(){
  let seed=197371;const rnd=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const games=[],rows=[];
  for(let year=2014;year<=2025;year++){
    for(let week=1;week<=17;week++){
      const date=new Date(Date.UTC(year,8,5+7*(week-1))).toISOString().slice(0,10);
      for(let i=0;i<16;i++){
        const home=roster[(i+week)%32],away=roster[(i+week+16)%32];
        const id=year+'_'+String(week).padStart(2,'0')+'_'+away+'_'+home;
        const win=rnd()<0.48+((i%5)-2)*0.02;
        const homeScore=win?24:17,awayScore=win?17:24;
        games.push({id,season:year,date,week,home,away,neutral:false,homeScore,awayScore});
        rows.push({game_id:id,season:year,home_moneyline:i%7===0?'':i%2?'-120':'+115',
          away_moneyline:i%7===0?'':i%2?'+108':'-125'});
      }
    }
  }
  return {games,rows};
}
test('Historical closing prices are filtered and never treated as filled offers',()=>{
  const source=[
    {game_id:'good',home_moneyline:'-110',away_moneyline:'+100'},
    {game_id:'bad_missing',home_moneyline:'',away_moneyline:'-120'},
    {game_id:'bad_zero',home_moneyline:'0',away_moneyline:'-120'},
    {game_id:'bad_vig',home_moneyline:'-5000',away_moneyline:'-5000'},
    {game_id:'bad_fraction',home_moneyline:'-100.5',away_moneyline:'+130'}
  ];
  const p=indexedHistoricalClosing(source);
  assert.equal(p.size,1);
  assert.equal(p.get('good').homeAmerican,-110);
  assert.equal(p.get('good').basis,'RETROSPECTIVE_UNTIMESTAMPED_CLOSING_MONEYLINE');
  assert.ok(p.get('good').homeMarketProbability>0.5);
});
test('Same-date outcomes are not available to the other pregame predictions',()=>{
  const games=[
    {id:'a',season:2020,date:'2020-10-01',home:'KC',away:'DEN',homeScore:30,awayScore:17,neutral:false},
    {id:'b',season:2020,date:'2020-10-01',home:'KC',away:'LV',homeScore:25,awayScore:17,neutral:false},
    {id:'c',season:2020,date:'2020-10-02',home:'LV',away:'KC',homeScore:14,awayScore:35,neutral:false}
  ];
  const a=walkForwardByDay(games).history;
  const edited=structuredClone(games);edited[0].homeScore=10;edited[0].awayScore=42;
  const b=walkForwardByDay(edited).history;
  assert.equal(a[1].prediction,b[1].prediction);
  assert.notEqual(a[2].prediction,b[2].prediction);
  assert.equal(a[0].prediction,b[0].prediction);
});
test('Annual re-tuning and calibration cannot see the test-year outcome',()=>{
  const {games}=syntheticData();
  const fit=fitBeforeSeason(games,2025);
  assert.deepEqual(fit.tunedYears,[2018,2022]);
  assert.deepEqual(fit.calibrationYears,[2023,2024]);
  assert.ok(fit.calibration.n>=350);
  const altered=structuredClone(games);
  for(const g of altered.filter(x=>x.season===2025)){g.homeScore=12;g.awayScore=50;}
  const fitAfter=fitBeforeSeason(altered,2025);
  assert.deepEqual(fit.params,fitAfter.params);
  assert.deepEqual(fit.tuning,fitAfter.tuning);
  assert.deepEqual(fit.calibration,fitAfter.calibration);
  const original=walkForwardByDay(games,fit.params).history.find(g=>g.season===2025);
  const modified=walkForwardByDay(altered,fit.params).history.find(g=>g.season===2025);
  assert.equal(original.prediction,modified.prediction);
});
test('Flat-unit prices grade wins, losses and ties explicitly; not CLV',()=>{
  const games=[
    {actual:'home',priceAvailable:true,selectedSide:'home',selectedOdds:+120,estimatedEV:.07},
    {actual:'away',priceAvailable:true,selectedSide:'home',selectedOdds:-110,estimatedEV:.05},
    {actual:'home',priceAvailable:true,selectedSide:'home',selectedOdds:-110,estimatedEV:.015},
    {actual:'TIE',priceAvailable:true,selectedSide:'home',selectedOdds:-110,estimatedEV:.09},
    {actual:'away',priceAvailable:false,selectedSide:null,selectedOdds:null,estimatedEV:null}
  ];
  const r=summarizeSelections(games,.03);
  assert.equal(r.graded,2);
  assert.equal(r.wins,1);assert.equal(r.losses,1);assert.equal(r.tiesExcluded,1);
  assert.equal(r.hypotheticalNetUnits,0.2);
  assert.equal(r.hypotheticalRiskedUnits,2);
  assert.equal(r.hypotheticalClosingPriceROI,10);
  assert.equal(r.verifiedRealMoneyROI,undefined);
  assert.equal(r.clvAvailable,false);
  assert.equal(r.realizedROI,null);
});
test('Fixed thresholds are compared; no selection rule optimized against final outcomes',()=>{
  const {games,rows}=syntheticData();
  const result=buildSeasonReplay(games,rows,{seasons:[2024,2025],thresholds:[0,.03,.05]});
  assert.equal(result.years.length,2);
  assert.equal(result.betExecutionVerified,false);
  assert.equal(result.verifiedCLV,false);
  assert.equal(result.verifiedROI,false);
  assert.equal(result.years[0].fit.testSeason,2024);
  for(const y of result.years){
    assert.ok(y.allGameForecast.n>=260);
    assert.ok(y.closingMoneylineCoverage.validGamesWithBothPrices>0);
    assert.ok(y.selectionRules[0].graded>=y.selectionRules[1].graded);
    assert.ok(y.selectionRules[1].graded>=y.selectionRules[2].graded);
    for(const d of y.decisions){
      assert.equal(d.modelBuiltUsingTestOutcomes,false);
      assert.equal(d.quoteTimeVerified,false);
      assert.ok(d.modelHomeProbability>0&&d.modelHomeProbability<1);
    }
  }
});
