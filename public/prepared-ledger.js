'use strict';
(()=>{
 const root=document.getElementById('prepared-model-ledger');if(!root)return;
 const p=text=>{const el=document.createElement('p');el.textContent=text;root.append(el);};
 function load(){root.replaceChildren();const h=document.createElement('h2');h.textContent='Background preparation · saved forecast ledger';root.append(h);
 p('Target: first capture 90–45 minutes before kickoff, checked about every 15 minutes. Scheduler delays and missed windows remain visible. This is separate from the card generated when you open BETQ.');
 fetch('/api/prepared-games',{cache:'no-store'}).then(x=>{if(!x.ok)throw Error();return x.json();}).then(r=>{
  if(!r.available||!r.publicationReadbackVerified)throw Error();
  p('Remote ledger read '+new Date(r.remoteLedgerObservedAt).toLocaleString()+'. Last scheduled run '+(r.lastRunAt?new Date(r.lastRunAt).toLocaleString():'none')+'.');
  if(r.productionCompatible===false)p('CAPTURE BLOCKED: deployed model or capture contract does not match the reviewed collector. No forecast was substituted.');
  if(r.schedulerStale)p('BACKGROUND SCHEDULER STALE: no recent run confirmed. Do not assume a card was prepared.');
  if(r.latestFailedWeeks?.length)p('Some official schedule weeks could not be verified; coverage is incomplete.');
  if(r.finalSourceAvailable===false||r.resultConflicts?.length)p('Some final results are missing or conflicting. Their grades remain withheld.');
  const games=[...(r.games||[])].sort((a,b)=>Date.parse(b.kickoff)-Date.parse(a.kickoff)).slice(0,12);
  if(!games.length)p('No game has entered this scheduled study yet. No forecast has been invented.');
  for(const g of games){
   const line=document.createElement('p');line.textContent=g.gameId+' · '+(g.kickoff?new Date(g.kickoff).toLocaleString():'unknown kickoff')+' · '+g.status.replaceAll('_',' ');root.append(line);
   if(g.custody&&g.captureId){p('Saved original forecast evaluated '+new Date(g.forecastEvaluatedAt).toLocaleString()+'; home win probability '+(100*g.homeWinProbability).toFixed(1)+'%.');const a=document.createElement('a');a.href='https://github.com/SpencerPhoenix/BETQ-ai/blob/'+g.custody.remoteCommit+'/ledger.json';a.textContent='Immutable capture ledger';a.target='_blank';a.rel='noopener noreferrer';root.append(a);}
   if(g.grade)p('Provisional final '+g.grade.homeScore+'–'+g.grade.awayScore+' · '+(g.grade.tie?'Tie: binary scores withheld':g.grade.pickWon===null?'No outright preference':g.grade.pickWon?'Model pick won':'Model pick lost')+(g.grade.brier===null?'':' · Brier '+g.grade.brier.toFixed(4))+'. Two public sources agree; upstream independence is not verified.');
  }
  p('Separate unqualified model-only study. Not market evidence, verified betting edge, fills, CLV or ROI. Remote readback is operator-observed, not independent timestamp attestation.');
 }).catch(()=>p('Scheduled ledger is not yet published or cannot be verified. No automatic-save claim is made.'));}
 load();setInterval(load,60000);
})();
