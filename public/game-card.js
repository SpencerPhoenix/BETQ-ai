'use strict';
const $=id=>document.getElementById(id);
const teams=['ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU','IND','JAX','KC','LA','LAC','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS'];
for(const id of ['home','away'])for(const t of teams){const o=document.createElement('option');o.value=o.textContent=t;$(id).append(o);}
$('season').value=new Date().getFullYear();$('away').value='LAC';$('home').value='BAL';
let discoveredGames=new Map();
let generation=0,current=null,contextExpires=null,userTouched=false;
const fixtureFresh=g=>Number.isFinite(Date.parse(g?.validUntil))&&Number.isFinite(Date.parse(g?.kickoff))&&Date.now()<Date.parse(g.validUntil)&&Date.now()<Date.parse(g.kickoff);
$('request').addEventListener('input',()=>{userTouched=true;});
$('refresh').addEventListener('click',()=>$('request').requestSubmit());
function paragraph(root,text,klass=''){const p=document.createElement('p');p.textContent=text;p.className=klass;root.append(p);}
const percent=x=>(100*x).toFixed(1)+'%';
// DOM text only: compare the same observations, never infer missing health or starters.
function renderPregameComparison(root,r,coverage=null){
 root.querySelector('.pregame-comparison')?.remove();
 const table=document.createElement('table');table.className='pregame-comparison';
 const caption=document.createElement('caption');caption.textContent='Pregame comparison · away vs home';table.append(caption);
 const sides=r.gameId.split('_').slice(2), names=[r.fixture.away,r.fixture.home];
 const head=document.createElement('thead'),hr=document.createElement('tr');
 for(const label of ['Compare',...names]){const th=document.createElement('th');th.scope='col';th.textContent=label;hr.append(th);}head.append(hr);table.append(head);
 const body=document.createElement('tbody');table.append(body);
 const row=(label,values)=>{const tr=document.createElement('tr'),th=document.createElement('th');th.scope='row';th.textContent=label;tr.append(th);for(const value of values){const td=document.createElement('td');td.textContent=value;tr.append(td);}body.append(tr);};
 const fresh=x=>x?.available===true&&Number.isFinite(Date.parse(x.validUntil))&&Date.now()<Date.parse(x.validUntil);
 const depth=fresh(r.depthContext)?r.depthContext:null;
 row('Unadjusted win estimate',[percent(r.baseline.awayWinProbability),percent(r.baseline.homeWinProbability)]);
 row('Listed quarterback',sides.map(team=>depth?.teams?.find(x=>x.team===team)?.player||'Unavailable or stale'));
 row('Confirmed starter',['Unknown','Unknown']);
 const usable=coverage?.gameId===r.gameId&&fresh(coverage);
 const teamRows=sides.map(team=>usable?coverage.teams?.find(x=>x.team===team):null);
 row('Injury report',teamRows.map(x=>x?.teamWeekRecordPresent?'Team-week record present; completeness unknown':coverage?'No usable team-week report':'Checking source…'));
 row('Practice / game status',teamRows.map(x=>!x?.teamWeekRecordPresent?'Unknown':!x.practiceFieldsRetained?'Practice fields unavailable':!x.participationRecords?.length?'No player records retained; health unknown':x.participationRecords.map(p=>p.player+': practice '+p.practiceParticipation+'; designation '+p.gameDesignation+'; inactives '+p.inactiveStatus+'; player timestamp '+(p.dateModified||'unknown')).join('\n\n')));
 row('Depth source loaded',sides.map(()=>depth?new Date(depth.sourceLoadAt).toLocaleString():'Unavailable or stale'));
 row('Injury file updated',sides.map(()=>coverage?.gameId===r.gameId&&coverage.sourceUpdatedAt?new Date(coverage.sourceUpdatedAt).toLocaleString():'Unknown'));
 const note=document.createElement('tfoot'),tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=3;td.textContent='Sources: nflverse depth charts and injury feed (CC-BY-4.0). File timestamps are not player-news timestamps. Listed QB is not a confirmed starter. Missing reports do not mean healthy. DNP is not OUT; FP is not starter confirmation. Neither feed adjusts these probabilities.';tr.append(td);note.append(tr);table.append(note);
 root.prepend(table);
}

