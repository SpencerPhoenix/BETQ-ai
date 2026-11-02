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
