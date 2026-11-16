/* Retained research display only. No model execution, odds collection or betting actions. */
(() => {
  'use strict';
  const DAY=86400000, CAPTURE_DISPLAY_AGE=DAY;
  const contexts=new WeakMap(), requests=new WeakMap();
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const instant=v=>typeof v==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString()===v ? Date.parse(v) : NaN;
  const day=v=>typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(instant(v+'T00:00:00.000Z'));
  const probability=v=>typeof v==='number' && Number.isFinite(v) && v>=0 && v<=1;
  const text=v=>typeof v==='string' && v.length>0 && v.length<=200;
  const percent=v=>(v*100).toFixed(1)+'%';
  const optionalTime=v=>v===null || Number.isFinite(instant(v));
  const same=(a,b)=>['gameId','season','home','away','gameDate','commenceTime'].every(k=>a[k]===b[k]);
  // Legacy responses can omit quarantine. Present metadata must be complete and
  // consistent before any associated forecasts or scoring counts are displayed.
  function quarantineValid(q,visibleGames=[],total=null) {
    if(q===undefined)return true;
    const count=v=>Number.isSafeInteger(v)&&v>=0;
    if(!q||q.policy!=='FROZEN_SCHEDULE_CONFLICT_QUARANTINE_V1'||q.historyPreserved!==true||
      !['rawGameCount','rawSnapshotCount','rawResultCount','excludedGameCount','excludedSnapshotCount','excludedResultCount'].every(k=>count(q[k]))||
      !Array.isArray(q.games)||q.games.length!==q.excludedGameCount||
      q.excludedGameCount>q.rawGameCount||q.excludedSnapshotCount>q.rawSnapshotCount||q.excludedResultCount>q.rawResultCount||
      q.rawSnapshotCount<q.rawGameCount||
      !Array.isArray(visibleGames)||(total!==null&&total!==q.rawGameCount-q.excludedGameCount))return false;
    if(total!==null){
      if(!visibleGames.every(g=>count(g?.snapshotCount)&&g.snapshotCount>0))return false;
      const shown=visibleGames.reduce((sum,g)=>sum+g.snapshotCount,0),remaining=q.rawSnapshotCount-q.excludedSnapshotCount;
      if(shown>remaining||(visibleGames.length===total&&shown!==remaining))return false;
    }
    const ids=new Set();let snapshots=0,results=0;
    for(const g of q.games){
      if(!g||!text(g.gameId)||ids.has(g.gameId)||!text(g.home)||!text(g.away)||g.home===g.away||
        !Number.isInteger(g.season)||!day(g.gameDate)||g.reason!=='CONFLICTING_RETAINED_KICKOFFS'||
        !text(g.firstFrozenSnapshotId)||!Number.isFinite(instant(g.firstFrozenCommenceTime))||
        !Array.isArray(g.observedCommenceTimes)||g.observedCommenceTimes.length<2||
        !g.observedCommenceTimes.every(t=>Number.isFinite(instant(t)))||
        new Set(g.observedCommenceTimes).size!==g.observedCommenceTimes.length||
        !g.observedCommenceTimes.includes(g.firstFrozenCommenceTime)||
        !count(g.snapshotCount)||g.snapshotCount<g.observedCommenceTimes.length||!count(g.resultCount)||
        g.scoringEligible!==false||g.collectionEligible!==false)return false;
      ids.add(g.gameId);snapshots+=g.snapshotCount;results+=g.resultCount;
    }
    return snapshots===q.excludedSnapshotCount&&results===q.excludedResultCount&&
      visibleGames.every(g=>g&&text(g.gameId)&&!ids.has(g.gameId));
  }
  function quarantineHTML(q,{compact=false}={}) {
    if(q===undefined)return '';
    if(!quarantineValid(q))return '<section class="schedule-quarantine" role="note"><h4>Schedule conflict details unavailable</h4><p>Quarantine metadata is incomplete or inconsistent. Associated retained forecasts and scoring claims are withheld; excluded games cannot be verified.</p></section>';
    if(!q.excludedGameCount)return '';
    const heading='<section class="schedule-quarantine" role="note"><h4>Schedule conflict quarantine</h4><p><b>Quarantined games: '+q.excludedGameCount+' of '+q.rawGameCount+'. Excluded snapshots: '+q.excludedSnapshotCount+' of '+q.rawSnapshotCount+'. Excluded result records: '+q.excludedResultCount+' of '+q.rawResultCount+'.</b></p>';
    const details='<p>Remaining view: '+(q.rawGameCount-q.excludedGameCount)+' games, '+(q.rawSnapshotCount-q.excludedSnapshotCount)+' snapshots and '+(q.rawResultCount-q.excludedResultCount)+' result records. Record counts are not qualified scoring counts.</p>'+
      '<p>Conflicting retained kickoff times are unresolved. These games are excluded from forecast rankings, scoring and further collection. Original history is preserved unchanged; no kickoff has been selected or corrected.</p><ul class="quarantined-game-list">'+q.games.map(g=>
        '<li data-quarantined-game="'+esc(g.gameId)+'"><h5>'+esc(g.away+' @ '+g.home)+'</h5><p>Game ID: '+esc(g.gameId)+' · Season: '+esc(g.season)+' · Frozen game date: '+esc(g.gameDate)+'</p>'+
        '<p>First frozen kickoff UTC: '+esc(g.firstFrozenCommenceTime)+' · Snapshot ID: '+esc(g.firstFrozenSnapshotId)+'</p><p><b>All retained kickoff times UTC:</b> '+g.observedCommenceTimes.map(esc).join(' · ')+'</p><p>'+g.snapshotCount+' snapshots and '+g.resultCount+' result records preserved. Not eligible for ranking, scoring or collection.</p></li>').join('')+'</ul>';
    return heading+(compact?'<p>Other games have unresolved kickoff conflicts and remain excluded from rankings, scoring and collection.</p><details class="quarantine-details"><summary>Show all '+q.excludedGameCount+' quarantined games and evidence</summary>'+details+'</details>':details)+'</section>';
  }
  function valid(data,now) {
    if(!Number.isFinite(now)||data?.schema!==1||data.available!==true||data.kind!=='RETAINED_NFL_OUTRIGHT_FORECASTS'||
      !['BUNDLED_RETAINED_JOURNAL','PUBLIC_RETAINED_JOURNAL'].includes(data.source)||data.researchOnly!==true||data.sourcePublicationTimeVerified!==false||
      !Number.isFinite(instant(data.generatedAt))||instant(data.generatedAt)>now||
      !Array.isArray(data.games)||data.games.length>1000||!Number.isInteger(data.total)||data.total<data.games.length||
      data.limit!==1000||data.truncated!==(data.total>data.games.length)||
      data.limitations?.verifiedEdge!==false||data.limitations?.wagerRecommendation!==false||
      data.limitations?.currentModelRecomputation!==false||data.limitations?.currentMarketRefresh!==false||
      data.limitations?.verifiedInjuryAdjustment!==false||!optionalTime(data.latestSnapshotAt)||
      !quarantineValid(data.quarantine,data.games,data.total)) return false;
    if(data.source==='PUBLIC_RETAINED_JOURNAL' && (data.publication?.source!=='PUBLIC_JOURNAL'||
      !/^[a-f0-9]{64}$/.test(data.publication?.journalSha256)||data.publication.latestSnapshotAt!==data.latestSnapshotAt))return false;
    const ids=new Set();
    return data.games.every(g=>{
      const s=g?.latestSnapshot;
      if(!g||!text(g.gameId)||ids.has(g.gameId)||!text(g.home)||!text(g.away)||g.home===g.away||
        !day(g.gameDate)||!Number.isInteger(g.season)||!Number.isFinite(instant(g.commenceTime))||
        typeof g.hasRecordedResult!=='boolean'||!s||!same(g,s)||!text(s.id)||
        s.independentModel!==true||s.researchOnly!==true||
        !Number.isFinite(instant(s.capturedAt))||instant(s.capturedAt)>instant(data.generatedAt)||
        instant(s.capturedAt)>=instant(s.commenceTime)||g.latestSnapshotAt!==s.capturedAt||
        !Number.isFinite(instant(data.latestSnapshotAt))||instant(s.capturedAt)>instant(data.latestSnapshotAt)||
        !['model','market','challenger'].every(k=>typeof s.eligibility?.[k]==='boolean')||
        s.labels?.model!=='INDEPENDENT_RESEARCH_MODEL'||s.labels?.market!=='MARKET_DERIVED_NO_VIG_CONSENSUS'||
        !['modelBuiltAt','sourceReceivedAt','marketNewestQuoteAt','challengerBuiltAt'].every(k=>optionalTime(s[k]) &&
          (s[k]===null || (instant(s[k])<=instant(data.generatedAt)&&instant(s[k])<instant(s.commenceTime))))||
        (s.marketOldestQuoteAt!=null && (!Number.isFinite(instant(s.marketOldestQuoteAt))||
          instant(s.marketOldestQuoteAt)>instant(data.generatedAt)||instant(s.marketOldestQuoteAt)>=instant(s.commenceTime)||
          !Number.isFinite(instant(s.marketNewestQuoteAt))||instant(s.marketOldestQuoteAt)>instant(s.marketNewestQuoteAt))))return false;
      ids.add(g.gameId);
      // Raw probabilities without their chronology are never enough to display a forecast.
      if(s.eligibility.model && (!probability(s.modelHomeProbability)||!day(s.modelLastResultDate)||
        !Number.isFinite(instant(s.modelBuiltAt))||!Number.isFinite(instant(s.sourceReceivedAt))||
        instant(s.modelBuiltAt)>instant(s.capturedAt)+60000||instant(s.sourceReceivedAt)>instant(s.capturedAt)+60000||
        instant(s.sourceReceivedAt)<instant(s.capturedAt)-600000||
        instant(s.modelLastResultDate+'T00:00:00.000Z')+DAY>Math.min(instant(s.modelBuiltAt),instant(s.capturedAt))))return false;
      if(s.eligibility.market && (!s.eligibility.model||!probability(s.marketHomeProbability)||s.marketBasis!=='NO_VIG_MULTI_BOOK_MEDIAN'||
        !Number.isInteger(s.marketBookCount)||s.marketBookCount<3||!Number.isFinite(instant(s.marketNewestQuoteAt))||
        instant(s.marketNewestQuoteAt)>instant(s.capturedAt)+60000||instant(s.marketNewestQuoteAt)<instant(s.capturedAt)-600000||
        instant(s.marketNewestQuoteAt)>instant(s.sourceReceivedAt)+60000||
        (s.marketOldestQuoteAt!=null&&(instant(s.marketOldestQuoteAt)<instant(s.capturedAt)-600000||
          instant(s.marketNewestQuoteAt)>instant(s.sourceReceivedAt)||instant(s.sourceReceivedAt)>instant(s.capturedAt)))))return false;
      return true;
    });
  }
  function comparison(s,home,away,now=Date.now()) {
    const ok=s?.eligibility?.model===true && s.modelVersion==='nfl-elo-1' && s?.eligibility?.challenger===true &&
      s.challengerResearchOnly===true && s.challengerModelVersion==='nfl-efficiency-1' &&
      probability(s.modelHomeProbability) && probability(s.challengerHomeProbability) &&
      Number.isFinite(instant(s.challengerBuiltAt)) && Number.isFinite(instant(s.capturedAt)) &&
      instant(s.challengerBuiltAt)<=instant(s.capturedAt) && instant(s.capturedAt)<instant(s.commenceTime);
    if(!ok)return '<p data-forecast-comparison>EPA challenger unavailable: compatible pregame provenance required. No substitute probability.</p>';
    const p=s.challengerHomeProbability,primary=s.modelHomeProbability;
    const opposed=(p-.5)*(primary-.5)<0;
    const state=opposed?'Models favor opposite teams':p===.5||primary===.5?'At least one model has no preferred side':'Models favor the same team';
    return '<section class="model-comparison" data-forecast-comparison><h5>'+esc(state)+'</h5><p>Frozen EPA challenger: '+esc(home)+' '+percent(p)+' · '+esc(away)+' '+percent(1-p)+
      '. Separate experimental model, not a replacement for Elo.</p><p>Challenger version: '+esc(s.challengerModelVersion)+' · Built UTC: '+esc(s.challengerBuiltAt)+
      ' · Captured UTC: '+esc(s.capturedAt)+'. '+(now-instant(s.challengerBuiltAt)>7*DAY?'Stale challenger build. ':'')+
      'Historical capture, not a current recomputation; build age does not certify lineup freshness.</p><p>No injury or confirmed-starter adjustment, calibrated confidence interval, or proven superiority is established. '+
      'Model disagreement is uncertainty, not a betting edge. Models are not averaged; Elo ranking and the first frozen scoring baseline remain unchanged.</p></section>';
  }
  function describe(game,now) {
    const s=game.latestSnapshot;
    const modelAvailable=s.eligibility.model && s.modelVersion==='nfl-elo-1';
    const p=modelAvailable?s.modelHomeProbability:null;
    const selectedSide=p===null||p===.5?null:p>.5?'home':'away';
    const selectedTeam=selectedSide?game[selectedSide]:null;
    const selectedProbability=selectedSide==='home'?p:selectedSide==='away'?1-p:null;
    const marketQualified=s.eligibility.market&&s.marketOldestQuoteAt!=null;
    const retainedMarketProbability=selectedSide&&probability(s.marketHomeProbability)?(selectedSide==='home'?s.marketHomeProbability:1-s.marketHomeProbability):null;
    const marketProbability=marketQualified?retainedMarketProbability:null;
    const unqualifiedMarketProbability=!marketQualified?retainedMarketProbability:null;
    const reasons=[];
    if(!modelAvailable)reasons.push('Elo unavailable: missing provenance or unsupported model version');
    if(game.hasRecordedResult)reasons.push('Recorded result exists; archived forecast');
    if(now>=instant(game.commenceTime))reasons.push('Recorded kickoff passed; actual game status unverified');
    if(['SCHEDULE_RECONCILIATION_REQUIRED','SCHEDULE_REVIEW_IDENTITY_MISMATCH'].includes(game.scheduleReview?.status))reasons.push('Schedule conflict: reconciliation required');
    if(now-instant(s.capturedAt)>CAPTURE_DISPLAY_AGE)reasons.push('Stale capture: more than 24 hours old');
    if(modelAvailable && (now-instant(s.modelBuiltAt)>14*DAY||now-instant(s.modelLastResultDate+'T00:00:00.000Z')>28*DAY))reasons.push('Stale model vintage');
    if(modelAvailable && !selectedSide)reasons.push('No preferred side: Elo is 50/50');
    const minutes=Math.max(0,Math.floor((now-instant(s.capturedAt))/60000));
    return {game,now,snapshot:s,selectedTeam,selectedProbability,marketProbability,unqualifiedMarketProbability,modelAvailable,rank:null,
      rankEligible:reasons.length===0,
      status:reasons.length?reasons.join(' · '):'Retained pregame forecast; current schedule and game status unverified',
      age:'Capture age: '+minutes+' minutes. Saved observation, not live odds.',
      marketStatus:!marketQualified?'Same-capture market comparison unavailable: capture-time freshness/provenance unverified.':
        (now-instant(s.marketOldestQuoteAt??s.marketNewestQuoteAt)>600000?
          'Archived market reference; retained contributing quotes are over 10 minutes old. No executable price is retained.':
          'Saved market reference, not an executable price.')+
        (s.marketOldestQuoteAt==null?' Oldest contributing quote time is not retained.':' Oldest and newest contributing quote times are retained.')};
  }
  function build(data,now=Date.now()) {
    if(!valid(data,now))return {available:false,quarantine:data?.quarantine,message:'Saved forecasts unavailable: no complete, compatible retained evidence was returned. No replacement forecast or live odds request was made.'};
    const cards=data.games.map(g=>describe(g,now)).sort((a,b)=>a.game.gameDate.localeCompare(b.game.gameDate)||
      Number(b.rankEligible)-Number(a.rankEligible)||(b.selectedProbability??-1)-(a.selectedProbability??-1)||a.game.gameId.localeCompare(b.game.gameId));
    const counts=new Map();
    for(const c of cards)if(c.rankEligible){const n=(counts.get(c.game.gameDate)||0)+1;counts.set(c.game.gameDate,n);c.rank=n;}
    return {available:true,data,cards};
  }
  const field=(label,value)=>'<dt>'+esc(label)+'</dt><dd>'+esc(value)+'</dd>';
  function card(c) {
    const s=c.snapshot,g=c.game;
    const preferred=c.selectedTeam?'Saved Elo preference: '+c.selectedTeam+' '+percent(c.selectedProbability):
      c.modelAvailable?'Saved Elo: no preferred side (50/50)':'Saved Elo preference unavailable';
    return '<article class="retained-forecast-card" data-retained-forecast="'+esc(g.gameId)+'"><p class="forecast-rank" data-forecast-rank>'+esc(c.rank?'#'+c.rank+' on '+g.gameDate+' by saved outright probability':'Not ranked as a current pregame preference')+'</p>'+
      '<h4>'+esc(g.away+' @ '+g.home)+'</h4><p class="forecast-preference"><b>'+esc(preferred)+'</b></p>'+
      (c.selectedTeam?'<label>Experimental outright-win probability · 0–100%<meter min="0" max="1" value="'+c.selectedProbability+'" aria-label="'+esc(c.selectedTeam+' experimental outright-win forecast '+percent(c.selectedProbability)+'; not betting confidence')+'">'+percent(c.selectedProbability)+'</meter></label>':'')+
      comparison(s,g.home,g.away,c.now)+'<p class="forecast-status" data-forecast-status>'+esc(c.status)+'</p><p data-forecast-age>'+esc(c.age)+'</p><dl>'+
      field('Both teams · frozen Elo',c.modelAvailable?g.home+' '+percent(s.modelHomeProbability)+' · '+g.away+' '+percent(1-s.modelHomeProbability):'Unavailable; no substitute probability')+
      field('Same-capture market · selected side',c.marketProbability===null?'Unavailable':c.selectedTeam+' '+percent(c.marketProbability)+' · no-vig bookmaker consensus, not an independent forecast')+
      (c.unqualifiedMarketProbability===null?'':field('Archived market · unqualified',c.selectedTeam+' '+percent(c.unqualifiedMarketProbability)+' · retained market probability, not an independent forecast; capture-time freshness/provenance unverified'))+
      field('Model minus market',c.marketProbability===null?'Unavailable':((c.selectedProbability-c.marketProbability)*100).toFixed(1)+' percentage points. Disagreement only; not a validated edge.')+
      field('Forecast captured UTC',s.capturedAt)+field('Model version / built UTC',(s.modelVersion||'Not retained')+' / '+(s.modelBuiltAt||'Not retained'))+
      field('Model results through',s.modelLastResultDate||'Not retained')+field('Recorded kickoff UTC',g.commenceTime)+
      field('Market oldest quote UTC',s.marketOldestQuoteAt||'Not retained')+field('Market newest quote UTC',s.marketNewestQuoteAt||'Not retained')+field('Source receipt UTC',s.sourceReceivedAt||'Not retained')+
      field('Frozen snapshot ID',s.id)+'</dl><p data-forecast-market-status>'+esc(c.marketStatus)+'</p>'+
      '<p>Research only · unvalidated for betting · no injury, confirmed-starter or weather adjustment. Spread-cover and total probabilities unavailable. No stake recommended.</p>'+
      '<button class="outline-button" type="button" data-dossier-game="'+esc(g.gameId)+'">Inspect frozen evidence</button></article>';
  }
  function html(report) {
    if(!report.available)return quarantineHTML(report.quarantine)+'<p>'+esc(report.message)+'</p>';
    const d=report.data;
    const warning=quarantineHTML(d.quarantine);
    if(!report.cards.length)return warning+'<p>No retained NFL forecasts are available outside quarantine. No forecast has been generated or invented.</p>';
    return warning+'<p><b>Model preference, not a wager recommendation.</b> Rankings compare saved outright-win probabilities within each date, not value or expected profit. A favorite can still be a poor price. Elo is the fixed primary model; no larger challenger probability is substituted.</p>'+
      '<p>These binary forecasts do not model tied-game probability or sportsbook tie/void rules. No per-game uncertainty interval or calibrated confidence grade has been established. A capture older than 24 hours, stale model, passed recorded kickoff or known schedule conflict is unranked; these display rules do not certify freshness or accuracy.</p>'+
      '<p>Source: '+esc(d.source==='PUBLIC_RETAINED_JOURNAL'?'validated public retained journal':'bundled retained journal')+'. '+
      (d.publication?.lastError?'Latest journal read failed; last validated retained records are shown. ':'')+
      'Latest retained capture UTC: '+esc(d.latestSnapshotAt||'None')+'. Response generated UTC: '+esc(d.generatedAt)+', not a new forecast capture. Source publication time is unverified.</p>'+
      '<div class="retained-forecast-grid">'+report.cards.map(card).join('')+'</div>'+
      '<p>Showing '+d.games.length+' of '+d.total+' retained games outside quarantine.'+(d.truncated?' The index is bounded, not the complete journal.':'')+'</p>';
  }
  function mount(root,data,now=Date.now()) {
    if(!root)return;
    const report=build(data,now);
    contexts.delete(root);
    if(report.available)contexts.set(root,structuredClone(data));
    root.innerHTML=html(report);
  }
  function refresh(root,now=Date.now()) {
    if(!root||!contexts.has(root))return;
    const report=build(contexts.get(root),now);
    if(!report.available){contexts.delete(root);root.innerHTML=html(report);return;}
    const byId=new Map(report.cards.map(c=>[c.game.gameId,c]));
    for(const el of root.querySelectorAll('[data-retained-forecast]')){
      const c=byId.get(el.dataset.retainedForecast);if(!c)continue;
      const compare=el.querySelector('[data-forecast-comparison]');
      if(compare)compare.outerHTML=comparison(c.snapshot,c.game.home,c.game.away,now);
      for(const [key,value] of [['rank',c.rank?'#'+c.rank+' on '+c.game.gameDate+' by saved outright probability':'Not ranked as a current pregame preference'],['status',c.status],['age',c.age],['market-status',c.marketStatus]]){
        const target=el.querySelector('[data-forecast-'+key+']');if(target)target.textContent=value;
      }
    }
  }
  async function load(root,request,clock=Date.now) {
    if(!root)return;
    const serial=(requests.get(root)||0)+1;requests.set(root,serial);
    try{
      const data=await request('/api/research/forecasts');
      if(requests.get(root)===serial)mount(root,data,clock());
    }catch{
      if(requests.get(root)===serial)mount(root,null,clock());
    }
  }
  globalThis.BETQRetainedForecasts=Object.freeze({build,html,mount,refresh,load,comparison,quarantineValid,quarantineHTML});
})();
