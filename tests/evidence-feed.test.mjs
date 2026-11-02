import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createEvidenceFeed, isValidEvidenceSummary } from '../src/evidence-feed.mjs';
import { summarizeEvidence, emptyJournal } from '../src/evidence.mjs';
import { createHandler } from '../src/server.mjs';

const NOW=Date.parse('2026-11-02T01:00:00Z');
const example=summarizeEvidence(emptyJournal(2026),NOW);

test('Public evidence feed validates schema, coalesces concurrent requests and caches for five minutes',async()=>{
  let time=NOW,calls=0;
  const report={...example,prospectiveGames:2,totalSnapshots:3};
  const feed=createEvidenceFeed({
    fallback:example,clock:()=>time,ttlMs:300000,
    fetchImpl:async()=>{calls++;return new Response(JSON.stringify(report),{status:200});}
  });
  const results=await Promise.all(Array.from({length:40},()=>feed.get()));
  assert.equal(calls,1);
  assert.ok(results.every(x=>x.prospectiveGames===2));
  await feed.get();
  assert.equal(calls,1);
  time+=300001;
  await feed.get();
  assert.equal(calls,2);
  assert.equal(feed.status().lastError,null);
});
test('Unsafe fabricated ROI/CLV reports are rejected and do not replace safe fallback',async()=>{
  assert.equal(isValidEvidenceSummary({...example,realizedROI:0.9}),false);
  assert.equal(isValidEvidenceSummary({...example,verifiedCLV:0.2}),false);
  assert.equal(isValidEvidenceSummary({...example,marketBeatingEdgeEstablished:true}),false);
  assert.equal(isValidEvidenceSummary({...example,forwardMetrics:{brier:0.1}}),false);
  const feed=createEvidenceFeed({fallback:example,fetchImpl:async()=>new Response(
    JSON.stringify({...example,realizedROI:0.99}),{status:200})});
  const result=await feed.get();
  assert.deepEqual(result,example);
  assert.equal(feed.status().lastError,'PUBLICATION_UNAVAILABLE_OR_INVALID');
});
test('Evidence API gives a derived summary without querying paid odds',async(t)=>{
  let paid=0;
  const source={
    status:()=>({configured:false}),getOdds:async()=>{paid++;return{};},
    getScores:async()=>{paid++;return{};}
  };
  const evidenceFeed={get:async()=>example,status:()=>({})};
  const server=http.createServer(createHandler({source,evidenceFeed,clock:()=>NOW,nflEvidence:example}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>server.close());
  const base='http://127.0.0.1:'+server.address().port;
  const response=await fetch(base+'/api/evidence/nfl');
  assert.equal(response.status,200);
  const payload=await response.json();
  assert.equal(payload.prospectiveGames,0);
  assert.equal(payload.realizedROI,null);
  assert.equal(paid,0);
  assert.match(response.headers.get('content-security-policy'),/default-src/);
});
