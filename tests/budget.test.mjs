import test from 'node:test';
import assert from 'node:assert/strict';
import { createOddsSource } from '../src/odds.mjs';

const START=Date.parse('2026-11-02T01:00:00Z');
const fixture=()=>new Response('[]',{status:200,headers:{
  'x-requests-remaining':'198','x-requests-used':'2','x-requests-last':'1'
}});

test('Twelve-credit budget configuration prevents a new paid request after the cap',async()=>{
  let current=START,calls=0;
  const source=createOddsSource({
    apiKey:'EXAMPLE_ONLY',clock:()=>current,ttlMs:5000,dailyCreditCap:2,
    reserveCredits:50,fetchImpl:async()=>{calls++;return fixture();}
  });
  await source.getOdds('americanfootball_nfl','h2h');
  await source.getOdds('basketball_nba','h2h');
  assert.equal(source.status().budget.used,2);
  await assert.rejects(source.getOdds('baseball_mlb','h2h'),{code:'API_DAILY_BUDGET'});
  assert.equal(calls,2);
  assert.equal((await source.getOdds('americanfootball_nfl','h2h')).cacheHit,true);
  assert.equal(calls,2);
  current+=86400000;
  await source.getOdds('baseball_mlb','h2h');
  assert.equal(source.status().budget.used,1);
  assert.equal(calls,3);
});

test('Provider credit reserve blocks new requests before quota exhaustion',async()=>{
  let calls=0;
  const source=createOddsSource({
    apiKey:'EXAMPLE_ONLY',clock:()=>START,ttlMs:5000,dailyCreditCap:10,
    reserveCredits:50,
    fetchImpl:async()=>{
      calls++;
      return new Response('[]',{status:200,headers:{
        'x-requests-remaining':'50','x-requests-last':'1'
      }});
    }
  });
  await source.getOdds('americanfootball_nfl','h2h');
  await assert.rejects(source.getOdds('basketball_nba','h2h'),{code:'PROVIDER_CREDIT_RESERVE'});
  assert.equal(calls,1);
  assert.equal((await source.getOdds('americanfootball_nfl','h2h')).cacheHit,true);
});

test('Scores reserve two credits by default and cache can avoid additional cost',async()=>{
  let calls=0;
  const source=createOddsSource({
    apiKey:'EXAMPLE_ONLY',clock:()=>START,ttlMs:5000,dailyCreditCap:2,
    reserveCredits:50,
    fetchImpl:async()=>{
      calls++;
      return new Response('[]',{status:200});
    }
  });
  await source.getScores('americanfootball_nfl');
  assert.equal(source.status().budget.used,2);
  assert.equal((await source.getScores('americanfootball_nfl')).cacheHit,true);
  await assert.rejects(source.getOdds('americanfootball_nfl','h2h'),{code:'API_DAILY_BUDGET'});
  assert.equal(calls,1);
});

test('Production interface never silently re-fetches paid odds on a two-minute timer',async()=>{
  const { readFile }=await import('node:fs/promises');
  const js=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.equal(js.includes("if (state.mode === 'live' && !document.hidden) loadSlate()"),false);
  assert.ok(js.includes('data-action'));
});


test('Explicit zero blocks odds and scores across concurrency, midnight and fresh instances',async()=>{
  let current=START,calls=0;
  const options={apiKey:'OFFLINE_FIXTURE',clock:()=>current,dailyCreditCap:0,
    fetchImpl:async()=>{calls++;return fixture();}};
  for(let instance=0;instance<2;instance++){
    const source=createOddsSource(options);
    for(let day=0;day<2;day++){
      const requests=Array.from({length:20},(_,index)=>index%2?
        source.getScores('americanfootball_nfl',{allowPaid:true}):
        source.getOdds('americanfootball_nfl','h2h',{allowPaid:true}));
      const results=await Promise.allSettled(requests);
      assert.ok(results.every(result=>result.status==='rejected'&&result.reason.code==='API_DAILY_BUDGET'));
      assert.equal(source.status().budget.limit,0);
      assert.equal(source.status().budget.used,0);
      assert.equal(source.status().budget.available,0);
      current+=86400000;
    }
  }
  assert.equal(calls,0);
});

test('Absent daily budget retains default, while explicit environment values fail closed',async(t)=>{
  const key='ODDS_DAILY_CREDIT_LIMIT',before=process.env[key];
  t.after(()=>{if(before===undefined)delete process.env[key];else process.env[key]=before;});
  let calls=0;
  const options={apiKey:'OFFLINE_FIXTURE',clock:()=>START,fetchImpl:async()=>{calls++;return fixture();}};
  delete process.env[key];
  const defaultSource=createOddsSource(options);
  assert.equal(defaultSource.status().budget.limit,12);
  await defaultSource.getOdds('americanfootball_nfl','h2h',{allowPaid:true});
  assert.equal(calls,1);
  for(const value of ['0',' 0 ','',' ','not-a-number','NaN','Infinity','-10','0.5']){
    process.env[key]=value;
    const source=createOddsSource(options);
    assert.equal(source.status().budget.limit,0,JSON.stringify(value));
    await assert.rejects(source.getOdds('americanfootball_nfl','h2h',{allowPaid:true}),{code:'API_DAILY_BUDGET'});
    await assert.rejects(source.getScores('americanfootball_nfl',{allowPaid:true}),{code:'API_DAILY_BUDGET'});
  }
  assert.equal(calls,1,'No explicit disabled/invalid configuration reaches even the mock provider');
  for(const [value,expected] of [['2',2],['12',12],['2.9',2],['500',100]]){
    process.env[key]=value;
    assert.equal(createOddsSource(options).status().budget.limit,expected);
  }
});

test('Invalid explicit numeric budget options fail closed rather than becoming twelve credits',async()=>{
  let calls=0;
  for(const dailyCreditCap of [NaN,Infinity,-Infinity,-1,null,false,'0',{},[]]){
    const source=createOddsSource({apiKey:'OFFLINE_FIXTURE',clock:()=>START,dailyCreditCap,
      fetchImpl:async()=>{calls++;return fixture();}});
    assert.equal(source.status().budget.limit,0);
    await assert.rejects(source.getOdds('americanfootball_nfl','h2h',{allowPaid:true}),{code:'API_DAILY_BUDGET'});
  }
  assert.equal(calls,0);
});
