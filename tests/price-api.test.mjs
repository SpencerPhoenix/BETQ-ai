import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHandler } from '../src/server.mjs';

async function serve(fn){
  let paid=0;
  const source={
    status:()=>({configured:false,budget:{limit:12}}),
    getOdds:async()=>{paid++;throw Error('Paid API called from price calculator');},
    getScores:async()=>{paid++;throw Error('Paid API called from price calculator');}
  };
  const server=http.createServer(createHandler({source}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const base='http://127.0.0.1:'+server.address().port;
    await fn(base,()=>paid);
  }finally{await new Promise(resolve=>server.close(resolve));}
}
test('Illustrative ROI / CLV API is read-only and does not consume any paid credits',async()=>{
  await serve(async(base,paid)=>{
    const response=await fetch(base+
      '/api/price/illustration?entry=-110&close=-125&closingOpposite=%2B115&stake=110&result=WIN');
    const body=await response.json();
    assert.equal(response.status,200);
    assert.equal(body.type,'ILLUSTRATIVE_PRICE_MATH');
    assert.equal(body.verifiedCLV,false);
    assert.equal(body.verifiedROI,false);
    assert.equal(body.settlement.netProfit,100);
    assert.equal(body.settlement.risked,110);
    assert.ok(body.rawCLVPercent>6.05&&body.rawCLVPercent<6.07);
    assert.ok(body.noVigCLVPercent>0);
    assert.equal(paid(),0);
    const status=await (await fetch(base+'/api/price/verification')).json();
    assert.equal(status.verifiedROI,null);
    assert.equal(status.verifiedCLV,null);
    assert.equal(status.performanceClaimsAllowed,false);
    assert.equal(paid(),0);
  });
});
test('API rejects invalid odds/denominator/unknown inputs/side effects',async()=>{
  await serve(async(base,paid)=>{
    const params=[
      '?entry=-50&close=-125&stake=100&result=WIN',
      '?entry=%2B110&close=0&stake=100&result=WIN',
      '?entry=foo&close=-125&stake=100&result=WIN',
      '?entry=-110&close=-125&stake=-10&result=WIN',
      '?entry=-110&close=-125&stake=10.123&result=WIN',
      '?entry=-110&close=-125&stake=100&result=UNKNOWN',
      '?entry=-110&close=-125&stake=100&result=WIN&url=https%3A%2F%2Fexample.com',
      '?close=-125&stake=100&result=WIN'
    ];
    for(const p of params){
      const r=await fetch(base+'/api/price/illustration'+p);
      assert.equal(r.status,400,p);
    }
    assert.equal((await fetch(base+'/api/price/illustration',{method:'POST'})).status,405);
    assert.equal(paid(),0);
  });
});