$('request').addEventListener('submit',async e=>{
 e.preventDefault();const token=++generation;current=null;contextExpires=null;$('result').hidden=true;$('quote').hidden=true;$('context').replaceChildren();$('comparison').textContent='';$('receipt').textContent='';$('evaluate').disabled=true;$('status').textContent='Checking official schedule and current model…';
 const gameId=`${$('season').value}_${String($('week').value).padStart(2,'0')}_${$('away').value}_${$('home').value}`;
 try{
  const response=await fetch('/api/game-evaluation?gameId='+encodeURIComponent(gameId)+'&preview=scheduled',{cache:'no-store'});const r=await response.json();if(token!==generation)return;
  $('receipt').textContent=JSON.stringify(r,null,2);
  if(!response.ok||!r.available||!Number.isFinite(Date.parse(r.validUntil))||Date.now()>=Date.parse(r.validUntil)){$('status').textContent='No current evaluation: '+(r.reason||r.error?.code||'unavailable');return;}
  current=r;$('status').textContent='Evaluated '+new Date(r.evaluatedAt).toLocaleString()+'. Official schedule observed '+new Date(r.fixture.observedAt).toLocaleString();
  const out=$('result');out.replaceChildren();out.hidden=false;
  const h=document.createElement('h2');h.textContent=r.fixture.away+' at '+r.fixture.home;out.append(h);
  paragraph(out,'Kickoff: '+new Date(r.fixture.kickoff).toLocaleString()+' · '+(r.fixture.neutralSite?'Neutral venue':'Home venue'));
  const pick=r.baseline.homeWinProbability===.5?'No outright preference':r.baseline.homeWinProbability>.5?r.fixture.home:r.fixture.away;
  if(r.preview)paragraph(out,'SCHEDULED MODEL PREVIEW: game-center pregame status not yet available. Not a confirmed pregame forecast; excluded from the frozen pregame ledger.','warning');
  paragraph(out,(r.preview?'PRELIMINARY OUTRIGHT LEAN: ':'MODEL OUTRIGHT PICK: ')+pick+'. This is not a verified betting recommendation.','warning');
  paragraph(out,'Estimated win chance (Elo baseline): '+r.fixture.home+' '+percent(r.baseline.homeWinProbability)+' · '+r.fixture.away+' '+percent(r.baseline.awayWinProbability));
  paragraph(out,'Why this team: the model compares team strength from past results and venue. It does not yet adjust for current injuries or quarterback changes.');
  renderPregameComparison($('context'),r);
  const depth=r.depthContext;
  paragraph($('context'),'Pregame quarterback context');
  if(depth?.available&&Number.isFinite(Date.parse(depth.validUntil))&&Date.now()<Date.parse(depth.validUntil)){
   contextExpires=Date.parse(depth.validUntil);
   for(const row of depth.teams||[])paragraph($('context'),row.team+' listed QB1: '+row.player);
   paragraph($('context'),'Depth-chart source loaded '+new Date(depth.sourceLoadAt).toLocaleString()+'; collected '+new Date(depth.collectedAt).toLocaleString()+'.');
   paragraph($('context'),'Listed role only, not confirmed starter or injury clearance. These names do not adjust the model probabilities.','warning');
   paragraph($('context'),'Source: nflverse depth charts (CC-BY-4.0). Source-load time is not the announcement time.');
  }else paragraph($('context'),'Current quarterback depth-chart context unavailable or stale. Starter status remains unknown.','warning');
  const detail=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Model comparison & build details';detail.append(summary);
  paragraph(detail,'Model built '+new Date(r.baseline.modelBuiltAt).toLocaleString()+' · results through '+r.baseline.throughGameDate);
  if(r.challenger.available){paragraph(detail,'Efficiency challenger: '+r.fixture.home+' '+percent(r.challenger.homeWinProbability)+' · '+r.fixture.away+' '+percent(r.challenger.awayWinProbability));
   paragraph(detail,'Challenger built '+new Date(r.challenger.generatedAt).toLocaleString());
   if((r.challenger.homeWinProbability-.5)*(r.baseline.homeWinProbability-.5)<0)paragraph(out,'Models favor opposite teams. Neither is automatically promoted.','warning');
  }else paragraph(detail,'Challenger unavailable: '+r.challenger.reason);
  out.append(detail);
  paragraph(out,'No current odds, validated spread/total probability, or demonstrated betting edge. These probabilities omit quarterback and injury adjustments.','warning');
  $('quote').hidden=r.preview===true;$('side').options[0].textContent=r.fixture.home;$('side').options[1].textContent=r.fixture.away;
  const source=await fetch('/api/injuries/nfl?gameId='+encodeURIComponent(gameId),{cache:'no-store'}).then(x=>{if(!x.ok)throw Error('CONTEXT_UNAVAILABLE');return x.json();}).catch(()=>({}));if(token!==generation||current!==r||Date.now()>=Date.parse(r.validUntil))return;
  const coverage=source.matchupCoverage;
  renderPregameComparison($('context'),r,coverage||{});
  if(coverage?.gameId===gameId){
   paragraph($('context'),'Injury matchup coverage: '+coverage.coverage+'. Source-file freshness is not matchup completeness.','warning');
   paragraph($('context'),'Source file updated: '+(coverage.sourceUpdatedAt||'unknown')+'. '+coverage.caveat);
   if(coverage.available&&Number.isFinite(Date.parse(coverage.validUntil)))contextExpires=Math.min(contextExpires??Infinity,Date.parse(coverage.validUntil));
   for(const team of coverage.teams||[])for(const player of team.participationRecords||[])paragraph($('context'),team.team+' · '+player.player+': practice '+player.practiceParticipation+'; game designation '+player.gameDesignation+'; inactives '+player.inactiveStatus+'; player timestamp '+(player.dateModified||'unknown'));
   for(const link of coverage.officialSourceLinks||[]){if(!/^https:\/\/www\.(houstontexans|colts)\.com\/news\//.test(link.url))continue;const a=document.createElement('a');a.href=link.url;a.textContent=link.title;a.target='_blank';a.rel='noopener noreferrer';const p=document.createElement('p');p.append(a);$('context').append(p);}
  }else paragraph($('context'),'Matchup injury coverage unavailable. Global feed freshness is not evidence of coverage.','warning');
  const reviews=[...(source.officialReviews||[]),...(source.rosterContextReviews||[])].filter(x=>x.gameId===gameId);
  paragraph($('context'),'Official context for this matchup (pilot coverage; not model adjustments):');
  if(!reviews.length)paragraph($('context'),'No supported official context. Missing records do not mean healthy or confirmed starters.','warning');
  else for(const review of reviews){
   if(!review.available||Date.now()>=Date.parse(review.validUntil)){paragraph($('context'),'Official context expired or unavailable: '+(review.reason||'EXPIRED'),'warning');continue;}
   contextExpires=Math.min(contextExpires??Infinity,Date.parse(review.validUntil));
   paragraph($('context'),'Observed '+new Date(review.observedAt).toLocaleString()+' · valid until '+new Date(review.validUntil).toLocaleString());
   if(review.expectedQuarterback)paragraph($('context'),'Expected Baltimore starter: '+review.expectedQuarterback+'. Injured reserve: '+review.injuredReserve.join(', ')+'. This is an attributed expectation, not verified first-snap participation.','warning');
   for(const c of review.conflicts||[])paragraph($('context'),c.player+': official '+c.officialStatus+' versus nflverse '+c.nflverseStatus+'.','warning');
   for(const player of review.officialFlaggedPlayers||[])paragraph($('context'),player.team+' · '+player.player+' ('+player.position+'): '+player.status+' · '+player.injury);
   for(const source of review.sources||[{url:review.sourceUrl,title:'Official club injury report'}]){if(typeof source.url!=='string'||!/^https:\/\/(www\.)?(chargers|baltimoreravens)\.com\//.test(source.url))continue;const a=document.createElement('a');a.href=source.url;a.textContent=source.title||'Official source';a.target='_blank';a.rel='noopener noreferrer';const p=document.createElement('p');p.append(a);$('context').append(p);}
  }
 }catch{if(token===generation)$('status').textContent='Could not retrieve a current evaluation. No price or probability substituted.';}
 finally{if(token===generation)$('evaluate').disabled=false;}
});
$('compare').addEventListener('click',()=>{
 if(current?.preview){$('comparison').textContent='Scheduled preview only. Price comparisons are disabled until pregame status is confirmed.';return;}
 if(!current||!Number.isFinite(Date.parse(current.validUntil))||Date.now()>=Date.parse(current.validUntil)){$('comparison').textContent='Evaluation expired. Evaluate the matchup again before comparing.';return;}
 const a=Number($('price').value);if(!Number.isFinite(a)||Math.abs(a)<100||Math.abs(a)>100000){$('comparison').textContent='Enter valid American odds of +100 or higher, or −100 or lower.';return;}
 const p=$('side').value==='home'?current.baseline.homeWinProbability:current.baseline.awayWinProbability;
 const decimal=a>0?1+a/100:1+100/-a,breakeven=1/decimal;
 $('comparison').textContent='User-entered price requires '+percent(breakeven)+' to break even. Unadjusted model: '+percent(p)+'. Arithmetic expected return: '+((p*decimal-1)*100).toFixed(1)+'%. Not a validated edge or recommended stake; quarterback/lineup effects remain unmodeled.';
});
setInterval(()=>{
 for(const option of $('upcoming').options){const g=discoveredGames.get(option.value);if(g&&!fixtureFresh(g)){option.textContent=g.away+' at '+g.home+' · Schedule expired; select to recheck';}}
 if(contextExpires!==null&&Date.now()>=contextExpires){contextExpires=null;$('context').replaceChildren();paragraph($('context'),'Official context expired. Evaluate again to refresh.','warning');}if(current&&(!Number.isFinite(Date.parse(current.validUntil))||Date.now()>=Date.parse(current.validUntil))){current=null;$('status').textContent='This evaluation has expired. Refresh before using it.';$('result').hidden=true;$('quote').hidden=true;$('context').replaceChildren();paragraph($('context'),'Refresh required: the displayed evaluation/context is no longer current.','warning');}},1000);

function chooseGame(gameId){const [season,week,away,home]=gameId.split('_');$('season').value=season;$('week').value=Number(week);$('away').value=away;$('home').value=home;
 $('request').requestSubmit();}
$('upcoming').addEventListener('change',()=>{userTouched=true;if($('upcoming').value)chooseGame($('upcoming').value);});
(async()=>{
 try{
  const response=await fetch('/api/upcoming-games',{cache:'no-store'});if(!response.ok)throw Error('DISCOVERY_UNAVAILABLE');
  const r=await response.json();if(userTouched||generation!==0)return;
  $('upcoming').replaceChildren();
  if(!r.available||!r.games?.length){const o=document.createElement('option');o.textContent='No verified upcoming matchup available';o.value='';$('upcoming').append(o);$('discovery').textContent='No current verified regular-season game found in the next seven days. Manual selection remains available; no fixture was invented.';return;}
  discoveredGames=new Map(r.games.map(g=>[g.gameId,g]));
  for(const g of r.games){const o=document.createElement('option');o.value=g.gameId;o.textContent=g.away+' at '+g.home+' · '+new Date(g.kickoff).toLocaleString()+(g.neutralSite?' · Neutral venue':'')+(g.forecastReady===false?' · Scheduled, awaiting pregame status':'');$('upcoming').append(o);}
  $('discovery').textContent='Nearest verified future kickoff selected. Times use your device timezone. '+(r.failedWeeks?.length?'Some official weeks could not be verified. ':'')+'Coverage is limited to nearby regular-season weeks; no paid odds requested.';
  chooseGame(r.games[0].gameId);
 }catch{if(!userTouched&&generation===0){$('upcoming').options[0].textContent='Automatic discovery unavailable';$('discovery').textContent='Could not verify upcoming fixtures. Use manual selection or reload; no substitute fixture was generated.';}}
})();
