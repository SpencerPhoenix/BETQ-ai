/* Frozen historical mode. No live data, localStorage, credentials, paid intents or write actions. */
export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const fmt=(n,d=2)=>Number.isFinite(n)?n.toFixed(d):'Unavailable';
const signed=n=>Number.isFinite(n)?(n>0?'+':'')+fmt(n):'Unavailable';
const keys=['market','marketPlusEfficiency','independentEfficiency'];
const phase=g=>g.gameType==='REG'?'Regular season':'Playoffs';
export const gameLabel=g=>g.away+' at '+g.home+' · '+g.gameDate+' · Week '+g.week+' · '+phase(g);
export function filterGames(games,{search='',week='',phase:selection=''}={}){
  const query=search.trim().toLowerCase();
  return games.filter(g=>(!query||[g.gameId,g.home,g.away,g.gameDate].join(' ').toLowerCase().includes(query))&&
    (!week||String(g.week)===String(week))&&(!selection||(selection==='REG'?g.gameType==='REG':g.gameType!=='REG')));
}
export function gameIdFromHash(hash,games){
  const candidate=String(hash||'').replace(/^#/, '');
  return /^2025_\d{2}_[A-Z]{2,3}_[A-Z]{2,3}$/.test(candidate)&&games.some(g=>g.gameId===candidate)?candidate:null;
}
export function validSummary(s){
  return s?.schema===1&&s.mode==='HISTORICAL_2025_FROZEN'&&s.available===true&&s.season===2025&&s.gameCount===285&&
    Array.isArray(s.games)&&s.games.length===285&&new Set(s.games.map(g=>g.gameId)).size===285&&
    s.games.every(g=>/^2025_\d{2}_[A-Z]{2,3}_[A-Z]{2,3}$/.test(g.gameId)&&typeof g.gameDate==='string'&&typeof g.home==='string'&&typeof g.away==='string')&&
    keys.every(k=>Number.isFinite(s.metrics?.[k]?.mae)&&Number.isFinite(s.metrics?.[k]?.rmse))&&
    Array.isArray(s.limitations)&&s.limitations.length>=5&&s.provenance?.fitSeason===2023&&s.provenance?.calibrationSeason===2024;
}
export function validGame(g,expected){
  return g?.gameId===expected&&g.season===2025&&typeof g.home==='string'&&typeof g.away==='string'&&
    Number.isFinite(g.actual?.homeScore)&&Number.isFinite(g.actual?.awayScore)&&Number.isFinite(g.actual?.margin)&&
    g.actual.homeScore-g.actual.awayScore===g.actual.margin&&
    keys.every(k=>Number.isFinite(g.models?.[k]?.margin)&&Number.isFinite(g.models?.[k]?.signedError)&&Number.isFinite(g.models?.[k]?.absoluteError)&&
      Math.abs(g.models[k].signedError-(g.models[k].margin-g.actual.margin))<1e-8&&Math.abs(g.models[k].absoluteError-Math.abs(g.models[k].signedError))<1e-8)&&
    g.analogs?.count===50&&Array.isArray(g.analogs.neighbors)&&g.analogs.neighbors.length===50&&
    g.analogs.neighbors.every(n=>/^202[34]_/.test(n.gameId)&&Number.isFinite(n.actualMargin)&&Number.isFinite(n.marketMargin)&&Number.isFinite(n.distance))&&
    ['epaDiff','successDiff','restDiff'].every(k=>Number.isFinite(g.features?.[k]))&&
    ['home','away'].every(k=>Array.isArray(g.features?.[k]?.includedGameIds));
}
export function renderSummary(s){
  return '<h2>All 285 games, without cherry-picking</h2><p>'+esc(s.regularSeasonGames)+' regular-season games + '+esc(s.playoffGames)+' playoff games. '+esc(s.pushGames)+' spread push. Errors are in points; lower is better.</p>'+
    '<div class="scorecards">'+keys.map(k=>'<article class="scorecard '+k+'"><h3>'+esc(s.metrics[k].label)+'</h3><strong>'+fmt(s.metrics[k].mae,3)+'</strong><span>Mean absolute margin error</span><p>RMSE '+fmt(s.metrics[k].rmse,3)+' points</p></article>').join('')+'</div>'+
    '<p class="cohort-result"><strong>The correction did not beat the benchmark.</strong> It reduced absolute error in '+esc(s.correction.improved)+' games and increased it in '+esc(s.correction.worsened)+' ('+esc(s.correction.tied)+' ties). This does not establish a betting strategy or profit.</p>';
}
export function renderProvenance(s){
  const p=s.provenance;
  const sourceLink=url=>typeof url==='string'&&/^https:\/\/github\.com\/nflverse\/nflverse-data\//.test(url)?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(url)+'</a>':'Source URL unavailable';
  return '<h2>What this evidence can and cannot show</h2><p>Data attribution: '+esc(p.attribution)+'. <a href="/historical-source-license.txt" target="_blank" rel="noopener noreferrer">CC BY 4.0 license text</a>. '+esc(p.modificationNotice)+' '+esc(p.rightsNotice)+'</p><ul>'+s.limitations.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>'+
    '<details><summary>Method and source provenance</summary><dl><dt>Fit / calibration / evaluation</dt><dd>2023 / 2024 / 2025</dd><dt>Fit method</dt><dd>'+esc(p.fit)+'</dd><dt>Analog method</dt><dd>'+esc(p.similarity)+'</dd><dt>Experiment status</dt><dd>'+esc(p.status)+'</dd><dt>Protocol recorded</dt><dd>'+esc(p.protocolRecordedAt)+' (retrospective protocol, not a pregame forecast receipt)</dd><dt>Attribution / license</dt><dd>'+esc(p.attribution)+' · '+esc(p.license)+'</dd><dt>Source metadata observed</dt><dd>'+esc(p.metadataObservedAt)+' (not historical publication or quote time)</dd><dt>Protocol</dt><dd>'+esc(p.protocolId)+'</dd><dt>Experiment script SHA-256</dt><dd class="source-hash">'+esc(p.scriptSha256)+'</dd><dt>Source builder SHA-256</dt><dd class="source-hash">'+esc(p.sourceBuilderSha256)+'</dd></dl>'+
    '<h3>Exact frozen input fingerprints</h3><ul class="source-list">'+Object.entries(p.files).map(([name,hash])=>'<li>'+esc(name)+'<div class="source-hash">'+esc(hash)+'</div></li>').join('')+'</ul>'+
    '<h3>Retained source metadata</h3><ul class="source-list">'+p.sources.map(x=>'<li><strong>'+esc(x.name)+'</strong><br>'+sourceLink(x.url)+'<br>Source asset update: '+esc(x.updatedAt)+'<br>Local bytes verified: '+esc(x.localBytesVerifiedAt)+'<div class="source-hash">'+esc(x.sha256)+'</div></li>').join('')+'</ul><p>No upstream source is fetched by this viewer. Asset update and local verification times are not game-result certification or decision-time availability.</p></details>';
}
export function renderGame(g){
  const a=g.analogs;
  return '<p>'+esc(g.gameDate)+' · Week '+esc(g.week)+' · '+esc(phase(g))+' · '+esc(g.gameId)+'</p>'+
    '<div class="result"><div><span class="metric-label">ACTUAL SCORE</span><strong>'+esc(g.away)+' '+esc(g.actual.awayScore)+' · '+esc(g.home)+' '+esc(g.actual.homeScore)+'</strong></div><div><span class="metric-label">ACTUAL HOME MARGIN</span><strong>'+signed(g.actual.margin)+'</strong></div><div><span class="metric-label">AGAINST RECORDED SPREAD</span><strong>'+esc(g.actual.spreadOutcome)+'</strong></div></div>'+
    '<p>Every margin uses the home team’s perspective: positive means the home team is ahead. Error = forecast minus actual; positive means the forecast overstated the home margin.</p>'+
    '<div class="forecast-grid">'+keys.map(k=>'<article class="forecast"><h3>'+esc(g.models[k].label)+'</h3><strong>'+signed(g.models[k].margin)+'</strong><p>Expected home margin, points</p><dl><dt>Signed error</dt><dd>'+signed(g.models[k].signedError)+'</dd><dt>Absolute error</dt><dd>'+fmt(g.models[k].absoluteError)+' points</dd></dl><p>'+(k==='market'?'Recorded closing reference; not a live or executable quote.':k==='marketPlusEfficiency'?'Uses the recorded line plus a lagged efficiency/rest correction. Not independent of the market.':'Uses lagged efficiency/rest without the recorded line as a point-forecast input. Research model, not validated edge.')+'</p></article>').join('')+'</div>'+
    '<h3>Inputs retained for this game</h3><p>Lagged features only. Current-game QB availability, injuries and weather were not verified. The rest feature is capped at 18 days in the source reconstruction.</p><div class="input-grid">'+[['epaDiff','EPA difference',3],['successDiff','Success-rate difference',3],['restDiff','Rest-days difference',1]].map(([k,l,d])=>'<div><span>'+l+'</span><strong>'+fmt(g.features[k],d)+'</strong></div>').join('')+'</div>'+
    '<details><summary>Prior-game input provenance</summary>'+['home','away'].map(side=>'<h3>'+esc(g[side])+'</h3><p>'+esc(g.features[side].priorGames)+' retained prior games. Latest included game date: '+esc(g.features[side].latestIncludedGameDate)+'.</p><p>'+g.features[side].includedGameIds.map(esc).join(' · ')+'</p>').join('')+'</details>'+
    '<h3>50 prior-season analogs</h3><p>'+esc(a.homeCovers)+' home covers · '+esc(a.awayCovers)+' away covers · '+esc(a.pushes)+' pushes. Historical home-cover frequency excluding pushes: '+fmt(a.homeCoverRateGivenNoPush*100,1)+'%.</p><div class="notice">Descriptive similarity, not a model probability or recommendation. All neighbors are from 2023/2024. Distance uses lagged EPA, success, rest, recorded spread and total, with scaling fitted on 2023 only.</div>'+
    '<details><summary>Inspect all 50 retained neighbors</summary><p>Lower squared standardized distance means closer on those selected features. It does not measure forecast certainty. Scroll horizontally within the table on a small screen.</p><div class="table-scroll" tabindex="0" role="region" aria-label="All 50 historical analogs, horizontally scrollable"><table class="neighbors"><caption>Neighbors in retained nearest-first order. Margins are from each neighbor’s home-team perspective.</caption><thead><tr><th scope="col">Rank / game</th><th scope="col" class="number">Distance</th><th scope="col" class="number">Actual margin</th><th scope="col" class="number">Market margin</th><th scope="col">Spread result</th></tr></thead><tbody>'+a.neighbors.map(n=>'<tr><th scope="row">'+esc(n.rank)+' · '+esc(n.away)+' at '+esc(n.home)+'<br><span class="muted">'+esc(n.gameId)+'</span></th><td class="number">'+fmt(n.distance,3)+'</td><td class="number">'+signed(n.actualMargin)+'</td><td class="number">'+signed(n.marketMargin)+'</td><td>'+esc(n.outcome)+'</td></tr>').join('')+'</tbody></table></div></details>';
}
export function createGameLoader(request,update){
  let serial=0;const cache=new Map(),inflight=new Map();
  return {cancel(){serial++;},async load(gameId){
    const current=++serial;update({status:'loading',gameId});
    try{
      let game=cache.get(gameId);
      if(!game){
        if(!inflight.has(gameId)){
          const pending=Promise.resolve().then(()=>request('/api/historical-evaluation/game?gameId='+encodeURIComponent(gameId)))
            .then(value=>{if(!validGame(value,gameId))throw Error('INVALID_GAME');if(cache.size>=285)cache.delete(cache.keys().next().value);cache.set(gameId,value);return value;})
            .finally(()=>inflight.delete(gameId));
          inflight.set(gameId,pending);
        }
        game=await inflight.get(gameId);
      }
      if(current!==serial)return;update({status:'ready',gameId,game:JSON.parse(JSON.stringify(game))});
    }catch(error){if(current===serial)update({status:'error',gameId,reason:error?.code==='RATE_LIMITED'?'RATE_LIMITED':'UNAVAILABLE'});}
  }};
}

if(typeof document!=='undefined'){
  const $=id=>document.getElementById(id);
  $('return-terminal').hidden=location.pathname!=='/historical-2025';
  let summary=null,visible=[],selected=null,indexSerial=0,detailStatus=null;
  const request=async path=>{const response=await fetch(path,{cache:'no-store',headers:{Accept:'application/json'}});if(!response.ok)throw Object.assign(Error('UNAVAILABLE'),{code:response.status===429?'RATE_LIMITED':'UNAVAILABLE'});return response.json();};
  const loader=createGameLoader(request,result=>{
    detailStatus=result.status;
    $('game-panel').hidden=false;$('game-detail').innerHTML='';$('retry-game').hidden=result.status!=='error';
    const entry=summary?.games.find(g=>g.gameId===result.gameId);$('game-heading').textContent=entry?entry.away+' at '+entry.home:'Game evaluation';
    $('game-status').textContent=result.status==='loading'?'Reading frozen game record…':result.status==='error'?
      (result.reason==='RATE_LIMITED'?'Temporary historical read limit reached. Wait a few minutes, then retry.':'Game unavailable. No previous game or invented fallback is shown.'):
      'Frozen 2025 record loaded. No live data was requested.';
    if(result.status==='ready')$('game-detail').innerHTML=renderGame(result.game);
  });
  function choose(gameId,{historyMode='push'}={}){
    const previousSelection=selected,index=visible.findIndex(g=>g.gameId===gameId);selected=index>=0?gameId:null;
    $('game').value=selected||'';$('previous').disabled=index<=0;$('next').disabled=index<0||index>=visible.length-1;
    if(!selected){loader.cancel();detailStatus=null;$('game-panel').hidden=true;$('game-detail').innerHTML='';return;}
    if(historyMode!=='none'&&location.hash.slice(1)!==selected)history[historyMode==='replace'?'replaceState':'pushState'](null,'','#'+selected);
    if(selected!==previousSelection||detailStatus!=='ready')loader.load(selected);
  }
  function applyFilters(preferred=selected){
    visible=filterGames(summary.games,{search:$('search').value,week:$('week').value,phase:$('phase').value});
    $('filter-status').textContent=visible.length+' of 285 games match. '+(visible.length?'Ordered by date.':'Clear filters to inspect the complete season.');
    $('game').innerHTML=visible.map(g=>'<option value="'+esc(g.gameId)+'">'+esc(gameLabel(g))+'</option>').join('');$('game').disabled=!visible.length;
    choose(visible.some(g=>g.gameId===preferred)?preferred:visible[0]?.gameId,{historyMode:'replace'});
  }
  async function loadIndex(){
    const current=++indexSerial;loader.cancel();summary=null;selected=null;$('summary').innerHTML='';$('limitations').innerHTML='';$('game-panel').hidden=true;$('browser').hidden=true;$('retry-index').hidden=true;
    $('index-status').textContent='Reading the frozen experiment…';
    try{const value=await request('/api/historical-evaluation');if(current!==indexSerial)return;if(!validSummary(value))throw Error('INVALID_SUMMARY');summary=value;
      $('summary').innerHTML=renderSummary(summary);$('limitations').innerHTML=renderProvenance(summary);$('browser').hidden=false;
      $('week').innerHTML='<option value="">All weeks</option>'+[...new Set(summary.games.map(g=>g.week))].sort((a,b)=>a-b).map(w=>'<option value="'+w+'">Week '+w+'</option>').join('');
      $('index-status').textContent='285 frozen records loaded. Frozen source hashes verified; no network source refresh.';
      applyFilters(location.hash.slice(1));
    }catch(error){if(current===indexSerial){$('index-status').textContent=error?.code==='RATE_LIMITED'?
      'Temporary historical read limit reached. Wait a few minutes, then retry.':
      'Historical evaluation unavailable. The frozen artifacts must be present and match their expected hashes.';$('retry-index').hidden=false;}}
  }
  $('search').addEventListener('input',()=>{if(summary)applyFilters();});
  for(const name of ['week','phase'])$(name).addEventListener('change',()=>{if(summary)applyFilters();});
  $('game').addEventListener('change',()=>choose($('game').value));
  $('previous').addEventListener('click',()=>choose(visible[visible.findIndex(g=>g.gameId===selected)-1]?.gameId));
  $('next').addEventListener('click',()=>choose(visible[visible.findIndex(g=>g.gameId===selected)+1]?.gameId));
  $('clear-filters').addEventListener('click',()=>{$('search').value='';$('week').value='';$('phase').value='';applyFilters();});
  $('retry-game').addEventListener('click',()=>{if(selected)loader.load(selected);});$('retry-index').addEventListener('click',loadIndex);
  window.addEventListener('popstate',()=>{
    const requested=summary&&gameIdFromHash(location.hash,summary.games);
    if(requested){$('search').value='';$('week').value='';$('phase').value='';applyFilters(requested);}
  });
  loadIndex();
}
