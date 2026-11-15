import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {
  SHADOW_SCHEMA,normalizeOwnedOddsSnapshot,makeQBCandidateNews,
  reviewQBCandidate,isPublicSafeShadowSummary
} from '../src/shadow-latency.mjs';
import {evaluateQBLatency,syntheticQBStudyFixture} from '../src/shadow-study.mjs';
import {
  disabledShadowStore,configuredShadowStore,postgresShadowStore
} from '../src/shadow-store.mjs';

const NOW=Date.parse('2026-11-04T18:00:00.000Z');
const iso=x=>new Date(x).toISOString();
const home='Baltimore Ravens',away='Cincinnati Bengals';
const goodEvent={
  id:'shadow-nfl-test-event',sport_key:'americanfootball_nfl',
  home_team:home,away_team:away,commence_time:iso(NOW+5*3600000),
  bookmakers:[
    {key:'a',markets:[{key:'h2h',last_update:iso(NOW-25000),
      outcomes:[{name:home,price:-120},{name:away,price:+110}]}]},
    {key:'b',markets:[{key:'h2h',last_update:iso(NOW-30000),
      outcomes:[{name:home,price:-125},{name:away,price:+115}]}]},
    {key:'c',markets:[{key:'h2h',last_update:iso(NOW-40000),
      outcomes:[{name:home,price:-130},{name:away,price:+120}]}]}
  ]
};
const snap=(events=[goodEvent],cacheHit=false,receivedAt=iso(NOW))=>({
  events,cacheHit,receivedAt,quota:{remaining:100}
});
const config={now:NOW};

