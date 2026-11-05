import test from 'node:test';
import {withSyntheticCorroboration} from './fixtures/source-corroborated.mjs';
import assert from 'node:assert/strict';
import {emptyJournal} from '../src/evidence.mjs';
import {calculateSequentialEvidence,evidencePath,SEQUENTIAL_PROTOCOL,
  isEligibleFirstSnapshot} from '../src/market-sequential.mjs';
import {summarizeDerivedForwardMarkets,createDerivedForwardMarketFeed} from '../src/shadow-derived.mjs';
const NOW=Date.parse('2026-11-02T12:00:00Z');
const iso=x=>new Date(x).toISOString();
function shot(game,num,market=.5,elo=.65,{at=NOW,challenger=null}={}){
  const captured=at+num*60000;
  return {
    id:'snapshot-'+game+'-'+num,gameId:game,providerEventId:'provider-'+game,
    season:2026,home:'KC',away:'LV',gameDate:'2026-11-08',
    commenceTime:iso(NOW+5*86400000),capturedAt:iso(captured),
    sourceReceivedAt:iso(captured-1000),
    marketNewestQuoteAt:iso(captured-2500),
    marketBookCount:4,marketBasis:'NO_VIG_MULTI_BOOK_MEDIAN',
    modelHomeProbability:elo,modelBuiltAt:iso(NOW-60000),
    modelVersion:'nfl-elo-1',
    challengerHomeProbability:challenger,
    challengerBuiltAt:challenger===null?undefined:iso(NOW-30000),
    challengerResearchOnly:true,
    independentModel:true,researchOnly:true,
    marketHomeProbability:market
  };
}
function final(game,y,revision=1){
  return withSyntheticCorroboration({
    gameId:game,gameDate:'2026-11-08',
    homeScore:y===1?31:10,awayScore:y===1?10:31,
    outcome:y===1?'HOME':'AWAY',revision,
    resultHash:'result-'+game+'-'+revision
  },iso(NOW+10*86400000));
}
function makeJ(snaps,results){
  const j=emptyJournal(2026);j.snapshots=snaps;j.settlements=results;return j;
}
test('Preregistered sample gate never manufactures profitability or model promotion',()=>{
  assert.equal(SEQUENTIAL_PROTOCOL.minDistinctFinalGames,30);
  assert.equal(SEQUENTIAL_PROTOCOL.evidenceLikelihoodRatioThreshold,20);
  assert.equal(SEQUENTIAL_PROTOCOL.mixtureWeights.elo,.5);
  const j=makeJ([shot('a',0,.5,.65),shot('a',30,.51,.66)],[final('a',1)]);
  const out=calculateSequentialEvidence(j);
  assert.equal(out.firstQualifyingPregameGames,1);
  assert.equal(out.eligibleSettledNonTieGames,1);
  assert.equal(out.properScores,null);
  assert.equal(out.candidateEvidence.fixedMixtureEvidence,null);
  assert.equal(out.candidateEvidence.crossedIllustrativeThreshold,null);
  assert.equal(out.gamesNeededForDescriptiveScore,29);
  assert.equal(out.bettingAuthorized,false);
  assert.equal(out.bookmakerFillVerified,false);
  assert.equal(out.verifiedROI,null);
  assert.equal(out.verifiedCLV,null);
  assert.equal(out.modelPromoted,false);
});
test('Exactly first eligible pregame snapshot per game; missing efficiency challenger is neutral market',()=>{
  const snaps=[shot('x',30,.9,.1),shot('x',0,.5,.6),shot('x',20,.95,.01,{challenger:.95})];
  const out=calculateSequentialEvidence(makeJ(snaps,[final('x',1)]));
  assert.equal(out.eligibleSettledNonTieGames,1);
  assert.equal(out.eligibleChallengerGames,0);
  assert.equal(out.candidateEvidence.efficiencyLogLikelihoodRatio,null);
  assert.equal(out.predictionsFrozenBeforeLaterPrice,true);
  assert.equal(out.sequentialNullProvenCorrect,false);
});
test('Thirty distinct outcomes unlock descriptive scores but never a validated betting edge',()=>{
  const snaps=[],results=[];
  for(let i=0;i<30;i++){
    const game='g-'+i;
    snaps.push(shot(game,0,.5,.65,{challenger:.55}),shot(game,30,.51,.2));
    results.push(final(game,i<22?1:0));
  }
  const out=calculateSequentialEvidence(makeJ(snaps,results));
  assert.equal(out.eligibleSettledNonTieGames,30);
  assert.equal(out.eligibleChallengerGames,30);
  assert.equal(out.gamesNeededForDescriptiveScore,0);
  assert.equal(out.properScores.n,30);
  assert.ok(Number.isFinite(out.properScores.marketBrier));
  assert.ok(Number.isFinite(out.properScores.eloBrier));
  assert.ok(Number.isFinite(out.candidateEvidence.fixedMixtureEvidence));
  assert.ok(out.candidateEvidence.fixedMixtureEvidence>0);
  assert.equal(out.independentProfitabilityProven,false);
  assert.equal(out.bettingAuthorized,false);
  assert.equal(out.correlationAdjusted,false);
});
test('Tie, missing settlement, stale provider quote and revised result are never duplicates',()=>{
  const a=shot('a',0),b=shot('b',0),c=shot('c',0),d=shot('d',0);
  c.marketBookCount=2;
  const journal=makeJ([a,b,c,d],[
    final('a',0,1),final('a',1,2),
    {gameId:'b',gameDate:'2026-11-08',homeScore:14,awayScore:14,
     outcome:'TIE',revision:1,resultHash:'tie-b'}
  ]);
  const out=calculateSequentialEvidence(journal);
  assert.equal(out.allTrackedGames,4);
  assert.equal(out.firstQualifyingPregameGames,3);
  assert.equal(out.eligibleSettledNonTieGames,1);
  assert.equal(out.exclusions.tie,1);
  assert.equal(out.exclusions.noSettlement,1);
  assert.equal(out.exclusions.noEligiblePregameQuote,1);
  assert.equal(out.properScores,null);
  assert.equal(isEligibleFirstSnapshot(c),false);
  assert.equal(isEligibleFirstSnapshot(a),true);
  journal.settlements.push({...final('a',0,2),resultHash:'conflict'});
  assert.throws(()=>calculateSequentialEvidence(journal),/Contradictory finalized/);
});
test('No odds API credit: reuses source-safe derived feed, withholding performance under 30',async()=>{
  const journal=makeJ([shot('a',0,.5,.55),shot('a',30,.51,.55)],[final('a',1)]);
  let calls=0;
  const feed=createDerivedForwardMarketFeed({fetchImpl:async()=>{
    calls++;return new Response(JSON.stringify(journal),{status:200});
  },clock:()=>NOW});
  const one=await feed.get(),again=await feed.get();
  assert.equal(calls,1);
  assert.deepEqual(one,again);
  assert.equal(one.sequentialMarketEvidence.properScores,null);
  assert.equal(one.sequentialMarketEvidence.candidateEvidence.fixedMixtureEvidence,null);
  assert.equal(one.sequentialMarketEvidence.bettingAuthorized,false);
  assert.ok(!JSON.stringify(one).includes('bookmakerKey'));
});
test('Likelihood ratio arithmetic rejects invalid probabilities/outcomes and handles null',()=>{
  assert.equal(evidencePath(.5,.5,1),0);
  assert.equal(evidencePath(.5,.5,0),0);
  assert.ok(evidencePath(.5,.6,1)>0);
  assert.ok(evidencePath(.5,.6,0)<0);
  for(const [p,q,y] of [[0,.6,1],[.5,1,0],[.5,.6,2],[.4,NaN,0]]){
    assert.throws(()=>evidencePath(p,q,y),/Invalid synthetic/);
  }
});
test('1000 synthetic efficient-market worlds keep threshold crossings rare; signal injection improves detection',()=>{
  // Under idealized null p=.50 for every game, qE=.60, qC=.40 are
  // previsible. Simulated independent outcomes only; NOT real NFL edge.
  let seed=20261102;
  const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  function crossing(trueP){
    let hit=0;
    for(let world=0;world<1000;world++){
      let elo=0,other=0,ever=false;
      for(let n=0;n<150;n++){
        const y=rand()<trueP?1:0;
        elo+=evidencePath(.5,.6,y);
        other+=evidencePath(.5,.4,y);
        const max=Math.max(elo,other);
        const logMixture=max+Math.log((Math.exp(elo-max)+Math.exp(other-max))/2);
        if(logMixture>=Math.log(20))ever=true;
      }
      if(ever)hit++;
    }
    return hit;
  }
  const nullCrossing=crossing(.5),signalCrossing=crossing(.6);
  assert.ok(nullCrossing>=0&&nullCrossing<60);
  assert.ok(signalCrossing>nullCrossing+120);
  console.log('PRE-REGISTERED SYNTHETIC E-MONITOR: null crossings '+nullCrossing+
    '/1000; genuine injected p=0.6 signal crossings '+signalCrossing+'/1000'+
    ' over 150 independent outcomes, not NFL performance or investment results.');
});
