'use strict';
(()=>{
 const root=document.getElementById('automatic-game-card');if(!root)return;
 let current=null,sequence=0;
 const p=text=>{const node=document.createElement('p');node.textContent=text;root.append(node);};
 const link=()=>{const a=document.createElement('a');a.href='/game-card';a.textContent='Full matchup card and other upcoming games →';root.append(a);};
 async function load(){
  const token=++sequence;current=null;root.replaceChildren();p('Preparing the next verified NFL matchup…');
  try{
   const d=await fetch('/api/upcoming-games',{cache:'no-store'}).then(x=>{if(!x.ok)throw Error();return x.json();});
   if(token!==sequence)return;
   if(!d.available||!d.games?.length){root.replaceChildren();p('No verified upcoming regular-season matchup is available right now. No game or pick was substituted.');link();return;}
   const r=await fetch('/api/game-evaluation?gameId='+encodeURIComponent(d.games[0].gameId),{cache:'no-store'}).then(x=>{if(!x.ok)throw Error();return x.json();});
   if(token!==sequence)return;
   if(!r.available||!Number.isFinite(Date.parse(r.validUntil))||Date.now()>=Date.parse(r.validUntil))throw Error();
   current=r;root.replaceChildren();
   const heading=document.createElement('h2');heading.textContent='Next NFL matchup · '+r.fixture.away+' at '+r.fixture.home;root.append(heading);
   const pick=r.baseline.homeWinProbability===.5?'No outright preference':r.baseline.homeWinProbability>.5?r.fixture.home:r.fixture.away;
   p('MODEL OUTRIGHT PICK: '+pick+'. Not a verified betting recommendation.');
   p(r.fixture.home+' '+(100*r.baseline.homeWinProbability).toFixed(1)+'% · '+r.fixture.away+' '+(100*r.baseline.awayWinProbability).toFixed(1)+'% (unadjusted Elo research).');
   if(r.challenger?.available&&(r.challenger.homeWinProbability-.5)*(r.baseline.homeWinProbability-.5)<0)p('The separate efficiency challenger favors the other team. Models disagree; no automatic promotion.');
   p('Baseline built '+new Date(r.baseline.modelBuiltAt).toLocaleString()+'; results through '+r.baseline.throughGameDate+'.');
   p('Kickoff '+new Date(r.fixture.kickoff).toLocaleString()+' · evaluated '+new Date(r.evaluatedAt).toLocaleString()+' · official schedule observed '+new Date(r.fixture.observedAt).toLocaleString()+'. Times use your device timezone.');
   p('Current bookmaker odds: UNAVAILABLE. No verified betting edge. Quarterback, injury and weather effects are not modeled. Read the full card’s official context before interpreting the pick.');
   p('Generated on opening this page, not a scheduled or automatically archived forecast. '+(d.failedWeeks?.length?'Some nearby official weeks could not be verified.':''));
   link();const button=document.createElement('button');button.type='button';button.textContent='Refresh matchup';button.addEventListener('click',load);root.append(button);
  }catch{if(token===sequence){current=null;root.replaceChildren();p('Current matchup evaluation unavailable. No stale pick or price was substituted.');link();}}
 }
 setInterval(()=>{if(current&&Date.now()>=Date.parse(current.validUntil)){current=null;root.replaceChildren();p('Pregame evaluation expired. Refresh to verify a current matchup.');link();const b=document.createElement('button');b.type='button';b.textContent='Refresh matchup';b.addEventListener('click',load);root.append(b);}},1000);
 load();
})();
