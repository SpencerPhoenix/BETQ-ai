import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  summarizeDerivedForwardMarkets,createDerivedForwardMarketFeed
} from '../src/shadow-derived.mjs';
import {createHandler} from '../src/server.mjs';

const T=Date.parse('2026-11-03T12:00:00.000Z');
const iso=n=>new Date(n).toISOString();
const observation=(id,minutes,p,game='2026_09_DEMO_A_B')=>({
  id,gameId:game,season:2026,
  home:'B',away:'A',
  gameDate:'2026-11-08',
  commenceTime:iso(T+5*86400000),
  capturedAt:iso(T+minutes*60000),
  sourceReceivedAt:iso(T+minutes*60000-1000),
  modelHomeProbability:.58,marketHomeProbability:p,
  marketBasis:'NO_VIG_MULTI_BOOK_MEDIAN',researchOnly:true,
  independentModel:true
});
const journal=(snapshots)=>({
  schema:1,season:2026,sport:'americanfootball_nfl',
  provenance:{market:'THE_ODDS_API_V4_DERIVED'},
  snapshots,settlements:[]
});
test('Derived journal summarizes real capture-to-capture changes but not news, fills or CLV',()=>{
  const sample=journal([
    observation('a',0,.52),
    observation('b',10,.56),
    observation('c',20,.55),
    observation('d',20,.49,'2026_09_FOO_BAR'),
    observation('e',25,.47,'2026_09_FOO_BAR')
  ]);
  const r=summarizeDerivedForwardMarkets(sample);
  assert.equal(r.source,'BETQ_PROSPECTIVE_DERIVED_ONLY');
  assert.equal(r.snapshotMarketAvailable,5);
  assert.equal(r.pricedGames,2);
  assert.equal(r.gamesWithMultipleSeparatedSnapshots,1);
  assert.equal(r.preview[0].matchup,'A @ B');
  assert.equal(r.preview[0].observedChangePoints,3);
  assert.equal(r.preview[0].elapsedMinutes,20);
  assert.equal(r.qbNewsVerified,false);
  assert.equal(r.qbTimingLinked,false);
  assert.equal(r.actualMarketOfferVerified,false);
  assert.equal(r.verifiedCLV,null);
  assert.equal(r.realMoneyROI,null);
  assert.equal(r.licensedRawBookmakerQuotesIncluded,false);
});
test('Same-time or less-than-ten-minute repeats cannot create a market trend',()=>{
  const r=summarizeDerivedForwardMarkets(journal([
    observation('a',0,.5),
    observation('b',0,.6),
    observation('c',9,.7)
  ]));
  assert.equal(r.pricedGames,1);
  assert.equal(r.gamesWithMultipleSeparatedSnapshots,0);
  assert.equal(r.medianObservedAbsoluteMovementPoints,null);
});
test('Derived feed fetches only fixed public-safe journal, caches and rejects raw-odds contamination',async()=>{
  let calls=0,now=T;
  const fake=async url=>{
    calls++;assert.equal(url,
      'https://raw.githubusercontent.com/SpencerPhoenix/BETQ-ai/main/data/evidence/nfl-2026.json');
    return new Response(JSON.stringify(journal([
      observation('a',0,.50),observation('b',20,.51)
    ])),{status:200});
  };
  const feed=createDerivedForwardMarketFeed({fetchImpl:fake,clock:()=>now,ttlMs:120000});
  const a=await feed.get(),b=await feed.get();
  assert.equal(a.available,true);
  assert.deepEqual(a,b);
  assert.equal(calls,1);
  now+=180000;
  await feed.get();
  assert.equal(calls,2);
  let badCalls=0;
  const bad=createDerivedForwardMarketFeed({fetchImpl:async()=>{
    badCalls++;
    const contaminated=journal([observation('x',0,.5)]);
    contaminated.snapshots[0].americanOdds=-110;
    return new Response(JSON.stringify(contaminated),{status:200});
  }});
  const r=await bad.get();
  assert.equal(r.available,false);
  assert.equal(r.verifiedCLV,null);
  assert.equal(badCalls,1);
});
test('Public derived status route is free, read-only and source restricted',async()=>{
  let odds=0,reads=0;
  const fakeSource={
    status:()=>({configured:false}),
    getOdds:async()=>{odds++;throw Error('Should not use paid odds provider');},
    getScores:async()=>{odds++;throw Error('Should not use paid scores provider');}
  };
  const derived={get:async()=>{reads++;return summarizeDerivedForwardMarkets(
    journal([observation('x',0,.5),observation('y',15,.51)])
  );}};
  const server=http.createServer(createHandler({
    source:fakeSource,derivedShadowFeed:derived
  }));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const base='http://127.0.0.1:'+server.address().port;
    const response=await fetch(base+'/api/shadow/derived');
    assert.equal(response.status,200);
    const data=await response.json();
    assert.equal(data.gamesWithMultipleSeparatedSnapshots,1);
    assert.equal(data.licensedRawBookmakerQuotesIncluded,false);
    assert.equal(data.wageringAuthorized,false);
    assert.equal(reads,1);assert.equal(odds,0);
    assert.equal((await fetch(base+'/api/shadow/derived',{method:'POST'})).status,405);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
