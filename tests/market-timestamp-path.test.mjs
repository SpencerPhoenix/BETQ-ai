import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHandler} from '../src/server.mjs';
import {demoEvents} from '../src/demo.mjs';
import {analyzeEvents} from '../src/engine.mjs';
import {nflMoneylineConsensus} from '../src/market-consensus.mjs';
const now=Date.parse('2026-11-19T23:00:00Z'),stamp=new Date(now).toISOString();
const js=readFileSync(new URL('../public/game-card.js',import.meta.url),'utf8');
const ctx=vm.createContext({Date});
vm.runInContext(js.slice(js.indexOf('function selectCachedLines('),js.indexOf('function renderCachedLines(')),ctx);
function event(shape){
 const e=demoEvents('americanfootball_nfl',now)[0];
 e.id='12345678901234567890123456789012';
 for(const b of e.bookmakers){
  b.last_update=stamp;
  for(const m of b.markets){
   if(shape==='book-only')delete m.last_update;
   if(shape==='null')m.last_update=null;
   if(shape==='empty')m.last_update='';
   if(shape==='zone-missing')m.last_update='2026-11-19T22:59:00';
   if(shape==='calendar-invalid')m.last_update='2026-11-31T22:59:00Z';
   if(shape==='future')m.last_update=new Date(now+1).toISOString();
   if(shape==='stale')m.last_update=new Date(now-600001).toISOString();
  }
 }
 return e;
}
test('book-only quotes cannot pass engine while stricter consensus rejects them',()=>{
 const e=event('book-only'),before=JSON.stringify(e);
 assert.equal(nflMoneylineConsensus(e,{asOf:now,receivedAt:stamp}).available,false);
 for(const market of ['h2h','spreads','totals']){
  const a=analyzeEvents([e],{sport:'americanfootball_nfl',market,asOf:now,receivedAt:stamp});
  assert.equal(a.summary.signals,0,market);assert.equal(a.events[0].topSignal,null);
 }
 assert.equal(JSON.stringify(e),before);
});
test('raw cached payload through HTTP slate into game-card selector never invents market freshness',async t=>{
 let events=[],receivedAt=stamp,reads=0;
 const source={status:async()=>({configured:true}),getOdds:async()=>{reads++;return {events,receivedAt,cacheHit:true,quota:null};}};
 const server=http.createServer(createHandler({source,clock:()=>now}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const base='http://127.0.0.1:'+server.address().port;
 for(const shape of ['book-only','null','empty','zone-missing','calendar-invalid','future','stale','after-receipt','missing-receipt','future-receipt','fresh']){
  events=[event(shape)];
  receivedAt=shape==='after-receipt'?new Date(now-120000).toISOString():shape==='missing-receipt'?null:shape==='future-receipt'?new Date(now+1).toISOString():stamp;
  const original=JSON.stringify(events);
  for(const market of ['h2h','spreads','totals']){
   const response=await fetch(base+'/api/slate?mode=live&sport=americanfootball_nfl&market='+market);
   assert.equal(response.status,200);
   const slate=await response.json();
   const r={validUntil:new Date(now+300000).toISOString(),fixture:{home:events[0].home_team,away:events[0].away_team,kickoff:events[0].commence_time}};
   const quotes=ctx.selectCachedLines({[market]:slate},r,now).groups.flatMap(g=>g.quotes);
   if(shape==='fresh'){
    assert.ok(slate.events[0].opportunities.length>0);assert.ok(quotes.length>0);
    for(const q of quotes)assert.notEqual(q.quoteAt,stamp);
   }else{
    assert.equal(slate.events[0].opportunities.length,0,`${shape} ${market}`);
    assert.equal(quotes.length,0,`${shape} ${market} card`);
   }
   if(market==='h2h'&&shape!=='fresh')assert.equal(slate.events[0].marketConsensus.available,false,shape);
  }
  assert.equal(JSON.stringify(events),original);
 }
 assert.equal(reads,33);
});
