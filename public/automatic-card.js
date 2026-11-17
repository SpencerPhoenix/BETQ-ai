'use strict';
(()=>{
 const root=document.getElementById('automatic-game-card');if(!root)return;
 let current=null,sequence=0;
 const p=(text,target=root)=>{const node=document.createElement('p');node.textContent=text;target.append(node);return node;};
 const link=()=>{const a=document.createElement('a');a.href='/game-card';a.textContent='Full matchup card and other upcoming games →';root.append(a);};
 async function load(){
  const token=++sequence;current=null;root.replaceChildren();p('Preparing the next verified NFL matchup…');
  try{
   const d=await fetch('/api/upcoming-games',{cache:'no-store'}).then(x=>{if(!x.ok)throw Error();return x.json();});
   if(token!==sequence)return;
   if(!d.available||!d.games?.length){root.replaceChildren();p('No verified upcoming regular-season matchup is available right now. No game or pick was substituted.');link();return;}
   const r=await fetch('/api/game-evaluation?gameId='+encodeURIComponent(d.games[0].gameId)+'&preview=scheduled',{cache:'no-store'}).then(x=>{if(!x.ok)throw Error();return x.json();});
   if(token!==sequence)return;
   if(!r.available||!Number.isFinite(Date.parse(r.validUntil))||Date.now()>=Date.parse(r.validUntil))throw Error();
   current=r;root.replaceChildren();
   const heading=document.createElement('h2');heading.textContent='Next NFL matchup · '+r.fixture.away+' at '+r.fixture.home;root.append(heading);
   const pick=r.baseline.homeWinProbability===.5?'No outright preference':r.baseline.homeWinProbability>.5?r.fixture.home:r.fixture.away;
   if(r.preview)p('SCHEDULED MODEL PREVIEW: game-center pregame status not yet available. Not a confirmed pregame forecast; excluded from the frozen pregame ledger.');
   p((r.preview?'PRELIMINARY OUTRIGHT LEAN: ':'MODEL OUTRIGHT PICK: ')+pick+'. Not a verified betting recommendation.').className='outlook-pick';
   const chances=document.createElement('div');chances.className='matchup-chances';
   for(const [team,value] of [[r.fixture.away,r.baseline.awayWinProbability],[r.fixture.home,r.baseline.homeWinProbability]]){
    const box=document.createElement('div');const name=document.createElement('span');name.textContent=team;
    const chance=document.createElement('strong');chance.textContent=(100*value).toFixed(1)+'%';
    const label=document.createElement('small');label.textContent='Unadjusted win estimate';box.append(name,chance,label);chances.append(box);
   }root.append(chances);
   if(r.challenger?.available&&(r.challenger.homeWinProbability-.5)*(r.baseline.homeWinProbability-.5)<0)p('The separate efficiency challenger favors the other team. Models disagree; no automatic promotion.');
   p('Why this team: the model compares team strength from past results and venue. It does not yet adjust for current injuries or quarterback changes.');
   const depth=r.depthContext;
   if(depth?.available&&Number.isFinite(Date.parse(depth.validUntil))&&Date.now()<Date.parse(depth.validUntil)){
    p('Listed quarterbacks: '+(depth.teams||[]).map(x=>x.team+' '+x.player).join(' · '));
    p('Depth chart loaded '+new Date(depth.sourceLoadAt).toLocaleString()+'. Listed roles only, not confirmed starters or injury clearance; probabilities remain unadjusted. Source: nflverse (CC-BY-4.0).');
   }else p('Current quarterback depth-chart context unavailable or stale. Starter status remains unknown.');
   const detail=document.createElement('details');const summary=document.createElement('summary');summary.textContent='How this estimate was made';detail.append(summary);
   p('Baseline built '+new Date(r.baseline.modelBuiltAt).toLocaleString()+'; results through '+r.baseline.throughGameDate+'.',detail);
   p('Kickoff '+new Date(r.fixture.kickoff).toLocaleString()+' · '+(r.fixture.neutralSite?'Neutral venue':'Home venue')+'. Times use your device timezone.');
   p('Current bookmaker odds: UNAVAILABLE. No verified betting edge. Quarterback, injury and weather effects are not modeled. Read the full card’s official context before interpreting the pick.');
   p('Evaluated '+new Date(r.evaluatedAt).toLocaleString()+' · official schedule observed '+new Date(r.fixture.observedAt).toLocaleString(),detail);
   p('Generated on opening this page, not a scheduled or automatically archived forecast.',detail);root.append(detail);
   if(d.failedWeeks?.length)p('Some nearby official weeks could not be verified. The game list may be incomplete.');
   link();const button=document.createElement('button');button.type='button';button.textContent='Refresh matchup';button.addEventListener('click',load);root.append(button);
  }catch{if(token===sequence){current=null;root.replaceChildren();p('Current matchup evaluation unavailable. No stale pick or price was substituted.');link();}}
 }
 setInterval(()=>{if(current&&(Date.now()>=Date.parse(current.validUntil)||(current.depthContext?.available&&Date.now()>=Date.parse(current.depthContext.validUntil)))){current=null;root.replaceChildren();p('Pregame evaluation expired. Refresh to verify a current matchup.');link();const b=document.createElement('button');b.type='button';b.textContent='Refresh matchup';b.addEventListener('click',load);root.append(b);}},1000);
 load();
})();
