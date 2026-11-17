/* Read-only grading of retained NFL evidence. Never collects odds or outcomes. */
(() => {
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=value=>typeof value==='number'&&Number.isFinite(value);
  const probability=value=>number(value)&&value>=0&&value<=1;
  const text=value=>typeof value==='string'&&value.length>0;
  const statuses={GRADED:'Graded',UNGRADED:'Ungraded',TIE_EXCLUDED:'Tie excluded',PENDING_RESULT:'Pending result',SCHEDULE_CONFLICT_QUARANTINED:'Schedule conflict: quarantined'};
  const bdlPolicy='BDL_NATIVE_FINAL_NFLVERSE_SCORE_REVIEWED_V1',v2Policy='SOURCE_CORROBORATED_SETTLEMENT_V2';
  const bdlSource='BALLDONTLIE_NFLVERSE_REVIEWED';
  function reviewedBdlResult(r){
    const q=r?.qualificationDetails;
    return !!q&&q.policyId===bdlPolicy&&q.source===bdlSource&&r.source===bdlSource&&
      q.label==='BDL native final + nflverse score agreement'&&r.sourceCorroborated===false&&
      r.descriptivelyQualified===true&&r.aggregateScoringEligible===false&&q.descriptivelyQualified===true&&
      q.aggregateScoringEligible===false&&q.sourceIndependenceVerified===false&&
      q.officialLeagueCertification===false&&q.historicalAsOfVerified===false&&
      q.sourceAuthenticityIndependentlyVerified===false&&q.providerPublicationTimeVerified===false&&
      q.verifiedAt===r.verifiedAt&&Number.isFinite(Date.parse(q.verifiedAt))&&
      typeof q.githubRunUrl==='string'&&/^https:\/\/github\.com\/SpencerPhoenix\/BETQ-ai\/actions\/runs\/[1-9]\d{0,19}$/.test(q.githubRunUrl);
  }
  function officialResult(r){
    const q=r?.qualificationDetails;
    return r?.source==='NFL_OFFICIAL_WEEKLY'&&r.sourceCorroborated===false&&r.descriptivelyQualified===true&&r.aggregateScoringEligible===false&&
      q?.policyId==='OFFICIAL_FINAL_DESCRIPTIVE_V1'&&q.source===r.source&&q.label==='Official NFL final score'&&
      q.descriptivelyQualified===true&&q.aggregateScoringEligible===false&&q.sourceIndependenceVerified===false&&q.historicalAsOfVerified===false&&
      q.verifiedAt===r.verifiedAt&&Number.isFinite(Date.parse(q.verifiedAt))&&/^[a-f0-9]{64}$/.test(q.sourceBodySha256)&&
      /^https:\/\/www\.nfl\.com\/scores\/20\d{2}\/week-([1-9]|1[0-8])$/.test(q.sourceUrl);
  }
  function qualifiedResult(r){
    if(r?.source==='NFL_OFFICIAL_WEEKLY'||r?.qualificationDetails?.policyId==='OFFICIAL_FINAL_DESCRIPTIVE_V1')return officialResult(r);
    if(r?.source===bdlSource||r?.qualificationDetails?.policyId===bdlPolicy)return reviewedBdlResult(r);
    if(r?.sourceCorroborated!==true||
      (r.descriptivelyQualified!==undefined&&r.descriptivelyQualified!==true)||
      (r.aggregateScoringEligible!==undefined&&r.aggregateScoringEligible!==true))return false;
    const q=r.qualificationDetails;
    return q==null||(q.policyId===v2Policy&&q.source==='NFLVERSE_SCHEDULES'&&q.descriptivelyQualified===true&&
      q.aggregateScoringEligible===true&&q.sourceIndependenceVerified===false&&q.officialLeagueCertification===false&&
      q.historicalAsOfVerified===false&&q.githubRunUrl===null&&q.verifiedAt===r.verifiedAt);
  }
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
      if(r?.qualificationDetails!=null&&!qualifiedResult(r))return false;
      if(g.status!=='GRADED')return m===null;
      if(!r||!qualifiedResult(r)||r.homeScore===r.awayScore||!m||!probability(g.modelHomeProbability)||!text(g.baselineSnapshotId)||!text(g.capturedAt)||(g.modelVersion!==null&&!text(g.modelVersion)))return false;
      if(!number(m.modelBrier)||m.modelBrier<0||m.modelBrier>1||!number(m.modelLogLoss)||m.modelLogLoss<0||!(typeof m.modelCorrect==='boolean'||(g.modelHomeProbability===.5&&m.modelCorrect===null)))return false;
      const marketAbsent=m.marketBrier===null&&m.marketLogLoss===null&&m.marketCorrect===null&&m.brierImprovement===null;
      return marketAbsent||(probability(g.marketHomeProbability)&&number(m.marketBrier)&&m.marketBrier>=0&&m.marketBrier<=1&&number(m.marketLogLoss)&&m.marketLogLoss>=0&&(typeof m.marketCorrect==='boolean'||(g.marketHomeProbability===.5&&m.marketCorrect===null))&&number(m.brierImprovement));
    })&&data.coverage.gradedGames===data.games.filter(g=>g.status==='GRADED').length&&validCohortCounts(data);
  }
  function validCohortCounts(data){
    const c=data.coverage,bdl=data.games.filter(g=>g.status==='GRADED'&&reviewedBdlResult(g.result)).length,
      v2=data.games.filter(g=>g.status==='GRADED'&&g.result?.sourceCorroborated===true).length;
    if(c.sourceCorroboratedV2GradedGames===undefined&&c.reviewedBdlGradedGames===undefined)return bdl===0;
    return c.sourceCorroboratedV2GradedGames===v2&&c.reviewedBdlGradedGames===bdl&&v2+bdl+(c.officialGradedGames??0)===c.gradedGames&&
      (c.officialGradedGames??0)===data.games.filter(g=>g.status==='GRADED'&&officialResult(g.result)).length;
  }
  const fixed=value=>number(value)?value.toFixed(3):'Not scored';
  const pct=value=>probability(value)?(value*100).toFixed(1)+'%':'Not available';
  const correct=(value,p,scored)=>value===true?'Correct':value===false?'Incorrect':scored&&p===.5?'No directional pick':'Not scored';
  function row(g) {
    const r=g.result,m=g.metrics,quarantined=g.status==='SCHEDULE_CONFLICT_QUARANTINED',official=officialResult(r),bdl=reviewedBdlResult(r),q=r?.qualificationDetails;
    return '<tr><th scope="row">'+esc(g.away+' @ '+g.home)+'<small>'+esc(g.gameDate)+' · '+esc(g.gameId)+'</small></th>'+
      '<td>'+esc(statuses[g.status])+(g.reasons.length?'<small>'+g.reasons.map(esc).join(' · ')+'</small>':'')+'</td>'+
      '<td>'+(r?esc(g.away+' '+r.awayScore+' · '+g.home+' '+r.homeScore)+'<small>'+(official?'Official NFL final score':bdl?'BDL native final + nflverse score agreement':r.sourceCorroborated?'Source corroborated (V2)':'Not source corroborated')+' · Revision '+esc(r.revision??'unknown')+'</small>'+
        (q?'<small>Source: '+esc(q.source)+'</small><small>Policy / separate cohort: '+esc(q.policyId)+'</small><small>Source independence unverified; not official league certification.</small>':'')+
        (official?'<small>Official final matched to original pregame forecast. Observed now, not saved to the retained journal. Descriptive only; excluded from qualified aggregate reports.</small><small><a href="'+esc(q.sourceUrl)+'">NFL result source</a> · Checked '+esc(q.verifiedAt)+'</small>':'')+
        (bdl?'<small>Operator-reviewed, not independently authenticated. Descriptive per-game grade only; excluded from V2 aggregate reports. Historical as-of and provider publication time unverified.</small>':''):'No retained final')+'</td>'+
      '<td>'+(!quarantined&&probability(g.modelHomeProbability)?'Original pick: '+esc(g.modelHomeProbability===.5?'No preference':g.modelHomeProbability>.5?g.home:g.away)+'<small>Win chance: '+pct(Math.max(g.modelHomeProbability,1-g.modelHomeProbability))+'</small>':'')+(quarantined?'Withheld':pct(g.modelHomeProbability))+'<small>Model: '+correct(m?.modelCorrect,g.modelHomeProbability,!!m)+'</small>'+(quarantined?'Withheld':pct(g.marketHomeProbability))+'<small>Market: '+correct(m?.marketCorrect,g.marketHomeProbability,number(m?.marketBrier))+'</small></td>'+
      '<td>'+fixed(m?.modelBrier)+'<small>Model log loss: '+fixed(m?.modelLogLoss)+'</small>'+fixed(m?.marketBrier)+'<small>Market log loss: '+fixed(m?.marketLogLoss)+'</small></td>'+
      '<td>'+fixed(m?.brierImprovement)+'</td><td>'+esc(g.baselineSnapshotId||'No eligible baseline')+'<small>Captured UTC: '+esc(g.capturedAt||'Not retained')+'</small><small>Model: '+esc(g.modelVersion||'Not retained')+'</small></td></tr>';
  }
  function html(data) {
    if(!valid(data))return '<p role="status">Game grading unavailable: complete, compatible retained evidence was not returned. Missing grades are not zeroes. No outcomes or forecasts were generated.</p>';
    const c=data.coverage;
    return '<p class="grade-coverage"><b>'+c.gradedGames+' graded / '+c.trackedGames+' tracked games</b> · '+(c.availableFinalScores??c.recordedResults)+' final scores available · '+c.ungradedGames+' ungraded · '+c.pendingGames+' pending results'+(c.quarantinedGames!==undefined?' · '+c.quarantinedGames+' held for conflicting game details':'')+'.</p>'+
      (c.reviewedBdlGradedGames!==undefined?'<p>Official final-score grades: '+(c.officialGradedGames??0)+'. Separate descriptive cohorts: '+c.sourceCorroboratedV2GradedGames+' V2 source-corroborated grades · '+c.reviewedBdlGradedGames+' reviewed BDL grades. Reviewed BDL outcomes are excluded from V2 aggregate reports.</p>':'')+
      '<p>All retained games are listed, including excluded and pending records. Qualified non-tie outcomes are scored against the original frozen pregame baseline, with the result policy identified for each game. Missing scores remain “Not scored”.</p>'+
      (data.games.length?'<div class="game-grades-scroll" role="region" aria-label="Retained NFL game grades" tabindex="0"><table class="game-grades-table"><caption>Frozen per-game probability grades. Home probabilities; model and market shown separately.</caption><thead><tr><th scope="col">Game</th><th scope="col">Status / reason</th><th scope="col">Final score</th><th scope="col">Home probability / direction</th><th scope="col">Brier / log loss</th><th scope="col">Brier improvement</th><th scope="col">Frozen baseline</th></tr></thead><tbody>'+data.games.map(row).join('')+'</tbody></table></div>':'<p>No retained games are available to grade.</p>')+
      '<p>Lower Brier score and log loss are better. Brier improvement is market minus model; positive means a lower model Brier score for that game, not proven future improvement. Directional correctness is not a probability-quality score.</p><p>Retained market probabilities are not executable prices, payouts or ROI. Research only; no verified betting edge or wagering recommendation.</p>'+
      (text(data.limitations?.notice)?'<p>'+esc(data.limitations.notice)+'</p>':'');
  }
  async function load(root,request) {
    if(!root)return;
    const serial=(requests.get(root)||0)+1;requests.set(root,serial);
    try {const data=await request('/api/research/grades');if(requests.get(root)===serial)root.innerHTML=html(data);}
    catch {if(requests.get(root)===serial)root.innerHTML=html(null);}
  }
  globalThis.BETQGameGrades=Object.freeze({valid,html,load,reviewedBdlResult,qualifiedResult,officialResult});
})();
