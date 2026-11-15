import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import http from 'node:http';
import {analyzeEvents} from '../src/engine.mjs';
import {demoEvents} from '../src/demo.mjs';
import {createHandler} from '../src/server.mjs';
const NOW=Date.parse('2026-11-07T13:00:00Z');
const source=await readFile(new URL('../public/game-strategies.js',import.meta.url),'utf8');
const context=vm.createContext({});vm.runInContext(source,context);
const api=context.BETQGameStrategies;
const fixture=(market='h2h')=>analyzeEvents(demoEvents('americanfootball_nfl',NOW),{market,sport:'americanfootball_nfl',asOf:NOW,demo:true}).events[0];
const options=(market='h2h',extra={})=>({market,mode:'demo',source:'SYNTHETIC_DEMO',receivedAt:new Date(NOW).toISOString(),now:NOW,...extra});
const live=market=>({...fixture(market),demo:false});
const liveOptions=market=>options(market,{mode:'live',source:'THE_ODDS_API_V4'});
const cards=r=>r.groups.flatMap(g=>g.cards);

test('All three strategy groups exist; missing markets never receive invented odds or probabilities',()=>{
  for(const market of ['h2h','spreads','totals']){
    const result=api.build(fixture(market),options(market));
    assert.equal(result.groups.length,3);assert.equal(cards(result).length,2);
    assert.ok(cards(result).every(c=>c.market===market));
    assert.ok(result.groups.filter(g=>g.market!==market).every(g=>g.cards.length===0&&/Not present/.test(g.unavailable)));
    assert.equal(result.status,'PASS');assert.equal(result.recommendedUnits,0);assert.equal(result.wagerRecommendation,false);
    assert.match(result.sourceLabel,/SYNTHETIC/);
  }
});
test('Both sides receive correct American-odds profit and conditional break-even arithmetic',()=>{
  const event=fixture();event.opportunities[0].americanOdds=150;event.opportunities[1].americanOdds=-200;
  const result=cards(api.build(event,options()));
  assert.equal(result[0].decimalOdds,2.5);assert.equal(result[0].profitPer100,150);assert.equal(result[0].breakEven,.4);
  assert.equal(result[1].decimalOdds,1.5);assert.equal(result[1].profitPer100,50);assert.equal(result[1].breakEven,2/3);
  assert.match(result[0].breakEvenBasis,/not a model confidence/);
});
test('Moneyline does not invent push or overtime rules',()=>{
  const result=cards(api.build(fixture(),options()));
  for(const card of result){assert.match(card.outcomes.win,/wins the quoted game period/);assert.match(card.outcomes.loss,/opposing team/);assert.match(card.outcomes.push,/tie is not assumed to push/);}
});
test('Spread signs, exact line equality and half-point push rules remain distinct',()=>{
  for(const point of [-3.5,-3,0,3,3.5]){
    const event=fixture('spreads');event.opportunities=event.opportunities.filter(q=>q.side==='home');
    Object.assign(event.opportunities[0],{point,contractId:'spread:'+point});
    const card=cards(api.build(event,options('spreads')))[0];
    assert.match(card.outcomes.win,/score minus opponent score/);
    assert.ok(card.outcomes.win.includes('plus '+(point>0?'+':'')+point));
    assert.match(card.outcomes.push,Number.isInteger(point)?/equals 0/:/No exact push/);
    assert.match(card.scenario,point<0?/wins by more than/:point>0?/close game/:/0-point/);
  }
});
test('Over and under explain inverse win/loss outcomes and integer-line pushes',()=>{
  for(const point of [47,47.5]){
    const event=fixture('totals');for(const q of event.opportunities)Object.assign(q,{point,contractId:'total:'+point});
    const result=cards(api.build(event,options('totals')));
    for(const card of result){
      assert.match(card.outcomes.win,card.side==='over'?/greater than/:/less than/);
      assert.match(card.outcomes.loss,card.side==='over'?/less than/:/greater than/);
      assert.match(card.outcomes.push,Number.isInteger(point)?/equals 47/:/No exact push/);
      assert.match(card.risk,/No validated total-score distribution/);
    }
  }
});
test('Unknown source, stale quote, stale receipt, missing time, future time and imminent kickoff fail closed',()=>{
  const event=live('h2h'),opts=liveOptions('h2h');
  assert.match(cards(api.build(event,opts))[0].sourceStatus,/within 10 minutes/);
  for(const [change,extra,pattern] of [
    [{},{source:'OTHER'},/unverified/],
    [{},{receivedAt:new Date(NOW-600001).toISOString()},/chronology invalid/],
    [{},{receivedAt:null},/missing/],
    [{},{receivedAt:new Date(NOW+1).toISOString()},/future-dated/],
    [{commenceTime:new Date(NOW+300000).toISOString()},{},/within 5 minutes/],
    [{started:true},{},/actual game status unverified/],
    [{},{now:NaN},/missing/],
  ])assert.match(cards(api.build({...event,...change},{...opts,...extra}))[0].sourceStatus,pattern);
  for(const [lastUpdated,pattern] of [[new Date(NOW-600001).toISOString(),/STALE/],[new Date(NOW+1).toISOString(),/future-dated/],[null,/missing/]]){
    const changed=structuredClone(event);changed.opportunities.forEach(q=>q.lastUpdated=lastUpdated);
    assert.match(cards(api.build(changed,opts))[0].sourceStatus,pattern);
  }
});
test('Demo source cannot be relabeled live by UI mode or fabricated validation flags',()=>{
  const event=fixture();event.independentModel={available:true,homeWinProbability:1};
  event.opportunities.forEach(q=>Object.assign(q,{status:'BET',executionAuthorized:true,independentModelValidated:true,recommendedUnits:10,qualityScore:99}));
  const result=api.build(event,liveOptions('h2h'));
  assert.match(result.sourceLabel,/SYNTHETIC/);assert.equal(result.recommendedUnits,0);
  assert.ok(cards(result).every(c=>c.status==='PASS'&&/SYNTHETIC DEMO/.test(c.sourceStatus)));
  const rendered=api.render(event,liveOptions('h2h'));assert.doesNotMatch(rendered,/100\.00%|99%|data-paper|data-pick|executionAuthorized/);
});
test('Wrong event, line, side, market, odds and duplicate conflicts are excluded rather than repaired',()=>{
  const mutations=[{eventId:'wrong'},{americanOdds:0},{americanOdds:99},{americanOdds:Infinity},{americanOdds:null},{bookmaker:''},{contractId:'spread:3.5'},{point:3.25},{side:'other'},{period:'first_half'}];
  for(const mutation of mutations){
    const event=fixture('spreads');event.opportunities=[{...event.opportunities[0],...mutation}];
    assert.equal(cards(api.build(event,options('spreads'))).length,0,JSON.stringify(mutation));
  }
  const event=fixture('h2h');event.opportunities=[event.opportunities[0],{...event.opportunities[0],americanOdds:500}];
  const result=api.build(event,options());assert.equal(cards(result).length,0);assert.equal(result.groups[0].rejected,2);
});
test('Retained dossier is educational only and does not turn archived derived probabilities into prices',()=>{
  const event=fixture();event.marketHomeProbability=.7;
  const result=api.build(event,options('h2h',{retained:true}));
  assert.equal(cards(result).length,0);assert.match(result.sourceLabel,/ARCHIVED/);
  assert.ok(result.groups.every(g=>/No sportsbook prices/.test(g.unavailable)));
  for(const value of [null,undefined,{}, {opportunities:'bad'}])assert.equal(cards(api.build(value,options())).length,0);
});
test('Rendering escapes source strings, supplies native disclosure semantics, and contains no wagering controls',()=>{
  const event=fixture();event.homeTeam='<img src=x onerror="evil()">';event.opportunities[0].bookmaker='<script>evil()</script>';
  const out=api.render(event,options());
  assert.doesNotMatch(out,/<img|<script|<button|<input|<form|data-paper|href=/);
  assert.match(out,/&lt;img/);assert.match(out,/&lt;script/);assert.match(out,/<details class="game-strategies"/);assert.match(out,/<summary>/);
  assert.match(out,/correlated/);assert.match(out,/Fees and taxes excluded/);
});
test('Refreshing updates body only, preserving disclosure node and checking clock without any network',()=>{
  const event=live('h2h'),out=api.render(event,liveOptions('h2h'));
  const key=JSON.stringify([false,'live','h2h','THE_ODDS_API_V4',event.id]);
  const content={innerHTML:out};const element={open:true,dataset:{strategyKey:key},querySelector:()=>content};
  api.refresh({querySelectorAll:()=>[element]},NOW+600001);
  assert.match(content.innerHTML,/STALE/);assert.equal(element.open,true);
  assert.doesNotMatch(source,/\bfetch\s*\(|XMLHttpRequest|localStorage|sendBeacon|WebSocket/);
});
test('Static strategy asset is allowlisted with CSP and never calls a provider',async t=>{
  let providerCalls=0;
  const server=http.createServer(createHandler({source:{getOdds(){providerCalls++;throw Error('Forbidden');},getScores(){providerCalls++;throw Error('Forbidden');},status:()=>({configured:false})},clock:()=>NOW}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
  const base='http://127.0.0.1:'+server.address().port;
  const response=await fetch(base+'/game-strategies.js');assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/javascript/);assert.match(response.headers.get('content-security-policy'),/script-src 'self'/);
  assert.equal(await response.text(),source);assert.equal(providerCalls,0);
});

test('All mounted panels age past freshness expiry even on slates exceeding 100 games',()=>{
  const elements=Array.from({length:101},(_,i)=>{
    const event=live('h2h');event.id='game-'+i;event.opportunities.forEach(q=>q.eventId=event.id);
    const content={innerHTML:api.render(event,liveOptions('h2h'))};
    return {dataset:{strategyKey:JSON.stringify([false,'live','h2h','THE_ODDS_API_V4',event.id])},
      content,querySelector:()=>content};
  });
  api.refresh({querySelectorAll:()=>elements},NOW+660000);
  for(const element of elements)assert.match(element.content.innerHTML,/STALE retained quote/);
  const content={innerHTML:'old fresh label'},missing={dataset:{strategyKey:'missing'},querySelector:()=>content};
  api.refresh({querySelectorAll:()=>[missing]},NOW+660000);
  assert.match(content.innerHTML,/freshness unverified/);assert.doesNotMatch(content.innerHTML,/old fresh label/);
});

function evaluatedEvent(){
  const event=live('h2h'),at=new Date(NOW).toISOString();
  event.marketConsensus={available:true,source:'THE_ODDS_API_V4',market:'h2h',method:'ALL_BOOKS_MEDIAN_DE_VIG',basis:'MARKET_DERIVED_NOT_INDEPENDENT',books:3,homeProbability:.6,awayProbability:.4,oldestQuoteAt:at,latestQuoteAt:at,snapshotAt:at};
  event.independentModel={available:true,method:'NFL_ELO_HISTORICAL_OUTCOMES',source:'NFLVERSE_SCHEDULES',independentOfOdds:true,use:'RESEARCH_ONLY',modelVersion:'fixture',modelBuiltAt:at,homeWinProbability:.55,awayWinProbability:.45};
  event.injuryContext={available:true,source:'NFLVERSE_INJURIES',sourceUpdatedAt:at,validUntil:new Date(NOW+3600000).toISOString(),home:{reported:true,count:2},away:{reported:false}};
  return event;
}
test('Evaluation distinguishes market estimates, independent research, exact price math and partial injury coverage',()=>{
  const event=evaluatedEvent(),r=api.build(event,liveOptions('h2h'));
  assert.equal(r.evaluation.market.home,.6);assert.equal(r.evaluation.model.home,.55);
  assert.equal(r.evaluation.injury.teams[1].reported,false);
  for(const c of cards(r)){
    const p=c.side==='home'?.55:.45;
    assert.equal(c.researchProbability,p);assert.equal(c.researchPriceGapPoints,(p-c.breakEven)*100);
  }
  const html=api.render(event,liveOptions('h2h'));
  assert.match(html,/Game evaluation at this check/);assert.match(html,/no team report/);
  assert.match(html,/not a verified edge/);assert.equal(r.status,'PASS');assert.equal(r.recommendedUnits,0);
});
test('Evaluation ages out all current claims and never bridges demo, archived, spread or conflicted games',()=>{
  for(const opts of [options(),{...liveOptions('h2h'),retained:true},liveOptions('spreads'),{...liveOptions('h2h'),now:NOW+600001}]){
    const r=api.build(evaluatedEvent(),opts);
    assert.equal(r.evaluation.market,null);assert.equal(r.evaluation.model,null);assert.equal(r.evaluation.injury,null);
  }
  for(const status of ['SCHEDULE_RECONCILIATION_REQUIRED','SCHEDULE_REVIEW_IDENTITY_MISMATCH']){
    const event=evaluatedEvent();event.scheduleReview={status};
    assert.equal(api.build(event,liveOptions('h2h')).evaluation.market,null);
  }
});
test('Malformed consensus, model and injury provenance fail independently without replacing missing evidence',()=>{
  for(const patch of [{books:2},{homeProbability:.7},{oldestQuoteAt:new Date(NOW-600001).toISOString()},{latestQuoteAt:new Date(NOW+1).toISOString()},{source:'OTHER'},{snapshotAt:null}]){
    const event=evaluatedEvent();Object.assign(event.marketConsensus,patch);
    const r=api.build(event,liveOptions('h2h'));assert.equal(r.evaluation.market,null);assert.ok(r.evaluation.model);
  }
  for(const patch of [{homeWinProbability:NaN},{awayWinProbability:.1},{use:'PRODUCTION'},{modelBuiltAt:new Date(NOW+1).toISOString()},{independentOfOdds:false}]){
    const event=evaluatedEvent();Object.assign(event.independentModel,patch);
    assert.equal(api.build(event,liveOptions('h2h')).evaluation.model,null);
  }
  const event=evaluatedEvent();event.injuryContext.validUntil=new Date(NOW).toISOString();
  assert.equal(api.build(event,liveOptions('h2h')).evaluation.injury,null);
});
test('A stale or future individual price cannot acquire a current research edge from fresh game metadata',()=>{
  for(const at of [NOW-600001,NOW+1]){
    const event=evaluatedEvent();event.opportunities[0].lastUpdated=new Date(at).toISOString();
    const r=api.build(event,liveOptions('h2h'));
    assert.equal(cards(r)[0].researchProbability,null);assert.equal(cards(r)[0].researchPriceGapPoints,null);
  }
});
