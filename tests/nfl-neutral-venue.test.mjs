import test from 'node:test';
import assert from 'node:assert/strict';
import { predictNflEvent, MODEL_VERSION, eloProbability } from '../src/nfl-elo.mjs';

const now=Date.parse('2026-11-01T20:00:00Z');
const event={home_team:'Kansas City Chiefs',away_team:'Las Vegas Raiders',
  commence_time:'2026-11-02T20:00:00Z'};
const artifact={schema:1,version:MODEL_VERSION,readyForResearch:true,
  generatedAt:'2026-11-01T19:00:00Z',lastGameDate:'2026-10-25',
  params:{homeAdv:55,scale:1},ratings:{KC:1500,LV:1500},
  holdout:{n:280,brier:0.23,ece:0.04}};

test('Explicit neutral venues remove home advantage without promoting the model',()=>{
  const result=predictNflEvent({...event,neutralSite:true},artifact,now);
  assert.equal(result.available,true);
  assert.equal(result.homeWinProbability,0.5);
  assert.equal(result.awayWinProbability,0.5);
  assert.equal(result.use,'RESEARCH_ONLY');
});

test('Explicit home venues and omitted venue flags retain the baseline assumption',()=>{
  const expected=Number(eloProbability(1500,1500,55,false).toFixed(6));
  for(const input of [event,{...event,neutralSite:false}]){
    const result=predictNflEvent(input,artifact,now);
    assert.equal(result.available,true);
    assert.equal(result.homeWinProbability,expected);
    assert.ok(result.homeWinProbability>0.5);
  }
});

test('Malformed neutral flags fail closed rather than using JavaScript truthiness',()=>{
  for(const neutralSite of ['false','true','',0,1,null,[],{},['false']]){
    const result=predictNflEvent({...event,neutralSite},artifact,now);
    assert.deepEqual(result,{available:false,reason:'INVALID_NEUTRAL_SITE'});
  }
});