test('Owned provider snapshot yields deterministic private record identities, correctly separated timestamps',()=>{
  const first=normalizeOwnedOddsSnapshot(snap(),config);
  const second=normalizeOwnedOddsSnapshot(snap(),config);
  assert.deepEqual(first,second);
  assert.equal(first.records.length,3);
  assert.equal(first.scanned,3);
  assert.equal(first.rejected,0);
  for(const r of first.records){
    assert.equal(r.schema,SHADOW_SCHEMA);
    assert.equal(r.firstObservedAt,iso(NOW));
    assert.equal(r.realWagerFillVerified,false);
    assert.equal(r.quoteProvenance,'ODDS_PROVIDER_MARKET_UPDATE_NOT_EXECUTABLE_OFFER');
    assert.equal(r.market,'h2h');
    assert.equal(r.period,'FULL_GAME');
    assert.equal(r.exactLine,null);
    assert.ok(r.sourceMarketUpdatedAt<r.firstObservedAt);
    assert.ok(Math.abs(r.fairHomeProbability+r.fairAwayProbability-1)<1e-6);
    assert.match(r.recordId,/^[a-f0-9]{64}$/);
    assert.match(r.payloadDigest,/^[a-f0-9]{64}$/);
  }
});
test('Cached responses cannot masquerade as new, first-seen sportsbook observations',()=>{
  assert.equal(normalizeOwnedOddsSnapshot(snap([goodEvent],true),config).records.length,0);
  assert.equal(normalizeOwnedOddsSnapshot(snap([goodEvent],false,iso(NOW-1000000)),config).records.length,0);
  assert.equal(normalizeOwnedOddsSnapshot(snap([goodEvent],false,iso(NOW+70000)),config).records.length,0);
  assert.equal(normalizeOwnedOddsSnapshot(snap(),{sport:'basketball_nba',now:NOW}).records.length,0);
  assert.equal(normalizeOwnedOddsSnapshot(snap(),{market:'spreads',now:NOW}).records.length,0);
  assert.throws(()=>normalizeOwnedOddsSnapshot(snap(Array.from({length:151},()=>goodEvent)),config),/snapshot/);
});
test('Malformed duplicate bookmaker IDs and impossible quote time/market prices are excluded',()=>{
  const e=structuredClone(goodEvent);
  e.bookmakers.push(structuredClone(e.bookmakers[0]));
  e.bookmakers[1].markets[0].last_update=iso(NOW+120000);
  e.bookmakers[2].markets[0].outcomes[0].price=99;
  const r=normalizeOwnedOddsSnapshot(snap([e]),config);
  assert.equal(r.records.length,1);
  assert.equal(r.rejected,3);
  assert.equal(r.records[0].bookmakerKey,'a');
  const post=structuredClone(goodEvent);post.commence_time=iso(NOW+60000);
  assert.equal(normalizeOwnedOddsSnapshot(snap([post]),config).records.length,0);
});
test('Official QB news is a candidate only; later publication time cannot backdate owned firstSeen',()=>{
  const input={
    eventId:'shadow-nfl-test-event',team:home,qbName:'Fictional Player',
    status:'OUT',sourceKind:'NFL_OFFICIAL',
    sourceUrl:'https://www.nfl.com/news/example-official',
    sourcePublishedAt:iso(NOW-86400000),
    kickoffAt:iso(NOW+5*3600000)
  };
  const r=makeQBCandidateNews(input,{observedAt:NOW});
  assert.equal(r.firstObservedAt,iso(NOW));
  assert.equal(r.sourcePublishedAt,iso(NOW-86400000));
  assert.equal(r.firstPublicationVerified,false);
  assert.equal(r.startingQuarterbackConfirmed,false);
  assert.equal(r.verificationStatus,'AWAITING_INDEPENDENT_SOURCE_REVIEW');
  assert.throws(()=>makeQBCandidateNews({...input,sourceUrl:'http://evil.invalid/news'},{observedAt:NOW}),/QB candidate/);
  assert.throws(()=>makeQBCandidateNews({...input,sourceUrl:'https://unverified.example/news'},{observedAt:NOW}),/QB candidate/);
  assert.throws(()=>makeQBCandidateNews({...input,sourcePublishedAt:iso(NOW+500000)},{observedAt:NOW}),/QB candidate/);
  assert.throws(()=>makeQBCandidateNews({...input,status:'CERTAIN_WIN'},{observedAt:NOW}),/QB candidate/);
  assert.throws(()=>reviewQBCandidate(r,{reviewerId:'rev',sourceEvidenceDigest:'a'.repeat(64),
    reviewedAt:NOW-1000}),/review/);
  const reviewed=reviewQBCandidate(r,{
    reviewerId:'AuthorizedHuman',sourceEvidenceDigest:'a'.repeat(64),
    reviewedAt:NOW+120000
  });
  assert.equal(reviewed.reviewStatus,'OFFICIAL_SOURCE_REVIEWED');
  assert.equal(reviewed.determination,'SOURCE_REVIEW_ONLY_NOT_STARTER_CERTAINTY');
  assert.equal(reviewed.genuineMarketEdgeEstablished,false);
});
test('Fictional no-cost QB-event study uses post-review timing and matched controls',()=>{
  const data=syntheticQBStudyFixture();
  const out=evaluateQBLatency(data);
  assert.equal(out.synthetic,true);
  assert.equal(out.nQBEventsEligible,1);
  assert.equal(out.newsCandidatesSubmitted,1);
  assert.equal(out.studyWindow.requiresMatchedNoNewsControls,true);
  assert.equal(out.timingInterpretation,'COLLECTOR_FIRST_SEEN_AFTER_HUMAN_REVIEW_NOT_PUBLICATION_TIME');
  assert.ok(out.outcome.median60mQBTeamMovementPoints>0);
  assert.ok(out.outcome.medianObservedMaterialMoveLatencyMinutes>=3);
  assert.equal(out.events.length,0); // k-anonymous public reporting gate
  assert.equal(out.sampleSizeGate,'TOO_FEW_EVENTS_TO_REPORT_REAL_EFFECT');
  assert.equal(out.realWorldExecutionVerified,false);
  assert.equal(out.causalEffectEstablished,undefined);
  assert.equal(out.verifiedCLV,null);
});
test('Missing controls or unreviewed QB source suppresses the historical effect',()=>{
  const data=syntheticQBStudyFixture();
  assert.equal(evaluateQBLatency({...data,controlGameIds:[]}).nQBEventsEligible,0);
  assert.equal(evaluateQBLatency({...data,reviews:[]}).nQBEventsEligible,0);
  const suspicious=structuredClone(data);
  suspicious.newsCandidates[0].status='QUESTIONABLE';
  assert.equal(evaluateQBLatency(suspicious).nQBEventsEligible,0);
});
test('Disabled archive never accidentally uses memory, another database or public GitHub',async()=>{
  const s=disabledShadowStore();
  const status=await s.status();
  assert.equal(status.available,false);
  assert.equal(status.durableStorage,false);
  assert.equal(status.rawBookmakerQuotesExposed,false);
  assert.equal(status.realMoneyROI,null);
  assert.equal((await s.capture(snap(),config)).inserted,0);
  assert.equal(isPublicSafeShadowSummary(status),true);
  const misconfigured=configuredShadowStore({env:{
    BETQ_SHADOW_CAPTURE_ENABLED:'true',BETQ_SHADOW_LICENSE_REVIEWED:'true',
    BETQ_SHADOW_DATABASE_URL:'postgresql://user:password@db/trading_agent_history_dev'
  }});
  assert.equal((await misconfigured.status()).available,false);
});
test('Private database adapters use transactions and idempotent parameterized inserts',async()=>{
  const inserted=new Set(),commands=[],rows=[];
  const client={
    async query(sql,params){
      commands.push({sql,params});
      if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rowCount:0};
      if(sql.includes('quote_observations')&&sql.includes('INSERT INTO')){
        let added=0;
        assert.equal(params.length%15,0);
        for(let i=0;i<params.length;i+=15){
          const values=params.slice(i,i+15),key=values[0];
          if(inserted.has(key))continue;
          inserted.add(key);rows.push(values);added++;
        }
        return{rowCount:added};
      }
      return{rowCount:0};
    },
    release(){commands.push({sql:'RELEASE'});}
  };
  const pool={
    async query(sql){
      if(sql.includes('count(*)'))return{rows:[{
        quote_rows:rows.length,qb_candidates:0,qb_reviews:0
      }]};
      return{rows:[],rowCount:1};
    },
    async connect(){return client;}
  };
  const store=postgresShadowStore(pool);
  const first=await store.capture(snap(),config);
  const second=await store.capture(snap(),config);
  assert.equal(first.inserted,3);
  assert.equal(second.inserted,0);
  assert.equal(rows.length,3);
  assert.ok(commands.some(c=>c.sql==='BEGIN'));
  assert.ok(commands.some(c=>c.sql==='COMMIT'));
  assert.equal(commands.filter(c=>c.sql==='RELEASE').length,2);
  assert.ok(commands.filter(c=>c.params).every(c=>!c.sql.includes("'Baltimore Ravens'")));
  const status=await store.status();
  assert.equal(status.recordedQuoteRevisions,3);
  assert.equal(status.available,true);
  assert.equal(status.rawBookmakerQuotesExposed,false);
  const news=makeQBCandidateNews({
    eventId:goodEvent.id,team:home,qbName:'Fictional Player',status:'OUT',
    sourceKind:'NFL_OFFICIAL',sourceUrl:'https://www.nfl.com/news/example',
    kickoffAt:iso(NOW+5*3600000)
  },{observedAt:NOW});
  const saved=await store.appendQBCandidate(news);
  assert.equal(saved.inserted,1);
  const approval=reviewQBCandidate(news,{reviewerId:'Human',
    reviewedAt:NOW+1000,sourceEvidenceDigest:'f'.repeat(64)});
  assert.equal((await store.appendQBReview(approval)).inserted,1);
  const aggregate=await store.analysis();
  assert.equal(aggregate.available,false);
  assert.equal(aggregate.rawBookmakerQuotesExposed,false);
  assert.equal(aggregate.causalityEstablished,false);
});
test('Adversarial 10000 malformed or cached quote variations never escape source and timestamp gates',()=>{
  let seed=27611;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  for(let i=0;i<10000;i++){
    const evt=structuredClone(goodEvent);
    const mode=i%5;
    if(mode===0)evt.bookmakers[0].markets[0].outcomes[1].price=NaN;
    if(mode===1)evt.bookmakers[0].markets[0].last_update=iso(NOW+100000+rand()*1000);
    if(mode===2)evt.bookmakers[0].markets[0].outcomes[0].name=away;
    if(mode===3)evt.commence_time=iso(NOW-3600000);
    if(mode===4)evt.bookmakers[0].key=''.padEnd(81,'x');
    const normalized=normalizeOwnedOddsSnapshot(snap([evt]),config);
    assert.ok(normalized.records.length<=2);
    assert.ok(normalized.records.every(x=>x.realWagerFillVerified===false));
  }
});

test('Private capture survives active connection failure and discards the failed client',async()=>{
  let discard;
  const client=new EventEmitter();
  client.release=flag=>{discard=flag;};
  client.query=async sql=>{
    if(sql==='COMMIT'){client.emit('error',Error('offline active failure'));throw Error('offline COMMIT acknowledgement lost');}
    return {rows:[],rowCount:3};
  };
  const store=postgresShadowStore({query:async()=>({rows:[]}),connect:async()=>client});
  await assert.rejects(store.capture(snap(),config),/PRIVATE_SHADOW_WRITE_FAILED/);
  assert.equal(discard,true);
  assert.doesNotThrow(()=>client.emit('error',Error('offline late failure')));
});
