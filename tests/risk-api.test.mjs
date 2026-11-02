import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHandler} from '../src/server.mjs';
const artifact={
  schema:1,version:'betq-risk-research-v1',model:'ORIGINAL_FROZEN_ELO_3PCT_EV_GATE',
  verifiedROI:null,verifiedCLV:null,bettingAuthorized:false,
  historicalPriceTimeVerified:false,historicalWeekBlocks:70,historicalEligibleDecisions:879,
  scenarios:[{
    label:'BASELINE_CONDITIONAL_RESAMPLE_1_PERCENT_RISK',
    result:{type:'CONDITIONAL_WEEK_BLOCK_BOOTSTRAP',iterations:10000,seed:11,
      endingBankrollReturnPercent:{p05:-80,median:-55,p95:-30},
      frequencyCrossingPracticalRuinPercent:60,pathMaxDrawdownPercent:{p95:80},
      startingBankroll:100,practicalRuinThreshold:50,stakePercent:1,
      exactRealWorldRiskOfRuin:null,verifiedHistoricalROI:null,verifiedCLV:null,
      providerPriceTimeVerified:false,bettingAuthorized:false}
  }]
};
async function serve(testFn,scenario=artifact){
  let paid=0;
  const source={
    status:()=>({configured:true}),
    getOdds:async()=>{paid++;throw Error('Paid odds not allowed');},
    getScores:async()=>{paid++;throw Error('Paid scores not allowed');}
  };
  const server=http.createServer(createHandler({source,riskReport:scenario}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await testFn('http://127.0.0.1:'+server.address().port,()=>paid);}
  finally{await new Promise(resolve=>server.close(resolve));}
}
test('Conditional bankroll stress endpoint is source-restricted, free and never claims verified ROI',async()=>{
  await serve(async(base,paid)=>{
    const r=await fetch(base+'/api/risk/nfl');
    assert.equal(r.status,200);
    const result=await r.json();
    assert.equal(result.available,true);
    assert.equal(result.exactRealWorldRiskOfRuin,null);
    assert.equal(result.verifiedROI,null);
    assert.equal(result.verifiedCLV,null);
    assert.equal(result.bettingAuthorized,false);
    assert.equal(result.historicalPriceTimeVerified,false);
    assert.equal(result.scenarios[0].result.frequencyCrossingPracticalRuinPercent,60);
    assert.equal(paid(),0);
  });
});
test('Missing stress file returns explicit unavailable, not invented zero risk',async()=>{
  await serve(async(base,paid)=>{
    const r=await fetch(base+'/api/risk/nfl');
    const result=await r.json();
    assert.equal(r.status,200);
    assert.equal(result.available,false);
    assert.equal(result.verifiedROI,null);
    assert.equal(result.verifiedCLV,null);
    assert.equal(result.exactRealWorldRiskOfRuin,null);
    assert.equal(paid(),0);
  },null);
});
test('Browser automatically reads free stress endpoint and labels assumption conditional',async()=>{
  const {readFile}=await import('node:fs/promises');
  const js=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(js,/requestJSON\('\/api\/risk\/nfl'\)/);
  assert.match(js,/loadRiskStress\(\)/);
  assert.match(js,/renderRiskStress\(\)/);
  assert.match(html,/id="risk-stress-view"/);
  assert.match(js,/does not measure an exact.*real-world probability of ruin/i);
  assert.match(js,/conditional on the/);
});
