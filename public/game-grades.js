/* Read-only grading of retained NFL evidence. Never collects odds or outcomes. */
(() => {
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=value=>typeof value==='number'&&Number.isFinite(value);
  const probability=value=>number(value)&&value>=0&&value<=1;
  const text=value=>typeof value==='string'&&value.length>0;
  const statuses={GRADED:'Graded',UNGRADED:'Ungraded',TIE_EXCLUDED:'Tie excluded',PENDING_RESULT:'Pending result',SCHEDULE_CONFLICT_QUARANTINED:'Schedule conflict: quarantined'};
  const requests=new WeakMap();
  function valid(data) {
    if(data?.schema!==1||data.available!==true||data.researchOnly!==true||data.scope!=='RETAINED_NFL_GAMES'||!Array.isArray(data.games)||
      !['trackedGames','recordedResults','gradedGames','ungradedGames','pendingGames'].every(k=>Number.isSafeInteger(data.coverage?.[k])&&data.coverage[k]>=0)||
      data.coverage.trackedGames!==data.games.length)return false;
    const ids=new Set();
    return data.games.every(g=>{
      if(!g||!['gameId','home','away','gameDate'].every(k=>text(g[k]))||ids.has(g.gameId)||!Object.hasOwn(statuses,g.status)||!Array.isArray(g.reasons)||!g.reasons.every(text))return false;
      ids.add(g.gameId);
      const r=g.result,m=g.metrics;
      if(r!==null&&(!r||!Number.isSafeInteger(r.homeScore)||r.homeScore<0||!Number.isSafeInteger(r.awayScore)||r.awayScore<0||typeof r.sourceCorroborated!=='boolean'))return false;
      if(g.status!=='GRADED')return m===null;
      if(!r||r.sourceCorroborated!==true||r.homeScore===r.awayScore||!m||!probability(g.modelHomeProbability)||!text(g.baselineSnapshotId)||!text(g.capturedAt)||(g.modelVersion!==null&&!text(g.modelVersion)))return false;
      if(!number(m.modelBrier)||m.modelBrier<0||m.modelBrier>1||!number(m.modelLogLoss)||m.modelLogLoss<0||!(typeof m.modelCorrect==='boolean'||(g.modelHomeProbability===.5&&m.modelCorrect===null)))return false;
      const marketAbsent=m.marketBrier===null&&m.marketLogLoss===null&&m.marketCorrect===null&&m.brierImprovement===null;
      return marketAbsent||(probability(g.marketHomeProbability)&&number(m.marketBrier)&&m.marketBrier>=0&&m.marketBrier<=1&&number(m.marketLogLoss)&&m.marketLogLoss>=0&&(typeof m.marketCorrect==='boolean'||(g.marketHomeProbability===.5&&m.marketCorrect===null))&&number(m.brierImprovement));
    })&&data.coverage.gradedGames===data.games.filter(g=>g.status==='GRADED').length;
  }
  const fixed=value=>number(value)?value.toFixed(3):'Not scored';
  const pct=value=>probability(value)?(value*100).toFixed(1)+'%':'Not available';
  const correct=(value,p,scored)=>value===true?'Correct':value===false?'Incorrect':scored&&p===.5?'No directional pick':'Not scored';
  function row(g) {
    const r=g.result,m=g.metrics,quarantined=g.status==='SCHEDULE_CONFLICT_QUARANTINED';
    return '<tr><th scope="row">'+esc(g.away+' @ '+g.home)+'<small>'+esc(g.gameDate)+' · '+esc(g.gameId)+'</small></th>'+
      '<td>'+esc(statuses[g.status])+(g.reasons.length?'<small>'+g.reasons.map(esc).join(' · ')+'</small>':'')+'</td>'+
      '<td>'+(r?esc(g.away+' '+r.awayScore+' · '+g.home+' '+r.homeScore)+'<small>'+(r.sourceCorroborated?'Source corroborated':'Not source corroborated')+' · Revision '+esc(r.revision??'unknown')+'</small>':'No retained final')+'</td>'+
      '<td>'+(quarantined?'Withheld':pct(g.modelHomeProbability))+'<small>Model: '+correct(m?.modelCorrect,g.modelHomeProbability,!!m)+'</small>'+(quarantined?'Withheld':pct(g.marketHomeProbability))+'<small>Market: '+correct(m?.marketCorrect,g.marketHomeProbability,number(m?.marketBrier))+'</small></td>'+
      '<td>'+fixed(m?.modelBrier)+'<small>Model log loss: '+fixed(m?.modelLogLoss)+'</small>'+fixed(m?.marketBrier)+'<small>Market log loss: '+fixed(m?.marketLogLoss)+'</small></td>'+
      '<td>'+fixed(m?.brierImprovement)+'</td><td>'+esc(g.baselineSnapshotId||'No eligible baseline')+'<small>Captured UTC: '+esc(g.capturedAt||'Not retained')+'</small><small>Model: '+esc(g.modelVersion||'Not retained')+'</small></td></tr>';
  }
  function html(data) {
    if(!valid(data))return '<p role="status">Game grading unavailable: complete, compatible retained evidence was not returned. Missing grades are not zeroes. No outcomes or forecasts were generated.</p>';
    const c=data.coverage;
    return '<p class="grade-coverage"><b>'+c.gradedGames+' graded / '+c.trackedGames+' tracked games</b> · '+c.recordedResults+' recorded results · '+c.ungradedGames+' ungraded · '+c.pendingGames+' pending results.</p>'+
      '<p>All retained games are listed, including excluded and pending records. Only eligible, source-corroborated, non-tie outcomes are scored against a frozen pregame baseline. Missing scores remain “Not scored”.</p>'+
      (data.games.length?'<div class="game-grades-scroll" role="region" aria-label="Retained NFL game grades" tabindex="0"><table class="game-grades-table"><caption>Frozen per-game probability grades. Home probabilities; model and market shown separately.</caption><thead><tr><th scope="col">Game</th><th scope="col">Status / reason</th><th scope="col">Retained final score</th><th scope="col">Home probability / direction</th><th scope="col">Brier / log loss</th><th scope="col">Brier improvement</th><th scope="col">Frozen baseline</th></tr></thead><tbody>'+data.games.map(row).join('')+'</tbody></table></div>':'<p>No retained games are available to grade.</p>')+
      '<p>Lower Brier score and log loss are better. Brier improvement is market minus model; positive means a lower model Brier score for that game, not proven future improvement. Directional correctness is not a probability-quality score.</p><p>Retained market probabilities are not executable prices, payouts or ROI. Research only; no verified betting edge or wagering recommendation.</p>'+
      (text(data.limitations?.notice)?'<p>'+esc(data.limitations.notice)+'</p>':'');
  }
  async function load(root,request) {
    if(!root)return;
    const serial=(requests.get(root)||0)+1;requests.set(root,serial);
    try {const data=await request('/api/research/grades');if(requests.get(root)===serial)root.innerHTML=html(data);}
    catch {if(requests.get(root)===serial)root.innerHTML=html(null);}
  }
  globalThis.BETQGameGrades=Object.freeze({valid,html,load});
})();
